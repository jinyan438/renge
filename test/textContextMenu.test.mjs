import assert from "node:assert/strict";
import test from "node:test";
import { createTextContextMenuTemplate } from "../electron/text-context-menu.mjs";

test("enables copy and cut only when the composer has a selection", () => {
  assert.deepEqual(createTextContextMenuTemplate({ hasSelection: true }), [
    { label: "复制", action: "copy", enabled: true },
    { label: "粘贴", action: "paste", enabled: false },
    { label: "剪切", action: "cut", enabled: true },
  ]);
});

test("enables paste only when the clipboard contains text", () => {
  assert.deepEqual(createTextContextMenuTemplate({ hasClipboardText: true }), [
    { label: "复制", action: "copy", enabled: false },
    { label: "粘贴", action: "paste", enabled: true },
    { label: "剪切", action: "cut", enabled: false },
  ]);
});
