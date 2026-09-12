import assert from "node:assert/strict";
import test from "node:test";

import {
  applyChatPresetToMessages,
  createDefaultChatPreset,
  exportSillyTavernPresetJson,
  importSillyTavernPreset,
  normalizeChatPresetPrompt,
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
