import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run against a saved production build. The fixture never contacts a model.
const baseline = process.argv.includes("--baseline");
const slowCpu = process.argv.includes("--slow-cpu");
const collectTrace = process.argv.includes("--trace");
// CPU emulation scales execution time. Keep the same CPU-work budget while
// retaining a separate one-second wall-clock limit for user input in both modes.
const taskBudgetMs = slowCpu ? 800 : 200;
const root = await mkdtemp(join(tmpdir(), "renge-task-stream-performance-"));
let server, browser, stream;
const upstream = createServer(async (request, response) => {
  for await (const _chunk of request) { /* consume fixture request */ }
  response.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" });
  response.flushHeaders();
  stream = response;
});
try {
  await mkdir(".runtime", { recursive: true });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: `history-${index}`, role: index % 2 ? "assistant" : "user", content: index === 0 ? "任务流式性能" : `历史消息 ${index}`, createdAt: now,
  }));
  for (let index = 0; index < 3; index += 1) messages.push({
    id: `large-tool-${index}`, role: "assistant", content: "", createdAt: now,
    toolVisualization: { name: "read", status: "done", toolCallId: `history-read-${index}`, args: { path: "large.txt" }, result: { content: [{ type: "text", text: "PERF_HISTORY 中文工具结果\n".repeat(60_000) }] } },
  });
  await fetch(`${server.url}/api/app-data`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {
      version: 1, chatMode: "ai", providers: [provider], activeProviderId: provider.id,
      llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
      chatSessions: [{ id: "performance", title: "任务流式性能", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages, createdAt: now, updatedAt: now }],
    } }),
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__contextPerf = { active: false, appRenders: 0, largeSerializations: 0, timeFormats: 0, changedStates: {}, longTasks: [] };
    const hookHeads = new WeakMap();
    const stateValues = new WeakMap();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      inject() { return 1; },
      onCommitFiberRoot(_id, root) {
        const pending = [root.current];
        while (pending.length) {
          const fiber = pending.pop();
          if (!fiber) continue;
          if (fiber.tag === 0 && typeof fiber.type === "function") {
            let hook = fiber.memoizedState, count = 0;
            while (hook && count < 40) { count += 1; hook = hook.next; }
            if (count === 40) {
              if (window.__contextPerf.active && hookHeads.get(fiber.type) !== fiber.memoizedState) window.__contextPerf.appRenders += 1;
              hookHeads.set(fiber.type, fiber.memoizedState);
              const previous = stateValues.get(fiber.type) ?? [];
              const next = [];
              let index = 0;
              for (let state = fiber.memoizedState; state; state = state.next, index += 1) {
                next[index] = state.memoizedState;
                if (window.__contextPerf.active && state.queue?.dispatch && !Object.is(previous[index], state.memoizedState)) {
                  const value = state.memoizedState;
                  const label = `${index}:${Array.isArray(value) ? value[0]?.role ? "messages" : value[0]?.messages ? "sessions" : "array" : typeof value}`;
                  window.__contextPerf.changedStates[label] = (window.__contextPerf.changedStates[label] ?? 0) + 1;
                }
              }
              stateValues.set(fiber.type, next);
              return;
            }
          }
          pending.push(fiber.sibling, fiber.child);
        }
      },
      onCommitFiberUnmount() {},
    };
    const formatTime = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function(...args) {
      if (window.__contextPerf.active) window.__contextPerf.timeFormats += 1;
      return Reflect.apply(formatTime, this, args);
    };
    const stringify = JSON.stringify;
    JSON.stringify = function(...args) {
      const result = Reflect.apply(stringify, this, args);
      if (window.__contextPerf.active && typeof result === "string" && result.length > 500_000 && result.includes("PERF_HISTORY")) window.__contextPerf.largeSerializations += 1;
      return result;
    };
    new PerformanceObserver((list) => {
      if (window.__contextPerf.active) window.__contextPerf.longTasks.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ entryTypes: ["longtask"] });
  });
  await page.route("**/api/pi/chat", (route) => route.continue({ url: `http://127.0.0.1:${upstream.address().port}/chat` }));
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.locator(".chat-session-item").filter({ hasText: "任务流式性能" }).click();
  const input = page.getByPlaceholder("输入消息，可粘贴图片");
  await input.fill("保持任务运行，验证 Token 刷新性能");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const deadline = Date.now() + 30_000;
  while (!stream && Date.now() < deadline) await delay(20);
  assert.ok(stream);
  const usage = (tokens) => stream.write(`data: ${JSON.stringify({ pi: { type: "context_usage", usage: { tokens, contextWindow: 100_000, percent: tokens / 1_000 } } })}\n\n`);
  usage(10_000);
  await page.locator(".context-token-ring").getByText("10%", { exact: true }).waitFor();
  await page.waitForTimeout(1_500);
  if (collectTrace) {
    console.log(JSON.stringify(await page.evaluate(() => ({
      thread: document.querySelector(".chat-thread")?.getBoundingClientRect().toJSON(),
      workspace: document.querySelector(".chat-workspace")?.getBoundingClientRect().toJSON(),
      scrollY, viewportHeight: innerHeight,
    }))));
    await page.screenshot({ path: ".runtime/task-stream-viewport.png" });
  }
  const client = await page.context().newCDPSession(page);
  if (slowCpu) await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const traceEvents = [];
  if (collectTrace) {
    client.on("Tracing.dataCollected", ({ value }) => traceEvents.push(...value));
    await client.send("Tracing.start", { categories: "devtools.timeline,v8.execute,disabled-by-default-devtools.timeline" });
  }
  await client.send("Profiler.enable");
  await client.send("Profiler.setSamplingInterval", { interval: 1_000 });
  await client.send("Profiler.start");
  // Starting the sampler walks the JS heap; CPU emulation also repaints the
  // existing page. Measure task work after those instrumentation costs settle.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__contextPerf.active = true; });
  const pi = (event) => stream.write(`data: ${JSON.stringify({ pi: event })}\n\n`);
  const id = "streaming-write";
  pi({ type: "tool_call_start", toolCallId: id, toolName: "write" });
  const code = Array.from({ length: 5_000 }, (_, index) => `const value_${index} = ${index}; // generated fixture source\n`).join("");
  const args = JSON.stringify({ path: "large-fixture.js", content: code });
  const producer = (async () => {
    for (let offset = 0; offset < args.length; offset += 512) {
      pi({ type: "tool_call_delta", toolCallId: id, delta: args.slice(offset, offset + 512) });
      if (offset % 16_384 === 0) usage(10_000 + Math.floor(offset / 4));
      await delay(4);
    }
  })();
  const latencies = [];
  for (let index = 0; index < 8; index += 1) {
    await delay(180);
    const started = Date.now();
    await input.fill(`任务运行中输入 ${index}`);
    latencies.push(Date.now() - started);
    if (!baseline && index === 0) await page.waitForFunction(() =>
      document.querySelectorAll(".pi-tool-diff pre code").length > 1,
    );
  }
  await producer;
  pi({ type: "tool_call_end", toolCallId: id, argumentsText: args });
  pi({ type: "tool_start", toolCallId: id, toolName: "write", arguments: { path: "large-fixture.js", content: code } });
  await page.locator(".chat-status").getByText(/正在执行工具/).waitFor();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const metrics = await page.evaluate(() => { window.__contextPerf.active = false; return window.__contextPerf; });
  const { profile } = await client.send("Profiler.stop");
  if (collectTrace) {
    const traceDone = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
    await client.send("Tracing.end");
    await traceDone;
    await writeFile(".runtime/task-stream-trace.json", JSON.stringify({ traceEvents }));
  }
  await writeFile(`.runtime/task-stream-${baseline ? "baseline" : "fixed"}${slowCpu ? "-slow" : ""}.cpuprofile`, JSON.stringify(profile));
  const self = new Map();
  (profile.samples ?? []).forEach((id, index) => self.set(id, (self.get(id) ?? 0) + profile.timeDeltas[index]));
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, us]) => {
    const node = profile.nodes.find((node) => node.id === id);
    return { ms: Math.round(us / 1_000), name: node.callFrame.functionName, url: node.callFrame.url.split("/").at(-1), line: node.callFrame.lineNumber + 1, column: node.callFrame.columnNumber };
  });
  console.log(JSON.stringify({ baseline, slowCpu, appRenders: metrics.appRenders, timeFormats: metrics.timeFormats, changedStates: metrics.changedStates, longTasks: metrics.longTasks.length, longestTaskMs: Math.round(Math.max(0, ...metrics.longTasks)), inputLatenciesMs: latencies, top }));
  if (!baseline) {
    assert.equal(metrics.timeFormats, 0, "stable message timestamps must not be formatted again for every stream fragment");
    assert.equal(metrics.largeSerializations, 0, "streaming must not serialize full tool histories on the UI thread");
    assert.ok(metrics.appRenders < 180, `tool argument refreshes must stay bounded (${metrics.appRenders} App renders)`);
    assert.ok(Math.max(...latencies) < 1_000, "typing remains responsive while streaming large tool arguments");
    assert.ok(Math.max(0, ...metrics.longTasks) < taskBudgetMs, "streaming must stay within the CPU-work budget");
  }
  await page.locator(".pi-tool-diff").getByRole("button", { name: "复制差异", exact: true }).click();
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
  assert.equal(copied, code.split("\n").map((line) => `+${line}`).join("\n"), "coalescing must preserve the complete file, including hidden preview lines");
  const codePane = page.locator(".pi-tool-diff pre");
  if (!baseline) assert.ok(await codePane.locator("code").count() < 50, "only visible code rows should be mounted");
  await codePane.evaluate((pre) => { pre.scrollTop = pre.scrollHeight; });
  await codePane.locator("code").filter({ hasText: "const value_599 = 599;" }).waitFor();
  await codePane.evaluate((pre) => { pre.scrollTop = 0; });
  await codePane.locator("code").filter({ hasText: "const value_0 = 0;" }).waitFor();
  pi({ type: "tool_end", toolCallId: id, toolName: "write", result: { content: "fixture write finished" } });
  await page.locator(".pi-tool-visualization.mutation.done").waitFor();

  // Exercise normal reply streaming too: a disabled preview throttle used to
  // schedule an additional App render for every new content frame.
  await page.evaluate(() => {
    window.__contextPerf.appRenders = 0;
    window.__contextPerf.longTasks = [];
    window.__contextPerf.changedStates = {};
    window.__contextPerf.active = true;
  });
  const delta = (content) => stream.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
  delta("```javascript\n");
  const replyProducer = (async () => {
    for (let offset = 0; offset < code.length; offset += 1_024) {
      delta(code.slice(offset, offset + 1_024));
      await delay(4);
    }
    delta("\n```\nSTREAM_REPLY_DONE");
  })();
  const replyLatencies = [];
  for (let index = 0; index < 8; index += 1) {
    await delay(180);
    const started = Date.now();
    await input.fill(`正文输出中输入 ${index}`);
    replyLatencies.push(Date.now() - started);
  }
  await replyProducer;
  await page.locator("#chat .mes_text").filter({ hasText: "STREAM_REPLY_DONE" }).last().waitFor();
  const replyMetrics = await page.evaluate(() => { window.__contextPerf.active = false; return window.__contextPerf; });
  console.log(JSON.stringify({ phase: "reply", appRenders: replyMetrics.appRenders, longestTaskMs: Math.round(Math.max(0, ...replyMetrics.longTasks)), inputLatenciesMs: replyLatencies }));
  if (!baseline) {
    assert.ok(Math.max(...replyLatencies) < 1_000, "typing remains responsive during a long code reply");
    assert.ok(Math.max(0, ...replyMetrics.longTasks) < taskBudgetMs, "reply streaming must stay within the CPU-work budget");
  }
  assert.deepEqual(errors, []);
  stream.end("data: [DONE]\n\n");
} finally {
  stream?.destroy();
  await browser?.close();
  server?.server.closeAllConnections(); upstream.closeAllConnections();
  if (server) await new Promise((resolve) => server.server.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
  await rm(root, { recursive: true, force: true });
}
