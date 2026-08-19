import assert from "node:assert/strict";
import test from "node:test";
import {
  convertOpenAiMessagesToPi,
  filterPiCustomToolDefinitions,
  getPiNativeToolNames,
  normalizePiProviderConfig,
} from "../src/piBridgeUtils.mjs";

const tool = (name) => ({
  type: "function",
  function: { name, description: name, parameters: { type: "object", properties: {} } },
});

test("Electron workspaces use all Pi native coding tools and remove Renge duplicates", () => {
  const workspace = { kind: "electron", cwd: "E:/project" };
  assert.deepEqual(getPiNativeToolNames(workspace), [
    "read",
    "grep",
    "find",
    "ls",
    "write",
    "edit",
    "bash",
  ]);
  assert.deepEqual(
    filterPiCustomToolDefinitions([
      tool("local_read_file"),
      tool("local_run_command"),
      tool("browser_read_page"),
      tool("mcp__vision"),
      tool("local_transfer_attachment_file"),
    ], workspace).map((entry) => entry.function.name),
    ["browser_read_page", "mcp__vision", "local_transfer_attachment_file"],
  );
});

test("non-Node workspaces retain Renge file tools", () => {
  const tools = [tool("local_read_file"), tool("phone_tap")];
  assert.deepEqual(getPiNativeToolNames({ kind: "android" }), []);
  assert.deepEqual(filterPiCustomToolDefinitions(tools, { kind: "android" }), tools);
});

test("Pi extension tools take precedence over same-named Renge tools", () => {
  assert.deepEqual(
    filterPiCustomToolDefinitions(
      [tool("extension_search"), tool("phone_tap")],
      { kind: "android" },
      new Set(["extension_search"]),
    ).map((entry) => entry.function.name),
    ["phone_tap"],
  );
});

test("OpenAI history converts to Pi transcript without duplicating the last user prompt", () => {
  const result = convertOpenAiMessagesToPi([
    { role: "system", content: "System rules" },
    { role: "user", content: "first" },
    {
      role: "assistant",
      content: "checking",
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { name: "browser_read_page", arguments: "{\"mode\":\"text\"}" },
      }],
    },
    { role: "tool", tool_call_id: "call-1", content: "page text" },
    { role: "user", content: "final question" },
  ], {
    providerId: "renge-test",
    modelId: "test-model",
  });

  assert.equal(result.systemPrompt, "System rules");
  assert.equal(result.promptMessage.content, "final question");
  assert.equal(result.history.length, 3);
  assert.equal(result.history[1].content[1].name, "browser_read_page");
  assert.equal(result.history[2].toolName, "browser_read_page");
});

test("trailing assistant history stays in context for Pi continuation requests", () => {
  const result = convertOpenAiMessagesToPi([
    { role: "user", content: "write a story" },
    { role: "assistant", content: "chapter one" },
  ]);

  assert.equal(result.promptMessage, null);
  assert.equal(result.history.length, 2);
  assert.equal(result.history[1].role, "assistant");
});

test("provider normalization selects the matching Pi OpenAI adapter", () => {
  assert.deepEqual(
    normalizePiProviderConfig({
      apiBaseUrl: "http://127.0.0.1:1234/v1/",
      apiKey: "TOKEN",
      apiType: "responses",
      request: { model: "model-a" },
    }),
    {
      apiBaseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "TOKEN",
      apiType: "responses",
      piApi: "openai-responses",
      modelId: "model-a",
    },
  );
});
