import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-review-browser-")), repo = join(root, "repo");
const execute = promisify(execFile);
const git = (...args) => execute("git", args, { cwd: repo, windowsHide: true });
let server, browser, page, heldRoute, releaseFix, holdNext = false;
const reviews = [], fixes = [], errors = [];
const reply = { summary: "发现一处缺少空值处理的问题。", findings: [
  { path: "app.ts", side: "right", line: 2, priority: 1, title: "空值会导致运行时异常", body: "当 value 未定义时访问 trim 会抛出异常，建议先检查参数。" },
  { path: "app.ts", side: "right", line: 500, priority: 0, title: "错误行号不能进入面板", body: "invalid" },
] };
const modelReply = (route) => route.fulfill({ json: { choices: [{ message: { role: "assistant", content: JSON.stringify(reply) } }] } });
async function waitFor(predicate, message) {
  const deadline = Date.now() + 15_000;
  while (!predicate() && Date.now() < deadline) await delay(20);
  assert.ok(predicate(), message);
}
try {
  await mkdir(repo); await mkdir(".runtime", { recursive: true });
  await git("init", "-b", "main"); await git("config", "user.email", "fixture@example.invalid"); await git("config", "user.name", "Fixture");
  await writeFile(join(repo, "app.ts"), "export function clean(value: string) {\n  return value || '';\n}\n");
  await git("add", "."); await git("commit", "-m", "seed");
  await git("switch", "-c", "feature");
  await writeFile(join(repo, "committed.ts"), "export const branch = true;\n"); await git("add", "."); await git("commit", "-m", "feature");
  await writeFile(join(repo, "app.ts"), "export function clean(value: string) {\n  return value.trim();\n}\n");
  await writeFile(join(repo, "staged.md"), "# Staged change\n"); await git("add", "staged.md");
  await writeFile(join(repo, "binary.bin"), Buffer.from([0, 1, 2]));
  await writeFile(join(repo, "literal.ts"), "const html = '<img src=x onerror=window.__reviewXss=true>';\n");
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString(), workspaceKey = `pc:${server.url}:${repo}`;
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: {
    version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider],
    pcConnection: { baseUrl: server.url, workspacePath: repo, workspaceName: "审阅工作区" },
    chatSessions: [{ id: "review-session", title: "审阅测试会话", mode: "ai", workspaceKey, workspaceName: "审阅工作区", workspacePath: repo, messages: [{ id: "seed", role: "user", content: "审阅测试会话", createdAt: now }], createdAt: now, updatedAt: now }],
    llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
  } }) });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage(); page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/chat/completions", async (route) => {
    reviews.push(route.request().postDataJSON());
    if (holdNext) { holdNext = false; heldRoute = route; return; }
    await modelReply(route);
  });
  await page.route("**/api/pi/chat", async (route) => {
    fixes.push(route.request().postDataJSON());
    await new Promise((done) => { releaseFix = done; });
    await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "修复请求已收到。" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n` });
  });
  async function openReview() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    await page.locator(".chat-session-item").filter({ hasText: "审阅测试会话" }).locator("button").first().click();
    const toggle = page.getByRole("button", { name: "展开右侧栏", exact: true });
    if (await toggle.count()) await toggle.click();
    await page.getByRole("button", { name: /^审阅 查看与审阅代码变更/ }).click();
    await page.locator(".review-file-list").getByRole("button", { name: /app.ts/ }).waitFor();
    await page.locator(".review-file-list").getByRole("button", { name: /app.ts/ }).click();
    await page.locator(".review-diff").getByText("return value.trim();", { exact: true }).waitFor();
  }
  await page.goto(server.url); await openReview();
  const panel = page.getByLabel("代码审阅面板", { exact: true });
  const allFindings = panel.getByLabel("全部审阅意见", { exact: true });
  assert.match(await panel.locator(".review-repository").textContent(), /feature/);
  await panel.getByLabel("筛选变更文件").fill("binary");
  assert.equal(await panel.locator(".review-file-list > button").count(), 1);
  await panel.locator(".review-file-list").getByRole("button", { name: /binary.bin/ }).click();
  await panel.getByText("二进制文件，无法显示逐行差异。", { exact: true }).waitFor();
  await panel.getByLabel("筛选变更文件").fill("");
  await panel.locator(".review-file-list").getByRole("button", { name: /literal.ts/ }).click();
  await panel.locator(".review-diff").getByText(/const html =/).waitFor();
  assert.equal(await page.evaluate(() => Boolean(window.__reviewXss)), false, "source code must never execute as HTML");
  await panel.locator(".review-file-list").getByRole("button", { name: /app.ts/ }).click();
  await panel.getByRole("button", { name: "在新代码第2行添加评论", exact: true }).click();
  await panel.getByLabel("行级审阅评论").fill("手工意见：补充空值检查");
  await panel.getByRole("button", { name: "保存评论", exact: true }).click();
  assert.equal(await allFindings.locator(".review-finding").count(), 1);
  await allFindings.getByRole("button", { name: "编辑", exact: true }).click();
  await panel.getByLabel("行级审阅评论").fill("手工意见：同时处理空值和空字符串");
  await panel.getByLabel("问题优先级").selectOption("1");
  await panel.getByRole("button", { name: "保存评论", exact: true }).click();
  assert.equal(await allFindings.locator(".review-finding").count(), 1, "editing replaces the comment");
  await panel.getByLabel("标记当前文件已阅").check();
  await panel.getByRole("button", { name: "并排", exact: true }).click();
  assert.ok(await panel.locator(".review-split-row").count() > 0);
  await panel.getByRole("button", { name: "展开代码审阅", exact: true }).click();
  await page.screenshot({ path: ".runtime/code-review-expanded.png" });
  await panel.getByLabel("额外审阅要求").fill("重点检查空值处理");
  await panel.getByRole("button", { name: "开始审阅", exact: true }).click();
  await panel.getByText(/^审阅完成，发现 1 项问题/).waitFor();
  assert.equal(await allFindings.locator(".review-finding").count(), 2, "AI preserves manual comments and excludes invented lines");
  assert.equal(reviews[0].request.tools, undefined, "review cannot execute tools");
  assert.match(JSON.stringify(reviews[0].request.messages), /app.ts|重点检查空值处理/);
  await allFindings.getByRole("button", { name: "复制审阅报告", exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /app.ts:2/);
  await allFindings.locator(".review-finding").filter({ hasText: "手工意见" }).getByRole("button", { name: "标记解决", exact: true }).click();
  assert.equal(await allFindings.locator(".review-finding").count(), 1);
  await allFindings.getByLabel("显示已解决").check();
  assert.equal(await allFindings.locator(".review-finding").count(), 2);
  await page.reload(); await openReview();
  assert.equal(await panel.getByLabel("标记当前文件已阅").isChecked(), true, "reviewed state survives reload");
  assert.equal(await allFindings.locator(".review-finding").count(), 1, "unresolved AI findings survive reload");

  await writeFile(join(repo, "other.ts"), "export const unrelated = true;\n");
  await panel.getByRole("button", { name: "刷新代码变更", exact: true }).click();
  await panel.locator(".review-file-list").getByRole("button", { name: /other.ts/ }).waitFor();
  assert.equal(await allFindings.getByRole("button", { name: /交给当前会话修复/ }).isEnabled(), true, "unrelated changes do not invalidate an unchanged file's findings");

  await writeFile(join(repo, "app.ts"), "export function clean(value: string) {\n  return value.toUpperCase();\n}\n");
  await panel.getByRole("button", { name: "刷新代码变更", exact: true }).click();
  await panel.getByText("return value.toUpperCase();", { exact: true }).waitFor();
  assert.equal(await panel.getByLabel("标记当前文件已阅").isChecked(), false, "new file content invalidates reviewed state");
  assert.match(await allFindings.textContent(), /代码已变化/);
  assert.equal(await allFindings.getByRole("button", { name: /交给当前会话修复/ }).isEnabled(), false, "stale findings cannot request a fix");
  holdNext = true;
  await panel.getByRole("button", { name: "开始审阅", exact: true }).click();
  await waitFor(() => heldRoute, "AI request held");
  await writeFile(join(repo, "app.ts"), "export function clean(value: string) {\n  return value.toLowerCase();\n}\n");
  await modelReply(heldRoute); heldRoute = null;
  await panel.getByText("审阅期间代码已变化，请基于最新差异重新审阅。", { exact: true }).waitFor();
  holdNext = true;
  await panel.getByRole("button", { name: "开始审阅", exact: true }).click();
  await waitFor(() => heldRoute, "cancellable review held");
  await panel.getByRole("button", { name: "停止", exact: true }).click();
  await panel.getByText("AI 审阅已停止。", { exact: true }).waitFor();
  await modelReply(heldRoute).catch(() => {}); heldRoute = null;
  await panel.getByRole("button", { name: "开始审阅", exact: true }).click();
  await panel.getByText(/^审阅完成，发现 1 项问题/).waitFor();
  await page.locator("#send_textarea").fill("保留此草稿");
  await allFindings.getByRole("button", { name: /交给当前会话修复/ }).click();
  await waitFor(() => fixes.length === 1, "fix request sent to chat");
  await panel.getByText("已交给当前会话处理；会话运行中时会加入队列。", { exact: true }).waitFor();
  assert.equal(fixes[0].sessionId, "review-session");
  assert.match(JSON.stringify(fixes[0].request.messages), /空值会导致运行时异常|app.ts:2/);
  assert.equal(await page.locator("#send_textarea").inputValue(), "保留此草稿", "review handoff preserves an unsent composer draft");
  assert.doesNotMatch(JSON.stringify(fixes[0].request.messages), /保留此草稿/, "review handoff sends only the review request");
  releaseFix(); releaseFix = null;
  await page.locator(".chat-message.assistant").filter({ hasText: "修复请求已收到。" }).waitFor();

  await panel.getByRole("button", { name: "最近提交", exact: true }).click();
  await panel.locator(".review-file-list").getByRole("button", { name: /committed.ts/ }).waitFor();
  assert.equal(await panel.locator(".review-file-list > button").count(), 1);

  await panel.getByRole("button", { name: "已暂存", exact: true }).click();
  await panel.locator(".review-file-list").getByRole("button", { name: /staged.md/ }).waitFor();
  assert.equal(await panel.locator(".review-file-list > button").count(), 1);
  await panel.getByRole("button", { name: "分支变更", exact: true }).click();
  await panel.locator(".review-file-list").getByRole("button", { name: /committed.ts/ }).waitFor();
  assert.equal(await panel.locator(".review-file-list > button").count(), 1);
  await panel.getByRole("button", { name: "未暂存", exact: true }).click();
  await panel.locator(".review-file-list").getByRole("button", { name: /app.ts/ }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileToggle = page.getByRole("button", { name: "展开右侧栏", exact: true });
  if (await mobileToggle.count()) await mobileToggle.click();
  if (!await panel.count()) await page.getByRole("button", { name: /^审阅 查看与审阅代码变更/ }).click();
  await panel.getByRole("button", { name: "展开代码审阅", exact: true }).click();
  await panel.getByRole("button", { name: "在新代码第2行添加评论", exact: true }).waitFor();
  await page.screenshot({ path: ".runtime/code-review-mobile.png" });
  const bounds = await panel.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.width <= 390, "expanded review fits the mobile viewport");
  await panel.getByRole("button", { name: "在新代码第2行添加评论", exact: true }).click();
  await panel.getByLabel("行级审阅评论").fill("移动端可以添加行级评论");
  await panel.getByRole("button", { name: "保存评论", exact: true }).click();
  await allFindings.locator(".review-finding").filter({ hasText: "移动端可以添加行级评论" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Code review browser regression passed: real workspace, file scopes/search, unified/split, safe rendering, comments/edit/resolve, reviewed persistence, AI anchors/cancellation/staleness, fix handoff and narrow layout.");
} catch (error) {
  if (page && !page.isClosed()) { console.error("Review:", await page.locator(".code-review-panel").innerText().catch(() => "unavailable")); await page.screenshot({ path: ".runtime/code-review-failure.png" }); }
  throw error;
} finally {
  releaseFix?.();
  await heldRoute?.abort().catch(() => {});
  await browser?.close(); server?.server.closeAllConnections();
  if (server) await new Promise((done) => server.server.close(done));
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
