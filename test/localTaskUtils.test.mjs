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

test("stops when the model is blocked waiting for the user", () => {
  // Extra turns can never supply the answer, so these must never auto-continue
  // even though they contain explicit pending-work phrasing.
  assert.equal(
    shouldAutoContinueLocalTask("需要继续，但我需要你先提供数据库连接串。"),
    false,
  );
  assert.equal(
    shouldAutoContinueLocalTask("下一步要写测试，不过需要你确认测试框架。"),
    false,
  );
  assert.equal(
    shouldAutoContinueLocalTask("还没完成。请问要用哪个方案？请选择 A 或 B。"),
    false,
  );
  assert.equal(
    shouldAutoContinueLocalTask("cannot proceed without the API key, please provide it."),
    false,
  );
  assert.equal(
    shouldAutoContinueLocalTask("我应该先改哪个文件？请你确认。"),
    false,
  );
});

test("treats truncation as authoritative even when a completion word appears", () => {
  // The provider cut the model off mid-output, so a leftover completion keyword
  // must not stop the run: there is usually a half-written file behind it.
  assert.equal(
    shouldAutoContinueLocalTask(
      "代码已完成，接下来我要写测试。文件内容如下：function a(){",
      "length",
    ),
    true,
  );
  assert.equal(
    shouldAutoContinueLocalTask("已创建 index.html，下一步要写样式。", "length"),
    true,
  );
  assert.equal(
    shouldAutoContinueLocalTask("第一部分已经写完，现在开始写第二部分：", "length"),
    true,
  );
});

test("stops after a truncated turn that closes on a completion claim", () => {
  // The output limit only clipped trailing prose, so the job really is done.
  assert.equal(shouldAutoContinueLocalTask("测试全部通过，构建成功。", "length"), false);
  assert.equal(shouldAutoContinueLocalTask("已完成。测试通过。", "length"), false);
  assert.equal(
    shouldAutoContinueLocalTask("任务已完成，文件在 a.html。需要的话我可以继续优化，告诉我即可。", "length"),
    false,
  );
});

test("does not continue on a plain explanation with no pending work", () => {
  assert.equal(shouldAutoContinueLocalTask("这个函数的实现思路是先排序再二分查找。"), false);
  assert.equal(shouldAutoContinueLocalTask("报错的原因是路径写错了，应该用绝对路径。"), false);
  assert.equal(shouldAutoContinueLocalTask("已构建通过。我继续说明一下目录结构："), false);
});
