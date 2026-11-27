import assert from "node:assert/strict";
import test from "node:test";

import { createCharacterCard } from "../src/characterCardUtils.ts";
import { createDefaultChatPreset } from "../src/presetUtils.ts";
import { createUserProfile } from "../src/userProfileUtils.ts";
import { createWorldBook } from "../src/worldbookUtils.ts";
import {
  SILLYTAVERN_EVENT_TYPES,
  TAVERN_HELPER_IFRAME_EVENTS,
  TAVERN_WORLDBOOK_META_KEY,
  applyTavernHelperCharacter,
  applyTavernHelperPersona,
  applyTavernHelperPreset,
  assignTavernWorldbookUids,
  createTavernHelperDefaultPreset,
  formatSillyTavernWorldInfoEntry,
  formatTavernHelperLorebookEntry,
  formatTavernHelperWorldbookEntry,
  isPresetNormalPrompt,
  isPresetPlaceholderPrompt,
  isPresetSystemPrompt,
  normalizeTavernEventName,
  readTavernHelperWorldbookEntry,
  resolveTavernMessageRange,
  rotateTavernMessages,
  toSillyTavernCharacterData,
  toTavernHelperCharacter,
  toTavernHelperPersona,
  toTavernHelperPreset,
} from "../src/tavernHelperCompat.ts";

test("normalizes legacy event aliases onto SillyTavern 1.19 names and exposes reasoning iframe events", () => {
  assert.equal(normalizeTavernEventName("generation_after_commands"), SILLYTAVERN_EVENT_TYPES.GENERATION_AFTER_COMMANDS);
  assert.equal(normalizeTavernEventName("GENERATION_AFTER_COMMANDS"), "GENERATION_AFTER_COMMANDS");
  assert.equal(normalizeTavernEventName("chat_changed"), "chat_id_changed");
  assert.equal(normalizeTavernEventName("character_deleted"), "characterDeleted");
  assert.equal(normalizeTavernEventName("custom_card_event"), "custom_card_event");
  assert.equal(
    TAVERN_HELPER_IFRAME_EVENTS.REASONING_TOKEN_RECEIVED_FULLY,
    "js_reasoning_token_received_fully",
  );
  assert.equal(
    TAVERN_HELPER_IFRAME_EVENTS.REASONING_TOKEN_RECEIVED_INCREMENTALLY,
    "js_reasoning_token_received_incrementally",
  );
});

test("assigns unique numeric worldbook uids while preserving existing numeric ones", () => {
  const uids = assignTavernWorldbookUids([
    { uid: "entry-opaque-a" },
    { uid: "0" },
    { uid: 2 },
    { uid: "2" },
    { uid: "" },
  ]);
  assert.deepEqual(uids, [1, 0, 2, 3, 4]);
});

