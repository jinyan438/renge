import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, _electron as electron } from "playwright";
import { startRengeServer } from "../server.mjs";

const desktop = process.argv.includes("--desktop");
const root = await mkdtemp(join(tmpdir(), "renge-chat-files-browser-"));
const repo = join(root, "workspace");
const now = new Date().toISOString();
const errors = [];
let server, browser, app, page;
const changes = { cwd: repo, total: 6, added: 12, deleted: 4, files: [
  { path: "app.ts", status: "modified", added: 3, deleted: 1 },
  { path: "new.md", status: "added", added: 2, deleted: 0 },
  { path: "removed.txt", status: "deleted", added: 0, deleted: 3 },
  { path: "docs/with space.md", status: "added", added: 2, deleted: 0 },
  { path: "fifth.ts", status: "added", added: 5, deleted: 0 },
  { path: "image.bin", status: "added", binary: true },
] };
try {
  await mkdir(join(repo, "docs"), { recursive: true }); await mkdir(join(root, "data")); await mkdir(".runtime", { recursive: true });
  await writeFile(join(repo, "app.ts"), "export const app = true;\nexport const lineTwo = 2;\n");
  await writeFile(join(repo, "new.md"), "# 新文件\n正文\n");
  await writeFile(join(repo, "docs", "with space.md"), "# 带空格的文档\n");
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const workspaceKey = `pc:${server.url}:${repo}`;
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  const data = { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], chatRenderedEditingEnabled: true,
    pcConnection: { baseUrl: server.url, workspacePath: repo, workspaceName: "路径测试工作区" },
    llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
    chatSessions: [{ id: "chat-files", title: "文件路径测试", mode: "ai", workspaceKey, workspaceName: "路径测试工作区", workspacePath: repo,
      messages: [{ id: "user", role: "user", content: "文件路径测试", createdAt: now }, { id: "answer", role: "assistant", createdAt: now,
        content: `查看 app.ts 和 \`app.ts:2\`，或 [文档](<${repo.replace(/\\/g, "/")}/docs/with space.md>)。\n\n[网站](https://example.com) [危险](javascript:alert)\n\n\`\`\`ts\nconst path = 'app.ts';\n\`\`\`` }], createdAt: now, updatedAt: now }] };
  await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
  if (desktop) {
    const desktopData = join(root, "desktop-data"); await mkdir(desktopData);
    await writeFile(join(desktopData, "app-data.json"), JSON.stringify(data));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
    Object.assign(env, { TEMP: root, TMP: root, RENGE_DATA_DIR: desktopData, RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"), RENGE_ELECTRON_CACHE_DIR: join(root, "cache") });
    app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
    const home = await app.firstWindow(); await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
    [page] = await Promise.all([app.waitForEvent("window"), home.getByRole("button", { name: "开始对话", exact: true }).click()]);
    await page.locator('body[data-desktop-window="chat"]').waitFor();
  } else {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    await page.goto(server.url);
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  }
  page.setDefaultTimeout(20_000); page.on("pageerror", error => errors.push(error.message));
  const answer = page.locator(".chat-message.assistant").filter({ hasText: "查看 app.ts" });
  await answer.locator('.chat-file-link[data-file-path="app.ts"]').first().waitFor();
  assert.equal(await answer.locator(".chat-code-block .chat-file-link").count(), 0, "fenced code stays source text");
  assert.equal(await answer.getByText("网站", { exact: true }).getAttribute("href"), "https://example.com");
  assert.equal(await answer.getByText("危险", { exact: true }).getAttribute("href"), null);
  assert.equal(await answer.locator(".chat-file-link").first().evaluate(el => getComputedStyle(el).color), "rgb(70, 123, 234)");
  assert.equal(await answer.locator(".chat-file-link code").evaluate(el => getComputedStyle(el).color), "rgb(70, 123, 234)");
  await answer.locator('.chat-file-link[data-file-path="app.ts"]').first().click();
  const panel = page.locator(".files-sidebar-panel");
  await panel.locator(".files-source-preview").getByText("export const app = true;", { exact: false }).waitFor();
  await answer.getByText("文档", { exact: true }).click();
  await panel.getByRole("heading", { name: "带空格的文档", exact: true }).waitFor();
  await answer.locator('.chat-file-link[data-file-path="app.ts"]').first().focus(); await page.keyboard.press("Enter");
  await panel.locator(".files-source-preview").waitFor();
  const responseBody = [
    { choices: [{ index: 0, delta: { content: "任务已完成，查看 new.md。" }, finish_reason: null }] },
    { pi: { type: "workspace_changes", runId: "fixture-task", changes } },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  if (desktop) {
    // Desktop Pi requests run through the main-process bridge, beyond page.route.
    await app.evaluate((_electron, body) => {
      const http = process.getBuiltinModule("node:http");
      const original = http.Server.prototype.emit;
      http.Server.prototype.emit = function(event, ...args) {
        if (event === "request" && args[0].url?.split("?")[0] === "/api/pi/chat") {
          args[0].resume(); args[1].writeHead(200, { "Content-Type": "text/event-stream" }); args[1].end(body); return true;
        }
        return Reflect.apply(original, this, [event, ...args]);
      };
    }, responseBody);
  } else await page.route("**/api/pi/chat", route => route.fulfill({ contentType: "text/event-stream", body: responseBody }));
  await page.getByPlaceholder("输入消息，可粘贴图片").fill("执行文件任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const card = page.getByRole("region", { name: "本次任务文件变更", exact: true });
  await card.getByText("已变更 6 个文件", { exact: true }).waitFor();
  assert.match(await card.locator("xpath=ancestor::article").textContent(), /任务已完成，查看 new.md/,
    "a summary belongs to the current turn even when the final text is buffered");
  assert.equal(await card.locator("li").count(), 4);
  assert.match(await card.textContent(), /新增 4 · 修改 1 · 删除 1/);
  assert.equal(await card.locator('.workspace-change-path.deleted').textContent(), "removed.txt");
  assert.equal(await card.locator('a[data-file-path$="removed.txt"]').count(), 0);
  await card.getByRole("button", { name: "全部 6 个文件", exact: true }).click();
  assert.equal(await card.locator("li").count(), 6);
  await card.getByText("new.md", { exact: true }).click();
  await panel.getByRole("heading", { name: "新文件", exact: true }).waitFor();
  await page.locator(".chat-workspace").screenshot({ path: `.runtime/chat-file-changes-${desktop ? "desktop" : "web"}.png` });
  if (!desktop) {
    await page.waitForFunction(async () => {
      const result = await (await fetch("/api/app-data")).json();
      return result.data?.chatSessions?.some(session => session.messages.some(message => message.extra?.workspaceChanges?.total === 6));
    });
    await page.reload();
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    await page.getByRole("region", { name: "本次任务文件变更", exact: true }).getByText("已变更 6 个文件", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileCard = page.getByRole("region", { name: "本次任务文件变更", exact: true });
    await mobileCard.scrollIntoViewIfNeeded();
    assert.ok(await mobileCard.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "file list fits mobile width");
    await mobileCard.screenshot({ path: ".runtime/chat-file-changes-mobile.png" });
  }
  assert.deepEqual(errors, []);
  console.log(`Chat file links and persisted task change summary passed (${desktop ? "desktop" : "web"}).`);
} catch (error) {
  await page?.screenshot({ path: `.runtime/chat-file-changes-failure-${desktop ? "desktop" : "web"}.png` }); throw error;
} finally {
  await app?.close(); await browser?.close(); server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
