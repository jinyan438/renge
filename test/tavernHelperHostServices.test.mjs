import assert from "node:assert/strict";
import test from "node:test";

import { createCharacterCard } from "../src/characterCardUtils.ts";
import {
  HTML_PREVIEW_TAVERN_API_REMOTE_NAMES,
  HTML_PREVIEW_TAVERN_EVENT_SUBSCRIPTIONS_MESSAGE,
  HTML_PREVIEW_TAVERN_HELPER_API_SOURCE,
  needsHeavyTavernPreviewContext,
} from "../src/htmlPreviewTavernHelperApi.ts";
import { createDefaultChatPreset } from "../src/presetUtils.ts";
import { normalizeRegexScript } from "../src/regexUtils.ts";
import {
  SILLYTAVERN_VERSION,
  TAVERN_BUILTIN_PROMPT_DEFAULT_ORDER,
  TAVERN_EVENT_TYPES,
  TAVERN_HELPER_IFRAME_EVENTS,
  TAVERN_HELPER_VERSION,
  TAVERN_MESSAGE_ID_EVENTS,
  createTavernHelperDefaultPreset,
} from "../src/tavernHelperCompat.ts";
import {
  createTavernHelperHostServices,
  toTavernHelperRegex,
} from "../src/tavernHelperHostServices.ts";
import { createUserProfile } from "../src/userProfileUtils.ts";
import { createWorldBook } from "../src/worldbookUtils.ts";

function createMockStores() {
  const card = {
    ...createCharacterCard("霞"),
    id: "char-kasumi",
    description: "测试角色描述",
    firstMessage: "你好！",
    avatarDataUrl: "data:image/png;base64,AAAA",
    characterBook: createWorldBook("霞的世界书"),
    regexScripts: [
      normalizeRegexScript(
        {
          id: "rx-char-1",
          scriptName: "去除思维标签",
          findRegex: "<think>[\\s\\S]*?</think>",
          replaceString: "",
          placement: [2],
          markdownOnly: true,
        },
        0,
      ),
    ],
  };
  let cards = [card];
  let presets = [
    {
      ...createDefaultChatPreset("默认文风"),
      id: "preset-default",
      temperature: 0.9,
    },
  ];
  const userA = { ...createUserProfile("玩家一"), id: "user-1", bio: "初始设定", sendToAi: true };
  let userProfileState = {
    userProfiles: [userA],
    activeUserProfileId: "user-1",
  };

  return {
    get state() {
      return { cards, presets, userProfileState };
    },
    stores: {
      getCards: () => cards,
      setCards: (next) => {
        cards = next;
      },
      getCurrentCard: () => cards[0],
      getCardWorldbookName: (target) =>
        (typeof target.extensions?.world === "string" && target.extensions.world) ||
        target.characterBook?.name ||
        null,
      createCard: (name) => createCharacterCard(name),
      getPresets: () => presets,
      setPresets: (next) => {
        presets = next;
      },
      getActivePreset: () => presets[0],
      createPreset: (name) => createDefaultChatPreset(name),
      getUserProfileState: () => userProfileState,
      setUserProfileState: (next) => {
        userProfileState = next;
      },
      createUserProfile: (name) => createUserProfile(name),
    },
  };
}

