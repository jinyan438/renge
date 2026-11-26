import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run against a saved production build. The fixture never contacts a model.
const HISTORY_LENGTH = 1_500;
const taskBudgetMs = 200;
const collectProfile = process.argv.includes("--profile");
// Measures a build that predates continuous history; mount assertions are skipped.
const baseline = process.argv.includes("--baseline");
const root = await mkdtemp(join(tmpdir(), "renge-long-chat-stream-"));
let server, browser, stream;
const upstream = createServer(async (request, response) => {
  for await (const _chunk of request) { /* consume fixture request */ }
  response.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" });
  response.flushHeaders();
  stream = response;
});
try {
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  const now = Date.now();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: new Date(now).toISOString() };
  const messages = Array.from({ length: HISTORY_LENGTH }, (_, index) => ({
    id: `history-${index}`,
    role: index % 2 ? "assistant" : "user",
    createdAt: new Date(now - (HISTORY_LENGTH - index) * 60_000).toISOString(),
    content: index === 0
      ? "超长代码会话"
      : index % 2
        ? `### 第 ${index} 段\n\n说明 **${index}** 与 \`value_${index}\`。\n\n\`\`\`javascript\n${Array.from({ length: 12 }, (_, line) => `const value_${index}_${line} = ${line}; // 历史代码`).join("\n")}\n\`\`\`\n`
        : `历史提问 ${index}`,
  }));
  await fetch(`${server.url}/api/app-data`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {
      version: 1, chatMode: "ai", chatMultiBubbleEnabled: false, providers: [provider], activeProviderId: provider.id,
      llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
      chatSessions: [{ id: "long", title: "超长代码会话", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages, createdAt: messages[0].createdAt, updatedAt: messages.at(-1).createdAt }],
    } }),
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__longChat = { longTasks: [], frames: [], recordingFrames: false };
    new PerformanceObserver((list) => {
      window.__longChat.longTasks.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ entryTypes: ["longtask"] });
    let previous = performance.now();
    const frame = (time) => {
      if (window.__longChat.recordingFrames) window.__longChat.frames.push(time - previous);
      previous = time;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.route("**/api/pi/chat", (route) => route.continue({ url: `http://127.0.0.1:${upstream.address().port}/chat` }));
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  const thread = page.locator("#chat");
  const resetMetrics = () => page.evaluate(() => { window.__longChat.longTasks = []; window.__longChat.frames = []; window.__longChat.recordingFrames = true; });
  const readMetrics = () => page.evaluate(() => {
    const metrics = window.__longChat;
    metrics.recordingFrames = false;
    const frames = [...metrics.frames].sort((a, b) => a - b);
    return {
      longestTaskMs: Math.round(Math.max(0, ...metrics.longTasks)),
      longTasks: metrics.longTasks.length,
      frames: frames.length,
      p95FrameMs: Math.round(frames[Math.floor(frames.length * 0.95)] ?? 0),
      worstFrameMs: Math.round(frames.at(-1) ?? 0),
    };
  });

  // Opening the conversation shows the newest messages immediately and then
  // mounts the rest of the history without a single blocking render.
  await resetMetrics();
  const openedAt = Date.now();
  await page.locator(".chat-session-item").filter({ hasText: "超长代码会话" }).click();
  await thread.locator(`.mes[mesid="${HISTORY_LENGTH - 1}"]`).waitFor();
  const firstPaintMs = Date.now() - openedAt;
  if (!baseline) await thread.locator('.mes[mesid="0"]').getByText("超长代码会话", { exact: true }).waitFor();
  const fullMountMs = Date.now() - openedAt;
  const mount = await readMetrics();
  console.log(JSON.stringify({ phase: "open", firstPaintMs, fullMountMs, ...mount }));
  if (!baseline) {
    assert.equal(await thread.locator(":scope > .mes").count(), HISTORY_LENGTH, "the whole history is mounted, without pages");
    assert.equal(await page.getByRole("button", { name: "查看更早的消息", exact: true }).count(), 0);
    assert.ok(mount.longestTaskMs < taskBudgetMs, "mounting a long history is split into short tasks");
    // Off-screen messages skip rendering only with their real remembered
    // size, so the scrollbar never jumps while moving through the history.
    await page.waitForFunction((count) => document.querySelectorAll("#chat > .mes[data-chat-layout-settled]").length === count, HISTORY_LENGTH);
    const heights = await thread.evaluate(async (element) => {
      const contained = element.scrollHeight;
      const style = element.ownerDocument.createElement("style");
      style.textContent = "#chat > .mes { content-visibility: visible !important; }";
      element.ownerDocument.head.append(style);
      const full = element.scrollHeight;
      style.remove();
      return { contained, full };
    });
    assert.ok(Math.abs(heights.contained - heights.full) < 2, `contained history keeps its real height (${JSON.stringify(heights)})`);
  }

  const input = page.getByPlaceholder("输入消息，可粘贴图片");
  await input.fill("写一段很长的代码");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const deadline = Date.now() + 30_000;
  while (!stream && Date.now() < deadline) await delay(20);
  assert.ok(stream);
  const delta = (content) => stream.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
  const code = Array.from({ length: 3_000 }, (_, index) => `export const generated_${index} = () => ${index}; // streamed\n`).join("");
  delta("```javascript\n");
  let producing = true;
  const producer = (async () => {
    for (let offset = 0; offset < code.length; offset += 256) {
      delta(code.slice(offset, offset + 256));
      await delay(8);
    }
    producing = false;
  })();
  await page.locator("#chat .chat-streaming-plain-text").first().waitFor();

  // Scroll from the first message to the newest one with the wheel while the
  // reply keeps growing.
  await thread.evaluate((element) => { element.scrollTop = 0; });
  await thread.hover();
  await resetMetrics();
  const scrollHeight = await thread.evaluate((element) => element.scrollHeight);
  const steps = 80;
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.wheel(0, Math.ceil(scrollHeight / steps));
    await delay(16);
  }
  const scrolling = await readMetrics();
  console.log(JSON.stringify({ phase: "wheel-scroll-while-streaming", ...scrolling }));
  assert.ok(producing, "the scroll phase overlapped with streaming");

  // Reading in the middle of the history: streaming fragments keep rendering
  // and must neither block the page nor move the reading position.
  await thread.evaluate((element) => { element.scrollTop = element.scrollHeight / 2; });
  await page.waitForTimeout(300);
  const readingTop = await thread.evaluate((element) => element.scrollTop);
  const client = collectProfile ? await page.context().newCDPSession(page) : null;
  const traceEvents = [];
  if (client) {
    client.on("Tracing.dataCollected", ({ value }) => traceEvents.push(...value));
    await client.send("Tracing.start", { categories: "devtools.timeline,blink,disabled-by-default-devtools.timeline" });
    await client.send("Profiler.enable");
    await client.send("Profiler.setSamplingInterval", { interval: 500 });
    await client.send("Profiler.start");
  }
  await resetMetrics();
  const latencies = [];
  for (let index = 0; index < 6; index += 1) {
    await delay(150);
    const started = Date.now();
    await input.fill(`阅读历史时输入 ${index}`);
    latencies.push(Date.now() - started);
  }
  const reading = await readMetrics();
  if (client) {
    const { profile } = await client.send("Profiler.stop");
    const self = new Map();
    (profile.samples ?? []).forEach((id, index) => self.set(id, (self.get(id) ?? 0) + profile.timeDeltas[index]));
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, us]) => {
      const node = profile.nodes.find((candidate) => candidate.id === id);
      return `${Math.round(us / 1_000)}ms ${node.callFrame.functionName || "(anonymous)"} ${node.callFrame.url.split("/").at(-1)}:${node.callFrame.lineNumber + 1}:${node.callFrame.columnNumber}`;
    });
    console.log(top.join("\n"));
    const traceDone = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
    await client.send("Tracing.end");
    await traceDone;
    const byName = new Map();
    for (const event of traceEvents) {
      if (event.ph !== "X" || !event.dur) continue;
      const entry = byName.get(event.name) ?? { ms: 0, count: 0, max: 0 };
      entry.ms += event.dur / 1_000; entry.count += 1; entry.max = Math.max(entry.max, event.dur / 1_000);
      byName.set(event.name, entry);
    }
    console.log([...byName].sort((a, b) => b[1].ms - a[1].ms).slice(0, 18)
      .map(([name, entry]) => `${Math.round(entry.ms)}ms x${entry.count} max ${Math.round(entry.max)}ms ${name}`).join("\n"));
  }
  console.log(JSON.stringify({ phase: "reading-while-streaming", ...reading, inputLatenciesMs: latencies }));
  assert.ok(producing, "the reading phase overlapped with streaming");
  assert.ok(Math.abs(await thread.evaluate((element) => element.scrollTop) - readingTop) < 2, "streaming does not move the reader");

  await producer;
  delta("\n```\nLONG_STREAM_DONE");
  await page.locator("#chat .mes_text").filter({ hasText: "LONG_STREAM_DONE" }).last().waitFor();
  stream.end("data: [DONE]\n\n");
  if (!baseline) {
    await thread.evaluate((element) => { element.scrollTop = 0; });
    await thread.locator('.mes[mesid="0"]').getByText("超长代码会话", { exact: true }).waitFor();
    assert.ok(await thread.locator(":scope > .mes").count() > HISTORY_LENGTH, "the reply joins the continuous history");
  }

  assert.ok(scrolling.longestTaskMs < taskBudgetMs, "wheel scrolling stays responsive while the reply streams");
  assert.ok(reading.longestTaskMs < taskBudgetMs, "streaming into a long history stays within the CPU-work budget");
  assert.ok(Math.max(...latencies) < 1_000, "typing remains responsive while streaming into a long history");
  assert.deepEqual(errors, []);
  console.log(`PASS: ${HISTORY_LENGTH}-message history mounts continuously and scrolls smoothly while streaming`);
} finally {
  stream?.destroy();
  await browser?.close();
  server?.server.closeAllConnections(); upstream.closeAllConnections();
  if (server) await new Promise((resolve) => server.server.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
  await rm(root, { recursive: true, force: true });
}
