import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. No live model requests or user app data are used.
const root = await mkdtemp(join(tmpdir(), "renge-composer-status-"));
const streams = [];
const fixture = createServer(async (request, response) => {
  for await (const _ of request) { /* consume request */ }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  });
  response.flushHeaders();
  streams.push(response);
});
let server;
let browser;
let page;
try {
  await mkdir(".runtime", { recursive: true });
  await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  await fetch(`${server.url}/api/app-data`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {
      version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider],
      llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
      chatSessions: [{ id: "fixture-chat", title: "提示测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: "seed-message", role: "user", content: "提示测试", createdAt: now }], createdAt: now, updatedAt: now }],
    } }),
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/pi/chat", route => route.continue({ url: `http://127.0.0.1:${fixture.address().port}/chat` }));
  await page.route("**/api/pi/abort", route => route.fulfill({ json: { ok: true } }));
  let releaseToolResult;
  await page.route("**/api/pi/tool-result", async route => {
    await new Promise(resolve => { releaseToolResult = resolve; });
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.locator(".chat-session-item").filter({ hasText: "提示测试" }).click();
  const status = page.locator(".chat-composer .chat-status");
  const input = page.getByPlaceholder("输入消息，可粘贴图片");
  const write = payload => streams.at(-1).write(`data: ${JSON.stringify(payload)}\n\n`);
  const pi = event => write({ pi: event });
  const delta = fields => write({ choices: [{ index: 0, delta: fields, finish_reason: null }] });
  async function expectStatus(text) {
    await status.getByText(text, { exact: true }).waitFor();
    assert.equal(await status.locator(".chat-status-message").textContent(), text);
  }
  async function send(text) {
    const previousCount = streams.length;
    await input.fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expectStatus("等待 AI 响应…");
    await waitForStream(previousCount);
  }
  async function waitForStream(previousCount) {
    const deadline = Date.now() + 15_000;
    while (streams.length === previousCount && Date.now() < deadline) await delay(10);
    assert.equal(streams.length, previousCount + 1, "fixture stream opened");
  }
  function finish() {
    write({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    streams.at(-1).end("data: [DONE]\n\n");
  }

  await send("验证实时阶段");
  pi({ type: "run_start" });
  pi({ type: "context_usage", usage: { tokens: 1_000, contextWindow: 10_000, percent: 10 } });
  await page.locator(".context-token-ring").getByText("10%", { exact: true }).waitFor();
  assert.match(await page.locator(".context-token-trigger").getAttribute("title"), /实时估算/);
  delta({ reasoning_content: "先分析问题。" });
  await expectStatus("AI 正在思考…");
  pi({ type: "context_usage", usage: { tokens: 8_000, contextWindow: 10_000, percent: 80 } });
  await page.locator(".context-token-ring").getByText("80%", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "停止输出", exact: true }).isVisible(), true);
  await page.waitForFunction(() => document.querySelector(".chat-status-elapsed")?.textContent !== "0:00");
  const elapsed = await status.locator(".chat-status-elapsed").textContent();
  await page.locator(".chat-composer").screenshot({ path: ".runtime/composer-thinking.png" });
  pi({ type: "tool_call_start", toolCallId: "read-1", toolName: "read" });
  await expectStatus("AI 正在准备调用：读取文件…");
  pi({ type: "tool_call_delta", toolCallId: "read-1", argumentsText: '{"path":"example.txt"}' });
  pi({ type: "tool_start", toolCallId: "read-1", toolName: "read", arguments: { path: "example.txt" } });
  await expectStatus("AI 正在执行工具：读取文件…");
  assert.notEqual(await status.locator(".chat-status-elapsed").textContent(), "0:00", "phase changes must not reset elapsed time");
  pi({ type: "tool_end", toolCallId: "read-1", toolName: "read", result: { content: "文件内容" } });
  await expectStatus("AI 正在处理工具结果…");
  pi({ type: "tool_request", runId: "fixture-run", toolCallId: "heartbeat-1", toolName: "chat_update_heartbeat", arguments: { enabled: false } });
  await expectStatus("AI 正在执行工具：更新心跳…");
  const toolDeadline = Date.now() + 15_000;
  while (!releaseToolResult && Date.now() < toolDeadline) await delay(10);
  assert.ok(releaseToolResult, "frontend tool submitted its result");
  releaseToolResult();
  await expectStatus("AI 正在处理工具结果…");
  delta({ reasoning_content: "整理工具结果。" });
  await expectStatus("AI 正在思考…");
  pi({ type: "auto_retry_start", attempt: 2, maxAttempts: 3 });
  await status.getByText(/正在重试模型请求/).waitFor();
  pi({ type: "auto_retry_end" });
  delta({ reasoning_content: "继续思考。" });
  await expectStatus("AI 正在思考…");
  pi({ type: "compaction_start" });
  await status.getByText(/正在压缩会话上下文/).waitFor();
  pi({ type: "compaction_end" });
  pi({ type: "context_usage", usage: { tokens: 3_000, contextWindow: 10_000, percent: 30 } });
  await page.locator(".context-token-ring").getByText("30%", { exact: true }).waitFor();
  delta({ content: "这是完整回复。" });
  await expectStatus("AI 正在回复…");
  await page.locator(".chat-composer").screenshot({ path: ".runtime/composer-replying.png" });
  finish();
  await expectStatus("回复已生成。");
  assert.equal(await status.locator(".chat-status-elapsed").count(), 0);
  await status.waitFor({ state: "hidden", timeout: 10_000 });

  // Continuation shares the request path used by regeneration and rewrites.
  const more = page.locator(".chat-message.assistant").filter({ hasText: "这是完整回复。" }).last().locator(".chat-message-more");
  await more.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await more.click();
  const previousCount = streams.length;
  await page.locator(".chat-message-menu").getByRole("button", { name: "续写", exact: true }).click();
  await expectStatus("等待 AI 响应…");
  await waitForStream(previousCount);
  delta({ reasoning_content: "准备补充细节。" });
  await expectStatus("AI 正在思考…");
  delta({ content: "更多细节。" });
  await expectStatus("AI 正在回复…");
  finish();
  await expectStatus("续写已完成。");
  await status.getByRole("button", { name: "关闭提示", exact: true }).click();

  await send("停止测试");
  delta({ reasoning_content: "尚未完成的分析。" });
  await expectStatus("AI 正在思考…");
  await page.getByRole("button", { name: "停止输出", exact: true }).click();
  await expectStatus("已停止输出。");
  streams.at(-1).end();
  await status.getByRole("button", { name: "关闭提示", exact: true }).click();
  await status.waitFor({ state: "hidden" });

  await send("失败测试");
  write({ error: { message: "fixture failure" } });
  streams.at(-1).end();
  await status.locator('[role="alert"]').waitFor();
  assert.match(await status.textContent(), /fixture failure/);
  await page.waitForTimeout(6_200);
  assert.equal(await status.isVisible(), true, "errors remain until dismissed");
  await status.getByRole("button", { name: "关闭提示", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await send("手机布局测试");
  delta({ reasoning_content: "窄屏思考" });
  await expectStatus("AI 正在思考…");
  const bounds = await status.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, "status fits the mobile viewport");
  await page.locator(".chat-composer").screenshot({ path: ".runtime/composer-mobile.png" });
  delta({ content: "手机回复。" });
  finish();
  await expectStatus("回复已生成。");
  assert.deepEqual(errors, []);
  console.log(`Composer status browser checks passed (first elapsed ${elapsed}).`);
} catch (error) {
  await page?.screenshot({ path: ".runtime/composer-failure.png" });
  console.error(await page?.locator(".chat-workspace").innerText().catch(() => "chat unavailable"));
  throw error;
} finally {
  for (const stream of streams) stream.destroy();
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await new Promise(resolve => fixture.close(resolve));
  await rm(root, { recursive: true, force: true });
}
