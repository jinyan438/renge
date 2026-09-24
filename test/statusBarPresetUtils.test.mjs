import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STATUS_BAR_PRESET_ID,
  DEFAULT_STATUS_BAR_PRESET_NAME,
  createDefaultStatusBarPreset,
  isDefaultStatusBarPreset,
  normalizeStatusBarPresets,
} from "../src/statusBarUtils.ts";

test("always provides the immutable built-in status bar preset", () => {
  const presets = normalizeStatusBarPresets(undefined);

  assert.equal(presets.length, 1);
  assert.equal(presets[0].id, DEFAULT_STATUS_BAR_PRESET_ID);
  assert.equal(presets[0].name, DEFAULT_STATUS_BAR_PRESET_NAME);
  assert.equal(presets[0].protagonistTemplate.title, "状态栏");
  assert.equal(presets[0].protagonistTemplate.items.length, 17);
  assert.equal(presets[0].importantCharacterTemplate.title, "重要角色状态");
  assert.equal(presets[0].importantCharacterTemplate.items.length, 17);
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
      items: defaultPreset.protagonistTemplate.items,
    },
  ]);

  assert.equal(presets.length, 2);
  assert.equal(presets[0].id, DEFAULT_STATUS_BAR_PRESET_ID);
  assert.equal(presets[0].protagonistTemplate.title, "状态栏");
  assert.equal(presets[0].protagonistTemplate.items.length, 17);
  assert.equal("providerId" in presets[0], false);
  assert.equal("modelId" in presets[0], false);
  assert.equal(presets[1].id, "user-preset");
  assert.equal(presets[1].name, "用户副本");
  assert.equal(presets[1].protagonistTemplate.title, "用户状态栏");
  assert.equal(presets[1].importantCharacterTemplate.title, "用户状态栏");
  assert.deepEqual(
    presets[1].protagonistTemplate.items,
    presets[1].importantCharacterTemplate.items,
  );
  assert.notEqual(
    presets[1].protagonistTemplate.items,
    presets[1].importantCharacterTemplate.items,
  );
  assert.equal("providerId" in presets[1], false);
  assert.equal("modelId" in presets[1], false);
});

test("keeps protagonist and important-character templates separate in modern presets", () => {
  const defaultPreset = createDefaultStatusBarPreset();
  const protagonistItem = {
    ...defaultPreset.protagonistTemplate.items[0],
    variableName: "主角时间",
    label: "主角时间",
  };
  const importantItem = {
    ...defaultPreset.importantCharacterTemplate.items[0],
    variableName: "角色时间",
    label: "角色时间",
  };
  const [_, preset] = normalizeStatusBarPresets([{
    id: "split-preset",
    name: "双模板",
    protagonistTemplate: {
      title: "主角面板",
      accentColor: "#123456",
      items: [protagonistItem],
    },
    importantCharacterTemplate: {
      title: "角色面板",
      accentColor: "#654321",
      items: [importantItem],
    },
  }]);

  assert.equal(preset.protagonistTemplate.title, "主角面板");
  assert.equal(preset.protagonistTemplate.accentColor, "#123456");
  assert.equal(preset.protagonistTemplate.items[0].variableName, "主角时间");
  assert.equal(preset.importantCharacterTemplate.title, "角色面板");
  assert.equal(preset.importantCharacterTemplate.accentColor, "#654321");
  assert.equal(preset.importantCharacterTemplate.items[0].variableName, "角色时间");
});

test("does not count the built-in preset against the user preset limit", () => {
  const item = createDefaultStatusBarPreset().protagonistTemplate.items[0];
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