test("round-trips Tavern Helper 4 WorldbookEntry metadata, outlet, recursion, effect, and ST position codes", () => {
  const internal = readTavernHelperWorldbookEntry(
    {
      uid: 7,
      name: "校园规则",
      enabled: false,
      strategy: {
        type: "vectorized",
        keys: ["校规", "图书馆"],
        keys_secondary: { logic: "not_any", keys: ["废弃"] },
        scan_depth: 6,
      },
      position: {
        type: "at_depth",
        role: "assistant",
        depth: 3,
        order: 240,
      },
      content: "宵禁后禁止进入二楼阅览室。",
      probability: 65,
      recursion: {
        prevent_incoming: true,
        prevent_outgoing: false,
        delay_until: 2,
      },
      effect: {
        sticky: 3,
        cooldown: 1,
        delay: null,
      },
      extra: {
        cardTag: "rule",
      },
    },
    0,
  );

  assert.equal(internal.uid, "7");
  assert.equal(internal.enabled, false);
  assert.equal(internal.selectiveLogic, 2);
  assert.equal(internal.position, "at_depth");
  assert.equal(internal.depth, 3);
  assert.equal(internal.scanDepth, 6);
  assert.equal(internal.useProbability, true);
  assert.equal(internal.probability, 65);
  assert.ok(internal.extra && TAVERN_WORLDBOOK_META_KEY in internal.extra);

  const thEntry = formatTavernHelperWorldbookEntry(internal, 7);
  assert.equal(thEntry.name, "校园规则");
  assert.equal(thEntry.strategy.type, "vectorized");
  assert.equal(thEntry.strategy.keys_secondary.logic, "not_any");
  assert.equal(thEntry.position.type, "at_depth");
  assert.equal(thEntry.position.role, "assistant");
  assert.equal(thEntry.recursion.prevent_incoming, true);
  assert.equal(thEntry.recursion.delay_until, 2);
  assert.equal(thEntry.effect.sticky, 3);
  assert.equal(thEntry.effect.cooldown, 1);
  assert.equal(thEntry.effect.delay, null);
  assert.deepEqual(thEntry.extra, { cardTag: "rule" });

  const stEntry = formatSillyTavernWorldInfoEntry(internal, 7, 4);
  assert.equal(stEntry.position, 4);
  assert.equal(stEntry.role, 2);
  assert.equal(stEntry.disable, true);
  assert.equal(stEntry.vectorized, true);
  assert.equal(stEntry.excludeRecursion, true);
  assert.equal(stEntry.delayUntilRecursion, 2);
  assert.equal(stEntry.sticky, 3);
  assert.deepEqual(stEntry.extra, { cardTag: "rule" });

  const loreEntry = formatTavernHelperLorebookEntry(internal, 7, 4);
  assert.equal(loreEntry.position, "at_depth_as_assistant");
  assert.equal(loreEntry.type, "vectorized");
  assert.equal(loreEntry.logic, "not_any");
  assert.equal(loreEntry.delay_until_recursion, 2);

  // Verify SillyTavern true numeric position mapping (2/3 = AN, 5/6 = examples, 7 = outlet)
  const beforeAn = readTavernHelperWorldbookEntry({ position: 2, comment: "AN before" }, 0);
  const beforeExamples = readTavernHelperWorldbookEntry({ position: 5, comment: "Examples before" }, 1);
  const outlet = readTavernHelperWorldbookEntry(
    { position: { type: "outlet", outlet_name: "status_slot" }, name: "Outlet" },
    2,
  );
  assert.equal(beforeAn.position, "before_an");
  assert.equal(formatSillyTavernWorldInfoEntry(beforeAn, 1, 0).position, 2);
  assert.equal(beforeExamples.position, "before_examples");
  assert.equal(formatSillyTavernWorldInfoEntry(beforeExamples, 2, 1).position, 5);
  assert.equal(formatTavernHelperWorldbookEntry(outlet, 3).position.type, "outlet");
  assert.equal(formatTavernHelperWorldbookEntry(outlet, 3).position.outlet_name, "status_slot");
  assert.equal(formatSillyTavernWorldInfoEntry(outlet, 3, 2).position, 7);
});

test("classifies preset prompt types and round-trips Tavern Helper 4 presets", () => {
  assert.equal(isPresetSystemPrompt({ id: "main" }), true);
  assert.equal(isPresetSystemPrompt({ id: "enhance_definitions" }), true);
  assert.equal(isPresetPlaceholderPrompt({ id: "worldInfoBefore" }), true);
  assert.equal(isPresetPlaceholderPrompt({ id: "chat_history" }), true);
  assert.equal(isPresetNormalPrompt({ id: "custom_cot" }), true);
  assert.equal(isPresetNormalPrompt({ id: "main" }), false);

  const defaultPreset = createTavernHelperDefaultPreset();
  assert.equal(defaultPreset.prompts.length, 8);
  assert.equal(defaultPreset.prompts.every(isPresetPlaceholderPrompt), true);

  const base = createDefaultChatPreset("测试预设");
  const updated = applyTavernHelperPreset(base, {
    settings: {
      temperature: 0.65,
      top_p: 0.88,
      max_context: 64000,
      max_completion_tokens: 2048,
      squash_system_messages: true,
    },
    prompts: [
      { id: "main", name: "主提示", role: "system", content: "保持冷静叙事", enabled: true },
      { id: "world_info_before", name: "前世界书", role: "system", enabled: true, position: { type: "relative" } },
      {
        id: "cot_rule",
        name: "思维链",
        role: "system",
        content: "<think>",
        enabled: false,
        position: { type: "in_chat", depth: 2, order: 150 },
      },
    ],
    prompts_unused: [
      { id: "spare_prompt", name: "备用", role: "user", content: "备用内容", enabled: false },
    ],
    extensions: {
      tavern_helper: {
        variables: { mode: "story" },
      },
    },
  });

  assert.equal(updated.temperature, 0.65);
  assert.equal(updated.topP, 0.88);
  assert.equal(updated.maxContext, 64000);
  assert.equal(updated.maxTokens, 2048);
  assert.equal(updated.squashSystemMessages, true);
  assert.deepEqual(updated.tavernVariables, { mode: "story" });
  assert.equal(updated.prompts[1].identifier, "worldInfoBefore");
  assert.equal(updated.prompts[1].marker, true);
  assert.equal(updated.prompts[2].injectionPosition, 2);
  assert.equal(updated.prompts[2].injectionDepth, 2);
  assert.equal(updated.backupPrompts.length, 1);

  const formatted = toTavernHelperPreset(updated, {
    regexScripts: [{ id: "rx-1" }],
    scripts: [{ type: "script", id: "sc-1" }],
  });
  assert.equal(formatted.settings.temperature, 0.65);
  assert.deepEqual(formatted.extensions.regex_scripts, [{ id: "rx-1" }]);
  assert.deepEqual(formatted.extensions.tavern_helper.scripts, [{ type: "script", id: "sc-1" }]);
  assert.deepEqual(formatted.extensions.tavern_helper.variables, { mode: "story" });
});

