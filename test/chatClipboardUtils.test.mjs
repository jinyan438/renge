import assert from "node:assert/strict";
import test from "node:test";
import { getChatBubbleCopyContent } from "../src/chatClipboardUtils.ts";

function createBubble(innerText, containedNodes = []) {
  const nodes = new Set(containedNodes);
  return {
    innerText,
    contains(node) {
      return nodes.has(node);
    },
  };
}

test("copies a non-empty selection contained by the current bubble", () => {
  const anchorNode = {};
  const focusNode = {};
  const bubble = createBubble("气泡全部文本", [anchorNode, focusNode]);
  const selection = {
    anchorNode,
    focusNode,
    isCollapsed: false,
    toString: () => "选中的文本",
  };

  assert.deepEqual(getChatBubbleCopyContent(bubble, "原始消息", selection), {
    text: "选中的文本",
    source: "selection",
  });
});

test("copies the entire rendered bubble when there is no local selection", () => {
  const outsideNode = {};
  const bubble = createBubble("  第一行\n第二行  ");
  const selection = {
    anchorNode: outsideNode,
    focusNode: outsideNode,
    isCollapsed: false,
    toString: () => "其他区域的选区",
  };

  assert.deepEqual(getChatBubbleCopyContent(bubble, "原始消息", selection), {
    text: "第一行\n第二行",
    source: "bubble",
  });
});

test("falls back to stored message text when the bubble has no rendered text", () => {
  const bubble = createBubble("   ");

  assert.deepEqual(getChatBubbleCopyContent(bubble, "原始消息", null), {
    text: "原始消息",
    source: "bubble",
  });
});
