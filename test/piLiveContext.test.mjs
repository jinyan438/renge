import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { startRengeServer } from "./piTestServer.mjs";
import { getReliableContextUsage, installPiLiveContext } from "../pi/live-context.mjs";

function fixtureSession() {
  const state = { tools: [], streamingMessage: undefined };
  return {
    model: { contextWindow: 10_000 }, systemPrompt: "system prompt",
    agent: { state }, messages: [{ role: "user", content: "request" }],
    getContextUsage: () => ({ tokens: 2_000, contextWindow: 10_000, percent: 20 }),
  };
}

test("live usage adds partial thinking, text and tool arguments to the usage-backed count", () => {
  const session = fixtureSession();
  const baseline = getReliableContextUsage(session).tokens;
  const partial = { role: "assistant", content: [
    { type: "thinking", thinking: "thinking ".repeat(100) },
    { type: "text", text: "answer ".repeat(100) },
    { type: "toolCall", name: "write", arguments: { content: "code ".repeat(100) } },
  ] };
  session.agent.state.streamingMessage = partial;
  assert.equal(getReliableContextUsage(session).tokens, baseline + estimateTokens(partial));
  partial.content[1].text += "more ".repeat(100);
  assert.equal(getReliableContextUsage(session).tokens, baseline + estimateTokens(partial));
  session.messages.push(partial);
  assert.equal(getReliableContextUsage(session).tokens, baseline, "a finalized message must not be counted again as a partial");
});

test("estimates ignore stale system copies and inactive tools, and recover immediately after compaction", () => {
  const session = fixtureSession();
  session.getContextUsage = () => ({ tokens: null, contextWindow: 10_000, percent: null });
  const before = getReliableContextUsage(session).tokens;
  session.messages.unshift({ role: "system", content: "old system ".repeat(10_000) });
  session.getAllTools = () => [{ name: "inactive", description: "unused ".repeat(10_000) }];
  assert.equal(getReliableContextUsage(session).tokens, before);
  const invalidSchema = {}; invalidSchema.self = invalidSchema;
  session.agent.state.tools = [{ name: "extension", parameters: invalidSchema }];
  assert.doesNotThrow(() => getReliableContextUsage(session));
  session.agent.state.tools = [];
  session.messages.push({ role: "toolResult", content: [{ type: "text", text: "output ".repeat(1_000) }] });
  const large = getReliableContextUsage(session).tokens;
  assert.ok(large > before);
  session.messages = [{ role: "compactionSummary", summary: "checkpoint" }];
  assert.ok(getReliableContextUsage(session).tokens < large);
});

test("stream events are throttled, boundaries refresh after persistence and disposal cancels timers", async () => {
  const session = fixtureSession();
  const updates = [];
  const live = installPiLiveContext(session, { onUsage: (usage) => updates.push(usage), intervalMs: 30 });
  live.flush();
  session.agent.state.streamingMessage = { role: "assistant", content: [{ type: "text", text: "x".repeat(400) }] };
  for (let index = 0; index < 100; index += 1) live.handleEvent({ type: "message_update" });
  assert.equal(updates.length, 1);
  await delay(45);
  assert.equal(updates.length, 2);
  assert.equal(updates[1].tokens, 2_100);
  live.handleEvent({ type: "message_end" });
  session.agent.state.streamingMessage = undefined;
  session.getContextUsage = () => ({ tokens: 3_000, contextWindow: 10_000 });
  await Promise.resolve();
  assert.equal(updates.at(-1).tokens, 3_000);
  session.agent.state.streamingMessage = { role: "assistant", content: [{ type: "text", text: "pending" }] };
  live.handleEvent({ type: "message_update" });
  live.dispose();
  await delay(45);
  assert.equal(updates.length, 3);
});

test("between-turn compaction uses the reliable count, respects settings and restores the native hook", async () => {
  const session = fixtureSession();
  session.messages.push({ role: "user", content: "x".repeat(40_000) });
  let enabled = true;
  let compacted = 0;
  let nativeChecks = 0;
  session.settingsManager = { getCompactionSettings: () => ({ enabled, reserveTokens: 1_000 }) };
  session.sessionManager = { buildSessionProjection: () => ({ messages: [{ role: "compactionSummary", summary: "checkpoint" }] }) };
  const original = session.agent.prepareRequest = async (request) => { nativeChecks += 1; return request; };
  session._runAutoCompaction = async (reason, willRetry) => {
    assert.equal(reason, "threshold"); assert.equal(willRetry, false); compacted += 1;
  };
  const live = installPiLiveContext(session);
  const prepared = await session.agent.prepareRequest({ context: { messages: session.messages, tools: [] } });
  assert.equal(compacted, 1);
  assert.equal(prepared.context.messages[0].summary, "checkpoint");
  assert.equal(nativeChecks, 1);
  enabled = false;
  await session.agent.prepareRequest({ context: { messages: session.messages } });
  assert.equal(compacted, 1);
  assert.equal(nativeChecks, 2);
  live.dispose();
  assert.equal(session.agent.prepareRequest, original);
});

