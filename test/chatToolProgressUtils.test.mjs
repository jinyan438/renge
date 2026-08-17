import assert from "node:assert/strict";
import test from "node:test";
import {
  compactToolCallForReplay,
  parseToolProgressContent,
} from "../src/chatToolProgressUtils.ts";

const browserCases = [
  ["打开网页：\nhttp://localhost:8123/snake.html", "action", "浏览器导航"],
  ["预览临时文件：audience-comments.html", "action", "预览临时文件"],
  ["控制浏览器历史：back", "action", "浏览器导航"],
  ["读取网页：snapshot", "action", "读取网页"],
  ["点击网页元素：button-start", "action", "浏览器点击"],
  ["悬浮网页元素：menu", "action", "浏览器悬浮"],
  ["输入网页内容：name\n4 个字符", "action", "浏览器输入"],
  ["选择网页选项：easy", "action", "浏览器选择"],
  ["滚动网页：x=0 y=600", "action", "浏览器滚动"],
  ["拖拽网页元素：card-1 -> lane-2", "action", "浏览器拖拽"],
  ["发送网页按键：Space", "action", "浏览器按键"],
  ["编辑网页：set_text title", "action", "编辑网页"],
  ["执行页面脚本：42 个字符", "action", "页面脚本"],
  ["网页已打开：贪吃蛇\nhttp://localhost:8123/snake.html", "success", "浏览器导航"],
  ["临时文件已在浏览器打开：audience-comments.html\n观众评论\nhttp://preview.localhost:5191/temporary-files/audience-comments.html", "success", "预览临时文件"],
  ["浏览器操作完成：back\nhttp://localhost:8123/", "success", "浏览器导航"],
  ["网页读取完成：贪吃蛇\nhttp://localhost:8123/snake.html\n正文 120 字符", "success", "读取网页"],
  ["网页操作完成：press_key\nhttp://localhost:8123/snake.html", "success", "浏览器按键"],
  ["网页操作完成：execute_script\nhttp://localhost:8123/snake.html", "success", "页面脚本"],
];

test("recognizes every browser action and result as collapsible tool progress", () => {
  for (const [content, variant, title] of browserCases) {
    const block = parseToolProgressContent(content);
    assert.ok(block, content);
    assert.equal(block.variant, variant, content);
    assert.equal(block.title, title, content);
  }
});

const terminalCases = [
  ["列出右侧栏终端。", "action", "列出终端"],
  ["新建终端：snake-preview", "action", "新建终端"],
  ["读取终端：58f7afa8", "action", "读取终端"],
  ["输入终端：58f7afa8\n5 个字符", "action", "终端输入"],
  ["在终端运行：58f7afa8\npython -m http.server 8123", "action", "运行终端命令"],
  ["调整终端：58f7afa8（80x24）", "action", "调整终端"],
  ["重启终端：58f7afa8", "action", "重启终端"],
  ["关闭终端：58f7afa8", "action", "关闭终端"],
  ["已列出 2 个终端。", "success", "列出终端"],
  ["已新建终端：snake-preview\nID：58f7afa8", "success", "新建终端"],
  ["已读取终端：snake-preview\n输出：\nServing HTTP on 0.0.0.0", "success", "读取终端"],
  ["已向终端 58f7afa8 发送输入。", "success", "终端输入"],
  ["终端命令已发送：python -m http.server 8123\n等待结束，进程可能仍在后台运行。\n本次暂未产生输出。", "success", "运行终端命令"],
  ["已调整终端 58f7afa8 的尺寸。", "success", "调整终端"],
  ["已重启终端：snake-preview", "success", "重启终端"],
  ["已关闭终端：58f7afa8", "success", "关闭终端"],
];

test("recognizes every terminal action and result as collapsible tool progress", () => {
  for (const [content, variant, title] of terminalCases) {
    const block = parseToolProgressContent(content);
    assert.ok(block, content);
    assert.equal(block.variant, variant, content);
    assert.equal(block.title, title, content);
  }
});

test("keeps browser result URLs inside the tool card as clickable links", () => {
  const url = "http://localhost:8123/snake.html";
  const block = parseToolProgressContent(`网页操作完成：press_key\n${url}`);

  assert.deepEqual(block?.links, [{ label: url, href: url }]);
  assert.ok(block?.details.includes(url));
});

test("does not classify ordinary assistant prose or standalone URLs as tool progress", () => {
  assert.equal(parseToolProgressContent("终端已经准备好了，接下来可以预览页面。"), null);
  assert.equal(parseToolProgressContent("http://localhost:8123/snake.html"), null);
});

test("preserves existing file tool progress parsing", () => {
  const block = parseToolProgressContent("已写入文件：src/App.tsx");
  assert.equal(block?.variant, "success");
  assert.equal(block?.title, "写入文件");
  assert.deepEqual(block?.links, [{ label: "src/App.tsx" }]);
});

test("compacts large write payloads before replaying tool history", () => {
  const toolCall = {
    id: "call-write",
    type: "function",
    function: {
      name: "local_write_file",
      arguments: JSON.stringify({ path: "index.html", content: "x".repeat(5000) }),
    },
  };
  const compacted = compactToolCallForReplay(toolCall);
  const args = JSON.parse(compacted.function.arguments);

  assert.equal(args.path, "index.html");
  assert.match(args.content, /省略 5000 个字符/);
  assert.equal(toolCall.function.arguments.includes("x".repeat(5000)), true);
});

test("replays file writes with the concrete path used by the client", () => {
  const html = "<!DOCTYPE html><html><body>game</body></html>";
  const toolCall = {
    id: "call-write-root",
    type: "function",
    function: {
      name: "local_write_file",
      arguments: JSON.stringify({ path: "E:\\AI\\test", content: html }),
    },
  };
  const replayed = compactToolCallForReplay(toolCall, "E:\\AI\\test");
  assert.deepEqual(JSON.parse(replayed.function.arguments), {
    path: "index.html",
    content: html,
  });

  const malformed = compactToolCallForReplay({
    ...toolCall,
    function: { ...toolCall.function, arguments: '{"path":' },
  });
  assert.deepEqual(JSON.parse(malformed.function.arguments), {
    path: "invalid-tool-arguments.txt",
    content: "",
  });

  const missing = compactToolCallForReplay({
    ...toolCall,
    function: { ...toolCall.function, arguments: "{}" },
  });
  assert.deepEqual(JSON.parse(missing.function.arguments), {
    path: "output.txt",
    content: "",
  });
});
