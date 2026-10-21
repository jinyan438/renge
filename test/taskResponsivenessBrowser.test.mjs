import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, _electron as electron } from "playwright";
import { startRengeServer } from "../server.mjs";

// Comparable to a real 136 MB conversation plus dormant histories. Small
// fixtures miss copying an unchanged transcript at every task checkpoint.
const baseline = process.argv.includes("--baseline");
const desktop = process.argv.includes("--desktop");
const trace = process.argv.includes("--trace");
const imageResults = process.argv.includes("--image-results");
const root = await mkdtemp(join(tmpdir(), "renge-responsiveness-"));
let browser, app, server, stream;

// Intercept only the mock model endpoint inside the isolated HTTP server.
// Browser routing enables DevTools Fetch interception on every request, which
// otherwise copies multi-megabyte checkpoint bodies through the test runner.
function installChatFixture(_electron, port) {
  const http = process.getBuiltinModule("node:http");
  const original = http.Server.prototype.emit;
  const probe = globalThis.__rengeTaskFixture = { recordSaves: false, saves: [] };
  globalThis.__restoreTaskFixture = () => { http.Server.prototype.emit = original; };
  http.Server.prototype.emit = function(event, ...args) {
    if (event === "request") {
      const [request, response] = args;
      const path = request.url?.split("?")[0];
      if (path === "/api/app-data" && request.method === "PATCH" && probe.recordSaves) {
        const save = { bytes: 0, status: null };
        probe.saves.push(save);
        request.on("data", (chunk) => { save.bytes += chunk.length; });
        response.on("finish", () => { save.status = response.statusCode; });
      }
      if (path === "/api/pi/chat") {
        const upstream = http.request({ hostname: "127.0.0.1", port, path: "/chat", method: request.method, headers: request.headers }, (reply) => {
          response.writeHead(reply.statusCode, reply.headers);
          reply.pipe(response);
        });
        upstream.on("error", (error) => response.destroy(error));
        response.on("close", () => upstream.destroy());
        request.pipe(upstream);
        return true;
      }
    }
    return Reflect.apply(original, this, [event, ...args]);
  };
}

