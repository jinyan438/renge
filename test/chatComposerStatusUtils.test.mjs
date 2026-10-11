import assert from "node:assert/strict";
import { test } from "node:test";
import { createChatProgressTracker, formatComposerElapsed } from "../src/chatComposerStatusUtils.ts";

function fixture(actor, signal) {
  const messages = [];
  return { messages, tracker: createChatProgressTracker(message => messages.push(message), signal, actor) };
}

test("waiting changes to thinking only on reasoning, then to replying on content", () => {
  const { messages, tracker } = fixture();
  tracker.waiting();
  tracker.piEvent({ type: "run_start" });
  tracker.reasoning("");
  tracker.reasoning("分析");
  tracker.reasoning("继续分析");
  tracker.content("回答");
  tracker.content("继续回答");
  assert.deepEqual(messages, ["等待 AI 响应…", "AI 正在思考…", "AI 正在回复…"]);
});

test("a model without reasoning moves directly from waiting to replying", () => {
  const { messages, tracker } = fixture();
  tracker.waiting();
  tracker.content("回复");
  assert.deepEqual(messages, ["等待 AI 响应…", "AI 正在回复…"]);
});

test("tool argument deltas keep the name, execution ends in result processing", () => {
  const { messages, tracker } = fixture();
  tracker.piEvent({ type: "tool_call_start", toolCallId: "read-1", toolName: "read" });
  tracker.piEvent({ type: "tool_call_delta", toolCallId: "read-1" });
  tracker.piEvent({ type: "tool_start", toolCallId: "read-1", toolName: "read" });
  tracker.piEvent({ type: "tool_request", toolCallId: "read-1", toolName: "read" });
  tracker.piEvent({ type: "tool_end", toolCallId: "read-1" });
  tracker.reasoning("读完文件后思考");
  tracker.content("最终回复");
  assert.deepEqual(messages, [
    "AI 正在准备调用：读取文件…", "AI 正在执行工具：读取文件…",
    "AI 正在处理工具结果…", "AI 正在思考…", "AI 正在回复…",
  ]);
});

test("parallel tools stay in execution until all tools finish", () => {
  const { messages, tracker } = fixture();
  tracker.piEvent({ type: "tool_start", toolCallId: "one", toolName: "read" });
  tracker.piEvent({ type: "tool_start", toolCallId: "two", toolName: "grep" });
  tracker.piEvent({ type: "tool_end", toolCallId: "one" });
  tracker.reasoning("不应覆盖工具执行");
  tracker.piEvent({ type: "tool_end", toolCallId: "two" });
  assert.deepEqual(messages, [
    "AI 正在执行工具：读取文件…", "AI 正在执行工具：读取文件、搜索内容（2 个）…",
    "AI 正在执行工具：搜索内容…", "AI 正在处理工具结果…",
  ]);
});

for (const type of ["auto_retry_start", "compaction_start"]) {
  test(`${type} allows the same phase to resume after a runtime notice`, () => {
    const { messages, tracker } = fixture();
    tracker.reasoning("首次思考");
    tracker.piEvent({ type });
    messages.push("运行时提示");
    tracker.reasoning("恢复思考");
    assert.deepEqual(messages, ["AI 正在思考…", "运行时提示", "AI 正在思考…"]);
  });
}

test("aborted streams cannot overwrite the stop notice", () => {
  const controller = new AbortController();
  const { messages, tracker } = fixture(undefined, controller.signal);
  tracker.waiting();
  controller.abort();
  tracker.content("延迟的正文");
  tracker.reasoning("延迟的思考");
  tracker.piEvent({ type: "tool_start", toolName: "read" });
  assert.deepEqual(messages, ["等待 AI 响应…"]);
});

test("Agent identity and custom tool names remain visible", () => {
  const { messages, tracker } = fixture("研究员");
  tracker.reasoning("分析");
  tracker.piEvent({ type: "tool_request", toolCallId: "mcp", toolName: "web_search" });
  assert.deepEqual(messages, ["研究员 正在思考…", "研究员 正在执行工具：web_search…"]);
});

test("elapsed time keeps minutes and padded seconds", () => {
  assert.equal(formatComposerElapsed(0), "0:00");
  assert.equal(formatComposerElapsed(9), "0:09");
  assert.equal(formatComposerElapsed(125.9), "2:05");
  assert.equal(formatComposerElapsed(-1), "0:00");
});