test("streaming refreshes reuse history/usage/schema snapshots and add only the arriving deltas", async () => {
  const session = fixtureSession();
  const updates = [];
  let projections = 0, schemas = 0;
  session.getContextUsage = () => { projections += 1; return { tokens: 2_000, contextWindow: 10_000 }; };
  session.agent.state.tools = [{ name: "tool", parameters: { toJSON() { schemas += 1; return {}; } } }];
  const live = installPiLiveContext(session, { onUsage: (usage) => updates.push(usage), intervalMs: 5 });
  session.agent.state.streamingMessage = { role: "assistant", content: [{ type: "text", text: "" }] };
  live.handleEvent({ type: "message_start", message: { role: "assistant" } });
  await Promise.resolve();
  const baseline = { projections, schemas };
  for (let index = 0; index < 8; index += 1) {
    session.agent.state.streamingMessage.content[0].text += "x".repeat(400);
    live.handleEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x".repeat(400) } });
    await delay(10);
  }
  assert.equal(projections, baseline.projections, "streaming ticks must not rebuild session projections");
  assert.equal(schemas, baseline.schemas, "streaming ticks must not serialize tool schemas");
  assert.equal(updates.at(-1).tokens, 2_800);
  assert.equal(updates.at(-1).breakdown.reduce((sum, part) => sum + part.tokens, 0), 2_800);
  session.messages.push(session.agent.state.streamingMessage);
  session.agent.state.streamingMessage = undefined;
  live.handleEvent({ type: "message_end" });
  await Promise.resolve();
  assert.equal(projections, baseline.projections + 1);
  live.dispose();
});

const send = (response, payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
function reply(response, delta, finishReason = "stop", end = true) {
  const base = { id: "live-context", object: "chat.completion.chunk", model: "fixture" };
  send(response, { ...base, choices: [{ index: 0, delta, finish_reason: null }] });
  if (end) {
    send(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    response.end("data: [DONE]\n\n");
  }
}

test("a long task refreshes usage while streaming and compacts between tool calls despite underreported usage", { timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-live-context-"));
  await writeFile(join(root, "large.txt"), "tool result line\n".repeat(1_000));
  let toolRequests = 0;
  let finalResponse;
  const requests = [];
  const upstream = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const summary = !body.tools?.length;
    requests.push({ summary, body });
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    if (summary) {
      reply(response, { role: "assistant", content: "LIVE_CHECKPOINT: Continue the current file inspection; preserve the remaining tool results." });
    } else if (toolRequests < 6) {
      const id = `live-read-${toolRequests++}`;
      reply(response, { role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: "read", arguments: JSON.stringify({ path: "large.txt" }) } }] }, "tool_calls");
    } else {
      finalResponse = response;
      reply(response, { role: "assistant", content: "FINAL_IN_PROGRESS " + "progress ".repeat(200) }, "stop", false);
    }
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  t.after(async () => {
    finalResponse?.end();
    server.server.closeAllConnections(); upstream.closeAllConnections();
    await new Promise((resolve) => server.server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const response = await fetch(`${server.url}/api/pi/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "live-task", apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture-key",
      workspace: { kind: "electron", cwd: root }, contextWindow: 18_000, modelMaxOutputTokens: 1_024,
      piCompaction: { enabled: true, reserveTokens: 4_000, keepRecentTokens: 2_000 },
      request: { model: "fixture", stream: true, messages: [{ role: "user", content: "Inspect the file six times and then report." }] },
    }),
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  let finalStarted = false;
  let liveUpdateBeforeDone = false;
  let finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") { finished = true; continue; }
      const event = JSON.parse(data);
      assert.ok(!event.error, JSON.stringify(event.error));
      events.push(event);
      if (event.choices?.[0]?.delta?.content?.includes("FINAL_IN_PROGRESS")) {
        finalStarted = true;
        // Usage and text can be delivered in either order for the same chunk.
        // Add another chunk after observing the first to verify a later update.
        reply(finalResponse, { content: "MORE_LIVE_OUTPUT " + "x".repeat(4_000) }, "stop", false);
      }
      if (finalStarted && event.pi?.type === "context_usage" && !liveUpdateBeforeDone) {
        liveUpdateBeforeDone = true;
        assert.equal(finalResponse.writableEnded, false, "usage must arrive before the final response completes");
        reply(finalResponse, {}, "stop");
      }
    }
  }
  assert.ok(liveUpdateBeforeDone);
  const compactionIndex = events.findIndex((event) => event.pi?.type === "compaction_start");
  const finalIndex = events.findIndex((event) => event.choices?.[0]?.delta?.content?.includes("FINAL_IN_PROGRESS"));
  assert.ok(compactionIndex >= 0 && compactionIndex < finalIndex, "compaction must happen inside the task");
  assert.ok(events.some((event) => event.pi?.type === "compaction_end" && event.pi.result));
  const usages = events.filter((event) => event.pi?.type === "context_usage").map((event) => event.pi.usage.tokens);
  assert.ok(usages.length >= 6);
  assert.ok(usages.some((tokens, index) => index > 0 && tokens < usages[index - 1] - 1_000), "the meter must drop after compaction");
  assert.ok(requests.some((request) => request.summary));
  assert.ok(requests.some((request) => !request.summary && JSON.stringify(request.body).includes("LIVE_CHECKPOINT")));
  const executed = events.filter((event) => event.pi?.type === "tool_end").map((event) => event.pi.toolCallId);
  assert.deepEqual(executed, Array.from({ length: 6 }, (_, index) => `live-read-${index}`));
  for (const { summary, body } of requests) {
    if (summary) continue;
    const calls = new Set(body.messages.flatMap((message) => message.tool_calls?.map((call) => call.id) ?? []));
    for (const message of body.messages.filter((message) => message.role === "tool")) assert.ok(calls.has(message.tool_call_id));
  }
});
