import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { startRengeServer } from "../server.mjs";
import { createChatSessionRuntime } from "../src/chatSessionRuntime.ts";

test("stopping one conversation preserves the other run and pauses only its own FIFO queue", () => {
  const runtime = createChatSessionRuntime();
  const a = runtime.begin("a"), b = runtime.begin("b");
  runtime.get("a").queued.push("a1", "a2");
  runtime.get("b").queued.push("b1");
  runtime.stop("a");
  assert.equal(a.signal.aborted, true);
  assert.equal(b.signal.aborted, false);
  runtime.finish(a);
  assert.equal(runtime.takeNext("a"), undefined);
  assert.equal(runtime.get("b").generationState, "running");
  runtime.finish(b);
  assert.equal(runtime.takeNext("b"), "b1");
  runtime.get("a").queuePaused = false;
  assert.equal(runtime.takeNext("a"), "a1");
  const newer = runtime.begin("a");
  runtime.finish(a);
  assert.equal(runtime.get("a").controller, newer, "stale completion cannot release a replacement run");
  runtime.finish(newer);
  assert.equal(runtime.takeNext("a"), "a2");
});

test("reset discards paused queues, steering and runtime state without affecting another conversation", () => {
  const runtime = createChatSessionRuntime();
  const a = runtime.get("a");
  a.queued.push("old input");
  a.steering.set("old steer", "old correction");
  a.queuePaused = true;
  a.stopRequested = true;
  a.startedAt = 123;
  a.status = { status: "error", message: "old error" };
  a.continueWith = async () => { throw new Error("old continuation must be discarded"); };
  const b = runtime.begin("b");
  runtime.get("b").queued.push("keep input");
  runtime.reset("a");
  const fresh = runtime.get("a");
  assert.deepEqual(fresh.queued, []);
  assert.equal(fresh.steering.size, 0);
  assert.equal(fresh.continueWith, undefined);
  assert.equal(fresh.queuePaused, false);
  assert.equal(fresh.stopRequested, false);
  assert.equal(fresh.startedAt, 0);
  assert.equal(fresh.status.status, "idle");
  assert.equal(runtime.takeNext("a"), undefined);
  assert.equal(b.signal.aborted, false);
  assert.deepEqual(runtime.get("b").queued, ["keep input"]);
  assert.throws(() => runtime.reset("b"), /先停止/);
  runtime.finish(b);
});

