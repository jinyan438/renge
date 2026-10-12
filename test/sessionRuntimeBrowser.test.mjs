import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Held SSE streams exercise real concurrent rendering without a live model.
const root = await mkdtemp(join(tmpdir(), "renge-runtime-browser-"));
const streams = [];
const fixture = createServer(async (request, response) => {
  let raw = ""; for await (const chunk of request) raw += chunk;
  response.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" });
  response.flushHeaders();
  const body = JSON.parse(raw);
  const stream = { body, response, runId: body.runId };
  streams.push(stream);
  write(stream, { pi: { type: "run_start", runId: body.runId } });
  write(stream, { pi: { type: "run_ready", runId: body.runId } });
});
function write(stream, payload) { stream.response.write(`data: ${JSON.stringify(payload)}\n\n`); }
function text(stream, content) { write(stream, { choices: [{ index: 0, delta: { content }, finish_reason: null }] }); }
function finish(stream) {
  write(stream, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  stream.response.end("data: [DONE]\n\n");
}
async function waitFor(predicate, message) {
  const deadline = Date.now() + 15_000;
  while (!predicate() && Date.now() < deadline) await delay(20);
  assert.ok(predicate(), message);
}
let server, browser, page;
try {
  await mkdir(".runtime", { recursive: true });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  const sessions = ["A", "B"].map((id) => ({ id, title: `会话${id}`, mode: "ai", workspaceKey: "default", workspaceName: "默认工作区",
    messages: [{ id: `seed-${id}`, role: "user", content: `会话${id}`, createdAt: now }], createdAt: now, updatedAt: now }));
  await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: {
    version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], chatSessions: sessions,
    llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
  } }) });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const errors = [], aborted = [], steering = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/pi/chat", (route) => route.continue({ url: `http://127.0.0.1:${fixture.address().port}/chat` }));
  await page.route("**/api/pi/abort", async (route) => {
    const body = route.request().postDataJSON(); aborted.push(body.runId);
    streams.find((stream) => stream.runId === body.runId)?.response.end();
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/pi/input", async (route) => {
    const body = route.request().postDataJSON(); steering.push(body);
    const stream = streams.find((candidate) => candidate.runId === body.runId);
    write(stream, { pi: { type: "input_delivered", runId: body.runId, inputId: body.inputId } });
    text(stream, "纠偏后的B回复");
    await route.fulfill({ json: { ok: true, inputId: body.inputId } });
  });
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  const input = page.getByPlaceholder("输入消息，可粘贴图片");
  const selectSession = (id) => page.locator(".chat-session-item").filter({ hasText: `会话${id}` }).locator("button").first().click();
  async function send(content, label = "发送") {
    await input.fill(content); await page.getByRole("button", { name: label, exact: true }).click();
  }
  await selectSession("A");
  await send("A正在工作");
  await waitFor(() => streams.length === 1, "A run started");
  text(streams[0], "A的部分回复");
  await page.locator(".chat-message.assistant").filter({ hasText: "A的部分回复" }).waitFor();
  await send("A排队任务", "加入队列");
  await page.getByLabel("待处理消息").getByText("A排队任务", { exact: true }).waitFor();
  assert.equal(streams.length, 1, "queued input cannot start before the original run finishes");
  await input.fill("A草稿");
  await selectSession("B");
  await send("B正在工作");
  await waitFor(() => streams.length === 2, "B starts while A is still running");
  text(streams[1], "B的部分回复");
  await page.locator(".chat-message.assistant").filter({ hasText: "B的部分回复" }).waitFor();
  await page.getByLabel("运行中消息方式").selectOption("steer");
  await input.fill("B草稿");
  await selectSession("A");
  assert.equal(await page.getByLabel("运行中消息方式").inputValue(), "queue", "input modes belong to their own conversation");
  assert.equal(await input.inputValue(), "A草稿");
  assert.equal(await page.locator(".chat-message").filter({ hasText: "B的部分回复" }).count(), 0);
  await selectSession("B");
  assert.equal(await page.getByLabel("运行中消息方式").inputValue(), "steer");
  assert.equal(await input.inputValue(), "B草稿");
  finish(streams[0]);
  await waitFor(() => streams.length === 3, "A queued input starts in the background");
  assert.equal(streams[2].body.sessionId, "A");
  assert.match(JSON.stringify(streams[2].body.request.messages), /A排队任务|A的部分回复/);
  assert.doesNotMatch(JSON.stringify(streams[2].body.request.messages), /B正在工作|B的部分回复/);
  assert.equal(await input.inputValue(), "B草稿", "background continuation cannot clear another conversation's draft");
  text(streams[2], "A排队任务的回复"); finish(streams[2]);
  await page.getByLabel("运行中消息方式").selectOption("steer");
  await send("请纠正B的方向", "立即纠偏");
  await waitFor(() => steering.length === 1, "steering request sent");
  assert.equal(steering[0].sessionId, "B");
  assert.equal(steering[0].runId, streams[1].runId);
  await page.locator(".chat-message.assistant").filter({ hasText: "纠偏后的B回复" }).waitFor();
  const contents = await page.locator(".chat-message").allTextContents();
  assert.ok(contents.findIndex((content) => content.includes("请纠正B的方向")) < contents.findIndex((content) => content.includes("纠偏后的B回复")), "steering user message must precede its answer");
  await page.getByLabel("运行中消息方式").selectOption("queue");
  await send("B停止后保留的队列", "加入队列");
  await page.getByRole("button", { name: "停止输出", exact: true }).click();
  await page.getByRole("button", { name: "继续排队", exact: true }).waitFor();
  assert.deepEqual(aborted, [streams[1].runId]);
  assert.equal(streams.length, 3, "manual stop pauses pending inputs");
  await selectSession("A");
  await page.locator(".chat-message.assistant").filter({ hasText: "A排队任务的回复" }).waitFor();
  assert.equal(await page.locator(".chat-message").filter({ hasText: "纠偏后的B回复" }).count(), 0);
  await selectSession("B");
  await page.getByRole("button", { name: "继续排队", exact: true }).click();
  await waitFor(() => streams.length === 4, "paused queue resumed explicitly");
  text(streams[3], "B恢复队列的回复"); finish(streams[3]);
  await page.locator(".chat-composer .chat-status").getByText("回复已生成。", { exact: true }).waitFor();
  await selectSession("A");
  await page.waitForTimeout(900);
  const saved = (await (await fetch(`${server.url}/api/app-data`)).json()).data.chatSessions;
  assert.match(JSON.stringify(saved.find((session) => session.id === "A")), /A排队任务的回复/);
  assert.doesNotMatch(JSON.stringify(saved.find((session) => session.id === "A")), /纠偏后的B回复|B恢复队列的回复/);
  assert.match(JSON.stringify(saved.find((session) => session.id === "B")), /纠偏后的B回复|B恢复队列的回复/);
  await send("窄屏运行测试");
  await waitFor(() => streams.length === 5, "narrow layout run started");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".chat-composer").screenshot({ path: ".runtime/session-runtime-mobile.png" });
  const composer = await page.locator(".chat-composer").boundingBox();
  assert.ok(composer.width <= 390, "composer must fit a narrow viewport");
  for (const button of await page.locator(".composer-send-actions button").all()) {
    const box = await button.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, "both send and stop must fit the narrow viewport");
  }
  await send("刷新后仍需保留的消息", "加入队列");
  await page.getByRole("button", { name: "停止输出", exact: true }).click();
  await page.getByRole("button", { name: "继续排队", exact: true }).waitFor();
  let savedPending;
  for (let i = 0; i < 100; i++) {
    savedPending = (await (await fetch(`${server.url}/api/app-data`)).json()).data.chatSessions.find((session) => session.id === "A");
    if (savedPending?.pendingInputs?.some((queued) => queued.content === "刷新后仍需保留的消息")) break;
    await delay(100);
  }
  assert.ok(savedPending?.pendingInputs?.some((queued) => queued.content === "刷新后仍需保留的消息"), `pending input must reach persistence before reload: ${JSON.stringify(savedPending)}`);
  await page.reload();
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.getByLabel("待处理消息").getByText("刷新后仍需保留的消息", { exact: true }).waitFor();
  await page.getByRole("button", { name: "继续排队", exact: true }).waitFor();
  await page.getByRole("button", { name: "取消待处理消息", exact: true }).click();
  await page.getByLabel("待处理消息").waitFor({ state: "hidden" });
  await page.evaluate(() => { window.RengeAndroidNative = {}; });
  await send("Android纠偏前的任务");
  await waitFor(() => streams.length === 6, "fallback run started");
  text(streams[5], "Android需要保留的部分输出");
  await page.locator(".chat-message.assistant").filter({ hasText: "Android需要保留的部分输出" }).waitFor();
  await page.getByLabel("运行中消息方式").selectOption("steer");
  await send("Android纠偏指令", "立即纠偏");
  await waitFor(() => streams.length === 7, "fallback steering resumes automatically");
  const fallbackMessages = JSON.stringify(streams[6].body.request.messages);
  assert.match(fallbackMessages, /Android需要保留的部分输出/);
  assert.match(fallbackMessages, /Android纠偏指令/);
  text(streams[6], "Android纠偏完成"); finish(streams[6]);
  await page.locator(".chat-message.assistant").filter({ hasText: "Android纠偏完成" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Session runtime browser regression passed: concurrent runs, drafts, FIFO queue, steering, scoped stop, pause/resume, queue recovery, Android fallback, persistence, narrow layout.");
} catch (error) {
  if (page && !page.isClosed()) {
    console.error("Visible statuses:", await page.locator(".chat-status").allTextContents());
    await page.screenshot({ path: ".runtime/session-runtime-failure.png" });
  }
  throw error;
} finally {
  await browser?.close();
  fixture.closeAllConnections(); server?.server.closeAllConnections();
  await Promise.all([new Promise((resolve) => fixture.close(resolve)), server ? new Promise((resolve) => server.server.close(resolve)) : Promise.resolve()]);
  await rm(root, { recursive: true, force: true });
}
