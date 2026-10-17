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
  const errors = [], aborted = [], steering = [], resets = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/pi/chat", (route) => route.continue({ url: `http://127.0.0.1:${fixture.address().port}/chat` }));
  await page.route("**/api/pi/abort", async (route) => {
    const body = route.request().postDataJSON(); aborted.push(body.runId);
    streams.find((stream) => stream.runId === body.runId)?.response.end();
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/pi/session", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    resets.push(route.request().postDataJSON());
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
  const status = page.locator(".chat-composer .chat-status");
  const selectSession = (id) => page.locator(".chat-session-item").filter({ hasText: `会话${id}` }).locator("button").first().click();
  const inputMenu = page.getByRole("dialog", { name: "选择发送方式" });
  async function send(content, mode) {
    await input.fill(content);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    if (mode) await inputMenu.getByRole("button", { name: new RegExp(`^${mode}`) }).click();
  }
  await selectSession("A");
  await send("A正在工作");
  await waitFor(() => streams.length === 1, "A run started");
  await page.getByRole("button", { name: "停止输出", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "停止输出", exact: true }).isEnabled(), true, "the stop button is enabled immediately after starting a run");
  assert.equal(await page.locator(".composer-send-actions > .send-button").count(), 1, "composer has one action button");
  assert.equal(await page.getByLabel("运行中消息方式").count(), 0, "no permanent mode selector");
  await input.fill("   ");
  await input.press("Enter");
  assert.equal(await page.getByRole("button", { name: "停止输出", exact: true }).count(), 1, "blank input keeps the stop button");
  assert.deepEqual(aborted, [], "Enter on empty input must not stop the run");
  await input.fill("");
  await page.locator(".chat-attachment-input").setInputFiles({ name: "queued-note.txt", mimeType: "text/plain", buffer: Buffer.from("运行中附件") });
  await page.getByRole("button", { name: "发送", exact: true }).waitFor();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await inputMenu.waitFor();
  await page.keyboard.press("Escape");
  await page.getByTitle("移除附件", { exact: true }).click();
  await page.getByRole("button", { name: "停止输出", exact: true }).waitFor();
  await input.fill("A未提交草稿");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await inputMenu.waitFor();
  await page.screenshot({ path: ".runtime/session-runtime-desktop-menu.png" });
  assert.equal(streams.length, 1, "opening the chooser does not submit a message");
  assert.equal(await page.getByLabel("待处理消息").count(), 0);
  await page.keyboard.press("Escape");
  await inputMenu.waitFor({ state: "hidden" });
  assert.equal(await input.inputValue(), "A未提交草稿", "Escape preserves the draft");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await inputMenu.waitFor();
  await input.click();
  await inputMenu.waitFor({ state: "hidden" });
  assert.equal(await input.inputValue(), "A未提交草稿", "outside click preserves the draft");
  await input.press("Enter");
  await inputMenu.waitFor();
  const aStatusBeforeSwitch = await status.locator(".chat-status-message").textContent();
  await selectSession("B");
  await inputMenu.waitFor({ state: "hidden" });
  assert.equal(await status.count(), 0, "an idle conversation does not inherit another run's progress");
  await selectSession("A");
  assert.equal(await status.locator(".chat-status-message").textContent(), aStatusBeforeSwitch, "switching back preserves the running conversation's status");
  assert.equal(await status.locator(".chat-status-elapsed").count(), 1, "switching back preserves the run timer");
  assert.equal(await input.inputValue(), "A未提交草稿", "switching conversations closes the chooser without losing its draft");
  await input.fill("");
  await page.getByRole("button", { name: "停止输出", exact: true }).waitFor();
  text(streams[0], "A的部分回复");
  await page.locator(".chat-message.assistant").filter({ hasText: "A的部分回复" }).waitFor();
  await send("A排队任务", "排队");
  await page.getByLabel("待处理消息").getByText("A排队任务", { exact: true }).waitFor();
  assert.equal(streams.length, 1, "queued input cannot start before the original run finishes");
  await input.fill("A草稿");
  await selectSession("B");
  await page.evaluate(() => {
    const textarea = document.querySelector("#send_textarea");
    textarea.value = "B正在工作";
    textarea.oninput(new Event("input"));
  });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await waitFor(() => streams.length === 2, "B starts while A is still running");
  assert.equal(await page.getByRole("button", { name: "停止输出", exact: true }).isEnabled(), true, "scripted input keeps stopping available after sending");
  text(streams[1], "B的部分回复");
  await page.locator(".chat-message.assistant").filter({ hasText: "B的部分回复" }).waitFor();
  const bStatusBeforeSwitch = await status.locator(".chat-status-message").textContent();
  await input.fill("B草稿");
  await selectSession("A");
  assert.equal(await input.inputValue(), "A草稿");
  assert.equal(await page.locator(".chat-message").filter({ hasText: "B的部分回复" }).count(), 0);
  await selectSession("B");
  assert.equal(await status.locator(".chat-status-message").textContent(), bStatusBeforeSwitch, "concurrent conversations keep independent progress");
  assert.equal(await input.inputValue(), "B草稿");
  finish(streams[0]);
  await delay(250);
  assert.equal(streams.length, 2, "switching away lets the current reply finish and freezes the remaining queue");
  await selectSession("A");
  await page.locator(".chat-message.assistant").filter({ hasText: "A的部分回复" }).waitFor();
  await page.getByRole("button", { name: "继续排队", exact: true }).click();
  await waitFor(() => streams.length === 3, "A resumes its preserved queue explicitly after returning");
  assert.equal(streams[2].body.sessionId, "A");
  assert.match(JSON.stringify(streams[2].body.request.messages), /A排队任务|A的部分回复/);
  assert.doesNotMatch(JSON.stringify(streams[2].body.request.messages), /B正在工作|B的部分回复/);
  await selectSession("B");
  assert.equal(await input.inputValue(), "B草稿", "background completion cannot clear another conversation's draft");
  text(streams[2], "A排队任务的回复"); finish(streams[2]);
  await send("请纠正B的方向", "立即纠偏");
  await waitFor(() => steering.length === 1, "steering request sent");
  assert.equal(steering[0].sessionId, "B");
  assert.equal(steering[0].runId, streams[1].runId);
  await page.locator(".chat-message.assistant").filter({ hasText: "纠偏后的B回复" }).waitFor();
  const contents = await page.locator(".chat-message").allTextContents();
  assert.ok(contents.findIndex((content) => content.includes("请纠正B的方向")) < contents.findIndex((content) => content.includes("纠偏后的B回复")), "steering user message must precede its answer");
  await send("B停止后保留的队列", "排队");
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
  for (const button of await page.locator(".composer-send-actions > .send-button").all()) {
    const box = await button.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, "the action button must fit the narrow viewport");
  }
  await input.fill("刷新后仍需保留的消息");
  await input.press("Enter");
  await inputMenu.waitFor();
  const menuBox = await inputMenu.boundingBox();
  assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 390, "the chooser must fit the narrow viewport");
  await page.screenshot({ path: ".runtime/session-runtime-mobile-menu.png" });
  await inputMenu.getByRole("button", { name: /^排队/ }).click();
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
  await send("Android纠偏指令", "立即纠偏");
  await waitFor(() => streams.length === 7, "fallback steering resumes automatically");
  const fallbackMessages = JSON.stringify(streams[6].body.request.messages);
  assert.match(fallbackMessages, /Android需要保留的部分输出/);
  assert.match(fallbackMessages, /Android纠偏指令/);
  text(streams[6], "Android纠偏完成"); finish(streams[6]);
  await page.locator(".chat-message.assistant").filter({ hasText: "Android纠偏完成" }).waitFor();
  await status.getByText("回复已生成。", { exact: true }).waitFor();

  // Completion of a background continuation must reconcile its own Pi history.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { delete window.RengeAndroidNative; });
  const more = page.locator(".chat-message.assistant").filter({ hasText: "Android纠偏完成" }).last().locator(".chat-message-more");
  await more.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await more.click();
  await page.locator(".chat-message-menu").getByRole("button", { name: "续写", exact: true }).click();
  await waitFor(() => streams.length === 8, "A continuation started");
  await selectSession("B");
  await send("B继续并行运行");
  await waitFor(() => streams.length === 9, "B runs while A continues");
  text(streams[8], "B仍在运行的部分回复");
  await page.locator(".chat-message.assistant").filter({ hasText: "B仍在运行的部分回复" }).waitFor();
  text(streams[7], "A后台完成的续写"); finish(streams[7]);
  await waitFor(() => resets.length === 1, "background continuation reconciled its own history");
  assert.equal(resets[0].sessionId, "A", "continuation must not reset the newly selected conversation");
  assert.equal(streams[8].response.writableEnded, false, "A completion does not end B's stream");
  const runningBStatus = await status.locator(".chat-status-message").textContent();
  await selectSession("A");
  await page.locator(".chat-message.assistant").filter({ hasText: "A后台完成的续写" }).waitFor();
  assert.equal(await status.locator(".chat-status-message").textContent(), "续写已完成。", "background completion status belongs to A");
  assert.equal(await status.locator(".chat-status-elapsed").count(), 0);
  await send("A与B同时继续运行");
  await waitFor(() => streams.length === 10, "A starts another independent run");

  // New conversations can join two existing runs; stopping B leaves A and C live.
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await send("新会话C的任务");
  await waitFor(() => streams.length === 11, "a newly created conversation starts while A and B run");
  const newSessionId = streams[10].body.sessionId;
  assert.ok(newSessionId && newSessionId !== "A" && newSessionId !== "B");
  assert.equal(await page.locator(".chat-session-running").count(), 3, "all three running sessions are visible in the sidebar");
  await selectSession("B");
  assert.equal(await status.locator(".chat-status-message").textContent(), runningBStatus);
  await page.getByRole("button", { name: "停止输出", exact: true }).click();
  await status.getByText("已停止输出。", { exact: true }).waitFor();
  assert.equal(aborted.at(-1), streams[8].runId, "stop targets B's run");
  assert.equal(streams[9].response.writableEnded, false, "stopping B leaves A running");
  assert.equal(streams[10].response.writableEnded, false, "stopping B leaves the new conversation running");
  text(streams[9], "A没有被停止"); finish(streams[9]);
  text(streams[10], "新会话C独立完成"); finish(streams[10]);
  await selectSession("A");
  await page.locator(".chat-message.assistant").filter({ hasText: "A没有被停止" }).waitFor();
  assert.equal(await page.locator(".chat-message").filter({ hasText: "新会话C独立完成" }).count(), 0);
  await page.locator(".chat-session-item").filter({ hasText: "新会话C的任务" }).locator("button").first().click();
  await page.locator(".chat-message.assistant").filter({ hasText: "新会话C独立完成" }).waitFor();
  assert.equal(await page.locator(".chat-message").filter({ hasText: "A没有被停止" }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("Session runtime browser regression passed: three concurrent conversations, new conversation during generation, scoped stop, background continuation, independent progress/timers, drafts, queue, steering, recovery, Android fallback, persistence, narrow layout, single action button.");
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
