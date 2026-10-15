import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. Streams contain no real credentials or live searches.
const root = await mkdtemp(join(tmpdir(), "renge-pi-extension-browser-"));
const streams = [];
const answers = [];
const fixture = createServer(async (request, response) => {
  let raw = ""; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  response.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" });
  response.flushHeaders();
  streams.push({ response, body });
});
let server, browser, page;
const errors = [];
const waitFor = async (check) => {
  const end = Date.now() + 15_000;
  while (!check() && Date.now() < end) await delay(20);
  assert.ok(check(), "expected fixture progress");
};
try {
  await mkdir(".runtime", { recursive: true });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: {
    version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider],
    llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
    chatChoiceToolsEnabled: false,
    extensions: [{ id: "pi-search", packageName: "pi-gpt-search", displayName: "pi-gpt-search", compatibility: "pi", enabled: true,
      status: "installed", sourceUrl: "npm:pi-gpt-search", piPackageSource: "npm:pi-gpt-search", piResources: { extensions: 1, skills: 0, prompts: 0, themes: 0 } }],
    chatSessions: [{ id: "search-chat", title: "插件兼容测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区",
      messages: [{ id: "seed", role: "user", content: "插件兼容测试", createdAt: now }], createdAt: now, updatedAt: now }],
  } }) });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/pi/chat", (route) => route.continue({ url: `http://127.0.0.1:${fixture.address().port}/chat` }));
  await page.route("**/api/pi/extension-ui-response", async (route) => {
    answers.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.locator(".chat-session-item").filter({ hasText: "插件兼容测试" }).click();
  const input = page.getByPlaceholder("输入消息，可粘贴图片");
  const status = page.locator(".chat-composer .chat-status");
  const send = async (text) => {
    const count = streams.length;
    await input.fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await waitFor(() => streams.length > count);
  };
  const pi = (event) => streams.at(-1).response.write(`data: ${JSON.stringify({ pi: { runId: streams.at(-1).body.runId, ...event } })}\n\n`);
  const finish = () => streams.at(-1).response.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  await send("/gpt-search Renge");
  assert.equal(streams.at(-1).body.enableTools, true, "installed Pi tools remain enabled without MCP or workspace tools");
  assert.match(JSON.stringify(streams.at(-1).body.request.messages), /\/gpt-search Renge/);
  pi({ type: "extension_ui_request", method: "setStatus", statusKey: "search", statusText: "正在检索 Renge" });
  await status.getByText("正在检索 Renge", { exact: true }).waitFor();
  pi({ type: "extension_entry", entry: { id: "search-entry", customType: "gpt-search-output", data: { text: "兼容搜索结果\n\x1b]8;;https://example.com/docs\x1b\\官方文档\x1b]8;;\x1b\\" } } });
  pi({ type: "extension_ui_request", method: "notify", message: "搜索完成，共 1 条", notifyType: "info" });
  pi({ type: "extension_ui_request", method: "setStatus", statusKey: "search" });
  finish();
  await page.locator(".chat-message.assistant").filter({ hasText: "兼容搜索结果" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "官方文档", exact: true }).getAttribute("href"), "https://example.com/docs");
  await status.getByText("搜索完成，共 1 条", { exact: true }).waitFor();
  assert.equal(await page.getByText("响应里没有可显示的回复内容。", { exact: false }).count(), 0);
  await page.screenshot({ path: ".runtime/pi-extension-search.png" });

  await send("/gpt-search");
  assert.doesNotMatch(JSON.stringify(streams.at(-1).body.request.messages), /兼容搜索结果|搜索完成，共 1 条/, "display-only output must not become model history");
  pi({ type: "extension_ui_request", method: "notify", message: "请提供检索词", notifyType: "warning" });
  finish();
  await status.getByText("请提供检索词", { exact: true }).waitFor();
  assert.ok((await status.getAttribute("class")).includes("warning"));
  await send("/gpt-search failure");
  pi({ type: "extension_error", error: "插件授权已过期", event: "command" });
  finish();
  await status.getByText("Pi 扩展错误：插件授权已过期", { exact: true }).waitFor();
  assert.ok((await status.getAttribute("class")).includes("error"));

  await send("验证交互接口");
  for (const [method, title, answer] of [["input", "检索词", "Renge docs"], ["confirm", "确认检索", true], ["select", "检索范围", "web"], ["editor", "检索备注", "edited note"]]) {
    const before = answers.length;
    pi({ type: "extension_ui_request", method, id: method, title, options: ["docs", "web"], prefill: "original" });
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await dialog.waitFor();
    if (method === "select") await dialog.getByRole("combobox").selectOption(answer);
    else if (method !== "confirm") await dialog.getByRole("textbox").fill(answer);
    if (method === "editor") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: ".runtime/pi-extension-dialog-mobile.png" });
    }
    await dialog.getByRole("button", { name: "确定", exact: true }).click();
    await waitFor(() => answers.length > before);
    assert.equal(method === "confirm" ? answers.at(-1).confirmed : answers.at(-1).value, answer);
    await dialog.waitFor({ state: "hidden" });
  }
  pi({ type: "extension_ui_request", method: "input", id: "expired", title: "超时输入" });
  await page.getByRole("dialog", { name: "超时输入" }).waitFor();
  pi({ type: "extension_ui_cancel", id: "expired" });
  await page.getByRole("dialog", { name: "超时输入" }).waitFor({ state: "hidden" });
  pi({ type: "extension_message", message: { content: "交互完成", display: true } });
  finish();
  await page.locator(".chat-message.assistant").filter({ hasText: "交互完成" }).waitFor();
  await page.getByRole("button", { name: "停止输出", exact: true }).waitFor({ state: "hidden" });
  await send("验证工具引用");
  pi({ type: "tool_start", toolCallId: "research", toolName: "codex-research", arguments: { open: [{ ref_id: "turn0search0" }] } });
  pi({ type: "tool_end", toolCallId: "research", toolName: "codex-research", result: { content: [{ type: "text", text: "引用 [1](https://example.com/source)" }], details: {} } });
  finish();
  const tool = page.locator(".pi-tool-visualization").filter({ hasText: "codex-research" });
  await page.locator(".chat-tool-run").filter({ has: tool }).locator(":scope > summary").click();
  await tool.locator("summary").click();
  assert.equal(await tool.getByRole("link", { name: "1", exact: true }).getAttribute("href"), "https://example.com/source");
  assert.equal(await page.getByText("响应里没有可显示的回复内容。", { exact: false }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("Pi extension browser compatibility passed: command results, links, context isolation, notices/errors, dialogs, timeout cleanup, narrow layout and tool citations.");
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: ".runtime/pi-extension-failure.png" });
  throw error;
} finally {
  await browser?.close(); fixture.closeAllConnections(); server?.server.closeAllConnections();
  await Promise.all([new Promise((resolve) => fixture.close(resolve)), server ? new Promise((resolve) => server.server.close(resolve)) : Promise.resolve()]);
  await rm(root, { recursive: true, force: true });
}