test("manages Tavern Helper characters, worldbook bindings, regexes, and script trees", () => {
  const mock = createMockStores();
  const services = createTavernHelperHostServices(mock.stores);

  assert.deepEqual(services.getCharacterNames(), ["霞"]);
  assert.equal(services.getCurrentCharacterName(), "霞");

  // Resolves 'current', name, and '.png' avatar ids
  const current = services.getTavernCharacter("current");
  assert.equal(current?.worldbook, "霞的世界书");
  assert.equal(services.getTavernCharacter("char-kasumi.png")?.description, "测试角色描述");
  assert.equal(Array.isArray(current?.extensions?.regex_scripts), true);
  assert.equal(current.extensions.regex_scripts[0].script_name, "去除思维标签");

  // Create mode refuses existing character, succeeds for new character
  assert.equal(services.saveTavernCharacter("霞", { description: "覆盖失败" }, "create"), false);
  assert.equal(
    services.saveTavernCharacter(
      "新角色.png",
      {
        description: "新来的转学生",
        first_messages: ["初次见面", "请多关照"],
        extensions: {
          regex_scripts: [
            {
              id: "rx-new",
              script_name: "高亮台词",
              enabled: true,
              find_regex: "「(.*?)」",
              replace_string: "<b>$1</b>",
              source: { ai_output: true },
              destination: { display: true, prompt: false },
            },
          ],
          tavern_helper: {
            scripts: [
              {
                type: "script",
                id: "tree-1",
                name: "状态栏脚本",
                content: "console.log('ready')",
                enabled: true,
              },
            ],
            variables: { chapter: 1 },
          },
        },
      },
      "create",
    ),
    true,
  );
  assert.equal(mock.state.cards.length, 2);
  assert.equal(mock.state.cards[1].name, "新角色");
  assert.equal(mock.state.cards[1].regexScripts.length, 1);
  assert.equal(mock.state.cards[1].tavernScripts.length, 1);

  assert.equal(services.setCharacterWorldbookName("霞", "新世界书"), true);
  assert.equal(services.getCharacterData("霞")?.data?.extensions?.world, "新世界书");
  assert.equal(services.deleteTavernCharacter("新角色"), true);
  assert.equal(mock.state.cards.length, 1);
});

test("manages Tavern Helper presets including 'in_use', create, replace, rename, and delete", () => {
  const mock = createMockStores();
  const services = createTavernHelperHostServices(mock.stores);

  assert.equal(services.getLoadedPresetName(), "默认文风");
  assert.equal(services.getTavernPreset("in_use")?.settings?.temperature, 0.9);

  assert.equal(services.saveTavernPreset("in_use", { settings: { temperature: 0.42 } }, "replace"), true);
  assert.equal(mock.state.presets[0].temperature, 0.42);

  assert.equal(services.saveTavernPreset("战斗预设", { settings: { temperature: 1.1 } }, "create"), true);
  assert.equal(services.renameTavernPreset("战斗预设", "探索预设"), true);
  assert.equal(services.getTavernPreset("探索预设")?.settings?.temperature, 1.1);
  assert.equal(services.deleteTavernPreset("in_use"), false);
  assert.equal(services.deleteTavernPreset("探索预设"), true);
  assert.equal(mock.state.presets.length, 1);
});

test("manages Tavern Helper personas and protects the last remaining user profile", () => {
  const mock = createMockStores();
  const services = createTavernHelperHostServices(mock.stores);

  assert.equal(services.getCurrentPersonaId(), "user-1");
  assert.equal(services.deleteTavernPersona("user-1"), false, "cannot delete the only user profile");

  const createdId = services.saveTavernPersona("persona-2", { name: "调查员", description: "神秘学学者", position: 0 }, "create");
  assert.equal(createdId, "persona-2");
  assert.equal(services.getPersonas().length, 2);

  assert.equal(services.deleteTavernPersona("user-1"), true);
  assert.equal(mock.state.userProfileState.activeUserProfileId, "persona-2");
});

