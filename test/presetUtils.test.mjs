import assert from "node:assert/strict";
import test from "node:test";

import {
  applyChatPresetToMessages,
  canAddFavoriteChatPresetPrompt,
  chatPresetPromptsMatch,
  copyFavoriteChatPresetPrompt,
  createDefaultChatPreset,
  exportSillyTavernPresetJson,
  importSillyTavernPreset,
  normalizeChatPresetPrompt,
  normalizeFavoriteChatPresetPrompts,
  reorderChatPresetPrompts,
} from "../src/presetUtils.ts";

function createPreset(prompts) {
  return {
    ...createDefaultChatPreset("test"),
    prompts: prompts.map((prompt, index) =>
      normalizeChatPresetPrompt(
        {
          identifier: prompt.identifier,
          name: prompt.identifier,
          role: prompt.role ?? "system",
          content: prompt.content,
          enabled: prompt.enabled ?? true,
          marker: prompt.marker ?? false,
          injection_position: prompt.position ?? 0,
          injection_depth: prompt.depth ?? 0,
          injection_order: prompt.order ?? index,
        },
        index,
      ),
    ),
  };
}

const macroContext = {
  user: "User",
  char: "Assistant",
  description: "",
  persona: "",
  lastUserMessage: "latest",
};

function text(messages) {
  return messages.map((message) => `${message.role}:${message.content}`);
}

test("drag insertion handles both directions, end gaps and adjacent no-op gaps", () => {
  const prompts = createPreset([
    { identifier: "a", content: "A" }, { identifier: "b", content: "B", enabled: false },
    { identifier: "c", content: "C", position: 2, depth: 3, order: 42 }, { identifier: "d", content: "D" },
  ]).prompts;
  const ids = (items) => items.map((prompt) => prompt.identifier);
  assert.deepEqual(ids(reorderChatPresetPrompts(prompts, "a", 3)), ["b", "c", "a", "d"]);
  assert.deepEqual(ids(reorderChatPresetPrompts(prompts, "d", 1)), ["a", "d", "b", "c"]);
  assert.deepEqual(ids(reorderChatPresetPrompts(prompts, "a", 4)), ["b", "c", "d", "a"]);
  assert.deepEqual(ids(reorderChatPresetPrompts(prompts, "d", 0)), ["d", "a", "b", "c"]);
  assert.equal(reorderChatPresetPrompts(prompts, "b", 1), prompts);
  assert.equal(reorderChatPresetPrompts(prompts, "b", 2), prompts);
  assert.equal(reorderChatPresetPrompts(prompts, "missing", 1), prompts);
  assert.equal(reorderChatPresetPrompts(prompts, "a", NaN), prompts);
  const reordered = reorderChatPresetPrompts(prompts, "c", 0);
  assert.equal(reordered[0], prompts[2], "moving preserves the module and its injection settings");
  assert.equal(reordered[2].enabled, false);
  assert.deepEqual(ids(prompts), ["a", "b", "c", "d"], "the original list is unchanged");
  const preset = { ...createDefaultChatPreset(), prompts: reorderChatPresetPrompts(prompts, "d", 1) };
  const exported = JSON.parse(exportSillyTavernPresetJson(preset));
  assert.deepEqual(exported.prompt_order[0].order.map((entry) => entry.identifier), ["a", "d", "b", "c"]);
});

test("favorite copies preserve injection settings, survive identifier collisions and stay independent", () => {
  const saved = normalizeChatPresetPrompt({
    identifier: "shared", name: "收藏模板", content: "saved content", role: "assistant",
    enabled: false, systemPrompt: true, injectionPosition: 2, injectionDepth: 1, injectionOrder: 42,
  }, 0);
  const preset = createPreset([{ identifier: "shared", content: "existing content" }]);
  preset.backupPrompts = [normalizeChatPresetPrompt({ identifier: "backup", content: "keep backup" }, 0)];
  const before = JSON.stringify(preset);
  const copy = copyFavoriteChatPresetPrompt(preset, saved);
  assert.ok(copy);
  assert.notEqual(copy.identifier, saved.identifier);
  assert.deepEqual(copy, { ...saved, identifier: copy.identifier, enabled: true });
  assert.equal(JSON.stringify(preset), before);
  assert.equal(saved.enabled, false);
  preset.prompts.push(copy);
  assert.equal(canAddFavoriteChatPresetPrompt(preset, saved), false);
  assert.equal(copyFavoriteChatPresetPrompt(preset, saved), null);
  const messages = applyChatPresetToMessages(preset, "", [{ role: "user", content: "latest" }], macroContext);
  assert.ok(messages.some((message) => message.role === "assistant" && message.content === "saved content"));
  copy.content = "local edit";
  assert.equal(saved.content, "saved content");
  assert.equal(chatPresetPromptsMatch(copy, saved), false);
});

