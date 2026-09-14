import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  chatBubbleStatusLabels,
  getChatBubbleStatus,
  getChatCompletionStatus,
  getToolBubbleStatus,
  normalizeChatOutputStatus,
  shouldAutoExpandChatReasoning,
} from "../src/chatBubbleStatusUtils.ts";
import { createChatStreamUpdateBatcher } from "../src/chatPerformanceUtils.ts";
import { createPiStreamingTimeline } from "../src/piStreamingTimeline.ts";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
function loadAppCode(start, end, expression, globals = {}) {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  const code = ts.transpileModule(appSource.slice(startIndex, endIndex), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return vm.runInNewContext(`${code}\n${expression}`, globals);
}

function createStreamFixture() {
  let messages = [];
  const controller = new AbortController();
  const createSegment = loadAppCode(
    "function createStreamingAssistantMessage(",
    "async function readChatStream(",
    "createStreamingAssistantMessage",
    {
      createChatStreamUpdateBatcher: (options) => createChatStreamUpdateBatcher({
        ...options,
        schedule: () => () => {},
      }),
      startTransition: (update) => update(),
      hasAssistantTimelinePayload: (content, reasoning) => Boolean(content.trim() || reasoning.trim()),
      crypto: { randomUUID: () => `message-${messages.length}` },
    },
  );
  const createStreamingSegment = (id) => createSegment(
    (update) => { messages = update(messages); }, controller.signal, undefined, id,
  );
  const timeline = createPiStreamingTimeline({
    createSegment: createStreamingSegment,
  });
  return { timeline, controller, createSegment: createStreamingSegment, get messages() { return messages; } };
}

test("text transitions from running to complete and cleanup preserves completion", async () => {
  const fixture = createStreamFixture();
  fixture.timeline.pushContent("已生成");
  assert.equal(fixture.messages[0].outputStatus, "running");
  await fixture.timeline.finish();
  fixture.timeline.complete("已生成");
  fixture.timeline.cancel();
  assert.equal(fixture.messages[0].outputStatus, "complete");
});

test("streamed reasoning expands until content starts and stays collapsed after completion", async () => {
  const fixture = createStreamFixture();
  const segment = fixture.createSegment();
  segment.pushReasoning("正在思考");
  await segment.finish();
  assert.equal(fixture.messages[0].reasoningStatus, "running");
  assert.equal(shouldAutoExpandChatReasoning(fixture.messages[0]), true);

  segment.pushContent("最终回复");
  await segment.finish();
  assert.equal(fixture.messages[0].reasoningStatus, "complete");
  assert.equal(shouldAutoExpandChatReasoning(fixture.messages[0]), false);

  segment.complete("最终回复", "正在思考");
  assert.equal(fixture.messages[0].reasoningStatus, "complete");
  assert.equal(shouldAutoExpandChatReasoning(fixture.messages[0]), false);
});

test("stopping a later bubble preserves earlier completed bubbles", async () => {
  const fixture = createStreamFixture();
  fixture.timeline.pushContent("工具前说明");
  fixture.timeline.beforeTool();
  assert.equal(fixture.messages[0].outputStatus, "complete");
  fixture.timeline.pushContent("尚未输出完");
  await fixture.timeline.finish();
  fixture.controller.abort();
  fixture.timeline.cancel();
  assert.deepEqual(Array.from(fixture.messages, (message) => message.outputStatus), ["complete", "incomplete"]);
  assert.equal(fixture.messages[1].content, "尚未输出完");
});

test("stream failure marks only the unfinished text bubble as an error", async () => {
  const fixture = createStreamFixture();
  fixture.timeline.pushContent("前一段");
  fixture.timeline.beforeTool();
  fixture.timeline.pushContent("失败前的内容");
  await fixture.timeline.finish();
  fixture.timeline.cancel();
  assert.deepEqual(Array.from(fixture.messages, (message) => message.outputStatus), ["complete", "error"]);
});

test("length limits affect only the final text segment, including trailing tool boundaries", async () => {
  const fixture = createStreamFixture();
  fixture.timeline.pushContent("前文");
  fixture.timeline.beforeTool();
  fixture.timeline.pushContent("被截断");
  await fixture.timeline.finish();
  fixture.timeline.complete("前文被截断", "", getChatCompletionStatus("length"));
  assert.deepEqual(Array.from(fixture.messages, (message) => message.outputStatus), ["complete", "incomplete"]);
  const trailingTool = createStreamFixture();
  trailingTool.timeline.pushContent("已经结束的说明");
  trailingTool.timeline.beforeTool();
  await trailingTool.timeline.finish();
  trailingTool.timeline.complete("已经结束的说明", "", "incomplete");
  assert.equal(trailingTool.messages[0].outputStatus, "complete");
});

test("restored sessions cannot keep a running text indicator", () => {
  assert.equal(normalizeChatOutputStatus("running", true), "incomplete");
  for (const status of ["complete", "incomplete", "error"]) {
    assert.equal(normalizeChatOutputStatus(status, true), status);
  }
  assert.equal(normalizeChatOutputStatus("unknown"), undefined);
  assert.equal(getChatBubbleStatus({}), "complete");
  assert.equal(getChatBubbleStatus({ renderAsPlainText: true }), "incomplete");
  assert.equal(getChatBubbleStatus({ outputStatus: "running" }, false), "complete");
});

test("reasoning auto-collapses when final output starts or the call ends", () => {
  assert.equal(shouldAutoExpandChatReasoning({ reasoningStatus: "running", outputStatus: "running" }), true);
  assert.equal(shouldAutoExpandChatReasoning({ reasoningStatus: "complete", outputStatus: "running" }), false);
  for (const outputStatus of ["complete", "incomplete", "error", undefined]) {
    assert.equal(shouldAutoExpandChatReasoning({ reasoningStatus: "running", outputStatus }), false);
  }
});

test("completion reasons distinguish successful, truncated, missing and failed endings", () => {
  for (const reason of ["stop", "tool_calls", "end_turn", "completed"]) {
    assert.equal(getChatCompletionStatus(reason), "complete");
  }
  for (const reason of ["length", "max_tokens", "content_filter", "aborted", ""]) {
    assert.equal(getChatCompletionStatus(reason), "incomplete");
  }
  assert.equal(getChatCompletionStatus("error"), "error");
});

test("each grouped tool bubble renders its own status even when collapsed", () => {
  const renderGroups = loadAppCode(
    "  const renderChatBubbleDot =",
    "  const renderChatReasoning =",
    "renderToolOnlyGroup",
    {
      React, chatBubbleStatusLabels, getToolBubbleStatus, chatGenerationState: "running",
      formatProcessingDuration: () => "1s",
      renderPiToolVisualization: () => null,
      renderChatAttachments: () => null,
      X: () => null, Wrench: () => null, FileCode2: () => null, ChevronDown: () => null,
    },
  );
  const makeGroup = (status) => ({
    completed: status !== "running", blocks: [], segments: [{ message: {} }],
    visualizations: [{ name: status === "running" ? "read" : "write", status }],
  });
  const toolGroups = ["done", "error", "running"].map(makeGroup);
  const markup = renderToStaticMarkup(renderGroups({ toolGroups }, "tools"));
  assert.equal((markup.match(/class="chat-bubble-dot /g) ?? []).length, 3);
  assert.equal((markup.match(/<button type="button" class="chat-bubble-dot /g) ?? []).length, 3);
  for (const status of ["complete", "error", "running"]) {
    assert.ok(markup.includes(`class="chat-bubble-dot ${status}"`));
  }
  assert.equal((markup.match(/<details[^>]*\bopen=""/g) ?? []).length, 1);
  assert.equal(getToolBubbleStatus(makeGroup("running"), false), "incomplete");
  assert.equal(getToolBubbleStatus({
    ...makeGroup("running"), segments: [{ message: { outputStatus: "incomplete" } }],
  }, true), "incomplete");
  assert.equal(getToolBubbleStatus({ completed: true, visualizations: [], blocks: [{ variant: "error" }] }, true), "error");
});

test("completed and failed tools auto-collapse, including file mutations", () => {
  const renderTool = loadAppCode(
    "  const renderPiToolVisualization =",
    "  const renderToolProgressBlock =",
    "renderPiToolVisualization",
    {
      React,
      toolVisualizationResultText: () => "",
      toolVisualizationDiff: () => "",
      isObjectRecord: () => false,
      FileCode2: () => null,
      Terminal: () => null,
      FilePenLine: () => null,
      Wrench: () => null,
      CircleCheck: () => null,
      X: () => null,
      LoaderCircle: () => null,
      ChevronDown: () => null,
    },
  );

  assert.equal(renderTool({ name: "write", status: "running" }, "running").props.open, true);
  assert.equal(renderTool({ name: "write", status: "done" }, "done").props.open, false);
  assert.equal(renderTool({ name: "write", status: "error" }, "error").props.open, false);
});

test("clicking a status dot centers its bubble and pauses automatic output following", () => {
  const chatReadingFocusRef = { current: false };
  const chatScrollFollowLatestRef = { current: true };
  let clickedDot;
  const renderDot = loadAppCode(
    "  const renderChatBubbleDot =",
    "  const renderToolRunGroup =",
    "renderChatBubbleDot",
    {
      React, chatBubbleStatusLabels, chatReadingFocusRef, chatScrollFollowLatestRef,
      centerChatBubble: (dot) => { clickedDot = dot; return true; },
    },
  );
  const button = renderDot("complete");
  assert.equal(button.type, "button");
  assert.equal(button.props.type, "button");
  assert.equal(button.props["aria-label"], "定位到此气泡（已完成）");
  const target = {};
  button.props.onClick({ currentTarget: target });
  assert.equal(clickedDot, target);
  assert.equal(chatReadingFocusRef.current, true);
  assert.equal(chatScrollFollowLatestRef.current, false);
});