test("converts character cards, v1CharData, and personas cleanly", () => {
  const card = {
    ...createCharacterCard("凛"),
    description: "神社巫女",
    personality: "沉静",
    scenario: "雨夜参道",
    firstMessage: "欢迎来到神社。",
    alternateGreetings: ["今天也在下雨呢。"],
    creator: "作者A",
    creatorNotes: "角色备注",
    characterVersion: "1.2.0",
    tags: ["奇幻", "日常"],
    characterBook: createWorldBook("神社设定集"),
    tavernVariables: { favor: 10 },
  };

  const thChar = toTavernHelperCharacter(card, {
    worldbookName: "神社设定集",
    avatar: "rin.png",
    regexScripts: [{ id: "char-rx" }],
    scripts: [{ id: "char-script" }],
  });
  assert.equal(thChar.worldbook, "神社设定集");
  assert.deepEqual(thChar.first_messages, ["欢迎来到神社。", "今天也在下雨呢。"]);
  assert.deepEqual(thChar.extensions.tavern_helper.variables, { favor: 10 });

  const modifiedCard = applyTavernHelperCharacter(card, {
    version: "2.0.0",
    worldbook: "新设定集",
    first_messages: ["新的开场白", "分支A", "分支B"],
    extensions: {
      customExt: { active: true },
      tavern_helper: { variables: { favor: 25 } },
    },
  });
  assert.equal(modifiedCard.characterVersion, "2.0.0");
  assert.equal(modifiedCard.extensions.world, "新设定集");
  assert.equal(modifiedCard.characterBook, null);
  assert.equal(modifiedCard.firstMessage, "新的开场白");
  assert.deepEqual(modifiedCard.alternateGreetings, ["分支A", "分支B"]);
  assert.deepEqual(modifiedCard.tavernVariables, { favor: 25 });

  const v1 = toSillyTavernCharacterData(card, { worldbookName: "神社设定集", avatar: "rin.png" });
  assert.equal(v1.name, "凛");
  assert.equal(v1.first_mes, "欢迎来到神社。");
  assert.equal(v1.creatorcomment, "角色备注");
  assert.equal(v1.data.character_version, "1.2.0");
  assert.equal(v1.data.extensions.world, "神社设定集");

  const profile = { ...createUserProfile("旅人"), bio: "路过的旅人", sendToAi: true };
  const thPersona = toTavernHelperPersona(profile, true);
  assert.equal(thPersona.position, 0);
  assert.equal(thPersona.is_default, true);
  const mutedProfile = applyTavernHelperPersona(profile, { name: "新旅人", position: 9 });
  assert.equal(mutedProfile.nickname, "新旅人");
  assert.equal(mutedProfile.sendToAi, false);
});

test("resolves message ranges and rotates message slices", () => {
  assert.deepEqual(resolveTavernMessageRange(undefined, 5), { start: 0, end: 4 });
  assert.deepEqual(resolveTavernMessageRange(undefined, 0), null);
  assert.deepEqual(resolveTavernMessageRange(-1, 5), { start: 4, end: 4 });
  assert.deepEqual(resolveTavernMessageRange("0-{{lastMessageId}}", 5), { start: 0, end: 4 });
  assert.deepEqual(resolveTavernMessageRange("{{currentMessageId}}-1", 5, 3), { start: 1, end: 3 });
  assert.deepEqual(resolveTavernMessageRange("-3--1", 5), { start: 2, end: 4 });
  assert.equal(resolveTavernMessageRange("invalid", 5), null);

  assert.deepEqual(rotateTavernMessages(["a", "b", "c", "d", "e"], 1, 3, 5), ["a", "d", "e", "b", "c"]);
});