test("favorite special modules retain Tavern identifiers and never overwrite conflicting modules", () => {
  const preset = createDefaultChatPreset();
  const history = normalizeChatPresetPrompt({ identifier: "chatHistory", name: "History", marker: true }, 0);
  preset.backupPrompts = [history];
  assert.equal(copyFavoriteChatPresetPrompt(preset, history).identifier, "chatHistory");
  const main = normalizeChatPresetPrompt({ identifier: "main", name: "Main", content: "saved main" }, 0);
  preset.prompts = [{ ...main, content: "keep current main" }];
  assert.equal(copyFavoriteChatPresetPrompt(preset, main), null);
  assert.equal(preset.prompts[0].content, "keep current main");
  assert.equal(chatPresetPromptsMatch(history, { ...history, identifier: "worldInfoBefore" }), false);
});

test("favorite storage round-trips snapshots and ignores invalid entries", () => {
  const favorites = normalizeFavoriteChatPresetPrompts([
    null, { id: "invalid" }, { id: "favorite", prompt: { identifier: "saved", content: "收藏内容", injectionDepth: 3 } },
  ]);
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0].id, "favorite");
  assert.equal(favorites[0].prompt.content, "收藏内容");
  assert.equal(favorites[0].prompt.injectionDepth, 3);
  assert.deepEqual(normalizeFavoriteChatPresetPrompts(JSON.parse(JSON.stringify(favorites))), favorites);
  assert.deepEqual(normalizeFavoriteChatPresetPrompts({}), []);
});

test("chat depth is measured from the original message boundaries", () => {
  const preset = createPreset([
    { identifier: "chatHistory", marker: true },
    { identifier: "depth-0", content: "after latest", position: 2, depth: 0 },
    { identifier: "depth-1", content: "before latest", position: 2, depth: 1 },
  ]);
  const messages = applyChatPresetToMessages(
    preset,
    "base",
    [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "latest" },
    ],
    macroContext,
  );

  assert.deepEqual(text(messages), [
    "system:base",
    "user:earlier",
    "system:before latest",
    "assistant:latest",
    "system:after latest",
  ]);
});

test("same-depth injections preserve Tavern injection order", () => {
  const preset = createPreset([
    { identifier: "chatHistory", marker: true },
    { identifier: "second", content: "second", position: 2, depth: 0, order: 20 },
    { identifier: "first", content: "first", position: 2, depth: 0, order: 10 },
  ]);
  const messages = applyChatPresetToMessages(
    preset,
    "base",
    [{ role: "user", content: "latest" }],
    macroContext,
  );

  assert.deepEqual(text(messages), [
    "system:base",
    "user:latest",
    "system:first",
    "system:second",
  ]);
});

test("same-depth injections use Tavern role priority after reversing the chat", () => {
  const preset = createPreset([
    { identifier: "chatHistory", marker: true },
    { identifier: "system", content: "system", role: "system", position: 2, depth: 0, order: 100 },
    { identifier: "user", content: "user", role: "user", position: 2, depth: 0, order: 100 },
    { identifier: "assistant", content: "assistant", role: "assistant", position: 2, depth: 0, order: 100 },
  ]);
  const messages = applyChatPresetToMessages(
    preset,
    "base",
    [{ role: "user", content: "latest" }],
    macroContext,
  );

  assert.deepEqual(text(messages), [
    "system:base",
    "user:latest",
    "assistant:assistant",
    "user:user",
    "system:system",
  ]);
});

test("maps SillyTavern position 1 to in-chat depth and exports it back as 1", () => {
  const preset = importSillyTavernPreset(
    {
      name: "native",
      prompts: [
        {
          identifier: "chatHistory",
          name: "Chat History",
          marker: true,
        },
        {
          identifier: "native-depth",
          name: "Native Depth",
          role: "system",
          content: "native",
          injection_position: 1,
          injection_depth: 3,
        },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: "chatHistory", enabled: true },
            { identifier: "native-depth", enabled: true },
          ],
        },
      ],
    },
    "native.json",
  );

  assert.equal(preset.prompts[1].injectionPosition, 2);
  assert.equal(preset.prompts[1].injectionDepth, 3);
  const exported = JSON.parse(exportSillyTavernPresetJson(preset));
  const exportedPrompt = exported.prompts.find((prompt) => prompt.identifier === "native-depth");
  assert.equal(exportedPrompt.injection_position, 1);
});

test("depths beyond history clamp to the beginning and relative prompts ignore depth", () => {
  const preset = createPreset([
    { identifier: "relative", content: "relative", position: 0, depth: 99 },
    { identifier: "chatHistory", marker: true },
    { identifier: "clamped", content: "first", position: 2, depth: 99 },
  ]);
  const messages = applyChatPresetToMessages(
    preset,
    "base",
    [{ role: "user", content: "latest" }],
    macroContext,
  );

  assert.deepEqual(text(messages), [
    "system:first",
    "system:relative",
    "system:base",
    "user:latest",
  ]);
});
