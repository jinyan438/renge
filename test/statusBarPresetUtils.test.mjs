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
  assert.equal(presets[0].items.length, 17);
  assert.equal(isDefaultStatusBarPreset(presets[0]), true);
});

test("migrates a legacy named default while restoring factory content", () => {
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
      items: createDefaultStatusBarPreset().items,
    },
  ]);

  assert.equal(presets.length, 2);
  assert.equal(presets[0].id, DEFAULT_STATUS_BAR_PRESET_ID);
  assert.equal(presets[0].title, "状态栏");
  assert.equal(presets[0].items.length, 17);
  assert.equal(presets[0].providerId, "deepseek-provider");
  assert.equal(presets[0].modelId, "deepseek-v4-flash");
  assert.equal(presets[1].id, "user-preset");
  assert.equal(presets[1].name, "用户副本");
});

test("does not count the built-in preset against the user preset limit", () => {
  const item = createDefaultStatusBarPreset().items[0];
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
