import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STATUS_BAR_PRESET_ID,
  DEFAULT_STATUS_BAR_PRESET_NAME,
  applyStatusBarPresetToState,
  createDefaultStatusBarState,
  createDefaultStatusBarPreset,
  createImportantStatusBarCharacter,
  isDefaultStatusBarPreset,
  normalizeStatusBarState,
  normalizeStatusBarPresets,
} from "../src/statusBarUtils.ts";

test("always provides the immutable built-in status bar preset", () => {
  const presets = normalizeStatusBarPresets(undefined);

  assert.equal(presets.length, 1);
  assert.equal(presets[0].id, DEFAULT_STATUS_BAR_PRESET_ID);
  assert.equal(presets[0].name, DEFAULT_STATUS_BAR_PRESET_NAME);
  assert.equal(presets[0].templates.protagonist.title, "状态栏");
  assert.equal(presets[0].templates.protagonist.items.length, 17);
  assert.equal(presets[0].templates.important.title, "重要角色状态");
  assert.equal(presets[0].templates.important.items.length, 17);
  assert.equal(isDefaultStatusBarPreset(presets[0]), true);
});

test("migrates a shared legacy template into independent protagonist and important templates", () => {
  const defaultPreset = createDefaultStatusBarPreset();
  const presets = normalizeStatusBarPresets([
    {
      id: "legacy-default",
      name: DEFAULT_STATUS_BAR_PRESET_NAME,
      providerId: "deepseek-provider",
      modelId: "deepseek-v4-flash",
      title: "已被修改的标题",
      accentColor: "#000000",
      items: [
        {
          variableName: "已被修改的变量",
          description: "",
          label: "已被修改",
          icon: "",
          type: "list",
          width: "long",
          size: "medium",
          initialValue: "错误值",
        },
      ],
    },
    {
      id: "user-preset",
      name: "用户副本",
      providerId: "",
      modelId: "",
      title: "用户状态栏",
      accentColor: "#123456",
      items: defaultPreset.templates.protagonist.items,
    },
  ]);

  assert.equal(presets.length, 2);
  assert.equal(presets[0].id, DEFAULT_STATUS_BAR_PRESET_ID);
  assert.equal(presets[0].templates.protagonist.title, "状态栏");
  assert.equal(presets[0].templates.protagonist.items.length, 17);
  assert.equal("providerId" in presets[0], false);
  assert.equal("modelId" in presets[0], false);
  assert.equal(presets[1].id, "user-preset");
  assert.equal(presets[1].name, "用户副本");
  assert.equal(presets[1].templates.protagonist.title, "用户状态栏");
  assert.equal(presets[1].templates.important.title, "用户状态栏");
  assert.deepEqual(
    presets[1].templates.protagonist.items,
    presets[1].templates.important.items,
  );
  assert.notEqual(
    presets[1].templates.protagonist.items,
    presets[1].templates.important.items,
  );
  assert.equal("providerId" in presets[1], false);
  assert.equal("modelId" in presets[1], false);
});

test("keeps protagonist and important-character templates separate in modern presets", () => {
  const defaultPreset = createDefaultStatusBarPreset();
  const protagonistItem = {
    ...defaultPreset.templates.protagonist.items[0],
    variableName: "主角时间",
    label: "主角时间",
  };
  const importantItem = {
    ...defaultPreset.templates.important.items[0],
    variableName: "角色时间",
    label: "角色时间",
  };
  const [_, preset] = normalizeStatusBarPresets([{
    id: "split-preset",
    name: "双模板",
    templates: {
      protagonist: {
        title: "主角面板",
        accentColor: "#123456",
        items: [protagonistItem],
      },
      important: {
        title: "角色面板",
        accentColor: "#654321",
        items: [importantItem],
      },
      futureTab: {
        title: "未来标签",
        accentColor: "#abcdef",
        items: [protagonistItem],
      },
    },
  }]);

  assert.equal(preset.templates.protagonist.title, "主角面板");
  assert.equal(preset.templates.protagonist.accentColor, "#123456");
  assert.equal(preset.templates.protagonist.items[0].variableName, "主角时间");
  assert.equal(preset.templates.important.title, "角色面板");
  assert.equal(preset.templates.important.accentColor, "#654321");
  assert.equal(preset.templates.important.items[0].variableName, "角色时间");
  assert.equal(preset.templates.futureTab.title, "未来标签");
});

test("migrates the previous split-template preset shape into keyed templates", () => {
  const [_, preset] = normalizeStatusBarPresets([{
    id: "legacy-split-preset",
    name: "旧双模板",
    protagonistTemplate: {
      title: "旧主角模板",
      accentColor: "#123456",
      items: createDefaultStatusBarPreset().templates.protagonist.items,
    },
    importantCharacterTemplate: {
      title: "旧重要角色模板",
      accentColor: "#654321",
      items: createDefaultStatusBarPreset().templates.important.items,
    },
  }]);

  assert.equal(preset.templates.protagonist.title, "旧主角模板");
  assert.equal(preset.templates.important.title, "旧重要角色模板");
});

test("does not count the built-in preset against the user preset limit", () => {
  const item = createDefaultStatusBarPreset().templates.protagonist.items[0];
  const presets = normalizeStatusBarPresets(
    Array.from({ length: 100 }, (_, index) => ({
      id: `user-${index}`,
      name: `用户预设 ${index + 1}`,
      providerId: "",
      modelId: "",
      title: "状态栏",
      accentColor: "#ff758c",
      items: [item],
    })),
  );

  assert.equal(presets.length, 101);
  assert.equal(presets[0].id, DEFAULT_STATUS_BAR_PRESET_ID);
});

test("applies one preset to the protagonist and every important character in the session", () => {
  const state = createDefaultStatusBarState();
  state.enabled = true;
  state.providerId = "provider-1";
  state.modelId = "model-1";
  state.values = { "status-character-name": "林风" };
  state.importantCharacters = [
    createImportantStatusBarCharacter("叶澜"),
    createImportantStatusBarCharacter("周凛"),
  ];
  state.importantCharacters.forEach((character) => {
    character.values[character.items[0].id] = "旧值";
  });

  const [_, preset] = normalizeStatusBarPresets([{
    id: "session-preset",
    name: "整会话预设",
    templates: {
      ...createDefaultStatusBarPreset().templates,
      futureTab: {
        title: "未来标签",
        accentColor: "#abcdef",
        items: createDefaultStatusBarPreset().templates.protagonist.items,
      },
    },
  }]);
  preset.templates.protagonist.title = "主角模板";
  preset.templates.important.title = "角色模板";

  const nextState = applyStatusBarPresetToState(state, preset);

  assert.equal(nextState.enabled, true);
  assert.equal(nextState.providerId, "provider-1");
  assert.equal(nextState.modelId, "model-1");
  assert.equal(nextState.appliedPresetId, "session-preset");
  assert.equal(nextState.appliedPresetTemplates.futureTab.title, "未来标签");
  assert.equal(nextState.title, "主角模板");
  assert.deepEqual(nextState.values, {});
  assert.equal(nextState.importantCharacters.length, 2);
  assert.deepEqual(
    nextState.importantCharacters.map((character) => [character.characterName, character.title]),
    [["叶澜", "角色模板"], ["周凛", "角色模板"]],
  );
  assert.deepEqual(nextState.importantCharacters.map((character) => character.values), [{}, {}]);
  assert.notEqual(
    nextState.importantCharacters[0].items[0].id,
    nextState.importantCharacters[1].items[0].id,
  );
  assert.equal(
    normalizeStatusBarState(nextState).appliedPresetTemplates.futureTab.title,
    "未来标签",
  );
});
