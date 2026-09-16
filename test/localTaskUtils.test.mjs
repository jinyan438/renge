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
  assert.equal(shouldAutoContinueLocalTask("I think this is good. Let me apply the edits."), true);
  assert.equal(shouldAutoContinueLocalTask("Alright, I'll start a local HTTP server and test it."), true);
  assert.equal(
    shouldAutoContinueLocalTask("已完成，文件位于 public/neon-breaker.html。"),
    false,
  );
});

test("stops after the final Pi segment reports completion", () => {
  const combinedPiContent = [
    "我来为你写一个五子棋网页游戏，包含棋盘绘制、落子和胜负判断。",
    "五子棋网页已完成，保存为 E:/AI/test6/gomoku.html。",
    "你直接双击打开就能玩。需要的话我可以再加人机对战，要加哪个功能告诉我即可。",
  ].join("\n\n");

  assert.equal(shouldAutoContinueLocalTask(combinedPiContent, "stop"), false);
  assert.equal(shouldAutoContinueLocalTask(combinedPiContent, "length"), false);
});

test("continues only when the latest task state is still incomplete", () => {
  assert.equal(
    shouldAutoContinueLocalTask("页面结构已完成，下一步还需要运行浏览器测试。"),
    true,
  );
  assert.equal(
    shouldAutoContinueLocalTask("文件内容在这里被截断", "length"),
    true,
  );
  assert.equal(shouldAutoContinueLocalTask("", "length"), true);
  assert.equal(
    shouldAutoContinueLocalTask("实现已完成。是否需要继续优化请告诉我。", "length"),
    false,
  );
});
