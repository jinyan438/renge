import assert from "node:assert/strict";
import test from "node:test";

import {
  getAiModeAvatarImage,
  normalizeAiAvatarProfiles,
} from "../src/aiAvatarUtils.ts";

test("normalizes avatar groups, legacy fields, duplicate IDs, and active indexes", () => {
  const profiles = normalizeAiAvatarProfiles([
    {
      id: "model-avatar",
      model_id: "  GPT-4o  ",
      avatarImages: ["first", "second", "first"],
      avatarImage: "legacy",
      activeAvatarIndex: 99,
    },
    {
      id: "model-avatar",
      modelId: "other-model",
      avatars: ["other"],
    },
  ]);
  const { updatedAt: firstUpdatedAt, ...firstProfile } = profiles[0];
  const { updatedAt: secondUpdatedAt, ...secondProfile } = profiles[1];

  assert.deepEqual(firstProfile, {
    id: "model-avatar",
    modelId: "GPT-4o",
    avatarImages: ["first", "second", "legacy"],
    activeAvatarIndex: 2,
  });
  assert.deepEqual(secondProfile, {
    id: "model-avatar-2",
    modelId: "other-model",
    avatarImages: ["other"],
    activeAvatarIndex: 0,
  });
  assert.match(firstUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(secondUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("matches model IDs case-insensitively and returns the selected avatar", () => {
  const profiles = normalizeAiAvatarProfiles([
    {
      id: "avatar",
      modelId: "Qwen/Qwen3",
      avatarImages: ["first", "selected"],
      activeAvatarIndex: 1,
    },
  ]);

  assert.equal(getAiModeAvatarImage(profiles, " qwen/qwen3 "), "selected");
  assert.equal(getAiModeAvatarImage(profiles, "different-model"), "");
  assert.equal(getAiModeAvatarImage(profiles, ""), "");
});
