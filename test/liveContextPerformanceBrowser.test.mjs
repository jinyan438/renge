import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run against a saved production build. The fixture never contacts a model.
const baseline = process.argv.includes("--baseline");
const root = await mkdtemp(join(tmpdir(), "renge-live-context-performance-"));
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
    id: `history-${index}`, role: index % 2 ? "assistant" : "user", content: index === 0 ? "实时用量性能" : `历史消息 ${index}`, createdAt: now,
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
      chatSessions: [{ id: "performance", title: "实时用量性能", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages, createdAt: now, updatedAt: now }],
    } }),
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__contextPerf = { active: false, appRenders: 0, largeSerializations: 0, longTasks: [] };
    const hookHeads = new WeakMap();
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
              return;
            }
          }
          pending.push(fiber.sibling, fiber.child);
        }
      },
      onCommitFiberUnmount() {},
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
  await page.locator(".chat-session-item").filter({ hasText: "实时用量性能" }).click();
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
  await page.evaluate(() => { window.__contextPerf.active = true; });
  for (let index = 1; index <= 24; index += 1) {
    usage(10_000 + index * 1_000);
    await delay(80);
  }
  await page.locator(".context-token-ring").getByText("34%", { exact: true }).waitFor();
  await page.waitForTimeout(500);
  const metrics = await page.evaluate(() => {
    window.__contextPerf.active = false;
    return window.__contextPerf;
  });
  const typingStarted = Date.now();
  await input.fill("任务运行中仍能顺畅输入");
  const typingMs = Date.now() - typingStarted;
  const report = { appRenders: metrics.appRenders, largeSerializations: metrics.largeSerializations, longTasks: metrics.longTasks.length, longestTaskMs: Math.round(Math.max(0, ...metrics.longTasks)), typingMs };
  console.log(JSON.stringify({ baseline, ...report }));
  if (!baseline) {
    assert.equal(metrics.largeSerializations, 0, "usage-only events must not reserialize historical tool output");
    assert.equal(metrics.appRenders, 0, "usage-only events must render the meter without rerendering App");
    assert.ok(typingMs < 1_000, `typing was delayed ${typingMs}ms during live usage updates`);
  }
  assert.equal(await input.inputValue(), "任务运行中仍能顺畅输入");
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