test("live native Pi inputs are scoped, idempotent, steer before queued follow-ups, and preserve parallel runs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-runtime-native-"));
  const requests = [];
  const held = new Map();
  const fixture = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const last = [...body.messages].reverse().find((message) => message.role === "user");
    const text = typeof last.content === "string" ? last.content : last.content.map((part) => part.text ?? "").join("\n");
    requests.push(text);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fake", created: 0, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    write({ role: "assistant", content: `reply:${text}` });
    const finish = () => { write({}, "stop"); response.end("data: [DONE]\n\n"); };
    if (text === "initial-a" || text === "initial-b") held.set(text, finish);
    else finish();
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  t.after(async () => {
    for (const finish of held.values()) finish();
    server.server.closeAllConnections(); fixture.closeAllConnections();
    await Promise.all([new Promise((resolve) => server.server.close(resolve)), new Promise((resolve) => fixture.close(resolve))]);
    await rm(root, { recursive: true, force: true });
  });
  const post = (path, body) => fetch(`${server.url}/api/pi/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const chatBody = (id) => ({ sessionId: id, runId: `run-${id}`, enableTools: false, piCompaction: { enabled: false },
    apiBaseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, request: { model: "fake", stream: true, messages: [{ role: "user", content: `initial-${id}` }] } });
  const a = await post("chat", chatBody("a")); const aText = a.text();
  const b = await post("chat", chatBody("b")); const bText = b.text();
  for (let i = 0; held.size < 2 && i < 500; i++) await delay(10);
  assert.equal(held.size, 2, "both conversations must reach the model concurrently");
  assert.equal((await post("chat", { ...chatBody("a"), runId: "duplicate-a" })).status, 409);
  const input = { runId: "run-a", sessionId: "a", inputId: "steer-a", content: "steer-a", mode: "steer" };
  assert.equal((await post("input", { ...input, sessionId: "b" })).status, 403);
  assert.equal((await post("input", input)).status, 200);
  assert.equal((await post("input", { ...input, content: "different content" })).status, 409);
  assert.equal((await post("input", input)).status, 200);
  assert.equal((await post("input", { ...input, inputId: "queue-a", content: "queue-a", mode: "queue" })).status, 200);
  held.get("initial-a")(); held.delete("initial-a");
  const output = await aText;
  assert.deepEqual(requests.filter((text) => text !== "initial-b"), ["initial-a", "steer-a", "queue-a"]);
  assert.equal((output.match(/"inputId":"steer-a"/g) ?? []).length, 1);
  assert.match(output, /"inputId":"queue-a"/);
  assert.equal((await post("input", input)).status, 409, "finished runs reject late inputs");
  assert.ok(held.has("initial-b"), "A finishing must not stop B");
  await post("abort", { runId: "run-b" });
  held.get("initial-b")(); held.delete("initial-b");
  await bText;
});

test("steering during a tool preserves its result and corrects the next model request", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-runtime-boundary-"));
  const modelRequests = [];
  const fixture = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); modelRequests.push(body);
    const corrected = body.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes("correct direction"));
    const delta = corrected ? { role: "assistant", content: "corrected result" } : {
      role: "assistant", tool_calls: ["fixture_gate"].map((name, index) => ({
        index, id: `gate-${index}`, type: "function", function: { name, arguments: "{}" },
      })),
    };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: corrected ? "stop" : "tool_calls" }]) {
      response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fake", created: 0, choices: [choice] })}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  t.after(async () => {
    server.server.closeAllConnections(); fixture.closeAllConnections();
    await Promise.all([new Promise((resolve) => server.server.close(resolve)), new Promise((resolve) => fixture.close(resolve))]);
    await rm(root, { recursive: true, force: true });
  });
  const post = (path, body) => fetch(`${server.url}/api/pi/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const response = await post("chat", {
    sessionId: "boundary", runId: "boundary-run", enableTools: true, piCompaction: { enabled: false },
    apiBaseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, request: {
      model: "fake", stream: true, messages: [{ role: "user", content: "original direction" }],
      tools: ["fixture_gate"].map((name) => ({ type: "function", function: { name, description: "Fixture boundary", parameters: { type: "object", properties: {} } } })),
    },
  });
  const events = [];
  const reading = (async () => {
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += new TextDecoder().decode(chunk);
      const frames = buffer.split("\n\n"); buffer = frames.pop();
      for (const frame of frames) {
        const data = frame.replace(/^data: /, "").trim();
        if (data && data !== "[DONE]") events.push(JSON.parse(data));
      }
    }
  })();
  let gate;
  for (let i = 0; !gate && i < 500; i++) { gate = events.find((event) => event.pi?.type === "tool_request")?.pi; if (!gate) await delay(10); }
  assert.equal(gate?.toolName, "fixture_gate");
  assert.equal((await post("input", { sessionId: "boundary", runId: "boundary-run", inputId: "correction", mode: "steer", content: "correct direction" })).status, 200);
  assert.equal((await post("tool-result", { runId: "boundary-run", toolCallId: gate.toolCallId, result: "original tool completed" })).status, 200);
  await reading;
  assert.deepEqual(events.filter((event) => event.pi?.type === "tool_request").map((event) => event.pi.toolName), ["fixture_gate"]);
  assert.match(JSON.stringify(modelRequests.at(-1).messages), /original tool completed/);
  assert.match(JSON.stringify(events), /corrected result/);
});
