import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResponsesApiRequest,
  extractResponsesApiStreamEvent,
  getResponsesApiErrorMessage,
  normalizeProviderApiType,
  normalizeResponsesApiPayload,
  resolveStatusBarProviderApiType,
} from "../src/responsesApiUtils.mjs";

test("normalizes provider API types without changing legacy providers", () => {
  assert.equal(normalizeProviderApiType(undefined), "chat-completions");
  assert.equal(normalizeProviderApiType("responses_api"), "responses");
});

test("routes DeepSeek V4 Pro status updates away from the unsupported Codex integration", () => {
  assert.equal(
    resolveStatusBarProviderApiType("responses", "deepseek-v4-pro"),
    "chat-completions",
  );
  assert.equal(
    resolveStatusBarProviderApiType("responses", "deepseek/deepseek-v4-pro"),
    "chat-completions",
  );
  assert.equal(
    resolveStatusBarProviderApiType("responses", "deepseek-v4-flash"),
    "responses",
  );
  assert.equal(
    resolveStatusBarProviderApiType("chat-completions", "deepseek-v4-pro"),
    "chat-completions",
  );
});

test("maps chat messages, tools, reasoning, and structured output to Responses", () => {
  const request = buildResponsesApiRequest({
    model: "gpt-5.6",
    messages: [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Weather?" },
      {
        role: "assistant",
        content: null,
        responses_reasoning_items: [{
          id: "rs_1",
          type: "reasoning",
          summary: [{ type: "summary_text", text: "Need weather" }],
        }],
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "weather", arguments: "{\"city\":\"Shanghai\"}" },
        }],
      },
      { role: "tool", tool_call_id: "call_1", content: "sunny" },
    ],
    tools: [{
      type: "function",
      function: {
        name: "weather",
        description: "Get weather",
        parameters: { type: "object" },
      },
    }],
    tool_choice: { type: "function", function: { name: "weather" } },
    reasoning_effort: "high",
    max_tokens: 1200,
    response_format: {
      type: "json_schema",
      json_schema: { name: "forecast", strict: true, schema: { type: "object" } },
    },
    stream_options: { include_usage: true },
  });

  assert.deepEqual(request.input, [
    { role: "system", content: "Be concise." },
    { role: "user", content: "Weather?" },
    {
      id: "rs_1",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Need weather" }],
    },
    {
      type: "function_call",
      call_id: "call_1",
      name: "weather",
      arguments: "{\"city\":\"Shanghai\"}",
    },
    { type: "function_call_output", call_id: "call_1", output: "sunny" },
  ]);
  assert.deepEqual(request.tools, [{
    type: "function",
    name: "weather",
    description: "Get weather",
    parameters: { type: "object" },
    strict: false,
  }]);
  assert.deepEqual(request.tool_choice, { type: "function", name: "weather" });
  assert.deepEqual(request.reasoning, { effort: "high", summary: "auto" });
  assert.equal(request.max_output_tokens, 1200);
  assert.deepEqual(request.text, {
    format: { name: "forecast", strict: true, schema: { type: "object" }, type: "json_schema" },
  });
  assert.equal(request.stream_options, undefined);
});

test("maps Chat Completions image parts to Responses input parts", () => {
  const request = buildResponsesApiRequest({
    model: "gpt-5.6",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Inspect this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AA==", detail: "high" } },
      ],
    }],
  });

  assert.deepEqual(request.input, [{
    role: "user",
    content: [
      { type: "input_text", text: "Inspect this" },
      { type: "input_image", image_url: "data:image/png;base64,AA==", detail: "high" },
    ],
  }]);
});

test("normalizes a Responses result to the app chat completion shape", () => {
  const payload = normalizeResponsesApiPayload({
    id: "resp_1",
    object: "response",
    status: "completed",
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "Checked inputs" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] },
      { type: "function_call", call_id: "call_2", name: "save", arguments: "{\"ok\":true}" },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });

  assert.equal(payload.output_text, "Done");
  assert.equal(payload.choices[0].message.content, "Done");
  assert.equal(payload.choices[0].message.reasoning_content, "Checked inputs");
  assert.deepEqual(payload.choices[0].message.tool_calls, [{
    id: "call_2",
    type: "function",
    function: { name: "save", arguments: "{\"ok\":true}" },
  }]);
  assert.deepEqual(payload.choices[0].message.responses_reasoning_items, [{
    type: "reasoning",
    summary: [{ type: "summary_text", text: "Checked inputs" }],
  }]);
  assert.equal(payload.choices[0].finish_reason, "tool_calls");
  assert.equal(payload.usage.prompt_tokens, 10);
  assert.equal(payload.usage.completion_tokens, 5);
});

test("extracts Responses text, reasoning, and function stream events", () => {
  assert.deepEqual(
    extractResponsesApiStreamEvent({ type: "response.output_text.delta", delta: "Hi" }),
    { content: "Hi", reasoning: "", mode: "delta" },
  );
  assert.deepEqual(
    extractResponsesApiStreamEvent({
      type: "response.reasoning_summary_text.delta",
      delta: "Checking",
    }),
    { content: "", reasoning: "Checking", mode: "delta" },
  );
  assert.deepEqual(
    extractResponsesApiStreamEvent({
      type: "response.output_item.added",
      output_index: 1,
      item: {
        type: "function_call",
        call_id: "call_3",
        name: "search",
        arguments: "",
      },
    }),
    {
      content: "",
      reasoning: "",
      mode: "delta",
      toolCallDeltas: [{
        index: 1,
        id: "call_3",
        type: "function",
        function: { name: "search", arguments: "" },
      }],
    },
  );
  assert.equal(
    getResponsesApiErrorMessage({ type: "error", message: "Upstream failed" }),
    "Upstream failed",
  );
});
