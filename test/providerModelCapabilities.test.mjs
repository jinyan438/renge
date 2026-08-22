import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureProviderModelInputModes,
  normalizeProviderModelInputModes,
  providerModelSupportsImages,
  setProviderModelImageSupport,
} from "../src/providerModelCapabilities.ts";

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
