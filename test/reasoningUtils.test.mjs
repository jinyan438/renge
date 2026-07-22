import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderReasoningReplay,
  buildProviderReasoningRequest,
  getFirstReasoningText,
  mergeReasoningStreamChunk,
  splitSseFrames,
} from "../src/reasoningUtils.ts";

const deepSeekV4Provider = {
  name: "DeepSeek",
  apiBaseUrl: "https://api.deepseek.com/v1",
  modelId: "deepseek-v4-pro",
  reasoningEnabled: true,
  reasoningEffort: "high",
};

test("builds the Liyuan-compatible DeepSeek V4 reasoning request", () => {
  assert.deepEqual(
    buildProviderReasoningRequest(deepSeekV4Provider, { stream: true }),
    {
      max_tokens: 384000,
      thinking: { type: "enabled" },
      reasoning_effort: "high",
      stream_options: { include_usage: true },
    },
  );
});

test("clamps unsupported DeepSeek V4 levels and maps xhigh to max", () => {
  assert.equal(
    buildProviderReasoningRequest({
      ...deepSeekV4Provider,
      reasoningEffort: "medium",
    }).reasoning_effort,
    "high",
  );
  assert.equal(
    buildProviderReasoningRequest({
      ...deepSeekV4Provider,
      reasoningEffort: "xhigh",
    }).reasoning_effort,
    "max",
  );
});

test("uses provider-native reasoning shapes instead of sending conflicting fields", () => {
  assert.deepEqual(
    buildProviderReasoningRequest({
      apiBaseUrl: "https://openrouter.ai/api/v1",
      modelId: "deepseek/deepseek-v4-pro",
      reasoningEnabled: true,
      reasoningEffort: "xhigh",
    }),
    {
      max_tokens: 384000,
      reasoning: { effort: "xhigh" },
    },
  );
  assert.deepEqual(
    buildProviderReasoningRequest({
      apiBaseUrl: "https://opencode.ai/zen/go/v1",
      modelId: "qwen3.6-plus",
      reasoningEnabled: true,
      reasoningEffort: "high",
    }),
    { enable_thinking: true },
  );
});

test("replays DeepSeek reasoning content, including the required empty value", () => {
  assert.deepEqual(buildProviderReasoningReplay(deepSeekV4Provider, "step 1"), {
    reasoning_content: "step 1",
  });
  assert.deepEqual(buildProviderReasoningReplay(deepSeekV4Provider, ""), {
    reasoning_content: "",
  });
  assert.deepEqual(
    buildProviderReasoningReplay(
      {
        apiBaseUrl: "https://openrouter.ai/api/v1",
        modelId: "deepseek/deepseek-v4-pro",
        reasoningEnabled: true,
      },
      "",
    ),
    { reasoning_content: "" },
  );
  assert.deepEqual(
    buildProviderReasoningReplay(
      {
        apiBaseUrl: "https://api.openai.com/v1",
        modelId: "gpt-5.6",
        reasoningEnabled: true,
      },
      "do not replay this field",
    ),
    {},
  );
});

test("keeps OpenCode and OpenCode Go DeepSeek request formats distinct", () => {
  const provider = {
    modelId: "deepseek-v4-pro",
    reasoningEnabled: true,
    reasoningEffort: "high",
  };
  assert.deepEqual(
    buildProviderReasoningRequest({
      ...provider,
      apiBaseUrl: "https://opencode.ai/zen/v1",
    }),
    {
      max_tokens: 384000,
      reasoning_effort: "high",
    },
  );
  assert.deepEqual(
    buildProviderReasoningRequest({
      ...provider,
      apiBaseUrl: "https://opencode.ai/zen/go/v1",
    }),
    {
      max_tokens: 384000,
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    },
  );
});

test("does not guess the native DeepSeek protocol from a model name on an unknown proxy", () => {
  assert.deepEqual(
    buildProviderReasoningRequest({
      apiBaseUrl: "https://example-proxy.invalid/v1",
      modelId: "deepseek-v4-pro",
      reasoningEnabled: true,
      reasoningEffort: "xhigh",
    }),
    {
      reasoning_effort: "high",
      include_reasoning: true,
    },
  );
});

test("supports the OpenCode DeepSeek V4 Flash Free compatibility metadata", () => {
  const provider = {
    apiBaseUrl: "https://opencode.ai/zen/v1",
    modelId: "deepseek-v4-flash-free",
    reasoningEnabled: true,
    reasoningEffort: "xhigh",
  };
  assert.deepEqual(buildProviderReasoningRequest(provider), {
    max_tokens: 128000,
    reasoning_effort: "max",
  });
  assert.deepEqual(buildProviderReasoningReplay(provider, ""), {
    reasoning_content: "",
  });
});

test("takes the first reasoning field without duplicating mirrored provider fields", () => {
  assert.equal(
    getFirstReasoningText(
      [" first chunk ", "duplicate chunk"],
      { preserveWhitespace: true },
    ),
    " first chunk ",
  );
});

test("preserves whitespace in reasoning deltas and recognizes cumulative snapshots", () => {
  const first = mergeReasoningStreamChunk("", "First", "delta");
  const second = mergeReasoningStreamChunk(
    first.text,
    " line\n",
    "delta",
    first.messageMode,
  );
  assert.equal(second.text, "First line\n");
  assert.equal(second.delta, " line\n");

  const cumulative = mergeReasoningStreamChunk("First", "First line", "cumulative");
  assert.equal(cumulative.text, "First line");
  assert.equal(cumulative.delta, " line");
  assert.equal(cumulative.messageMode, "cumulative");
});

test("does not replace a long cumulative reasoning trace with a shorter final summary", () => {
  const first = mergeReasoningStreamChunk(
    "",
    "a much longer reasoning trace",
    "cumulative",
  );
  assert.equal(first.messageMode, "cumulative");
  const merged = mergeReasoningStreamChunk(
    first.text,
    "short summary",
    "cumulative",
    first.messageMode,
  );
  assert.equal(merged.text, "a much longer reasoning trace");
  assert.equal(merged.delta, "");
});

test("splits LF and CRLF SSE frames and flushes a final unterminated frame", () => {
  const lf = splitSseFrames("data: one\n\ndata: two\n\nrest");
  assert.deepEqual(lf.frames, ["data: one", "data: two"]);
  assert.equal(lf.rest, "rest");

  const crlf = splitSseFrames("data: one\r\n\r\ndata: two");
  assert.deepEqual(crlf.frames, ["data: one"]);
  assert.equal(crlf.rest, "data: two");
  assert.deepEqual(splitSseFrames(crlf.rest, true), {
    frames: ["data: two"],
    rest: "",
  });
});
