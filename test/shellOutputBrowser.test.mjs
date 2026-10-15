import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. Hold real SSE streams so assertions happen before completion.
const root = await mkdtemp(join(tmpdir(), "renge-shell-output-browser-"));
const streams = [];
const fixture = createServer(async (request, response) => {
  for await (const _chunk of request) {}
  response.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" });
  response.flushHeaders();
  streams.push(response);
});
let server, browser, page;
try {
  await mkdir(".runtime", { recursive: true });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: {
    version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider],
    llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
    chatSessions: [{ id: "shell-output", title: "命令输出回归", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: "seed", role: "user", content: "命令输出回归", createdAt: now }], createdAt: now, updatedAt: now }],
  } }) });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/pi/chat", (route) => route.continue({ url: `http://127.0.0.1:${fixture.address().port}/chat` }));
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.locator(".chat-session-item").filter({ hasText: "命令输出回归" }).click();

  const pi = (event) => streams.at(-1).write(`data: ${JSON.stringify({ pi: event })}\n\n`);
  const result = (text, status) => ({ content: [{ type: "text", text }], details: { shellSession: { id: "shell-session-1", status } } });
  const commandCard = page.locator(".pi-tool-visualization.shell").filter({ hasText: "emulator-check.ps1" });
  async function send(content) {
    const count = streams.length;
    await page.getByPlaceholder("输入消息，可粘贴图片").fill(content);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const deadline = Date.now() + 15_000;
    while (streams.length === count && Date.now() < deadline) await delay(10);
    assert.equal(streams.length, count + 1);
  }
  function finish(content) {
    streams.at(-1).write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: "stop" }] })}\n\n`);
    streams.at(-1).end("data: [DONE]\n\n");
  }
  async function exercise(id) {
    pi({ type: "tool_call_start", toolCallId: id, toolName: "powershell" });
    pi({ type: "tool_start", toolCallId: id, toolName: "powershell", arguments: { command: "powershell -NoProfile -File emulator-check.ps1" } });
    pi({ type: "tool_update", toolCallId: id, toolName: "powershell", result: { content: [{ type: "text", text: "emulator started\nwaiting for device" }] } });
    const card = commandCard.last();
    await card.locator(".pi-tool-terminal-preview pre").filter({ hasText: "waiting for device" }).waitFor();
    assert.match(await card.getAttribute("class"), /running/);
    assert.equal(await card.locator(".pi-tool-visualization-status").textContent(), "执行中");
    pi({ type: "tool_end", toolCallId: id, toolName: "powershell", result: result("waiting for device\nCommand still running", "running") });
    await card.getByText("Command still running", { exact: false }).waitFor();
    assert.match(await card.getAttribute("class"), /running/, "yield is not displayed as success");
    pi({ type: "tool_start", toolCallId: `${id}-poll`, toolName: "shell_status", arguments: { session_id: "shell-session-1" } });
    pi({ type: "tool_end", toolCallId: `${id}-poll`, toolName: "shell_status", result: result("still waiting", "running") });
    const poll = page.locator(".pi-tool-visualization").filter({ hasText: "shell_status" }).last();
    await poll.locator(".pi-tool-visualization-status").getByText("完成", { exact: true }).waitFor();
    assert.match(await card.getAttribute("class"), /running/, "a finished poll leaves its original command active");
    pi({ type: "tool_start", toolCallId: `${id}-poll-final`, toolName: "shell_status", arguments: { session_id: "shell-session-1" } });
    pi({ type: "tool_update", toolCallId: id, toolName: "powershell", result: result("waiting for device\nboot_completed=1", "running") });
    await card.locator("pre").filter({ hasText: "boot_completed=1" }).waitFor();
    await page.locator(".chat-workspace").screenshot({ path: ".runtime/shell-live-output.png" });
    pi({ type: "tool_end", toolCallId: id, toolName: "powershell", result: result("boot_completed=1\ncommand finished", "completed") });
    pi({ type: "tool_end", toolCallId: `${id}-poll-final`, toolName: "shell_status", result: result("boot_completed=1\ncommand finished", "completed") });
    await card.locator(".pi-tool-visualization-status").getByText("完成", { exact: true }).waitFor();
    assert.match(await card.locator("pre").textContent(), /command finished/);
    assert.equal(await page.locator(".pi-tool-visualization").filter({ hasText: "emulator-check.ps1" }).count(), id === "initial" ? 1 : 2, "completion updates its original card");
    finish(id === "initial" ? "命令完成，已核对输出。" : "补充验证通过，模拟器已经就绪。");
    await page.getByRole("button", { name: "发送", exact: true }).waitFor();
  }

  await send("检查模拟器");
  await exercise("initial");

  // Continuation uses the other main Pi event handler.
  const more = page.locator(".chat-message.assistant").filter({ hasText: "命令完成，已核对输出。" }).last().locator(".chat-message-more");
  await more.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await more.click();
  const count = streams.length;
  await page.locator(".chat-message-menu").getByRole("button", { name: "续写", exact: true }).click();
  const deadline = Date.now() + 15_000;
  while (streams.length === count && Date.now() < deadline) await delay(10);
  assert.equal(streams.length, count + 1);
  await exercise("continuation");
  assert.deepEqual(errors, []);
  console.log("Shell browser checks passed: live output, running after yield, completion in place, and continuation.");
} catch (error) {
  await page?.screenshot({ path: ".runtime/shell-output-failure.png" });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  fixture.closeAllConnections();
  if (server) await new Promise((resolve) => server.server.close(resolve));
  await new Promise((resolve) => fixture.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
