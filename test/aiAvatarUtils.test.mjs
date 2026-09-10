import assert from "node:assert/strict";
import test from "node:test";

import {
  getAiModeAvatarImage,
  normalizeAiAvatarSettings,
} from "../src/aiAvatarUtils.ts";

test("normalizes an avatar library and one-avatar model bindings", () => {
  const settings = normalizeAiAvatarSettings({
    images: [
      { id: "first", dataUrl: "first" },
      { id: "second", dataUrl: "second" },
      { id: "duplicate", dataUrl: "first" },
    ],
    modelProfiles: [
      { id: "model-avatar", model_id: "  GPT-4o  ", avatar_id: "second" },
      { id: "model-avatar", modelId: "other-model", avatarId: "missing" },
    ],
  });

  assert.deepEqual(
    settings.images.map(({ id, dataUrl }) => ({ id, dataUrl })),
    [
      { id: "first", dataUrl: "first" },
      { id: "second", dataUrl: "second" },
    ],
  );
  assert.deepEqual(
    settings.modelProfiles.map(({ id, modelId, avatarId }) => ({
      id,
      modelId,
      avatarId,
    })),
    [
      { id: "model-avatar", modelId: "GPT-4o", avatarId: "second" },
      { id: "model-avatar-2", modelId: "other-model", avatarId: "" },
    ],
  );
});

test("migrates the previous per-model multi-avatar format", () => {
  const settings = normalizeAiAvatarSettings([
    {
      id: "legacy-model",
      modelId: "legacy",
      avatarImages: ["first", "selected"],
      activeAvatarIndex: 1,
    },
  ]);

  assert.deepEqual(settings.images.map((image) => image.dataUrl), ["first", "selected"]);
  assert.equal(settings.modelProfiles[0].modelId, "legacy");
  assert.equal(settings.modelProfiles[0].avatarId, settings.images[1].id);
});

test("matches model IDs case-insensitively and returns only the selected avatar", () => {
  const settings = normalizeAiAvatarSettings({
    images: [
      { id: "first", dataUrl: "first" },
      { id: "selected", dataUrl: "selected" },
    ],
    modelProfiles: [
      { id: "avatar", modelId: "Qwen/Qwen3", avatarId: "selected" },
    ],
  });

  assert.equal(getAiModeAvatarImage(settings, " qwen/qwen3 "), "selected");
  assert.equal(getAiModeAvatarImage(settings, "different-model"), "");
  assert.equal(getAiModeAvatarImage(settings, ""), "");
});