test("detects heavy preview HTML snippets and installs synchronous + event TavernHelper APIs in frame context", async () => {
  assert.equal(needsHeavyTavernPreviewContext('<div class="status">HP: 100</div>'), false);
  assert.equal(needsHeavyTavernPreviewContext("<script>const p = getPreset('in_use');</script>"), true);
  assert.equal(needsHeavyTavernPreviewContext('<script src="https://cdn.jsdelivr.net/npm/app.js"></script>'), true);

  const posted = [];
  const parentCommands = [];
  const fakeWindow = {
    parent: {
      postMessage: (message) => posted.push(message),
    },
  };

  const snapshot = {
    currentMessageIndex: 2,
    messages: [
      { role: "assistant", content: "开场" },
      { role: "user", content: "你好" },
      { role: "assistant", content: "<think>secret</think>正文 **bold**" },
    ],
    userName: "玩家一",
    characterName: "霞",
    chatId: "chat-1",
    tavern: {
      characterNames: ["霞"],
      characterIds: ["char-kasumi.png"],
      currentCharacterName: "霞",
      currentCharacterId: "char-kasumi.png",
      currentCharacterAvatar: "data:image/png;base64,AAAA",
      worldbookNames: ["霞的世界书", "全局设定"],
      globalWorldbookNames: ["全局设定"],
      charWorldbookNames: { primary: "霞的世界书", additional: [] },
      chatWorldbookName: null,
      presetNames: ["默认文风"],
      loadedPresetName: "默认文风",
      personas: [{ avatar_id: "user-1", name: "玩家一", description: "初始设定", is_default: true }],
      currentPersonaId: "user-1",
      installedExtensionIds: ["JS-Slash-Runner"],
      isGenerating: false,
      chatMetadata: {},
      inUsePreset: createTavernHelperDefaultPreset(),
      namedPresets: {},
      regexes: [
        toTavernHelperRegex(
          normalizeRegexScript(
            {
              id: "rx-1",
              scriptName: "strip-think",
              findRegex: "/<think>[\\s\\S]*?<\\/think>/g",
              replaceString: "",
              placement: [2],
              markdownOnly: true,
            },
            0,
          ),
          "character",
        ),
      ],
      charData: { name: "霞", first_mes: "你好！" },
      charDataByName: { 霞: { name: "霞", first_mes: "你好！" } },
      characterAvatars: { 霞: "data:image/png;base64,AAAA" },
      personaAvatars: { "user-1": "" },
    },
  };

  const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  const mergeRecords = (base, overlay) => ({ ...base, ...overlay });

  const installer = new Function("window", `return (${HTML_PREVIEW_TAVERN_HELPER_API_SOURCE});`)(fakeWindow);
  const bridge = installer(
    {
      previewId: "preview-test",
      subscriptionMessageType: HTML_PREVIEW_TAVERN_EVENT_SUBSCRIPTIONS_MESSAGE,
      snapshot,
      clone,
      isRecord,
      mergeRecords,
      requestParentCommand: async (operation, data) => {
        parentCommands.push({ operation, data });
        return true;
      },
      getVariables: () => ({}),
    },
    {
      tavernHelperVersion: TAVERN_HELPER_VERSION,
      sillyTavernVersion: SILLYTAVERN_VERSION,
      tavernEvents: TAVERN_EVENT_TYPES,
      iframeEvents: TAVERN_HELPER_IFRAME_EVENTS,
      messageIdEvents: [...TAVERN_MESSAGE_ID_EVENTS],
      builtinPromptDefaultOrder: TAVERN_BUILTIN_PROMPT_DEFAULT_ORDER,
      defaultPreset: createTavernHelperDefaultPreset(),
      remoteApiNames: HTML_PREVIEW_TAVERN_API_REMOTE_NAMES,
    },
  );

  assert.deepEqual(bridge.api.getWorldbookNames(), ["霞的世界书", "全局设定"]);
  assert.equal(bridge.api.getCurrentCharPrimaryLorebook(), "霞的世界书");
  assert.equal(bridge.api.getLoadedPresetName(), "默认文风");
  assert.equal(bridge.api.getPersona("current").name, "玩家一");
  assert.equal(
    bridge.api.formatAsTavernRegexedString("<think>hidden</think>Visible", "ai_output", "display"),
    "Visible",
  );

  // Event bus ordering + host delivery without echo loops
  const order = [];
  bridge.api.eventOn("message_received", (id) => order.push(["normal", id]));
  bridge.api.eventMakeFirst("message_received", (id) => order.push(["first", id]));
  bridge.api.eventMakeLast("message_received", (id) => order.push(["last", id]));
  assert.equal(
    posted.some(
      (entry) =>
        entry.type === HTML_PREVIEW_TAVERN_EVENT_SUBSCRIPTIONS_MESSAGE &&
        entry.events.includes("message_received"),
    ),
    true,
  );

  await bridge.deliverHostEvent("message_received", ["2"]);
  assert.deepEqual(order, [
    ["first", 2],
    ["normal", 2],
    ["last", 2],
  ]);
  assert.equal(parentCommands.length, 0, "deliverHostEvent must not echo back to host");
});
