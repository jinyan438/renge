import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  createPiStreamRenderQueue,
  createPiStreamEventQueue,
} from "../src/piStreamEventQueue.ts";
import { createPiStreamingTimeline } from "../src/piStreamingTimeline.ts";
import { getFirstReasoningText, mergeReasoningStreamChunk, splitSseFrames } from "../src/reasoningUtils.ts";
import { extractResponsesApiStreamEvent, getResponsesApiErrorMessage } from "../src/responsesApiUtils.mjs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
function loadStreamReader(waitForToolProgressPaint) {
  const helpers = appSource.slice(appSource.indexOf("function getChatApiErrorMessage("), appSource.indexOf("function isTruncatedChatFinishReason("));
  const reader = appSource.slice(appSource.indexOf("async function readChatStream("), appSource.indexOf("function piToolCallFromEvent("));
  const code = ts.transpileModule(`${helpers}\n${reader}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(`${code}\nreadChatStream`, {
    createPiStreamRenderQueue, waitForToolProgressPaint, TextDecoder,
    getFirstReasoningText, mergeReasoningStreamChunk, splitSseFrames,
    extractResponsesApiStreamEvent, getResponsesApiErrorMessage,
    isObjectRecord: (value) => Boolean(value && typeof value === "object" && !Array.isArray(value)),
    throwIfChatAborted: (signal) => signal?.throwIfAborted(),
  });
}

function sse(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function createTimelineFixture(sender = "main") {
  const rendered = [];
  let nextId = 0;
  const timeline = createPiStreamingTimeline({
    initialMessageId: `${sender}-initial`,
    createSegment(messageId) {
      const item = {
        kind: "text",
        id: messageId ?? `${sender}-${nextId += 1}`,
        sender,
        content: "",
        reasoning: "",
      };
      rendered.push(item);
      return {
        messageId: item.id,
        pushContent(delta) {
          item.content += delta;
        },
        pushReasoning(delta) {
          item.reasoning += delta;
        },
        async finish() {},
        complete(content, reasoning = "") {
          item.content = content;
          item.reasoning = reasoning;
          return Boolean(content.trim() || reasoning.trim());
        },
        cancel() {},
        remove() {
          rendered.splice(rendered.indexOf(item), 1);
        },
      };
    },
  });
  return { rendered, timeline };
}

function appendTool(rendered, name, status = "success") {
  rendered.push({ kind: "tool", name, status });
}

test("preserves Pi tool and text event order without merging text segments", async () => {
  const { rendered, timeline } = createTimelineFixture();

  timeline.beforeTool();
  appendTool(rendered, "tool-a");
  timeline.pushContent("文本 A");
  timeline.beforeTool();
  appendTool(rendered, "tool-b");
  timeline.pushContent("文本 B");
  await timeline.finish();
  timeline.complete("文本 A文本 B");

  assert.deepEqual(
    rendered.map((item) => item.kind === "tool" ? item.name : item.content),
    ["tool-a", "文本 A", "tool-b", "文本 B"],
  );
  assert.equal(timeline.segmentCount, 2);
  assert.equal(timeline.lastSegmentContent, "文本 B");
});

test("keeps text emitted before a tool ahead of that tool", async () => {
  const { rendered, timeline } = createTimelineFixture();

  timeline.pushContent("先说明");
  timeline.beforeTool();
  appendTool(rendered, "read");
  timeline.pushContent("再总结");
  await timeline.finish();
  timeline.complete("先说明再总结");

  assert.deepEqual(
    rendered.map((item) => item.kind === "tool" ? item.name : item.content),
    ["先说明", "read", "再总结"],
  );
});

test("does not create empty bubbles around consecutive or trailing tools", async () => {
  const { rendered, timeline } = createTimelineFixture();

  timeline.beforeTool();
  appendTool(rendered, "read");
  timeline.beforeTool();
  appendTool(rendered, "write");
  await timeline.finish();
  timeline.complete("", "");

  assert.deepEqual(rendered.map((item) => item.name), ["read", "write"]);
  assert.equal(timeline.segmentCount, 0);
});

test("preserves failed tools and reasoning boundaries", async () => {
  const { rendered, timeline } = createTimelineFixture();

  timeline.pushReasoning("分析 A");
  timeline.beforeTool();
  appendTool(rendered, "bash", "error");
  timeline.pushReasoning("分析 B");
  timeline.pushContent("结论");
  await timeline.finish();
  timeline.complete("结论", "分析 A分析 B");

  assert.deepEqual(rendered, [
    {
      kind: "text",
      id: "main-initial",
      sender: "main",
      content: "",
      reasoning: "分析 A",
    },
    { kind: "tool", name: "bash", status: "error" },
    {
      kind: "text",
      id: "main-1",
      sender: "main",
      content: "结论",
      reasoning: "分析 B",
    },
  ]);
});

test("uses the same ordered timeline for sub-agent messages", async () => {
  const { rendered, timeline } = createTimelineFixture("sub-agent");

  timeline.beforeTool();
  appendTool(rendered, "grep");
  timeline.pushContent("子 Agent 结果");
  await timeline.finish();
  timeline.complete("子 Agent 结果");

  assert.equal(rendered[1].sender, "sub-agent");
  assert.deepEqual(rendered.map((item) => item.kind), ["tool", "text"]);
});

test("does not let final text overtake a queued Pi tool event", async () => {
  const { rendered, timeline } = createTimelineFixture();
  const queue = createPiStreamRenderQueue({
    async dispatchPiEvent(event) {
      if (event.type !== "tool_call_start") return;
      timeline.beforeTool();
      appendTool(rendered, event.toolName);
      await Promise.resolve();
    },
    dispatchContent: timeline.pushContent,
    dispatchReasoning: timeline.pushReasoning,
    async waitForPaint() {},
  });

  queue.enqueueContent("工具前正文");
  queue.enqueuePiEvent({ type: "tool_call_start", toolName: "bash" });
  queue.enqueueContent("最终正文");
  await queue.waitForIdle();
  await timeline.finish();
  timeline.complete("工具前正文最终正文");

  assert.deepEqual(
    rendered.map((item) => item.kind === "tool" ? item.name : item.content),
    ["工具前正文", "bash", "最终正文"],
  );
});

test("drains buffered Pi events in order without delaying execution for argument paints", async () => {
  const applied = [];
  const queue = createPiStreamEventQueue({
    async dispatch(event) {
      applied.push(event.type);
      await Promise.resolve();
    },
    shouldPaintAfter: (event) => event.type === "tool_call_delta",
    async waitForPaint() {
      applied.push("paint");
    },
  });

  queue.enqueue({ type: "tool_call_start" });
  queue.enqueue({ type: "tool_call_delta" });
  queue.enqueue({ type: "tool_call_delta" });
  queue.enqueue({ type: "tool_call_end" });
  queue.enqueue({ type: "tool_request" });
  await queue.waitForIdle();

  assert.deepEqual(applied, [
    "tool_call_start",
    "tool_call_delta",
    "tool_call_delta",
    "tool_call_end",
    "tool_request",
  ]);
});

test("paints live output and catches up to completion after a slow frame", async () => {
  const applied = [];
  let releaseFirstPaint;
  let notifyFirstPaint;
  const firstPaintStarted = new Promise((resolve) => { notifyFirstPaint = resolve; });
  const firstPaint = new Promise((resolve) => {
    releaseFirstPaint = resolve;
  });
  let paintCount = 0;
  const queue = createPiStreamRenderQueue({
    dispatchPiEvent(event) {
      applied.push(event.delta ?? event.type);
    },
    dispatchContent: (delta) => applied.push(delta),
    dispatchReasoning() {},
    async waitForPaint() {
      paintCount += 1;
      applied.push(`paint-${paintCount}`);
      notifyFirstPaint();
      await firstPaint;
    },
  });

  queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId: "write-1", delta: "a" });
  await firstPaintStarted;
  for (let index = 0; index < 1000; index += 1) {
    queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId: "write-1", delta: "b" });
  }
  queue.enqueuePiEvent({ type: "tool_call_end", toolCallId: "write-1" });
  queue.enqueuePiEvent({ type: "tool_start", toolCallId: "write-1" });
  queue.enqueuePiEvent({ type: "tool_end", toolCallId: "write-1" });
  queue.enqueueContent("final");
  releaseFirstPaint();
  await queue.waitForIdle();

  assert.deepEqual(applied, ["a", "paint-1", "b".repeat(1000), "tool_call_end", "tool_start", "tool_end", "final"]);
  assert.equal(paintCount, 1);
});

function createRenderFixture(options = {}) {
  const applied = [];
  let paints = 0;
  const queue = createPiStreamRenderQueue({
    dispatchPiEvent: (event) => applied.push(event),
    dispatchContent: (delta) => applied.push({ type: "content", delta }),
    dispatchReasoning: (delta) => applied.push({ type: "reasoning", delta }),
    async waitForPaint() { paints += 1; },
    ...options,
  });
  return { applied, queue, get paints() { return paints; } };
}

function createProgressClock() {
  const timers = new Set();
  return {
    scheduleProgress(callback, delayMs) {
      assert.equal(delayMs, 100);
      timers.add(callback);
      return () => timers.delete(callback);
    },
    tick() { for (const callback of [...timers]) { timers.delete(callback); callback(); } },
    get pending() { return timers.size; },
  };
}

test("coalesces tool arguments across network reads and flushes execution without waiting for a timer", async () => {
  const clock = createProgressClock();
  const { applied, queue } = createRenderFixture(clock);
  queue.enqueuePiEvent({ type: "tool_call_start", toolCallId: "write" });
  await queue.waitForIdle();
  for (let index = 0; index < 100; index += 1) {
    queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId: "write", delta: "文🚀" });
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(applied.map(({ type }) => type), ["tool_call_start"]);
  assert.equal(clock.pending, 1);
  clock.tick();
  await queue.waitForIdle();
  assert.equal(applied[1].delta, "文🚀".repeat(100));

  queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId: "write", delta: "final" });
  queue.enqueuePiEvent({ type: "tool_call_end", toolCallId: "write" });
  queue.enqueuePiEvent({ type: "tool_request", toolCallId: "write" });
  await queue.waitForIdle();
  assert.equal(clock.pending, 0);
  assert.deepEqual(applied.slice(2).map(({ type, delta }) => delta ?? type), ["final", "tool_call_end", "tool_request"]);
});

test("bounds cumulative tool output refreshes and keeps the final result in order", async () => {
  const clock = createProgressClock();
  const { applied, queue } = createRenderFixture(clock);
  for (const result of ["a", "ab", "abc"]) {
    queue.enqueuePiEvent({ type: "tool_update", toolCallId: "shell", result });
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(applied.length, 0);
  clock.tick();
  await queue.waitForIdle();
  assert.equal(applied[0].result, "abc");
  queue.enqueuePiEvent({ type: "tool_update", toolCallId: "shell", result: "abcd" });
  queue.enqueuePiEvent({ type: "tool_end", toolCallId: "shell", result: "complete" });
  queue.enqueueContent("answer");
  await queue.waitForIdle();
  assert.deepEqual(applied.slice(1).map(({ result, delta }) => result ?? delta), ["abcd", "complete", "answer"]);
  assert.equal(clock.pending, 0);
});

test("aborting cancels a pending progress refresh even after an earlier idle", async () => {
  const controller = new AbortController();
  const clock = createProgressClock();
  const { applied, queue } = createRenderFixture({ ...clock, signal: controller.signal });
  queue.enqueueContent("keep");
  await queue.waitForIdle();
  queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId: "write", delta: "stale" });
  assert.equal(clock.pending, 1);
  controller.abort();
  clock.tick();
  await queue.waitForIdle();
  assert.deepEqual(applied, [{ type: "content", delta: "keep" }]);
  assert.equal(clock.pending, 0);
});

test("renders large buffered writes without creating an animation backlog", async () => {
  const fixture = createRenderFixture();
  const argumentsText = JSON.stringify({ path: "index.html", content: "内容🚀".repeat(100000) });
  const event = { type: "tool_call_delta", toolCallId: "call-1", delta: argumentsText, argumentsText };
  fixture.queue.enqueuePiEvent({ type: "tool_call_start", toolCallId: "call-1" });
  fixture.queue.enqueuePiEvent(event);
  fixture.queue.enqueuePiEvent({ type: "tool_call_end", toolCallId: "call-1" });
  fixture.queue.enqueuePiEvent({ type: "tool_start", toolCallId: "call-1" });
  fixture.queue.enqueuePiEvent({ type: "tool_end", toolCallId: "call-1", result: "written" });
  fixture.queue.enqueueContent("done");
  await fixture.queue.waitForIdle();

  assert.equal(fixture.applied[1], event);
  assert.deepEqual(JSON.parse(fixture.applied[1].argumentsText), JSON.parse(argumentsText));
  assert.equal(fixture.paints, 0);
  assert.deepEqual(fixture.applied.map(({ type }) => type), [
    "tool_call_start", "tool_call_delta", "tool_call_end", "tool_start", "tool_end", "content",
  ]);
});

test("coalesces provider fragments while preserving authoritative argument snapshots", async () => {
  const fixture = createRenderFixture();
  fixture.queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId: "a", delta: "old", argumentsText: "旧" });
  fixture.queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId: "a", delta: "delta", argumentsText: "新" });
  fixture.queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId: "a", delta: "🚀" });
  fixture.queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId: "b", delta: "另一调用" });
  fixture.queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId: "a", delta: "后续" });
  await fixture.queue.waitForIdle();

  assert.deepEqual(fixture.applied.map(({ toolCallId, delta, argumentsText }) => ({ toolCallId, delta, argumentsText })), [
    { toolCallId: "a", delta: "olddelta🚀", argumentsText: "新🚀" },
    { toolCallId: "b", delta: "另一调用", argumentsText: undefined },
    { toolCallId: "a", delta: "后续", argumentsText: undefined },
  ]);
  assert.equal(fixture.paints, 1);
});

test("does not accumulate paint delays as the number of tools increases", async () => {
  const fixture = createRenderFixture();
  for (let tool = 0; tool < 100; tool += 1) {
    const toolCallId = `write-${tool}`;
    fixture.queue.enqueuePiEvent({ type: "tool_call_start", toolCallId });
    for (let fragment = 0; fragment < 200; fragment += 1) {
      fixture.queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId, delta: "内容🚀" });
    }
    fixture.queue.enqueuePiEvent({ type: "tool_call_end", toolCallId });
    fixture.queue.enqueuePiEvent({ type: "tool_start", toolCallId });
    fixture.queue.enqueuePiEvent({ type: "tool_end", toolCallId });
    fixture.queue.enqueueContent(`结果 ${tool}`);
  }
  await fixture.queue.waitForIdle();

  assert.equal(fixture.applied.length, 600);
  assert.equal(fixture.paints, 0);
  assert.deepEqual(fixture.applied.filter(({ type }) => type === "tool_call_delta").map(({ delta }) => delta),
    Array(100).fill("内容🚀".repeat(200)));
  assert.equal(fixture.applied.at(-1).delta, "结果 99");
});

test("keeps incremental paints for normally paced live tool output", async () => {
  const fixture = createRenderFixture();
  fixture.queue.enqueuePiEvent({ type: "tool_call_start", toolCallId: "a" });
  await fixture.queue.waitForIdle();
  for (const delta of ["a", "b", "c"]) {
    fixture.queue.enqueuePiEvent({ type: "tool_call_delta", toolCallId: "a", delta });
    await fixture.queue.waitForIdle();
  }
  assert.equal(fixture.paints, 4);
  assert.deepEqual(fixture.applied.slice(1).map(({ delta }) => delta), ["a", "b", "c"]);
});

test("merges text fragments without crossing reasoning or tool boundaries", async () => {
  const fixture = createRenderFixture();
  fixture.queue.enqueueContent("前");
  fixture.queue.enqueueContent("文");
  fixture.queue.enqueueReasoning("分");
  fixture.queue.enqueueReasoning("析");
  fixture.queue.enqueuePiEvent({ type: "tool_call_start", toolCallId: "a" });
  fixture.queue.enqueueContent("后文");
  await fixture.queue.waitForIdle();
  assert.deepEqual(fixture.applied, [
    { type: "content", delta: "前文" },
    { type: "reasoning", delta: "分析" },
    { type: "tool_call_start", toolCallId: "a" },
    { type: "content", delta: "后文" },
  ]);
});

test("does not merge argument fragments without a tool identity", async () => {
  const fixture = createRenderFixture();
  fixture.queue.enqueuePiEvent({ type: "tool_call_delta", delta: "a" });
  fixture.queue.enqueuePiEvent({ type: "tool_call_delta", delta: "b" });
  await fixture.queue.waitForIdle();
  assert.deepEqual(fixture.applied.map(({ delta }) => delta), ["a", "b"]);
});

test("aborting a stream drops queued output behind active tool work", async () => {
  const controller = new AbortController();
  let release;
  let started;
  const work = new Promise((resolve) => { release = resolve; });
  const working = new Promise((resolve) => { started = resolve; });
  const applied = [];
  const fixture = createRenderFixture({
    signal: controller.signal,
    async dispatchPiEvent(event) {
      applied.push(event.type);
      started();
      await work;
    },
  });
  fixture.queue.enqueuePiEvent({ type: "tool_request" });
  fixture.queue.enqueuePiEvent({ type: "tool_end" });
  await working;
  controller.abort();
  release();
  await fixture.queue.waitForIdle();
  fixture.queue.enqueuePiEvent({ type: "tool_call_start" });
  fixture.queue.enqueueContent("stale text");
  await fixture.queue.waitForIdle();
  assert.deepEqual(applied, ["tool_request"]);
  assert.deepEqual(fixture.applied, []);
  assert.equal(fixture.paints, 0);
});

test("reports dispatch failures and discards later queued events", async () => {
  const failure = new Error("tool failed");
  const fixture = createRenderFixture({ dispatchPiEvent() { throw failure; } });
  fixture.queue.enqueuePiEvent({ type: "tool_request" });
  fixture.queue.enqueueContent("stale");
  await assert.rejects(fixture.queue.waitForIdle(), (error) => error === failure);
  assert.deepEqual(fixture.applied, []);
});

test("an already aborted stream never dispatches output", async () => {
  const controller = new AbortController();
  controller.abort();
  const fixture = createRenderFixture({ signal: controller.signal });
  fixture.queue.enqueueContent("stale");
  fixture.queue.enqueuePiEvent({ type: "tool_request" });
  await fixture.queue.waitForIdle();
  assert.deepEqual(fixture.applied, []);
});

test("the SSE reader forwards large tool output intact and finishes in wire order", async () => {
  let paints = 0;
  const readChatStream = loadStreamReader(async () => { paints += 1; });
  const delta = JSON.stringify({ path: "index.html", content: "内容🚀".repeat(100000) });
  const events = [
    { type: "tool_call_start", toolCallId: "a", toolName: "write" },
    { type: "tool_call_delta", toolCallId: "a", delta },
    { type: "tool_call_end", toolCallId: "a" },
    { type: "tool_start", toolCallId: "a" },
    { type: "tool_end", toolCallId: "a", result: "written" },
  ];
  const response = new Response([
    ...events.map((pi) => sse({ pi })),
    sse({ choices: [{ delta: { content: "完成" }, finish_reason: "stop" }] }),
    "data: [DONE]\n\n",
  ].join(""), { headers: { "content-type": "text/event-stream" } });
  const applied = [];
  const result = await readChatStream(response, (text) => applied.push(text), undefined, undefined,
    (event) => { applied.push(event.type === "tool_call_delta" ? event.delta : event.type); });

  assert.deepEqual(applied, ["tool_call_start", delta, "tool_call_end", "tool_start", "tool_end", "完成"]);
  assert.equal(result.content, "完成");
  assert.equal(result.finishReason, "stop");
  assert.equal(paints, 0);
  assert.equal(response.body.locked, false);
});

test("an SSE failure discards pending animation updates and releases the stream reader", async () => {
  let source;
  let releasePaint;
  let notifyPaint;
  const painting = new Promise((resolve) => { notifyPaint = resolve; });
  const paint = new Promise((resolve) => { releasePaint = resolve; });
  const readChatStream = loadStreamReader(() => { notifyPaint(); return paint; });
  const response = new Response(new ReadableStream({ start(controller) { source = controller; } }),
    { headers: { "content-type": "text/event-stream" } });
  const encoder = new TextEncoder();
  const applied = [];
  const reading = readChatStream(response, (text) => applied.push(text), undefined, undefined,
    (event) => { applied.push(event.type); });
  source.enqueue(encoder.encode(sse({ pi: { type: "tool_call_start", toolCallId: "a" } })));
  await painting;
  source.enqueue(encoder.encode(
    sse({ pi: { type: "tool_call_delta", toolCallId: "a", delta: "stale" } }) +
    sse({ error: { message: "connection failed" } }),
  ));
  source.close();
  await assert.rejects(reading, /connection failed/);
  releasePaint();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(applied, ["tool_call_start"]);
  assert.equal(response.body.locked, false);
});
