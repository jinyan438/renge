import assert from "node:assert/strict";
import test from "node:test";
import {
  createPiStreamEventQueue,
  splitLargePiToolCallDelta,
} from "../src/piStreamEventQueue.ts";
import { createPiStreamingTimeline } from "../src/piStreamingTimeline.ts";

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

test("serializes Pi events and paints coalesced tool deltas before execution", async () => {
  const applied = [];
  const queue = createPiStreamEventQueue({
    async dispatch(event) {
      applied.push(event.type);
      await Promise.resolve();
    },
    shouldPaintAfter: (event) => event.type === "tool_call_delta",
    paintWeight: () => 1,
    maxPaintWeight: 2,
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
    "paint",
    "tool_call_end",
    "tool_request",
  ]);
});

test("paints newly arrived Pi deltas on the next drain frame", async () => {
  const applied = [];
  let releaseFirstPaint;
  const firstPaint = new Promise((resolve) => {
    releaseFirstPaint = resolve;
  });
  let paintCount = 0;
  const queue = createPiStreamEventQueue({
    dispatch(event) {
      applied.push(event.value);
    },
    shouldPaintAfter: (event) => event.type === "tool_call_delta",
    paintWeight: () => 1,
    maxPaintWeight: 1,
    async waitForPaint() {
      paintCount += 1;
      applied.push(`paint-${paintCount}`);
      if (paintCount === 1) await firstPaint;
    },
  });

  queue.enqueue({ type: "tool_call_delta", value: "a" });
  await Promise.resolve();
  queue.enqueue({ type: "tool_call_delta", value: "b" });
  queue.enqueue({ type: "tool_call_end", value: "end" });
  releaseFirstPaint();
  await queue.waitForIdle();

  assert.deepEqual(applied, ["a", "paint-1", "b", "paint-2", "end"]);
});

test("splits one buffered Pi tool delta into bounded Unicode-safe visual chunks", () => {
  const source = `${"a".repeat(250)}\u{1f680}${"b".repeat(250)}`;
  const chunks = splitLargePiToolCallDelta({
    type: "tool_call_delta",
    toolCallId: "call-1",
    delta: source,
    argumentsText: source,
  }, 96, 120);

  assert.equal(chunks.length, 6);
  assert.equal(chunks.map((event) => event.delta).join(""), source);
  assert.equal(chunks.every((event) => !("argumentsText" in event)), true);
  assert.equal(chunks.every((event) => event.toolCallId === "call-1"), true);
  assert.equal(chunks.some((event) => event.delta.includes("\ud83d") && !event.delta.includes("\ude80")), false);
});

test("renders a buffered write across frames before processing tool end", async () => {
  const applied = [];
  let partial = "";
  const queue = createPiStreamEventQueue({
    dispatch(event) {
      if (event.type === "tool_call_delta") partial += event.delta;
      applied.push({ type: event.type, length: partial.length });
    },
    shouldPaintAfter: (event) => event.type === "tool_call_delta",
    paintWeight: (event) => event.delta?.length ?? 0,
    maxPaintWeight: 96,
    async waitForPaint() {
      applied.push({ type: "paint", length: partial.length });
    },
  });
  const argumentsText = JSON.stringify({ path: "index.html", content: "x".repeat(420) });

  queue.enqueue({ type: "tool_call_start" });
  splitLargePiToolCallDelta({ type: "tool_call_delta", delta: argumentsText })
    .forEach(queue.enqueue);
  queue.enqueue({ type: "tool_call_end" });
  queue.enqueue({ type: "tool_request" });
  await queue.waitForIdle();

  const paints = applied.filter((event) => event.type === "paint");
  assert.equal(paints.length > 1, true);
  assert.equal(paints.at(-1).length, argumentsText.length);
  assert.deepEqual(applied.slice(-2).map((event) => event.type), ["tool_call_end", "tool_request"]);
});
