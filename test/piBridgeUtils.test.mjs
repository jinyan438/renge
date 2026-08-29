import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  convertOpenAiMessagesToPi,
  filterPiCustomToolDefinitions,
  getPiNativeToolNames,
  getPiReasoningModelConfig,
  getPiSamplingParams,
  normalizePiCompactionConfig,
  normalizePiSkillPaths,
  normalizePiProviderConfig,
  PI_KERNEL_ID,
  shouldEnablePiTools,
} from "../src/piBridgeUtils.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const tool = (name) => ({
  type: "function",
  function: { name, description: name, parameters: { type: "object", properties: {} } },
});

test("Pi sampling params leave token-limit field selection to the provider adapter", () => {
  assert.deepEqual(getPiSamplingParams({
    model: "test-model",
    messages: [],
    max_tokens: 4_096,
    max_completion_tokens: 8_192,
    max_output_tokens: 16_384,
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    reasoning_effort: "max",
    enable_thinking: true,
  }), {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
  });
});

test("Pi owns reasoning controls so a partial-progress continuation can disable rethinking", () => {
  assert.deepEqual(getPiReasoningModelConfig({
    reasoning_effort: "max",
    include_reasoning: true,
  }), {
    reasoning: true,
    thinkingLevel: "max",
    thinkingLevelMap: {
      off: "none",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  });
  assert.deepEqual(getPiReasoningModelConfig({ enable_thinking: true }), {
    reasoning: true,
    thinkingLevel: "high",
    thinkingLevelMap: {
      off: "none",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    compat: {
      thinkingFormat: "qwen",
      supportsReasoningEffort: false,
    },
  });
  assert.deepEqual(getPiReasoningModelConfig({ reasoning_effort: "none" }), {
    reasoning: false,
    thinkingLevel: "off",
  });
  assert.equal(getPiReasoningModelConfig({ include_reasoning: true }).reasoning, true);
});

test("Electron workspaces use all Pi native coding tools and remove Renge duplicates", () => {
  const workspace = { kind: "electron", cwd: "E:/project" };
  assert.deepEqual(getPiNativeToolNames(workspace, { platform: "linux" }), [
    "read",
    "grep",
    "find",
    "ls",
    "write",
    "edit",
    "bash",
  ]);
  assert.deepEqual(getPiNativeToolNames(workspace, { platform: "win32" }), [
    "read",
    "grep",
    "find",
    "ls",
    "write",
    "edit",
    "powershell",
  ]);
  assert.equal(packageJson.dependencies["@earendil-works/pi-coding-agent"], "0.84.4");
  assert.equal(
    PI_KERNEL_ID,
    `@earendil-works/pi-coding-agent@${packageJson.dependencies["@earendil-works/pi-coding-agent"]}`,
  );
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

test("Pi Skills keep the native read tool available without a project workspace", () => {
  const skillPaths = normalizePiSkillPaths([
    " E:/skills/example/SKILL.md ",
    "E:/skills/example/SKILL.md",
    "",
  ]);

  assert.deepEqual(skillPaths, ["E:/skills/example/SKILL.md"]);
  assert.equal(shouldEnablePiTools(false, skillPaths), true);
  assert.deepEqual(getPiNativeToolNames(null, { skillsEnabled: true }), ["read"]);
  assert.deepEqual(getPiNativeToolNames(
    { kind: "electron", cwd: "E:/project" },
    { fullToolsEnabled: false, skillsEnabled: true },
  ), ["read"]);
  assert.equal(shouldEnablePiTools(false, []), false);
  assert.deepEqual(getPiNativeToolNames(null), []);
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

test("Pi compaction settings use native defaults and honor Renge UI overrides", () => {
  assert.deepEqual(normalizePiCompactionConfig(), {
    enabled: true,
    reserveTokens: 16_384,
    keepRecentTokens: 20_000,
  });
  assert.deepEqual(normalizePiCompactionConfig({
    enabled: false,
    reserveTokens: 8_192,
    keep_recent_tokens: 12_000,
  }), {
    enabled: false,
    reserveTokens: 8_192,
    keepRecentTokens: 12_000,
  });
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
      allowImageInputs: false,
      piApi: "openai-responses",
      modelId: "model-a",
    },
  );
});
