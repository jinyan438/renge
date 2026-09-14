import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PROVIDER_MODEL_MAX_OUTPUT_TOKENS,
  ensureProviderModelMaxOutputTokens,
  ensureProviderModelInputModes,
  getProviderModelMaxOutputTokens,
  normalizeProviderModelMaxOutputTokens,
  normalizeProviderModelInputModes,
  providerModelSupportsImages,
  setProviderModelMaxOutputTokens,
  setProviderModelImageSupport,
  stripUnsupportedImageInputs,
} from "../src/providerModelCapabilities.ts";

test("normalizes per-model maximum output tokens with a 65536 default", () => {
  assert.deepEqual(
    normalizeProviderModelMaxOutputTokens({
      " Model-A ": 32_768,
      "model-b": "12000",
      invalid: 0,
      "": 123,
    }),
    {
      "model-a": 32_768,
      "model-b": 12_000,
      invalid: DEFAULT_PROVIDER_MODEL_MAX_OUTPUT_TOKENS,
    },
  );
  assert.equal(
    getProviderModelMaxOutputTokens({}, "new-model"),
    DEFAULT_PROVIDER_MODEL_MAX_OUTPUT_TOKENS,
  );
  assert.deepEqual(
    ensureProviderModelMaxOutputTokens({ "model-a": 8192 }, ["MODEL-A", "model-b"]),
    { "model-a": 8192, "model-b": DEFAULT_PROVIDER_MODEL_MAX_OUTPUT_TOKENS },
  );
  assert.deepEqual(
    setProviderModelMaxOutputTokens({ "model-a": 8192 }, "MODEL-B", 24_000),
    { "model-a": 8192, "model-b": 24_000 },
  );
});

test("normalizes model input modes and defaults configured models to text", () => {
  assert.deepEqual(
    normalizeProviderModelInputModes({
      " Qwen-VL ": ["image", "image", "text"],
      "text-only": ["audio"],
      "": ["image"],
      invalid: "image",
    }),
    {
      "qwen-vl": ["text", "image"],
      "text-only": ["text"],
      invalid: ["text"],
    },
  );
});

test("matches model IDs case-insensitively and does not guess visual support", () => {
  const modes = { "qwen-vl": ["text", "image"] };
  assert.equal(providerModelSupportsImages(modes, " QWEN-VL "), true);
  assert.equal(providerModelSupportsImages(modes, "qwen-text"), false);
  assert.equal(providerModelSupportsImages({}, "qwen-vl"), false);
});

test("updates one model without changing other model capabilities", () => {
  const initial = { "qwen-vl": ["text", "image"], "qwen-text": ["text"] };
  const disabled = setProviderModelImageSupport(initial, "QWEN-VL", false);
  assert.deepEqual(disabled, {
    "qwen-vl": ["text"],
    "qwen-text": ["text"],
  });
  const enabled = setProviderModelImageSupport(disabled, "qwen-text", true);
  assert.deepEqual(enabled, {
    "qwen-vl": ["text"],
    "qwen-text": ["text", "image"],
  });
});

test("adds newly pulled models as text-only while preserving configured capabilities", () => {
  assert.deepEqual(
    ensureProviderModelInputModes({ "qwen-vl": ["text", "image"] }, ["Qwen-VL", "new-model"]),
    {
      "qwen-vl": ["text", "image"],
      "new-model": ["text"],
    },
  );
});

test("strips image content parts for text-only models while preserving text", () => {
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "读取截图" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      ],
    },
    {
      role: "assistant",
      content: [{ type: "image", data: "AAA" }],
    },
  ];

  assert.deepEqual(stripUnsupportedImageInputs(messages, false), [
    {
      role: "user",
      content: [{ type: "text", text: "读取截图" }],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "图片内容未发送给当前文本模型。" }],
    },
  ]);
  assert.strictEqual(stripUnsupportedImageInputs(messages, true), messages);
});
