import assert from "node:assert/strict";
import test from "node:test";

import {
  applyContextCompressionSummary,
  buildFallbackContextSummary,
  createContextCompressionPlan,
  estimateContextMessagesTokens,
  estimateContextTextTokens,
  getContextCompressionTokenBudget,
  normalizeContextCompressionSettings,
  resolveContextCompressionLimit,
  splitContextSummaryTranscript,
  truncateContextSummary,
} from "../src/contextCompressionUtils.ts";

function settings(modelId = "demo/model", maxContextTokens = 2_048) {
  return {
    enabled: true,
    modelLimits: [{ id: "rule-1", modelId, maxContextTokens }],
  };
}

test("normalizes limits, removes duplicate model IDs, and matches IDs case-insensitively", () => {
  const normalized = normalizeContextCompressionSettings({
    enabled: true,
    model_limits: [
      { id: "old", model_id: "Demo/Model", max_context_tokens: 4_096 },
      { id: "new", modelId: " demo/model ", maxContextTokens: 8_192 },
      { id: "blank", modelId: "", maxContextTokens: 1_000 },
    ],
  });

  assert.equal(normalized.enabled, true);
  assert.deepEqual(normalized.modelLimits, [
    { id: "new", modelId: "demo/model", maxContextTokens: 8_192 },
  ]);
  assert.equal(resolveContextCompressionLimit(normalized, "DEMO/MODEL"), 8_192);
  assert.equal(resolveContextCompressionLimit(normalized, "other-model"), null);
  assert.equal(
    resolveContextCompressionLimit({ ...normalized, enabled: false }, "demo/model"),
    null,
  );
});

test("calculates the same input safety threshold used by compression", () => {
  assert.deepEqual(getContextCompressionTokenBudget(settings(), "DEMO/MODEL"), {
    maxContextTokens: 2_048,
    outputReserveTokens: 1_024,
    inputBudgetTokens: 1_024,
    safetyThresholdTokens: 921,
  });
  assert.deepEqual(getContextCompressionTokenBudget(settings(), "demo/model", 1_500), {
    maxContextTokens: 2_048,
    outputReserveTokens: 1_500,
    inputBudgetTokens: 548,
    safetyThresholdTokens: 493,
  });
  assert.equal(
    getContextCompressionTokenBudget(
      { ...settings(), enabled: false },
      "demo/model",
    ),
    null,
  );
});

test("does not compress requests below the configured safety threshold", () => {
  const messages = [
    { role: "system", content: "Keep this instruction." },
    { role: "user", content: "Short question" },
  ];
  assert.equal(createContextCompressionPlan(messages, settings(), "demo/model"), null);
});

test("preserves system instructions and recent turns while replacing older messages", () => {
  const messages = [
    { role: "system", content: `Important system policy ${"S".repeat(400)}` },
    ...Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `turn-${index} ${"history ".repeat(170)}`,
    })),
  ];
  const plan = createContextCompressionPlan(messages, settings(), "demo/model");

  assert.ok(plan);
  assert.ok(plan.removedMessages.length > 0);
  assert.equal(plan.keptMessages[0], messages[0]);
  assert.equal(plan.keptMessages.at(-1), messages.at(-1));
  assert.ok(plan.estimatedInputTokens > plan.inputBudgetTokens * 0.9);

  const compressed = applyContextCompressionSummary(plan, "用户已确定项目目标和关键约束。");
  assert.equal(compressed.filter((message) => message.role === "system").length, 1);
  assert.match(String(compressed[0].content), /Important system policy/);
  assert.match(String(compressed[0].content), /自动上下文压缩摘要/);
  assert.equal(compressed.at(-1), messages.at(-1));
  assert.ok(estimateContextMessagesTokens(compressed) < estimateContextMessagesTokens(messages));
});

test("merges leading system messages and a summary for strict chat templates", () => {
  const compressed = applyContextCompressionSummary(
    {
      maxContextTokens: 8_192,
      inputBudgetTokens: 7_000,
      estimatedInputTokens: 6_500,
      summaryTokenBudget: 512,
      removedMessages: [],
      keptMessages: [
        { role: "system", content: "Primary instruction" },
        { role: "system", content: "Status context" },
        { role: "user", content: "Latest request" },
      ],
      summaryInsertIndex: 2,
    },
    "Earlier facts",
  );

  assert.equal(compressed.length, 2);
  assert.equal(compressed[0].role, "system");
  assert.match(compressed[0].content, /Primary instruction/);
  assert.match(compressed[0].content, /Status context/);
  assert.match(compressed[0].content, /自动上下文压缩摘要/);
  assert.equal(compressed[1].role, "user");
});

test("keeps assistant tool calls together with their following tool results", () => {
  const messages = [
    { role: "system", content: "system" },
    { role: "user", content: "old ".repeat(1_000) },
    { role: "assistant", content: "old answer ".repeat(800) },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call-1", type: "function", function: { name: "lookup" } }],
    },
    { role: "tool", tool_call_id: "call-1", content: "result" },
    { role: "user", content: "latest question" },
  ];
  const plan = createContextCompressionPlan(messages, settings(), "demo/model");
  assert.ok(plan);
  const keptRoles = plan.keptMessages.map((message) => message.role);
  const toolIndex = keptRoles.indexOf("tool");
  assert.ok(toolIndex > 0);
  assert.equal(keptRoles[toolIndex - 1], "assistant");
});

test("splits oversized transcripts on message boundaries and builds a bounded fallback", () => {
  const transcript = Array.from(
    { length: 20 },
    (_, index) => `#${index + 1} user\n${"detail ".repeat(100)}`,
  ).join("\n\n");
  const chunks = splitContextSummaryTranscript(transcript, 500);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length > 0));

  const fallback = buildFallbackContextSummary(
    Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `message-${index} ${"content ".repeat(100)}`,
    })),
    300,
  );
  assert.match(fallback, /message-0/);
  assert.ok(fallback.length < transcript.length);

  const cjkSummary = truncateContextSummary("重要信息".repeat(500), 120);
  assert.ok(estimateContextTextTokens(cjkSummary) <= 120);
});
