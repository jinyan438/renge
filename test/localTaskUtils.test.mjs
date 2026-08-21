import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldAutoContinueLocalTask,
  shouldRequireLocalToolCall,
} from "../src/localTaskUtils.ts";

test("requires available tools for an HTML coding task without a directory handle", () => {
  const messages = [{
    role: "user",
    content: "帮我写一个画面精美、功能完善的打砖块 HTML 游戏",
  }];

  assert.equal(shouldRequireLocalToolCall(messages, false, true), true);
  assert.equal(shouldRequireLocalToolCall(messages, false, false), false);
});

test("keeps executing when the assistant announces a write but calls no tool", () => {
  assert.equal(
    shouldAutoContinueLocalTask("好，直接开写。文件放在 public/neon-breaker.html。"),
    true,
  );
  assert.equal(shouldAutoContinueLocalTask("Let me write the complete file now."), true);
  assert.equal(
    shouldAutoContinueLocalTask("已完成，文件位于 public/neon-breaker.html。"),
    false,
  );
});
