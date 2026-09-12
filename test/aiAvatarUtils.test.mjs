import assert from "node:assert/strict";
import test from "node:test";

import {
  compactAiAvatarMessageIdentities,
  getAiModeAvatarId,
  getAiModeAvatarImage,
  getSelectableAiAvatarImages,
  normalizeAiAvatarSettings,
  pruneArchivedAiAvatarImages,
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
      { id: "duplicate", dataUrl: "first" },
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
  assert.equal(getAiModeAvatarId(settings, " qwen/qwen3 "), "selected");
  assert.equal(getAiModeAvatarImage(settings, "different-model"), "");
  assert.equal(getAiModeAvatarId(settings, "different-model"), "");
  assert.equal(getAiModeAvatarImage(settings, ""), "");
});

test("deduplicates legacy per-message avatar images into the shared library", () => {
  const source = "data:image/png;base64,shared";
  const sessions = [{
    id: "session",
    messages: [
      { aiIdentity: { modelId: "model", modelName: "Model", avatarImage: source } },
      { aiIdentity: { modelId: "model", modelName: "Model", avatarImage: source } },
    ],
  }];
  const result = compactAiAvatarMessageIdentities(
    sessions,
    { images: [], modelProfiles: [] },
  );

  assert.equal(result.settings.images.length, 1);
  assert.equal(result.settings.images[0].dataUrl, source);
  assert.equal(
    result.sessions[0].messages[0].aiIdentity.avatarId,
    result.settings.images[0].id,
  );
  assert.equal(
    result.sessions[0].messages[1].aiIdentity.avatarId,
    result.settings.images[0].id,
  );
  assert.equal(result.sessions[0].messages[0].aiIdentity.avatarImage, undefined);
  assert.equal(sessions[0].messages[0].aiIdentity.avatarImage, source);
});

test("reuses an existing shared avatar and is idempotent after migration", () => {
  const source = "data:image/png;base64,existing";
  const settings = normalizeAiAvatarSettings({
    images: [{ id: "existing", dataUrl: source }],
  });
  const first = compactAiAvatarMessageIdentities(
    [{ messages: [{ aiIdentity: { modelId: "model", modelName: "Model", avatarImage: source } }] }],
    settings,
  );
  const second = compactAiAvatarMessageIdentities(first.sessions, first.settings);

  assert.equal(first.settings, settings);
  assert.equal(first.settings.images.length, 1);
  assert.equal(first.sessions[0].messages[0].aiIdentity.avatarId, "existing");
  assert.equal(second.sessions, first.sessions);
  assert.equal(second.settings, first.settings);
});

test("preserves explicit duplicate image IDs referenced by messages", () => {
  const source = "data:image/png;base64,same";
  const settings = normalizeAiAvatarSettings({
    images: [
      { id: "first", dataUrl: source },
      { id: "second", dataUrl: source },
    ],
    modelProfiles: [{ id: "model", modelId: "model", avatarId: "second" }],
  });
  const result = compactAiAvatarMessageIdentities(
    [{ messages: [{ aiIdentity: { modelId: "model", modelName: "Model", avatarId: "second" } }] }],
    settings,
  );

  assert.deepEqual(settings.images.map((image) => image.id), ["first", "second"]);
  assert.equal(getAiModeAvatarId(settings, "model"), "second");
  assert.equal(result.sessions[0].messages[0].aiIdentity.avatarId, "second");
});

test("keeps archived avatars available to history but excludes them from model selection", () => {
  const settings = normalizeAiAvatarSettings({
    images: [
      { id: "active", dataUrl: "active" },
      { id: "history", dataUrl: "history", archived: true },
    ],
    modelProfiles: [
      { id: "active-model", modelId: "active-model", avatarId: "active" },
      { id: "history-model", modelId: "history-model", avatarId: "history" },
    ],
  });

  assert.deepEqual(getSelectableAiAvatarImages(settings).map((image) => image.id), ["active"]);
  assert.equal(settings.images.find((image) => image.id === "history")?.dataUrl, "history");
  assert.equal(getAiModeAvatarId(settings, "active-model"), "active");
  assert.equal(getAiModeAvatarId(settings, "history-model"), "");
});

test("removes archived avatars after history no longer references them", () => {
  const settings = normalizeAiAvatarSettings({
    images: [
      { id: "active", dataUrl: "active" },
      { id: "retained", dataUrl: "retained", archived: true },
      { id: "unused", dataUrl: "unused", archived: true },
    ],
  });
  const pruned = pruneArchivedAiAvatarImages(settings, new Set(["retained"]));

  assert.deepEqual(pruned.images.map((image) => image.id), ["active", "retained"]);
  assert.equal(pruneArchivedAiAvatarImages(pruned, new Set(["retained"])), pruned);
});
