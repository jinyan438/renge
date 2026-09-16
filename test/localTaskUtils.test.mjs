import assert from "node:assert/strict";
import test from "node:test";
import { shouldRequireLocalToolCall } from "../src/localTaskUtils.ts";

test("requires available tools for an HTML coding task without a directory handle", () => {
  const messages = [{
    role: "user",
    content: "帮我写一个画面精美、功能完善的打砖块 HTML 游戏",
  }];

  assert.equal(shouldRequireLocalToolCall(messages, false, true), true);
  assert.equal(shouldRequireLocalToolCall(messages, false, false), false);
});

test("requires a tool call for file operations inside a workspace", () => {
  const messages = [{ role: "user", content: "把这个项目的依赖安装好" }];
  assert.equal(shouldRequireLocalToolCall(messages, true, true), true);
});

test("does not require a tool call for plain conversation", () => {
  const messages = [{ role: "user", content: "你好，今天感觉怎么样？" }];
  assert.equal(shouldRequireLocalToolCall(messages, true, true), false);
});

test("short execution confirmations still require a tool call when work is pending", () => {
  const messages = [
    { role: "user", content: "帮我写一个 HTML 页面" },
    { role: "user", content: "开始吧" },
  ];
  assert.equal(shouldRequireLocalToolCall(messages, true, true), true);
});

test("ignores workspaces and tools that are both unavailable", () => {
  const messages = [{ role: "user", content: "帮我写一个 HTML 页面" }];
  assert.equal(shouldRequireLocalToolCall(messages, false, false), false);
});
