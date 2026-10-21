import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startRengeServer } from "../server.mjs";
import { seedColdPiSession } from "./piStartupFixture.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-pi-startup-"));
const baseline = process.argv.includes("--baseline");
let server, timer;
let receivedBytes = 0;
const upstream = createServer(async (request, response) => {
  for await (const chunk of request) receivedBytes += chunk.length;
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const base = { id: "startup", object: "chat.completion.chunk", model: "fixture" };
  response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "启动成功" }, finish_reason: null }] })}\n\n`);
  await delay(300);
  response.end(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 } })}\n\ndata: [DONE]\n\n`);
});
try {
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const owner = "startup-stress", cwd = resolve(".");
  await seedColdPiSession(root, owner, ["main-text"], cwd);
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root, isolatePiHost: !baseline });
  const delays = [];
  let last = performance.now();
  timer = setInterval(() => { const now = performance.now(); delays.push(now - last); last = now; }, 10);
  await delay(100);
  const response = await fetch(`${server.url}/api/pi/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    sessionId: owner, apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture", enableTools: false,
    allowImageInputs: false, piSessionScope: "main-text", piCompaction: { enabled: false },
    request: { model: "fixture", stream: true, messages: [{ role: "user", content: "继续测试" }] },
  }) });
  const output = await response.text();
  await delay(100);
  clearInterval(timer);
  assert.doesNotMatch(output, /"error"/);
  assert.ok(receivedBytes > 48_000_000, "cold Pi history must actually reach the local model fixture");
  const longestTick = Math.max(...delays);
  console.log(JSON.stringify({ baseline, historyBytes: 48_000_000, receivedBytes, longestTick }));
  if (!baseline) assert.ok(longestTick < 50, "loading a cold Pi session must not block the desktop main loop");
} finally {
  clearInterval(timer);
  server?.server.closeAllConnections(); upstream.closeAllConnections();
  if (server) await new Promise((resolve) => server.server.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