const upstream = createServer(async (request, response) => {
  for await (const _ of request) {}
  response.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" });
  response.flushHeaders(); stream = response;
});
try {
  const now = new Date().toISOString();
  const result = "HISTORY_DO_NOT_COPY " + "x".repeat(1_000_000);
  const image = imageResults ? Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900"><desc>${"x".repeat(2_100_000)}</desc><rect width="800" height="900" fill="#96a8c8"/></svg>`).toString("base64") : "";
  const history = Array.from({ length: 136 }, (_, index) => ({
    id: `history-${index}`, role: "assistant", content: "历史工具", createdAt: now,
    toolVisualization: { toolCallId: `history-${index}`, name: "read", status: "done", args: { path: "history.txt" }, result: { content: [{ type: "text", text: result }] } },
  }));
  history.unshift({ id: "seed", role: "user", content: "任务响应验收", createdAt: now });
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  await mkdir(join(root, "data"));
  await writeFile(join(root, "data", "app-data.json"), JSON.stringify({ version: 1, chatMode: "ai", providers: [provider], activeProviderId: provider.id,
    contextCompressionSettings: { enabled: false },
    llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
    chatSessions: [{ id: "active", title: "任务响应验收", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: history, createdAt: now, updatedAt: now },
      { id: "dormant", title: "后台历史", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: history.slice(0, 80), createdAt: now, updatedAt: now }],
  }));
  const fixtureBytes = (await stat(join(root, "data", "app-data.json"))).size;
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  let context, page, home;
  if (desktop) {
    const env = { ...process.env, RENGE_DATA_DIR: join(root, "data"), RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"), RENGE_ELECTRON_CACHE_DIR: join(root, "cache") };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
    context = app.context(); home = await app.firstWindow();
  } else {
    server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  }
  const errors = [];
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  const installProbe = () => {
    window.__responsiveness = { active: false, frames: [], gaps: [], longTasks: [], copies: [] };
    let last;
    const frame = (time) => {
      if (window.__responsiveness.active && last) {
        window.__responsiveness.frames.push(time - last);
        if (time - last > 20) {
          window.__responsiveness.gaps.push({ at: performance.timeOrigin + time, duration: time - last });
          console.timeStamp(`FRAME_GAP:${time - last}`);
        }
      }
      last = time; requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    new PerformanceObserver((list) => {
      if (window.__responsiveness.active) window.__responsiveness.longTasks.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ entryTypes: ["longtask"] });
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(...args) {
      const started = performance.now(); const result = Reflect.apply(post, this, args);
      if (window.__responsiveness.active) window.__responsiveness.copies.push(performance.now() - started);
      return result;
    };
  };
  if (app) await app.evaluate(installChatFixture, upstream.address().port);
  else installChatFixture(undefined, upstream.address().port);
  if (desktop) {
    await home.evaluate(installProbe);
    await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
    [page] = await Promise.all([app.waitForEvent("window"), home.getByRole("button", { name: "开始对话", exact: true }).click()]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getTitle().endsWith("— Agent Chat"))?.maximize());
  } else {
    page = await context.newPage(); await page.goto(server.url);
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  }
  page.setDefaultTimeout(60_000);
  await page.locator(".chat-session-item").filter({ hasText: "任务响应验收" }).click();
  await page.evaluate(installProbe);
  console.log("Loaded large-history fixture");
  const input = page.getByPlaceholder("输入消息，可粘贴图片");
  await page.waitForTimeout(2_000);
  const rendering = app ? await app.evaluate(({ app }) => ({ softwareCompositing: app.commandLine.hasSwitch("disable-gpu-compositing"), softwareRasterization: app.commandLine.hasSwitch("disable-gpu-rasterization"), hardwareAcceleration: app.isHardwareAccelerationEnabled(), features: app.getGPUFeatureStatus() })) : undefined;
  const measure = async (work) => {
    await page.evaluate(() => { Object.assign(window.__responsiveness, { frames: [], gaps: [], longTasks: [], copies: [], active: true }); });
    if (home) await home.evaluate(() => { Object.assign(window.__responsiveness, { frames: [], gaps: [], longTasks: [], copies: [], active: true }); });
    const producer = work?.();
    const inputMs = [];
    const inputSamples = [];
    for (let index = 0; index < 32; index++) {
      const started = Date.now(); await input.fill(`响应验收 ${index}`); inputMs.push(Date.now() - started);
      inputSamples.push({ at: started, duration: inputMs.at(-1) });
      await page.locator(".chat-thread").evaluate((thread, i) => { thread.scrollTop = i % 2 ? thread.scrollHeight : Math.max(0, thread.scrollHeight - thread.clientHeight - 100); }, index);
      await delay(200);
    }
    await producer;
    const metrics = await page.evaluate(() => { window.__responsiveness.active = false; return window.__responsiveness; });
    if (home) {
      const main = await home.evaluate(() => { window.__responsiveness.active = false; return window.__responsiveness; });
      metrics.frames.push(...main.frames); metrics.gaps.push(...main.gaps); metrics.longTasks.push(...main.longTasks); metrics.copies.push(...main.copies);
    }
    return { ...metrics, inputMs, inputSamples };
  };
  const idle = await measure();
  console.log("Measured idle responsiveness");
  await input.fill("开始验收任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  for (let attempt = 0; !stream && attempt < 300; attempt++) await delay(20);
  assert.ok(stream);
  const pi = (event) => stream.write(`data: ${JSON.stringify({ pi: event })}\n\n`);
  pi({ type: "context_usage", usage: { tokens: 10_000, contextWindow: 100_000, percent: 10 } });
  await page.locator(".context-token-ring").getByText("10%", { exact: true }).waitFor();
  await page.waitForTimeout(1_000);
  const client = await context.newCDPSession(home ?? page);
  const traceEvents = [];
  if (trace) {
    client.on("Tracing.dataCollected", ({ value }) => traceEvents.push(...value));
    await client.send("Tracing.start", { categories: "devtools.timeline,v8.execute,toplevel,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,blink,blink.fonts" });
  }
  await client.send("Profiler.enable"); await client.send("Profiler.start");
  // Starting V8's sampler walks the heap. Do not count that instrumentation
  // pause as a frame produced by task execution.
  await page.waitForTimeout(500);
  if (app) await app.evaluate(() => { globalThis.__rengeTaskFixture.recordSaves = true; });
  else globalThis.__rengeTaskFixture.recordSaves = true;
  const steps = [];
  const running = await measure(async () => {
    for (let index = 0; index < 8; index++) {
      const id = `acceptance-${index}`;
      steps.push({ at: Date.now(), id });
      const name = imageResults && index === 3 ? "read" : "powershell";
      pi({ type: "tool_start", toolCallId: id, toolName: name, arguments: name === "read" ? { path: "fixture.svg" } : { command: "fixture-only" } });
      await delay(100);
      pi({ type: "tool_update", toolCallId: id, toolName: name, result: { content: [{ type: "text", text: `output ${index}` }] } });
      await delay(100);
      pi({ type: "tool_end", toolCallId: id, toolName: name, result: { content: [{ type: "text", text: `output ${index} done` }, ...(name === "read" ? [{ type: "image", mimeType: "image/svg+xml", data: image }] : [])] } });
      // Checkpoint while typing/scrolling too; idle scheduling must not hide
      // expensive saves from the acceptance measurement.
      if (index % 2) await (home ?? page).evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
      await delay(700);
    }
  });
  console.log("Measured running responsiveness");
  const { profile } = await client.send("Profiler.stop");
  if (trace) {
    const done = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
    await client.send("Tracing.end"); await done;
    await writeFile(".runtime/task-responsiveness-trace.json", JSON.stringify({ traceEvents }));
  }
  stream.end("data: [DONE]\n\n");
  await page.getByRole("button", { name: "停止输出", exact: true }).waitFor({ state: "hidden" });
  await page.waitForTimeout(2_000);
  const completed = await measure();
  const saves = app ? await app.evaluate(() => { globalThis.__rengeTaskFixture.recordSaves = false; return globalThis.__rengeTaskFixture.saves; }) : globalThis.__rengeTaskFixture.saves;
  for (const save of saves) {
    assert.equal(save.status, 200, "task checkpoints reach durable storage");
    if (!baseline) assert.ok(save.bytes < image.length + 100_000, "checkpoints send only changed messages");
  }
  assert.ok(saves.length >= 4, "the active measurement includes checkpoints");
  const durable = JSON.parse(await readFile(join(root, "data", "app-data.json"), "utf8"));
  const savedMessages = durable.chatSessions.find((session) => session.id === "active").messages;
  assert.equal(savedMessages.find((message) => message.id === "history-0").toolVisualization.result.content[0].text, result);
  assert.equal(savedMessages.filter((message) => message.toolVisualization?.toolCallId?.startsWith("acceptance-") && message.toolVisualization.status === "done").length, 8);
  if (imageResults) assert.equal(savedMessages.find((message) => message.toolVisualization?.toolCallId === "acceptance-3").toolVisualization.result.content[1].data, image, "full image payloads reach durable storage");
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
  const summarize = (metrics) => ({ frameP95: percentile(metrics.frames, .95), frameP99: percentile(metrics.frames, .99), longestFrame: Math.max(0, ...metrics.frames), longestTask: Math.max(0, ...metrics.longTasks), longestCopy: Math.max(0, ...metrics.copies), inputP95: percentile(metrics.inputMs, .95), inputMax: Math.max(...metrics.inputMs) });
  const resultMetrics = { desktop, imageResults, fixtureBytes, rendering, idle: summarize(idle), running: summarize(running), completed: summarize(completed) };
  await mkdir(".runtime", { recursive: true });
  const reportName = `.runtime/task-responsiveness-${baseline ? "baseline" : "fixed"}${desktop ? "-desktop" : ""}${imageResults ? "-images" : ""}`;
  await writeFile(`${reportName}.cpuprofile`, JSON.stringify(profile));
  await writeFile(`${reportName}.json`, JSON.stringify({ ...resultMetrics, steps, gaps: running.gaps, inputSamples: running.inputSamples, checkpointCount: saves.length, checkpointBytes: saves.map((save) => save.bytes) }, null, 2));
  console.log(JSON.stringify(resultMetrics));
  assert.deepEqual(errors, []);
  if (!baseline) {
    assert.ok(running.frames.length > 200 && completed.frames.length > 200, "frame probes must run in the visible renderer");
    assert.ok(resultMetrics.running.frameP95 <= resultMetrics.completed.frameP95 + 8, "running p95 frame time must match the completed task");
    assert.ok(resultMetrics.running.frameP99 <= resultMetrics.completed.frameP99 + 17, "running p99 frame time must stay within one extra frame");
    assert.ok(resultMetrics.running.longestFrame <= Math.max(33.5, resultMetrics.completed.longestFrame + 17), "no visible task frame stalls compared with the completed task");
    assert.ok(resultMetrics.running.longestTask < 50, "task checkpoints must not monopolize the UI thread");
    assert.ok(resultMetrics.running.longestCopy < 10, "save requests must not copy unchanged large history");
    assert.ok(resultMetrics.running.inputP95 <= resultMetrics.completed.inputP95 + 30, "running input latency must match the completed task");
  }
} finally {
  globalThis.__restoreTaskFixture?.();
  stream?.destroy(); await browser?.close(); await app?.close(); server?.server.closeAllConnections(); upstream.closeAllConnections();
  if (server) await new Promise((resolve) => server.server.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
