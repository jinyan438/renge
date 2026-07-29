import assert from "node:assert/strict";
import test from "node:test";
import {
  browserToolDefinitions,
  buildBrowserPageReadScript,
  buildBrowserToolsSystemPrompt,
  calculateBrowserFitZoomFactor,
  isBrowserToolName,
  normalizeBrowserAddress,
} from "../src/browserSidebarRuntime.ts";

test("builds a syntactically valid page-reading script", () => {
  const script = buildBrowserPageReadScript({ mode: "snapshot" });
  assert.doesNotThrow(() => new Function(`return ${script};`));
  assert.match(script, /replace\(\/\\n\{3,\}\/g, '\\n\\n'\)/);
});

test("fits horizontally overflowing pages into the sidebar viewport", () => {
  assert.equal(calculateBrowserFitZoomFactor(720, 1200), 0.6);
  assert.equal(calculateBrowserFitZoomFactor(360, 1200), 0.3);
  assert.equal(calculateBrowserFitZoomFactor(260, 2000), 0.25);
  assert.equal(calculateBrowserFitZoomFactor(720, 720), 1);
  assert.equal(calculateBrowserFitZoomFactor(720, 721), 1);
  assert.equal(calculateBrowserFitZoomFactor(720, 730), 0.98);
});

test("normalizes browser addresses and search queries", () => {
  assert.equal(normalizeBrowserAddress("https://example.com/a"), "https://example.com/a");
  assert.equal(normalizeBrowserAddress("example.com/docs"), "https://example.com/docs");
  assert.equal(normalizeBrowserAddress("example.com?q=1#result"), "https://example.com?q=1#result");
  assert.equal(normalizeBrowserAddress("192.168.1.20:8080/admin"), "http://192.168.1.20:8080/admin");
  assert.equal(normalizeBrowserAddress("例子.中国/文档"), "https://例子.中国/文档");
  assert.equal(normalizeBrowserAddress("localhost:5173/test"), "http://localhost:5173/test");
  assert.equal(normalizeBrowserAddress("localhost:5173?view=browser"), "http://localhost:5173?view=browser");
  assert.equal(normalizeBrowserAddress("about:blank"), "about:blank");
  assert.equal(
    normalizeBrowserAddress("查找 Renge 文档"),
    "https://www.bing.com/search?q=%E6%9F%A5%E6%89%BE%20Renge%20%E6%96%87%E6%A1%A3",
  );
});

test("exposes a complete, unique browser tool set", () => {
  const names = browserToolDefinitions.map((tool) => tool.function.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, [
    "browser_navigate",
    "browser_history",
    "browser_read_page",
    "browser_click",
    "browser_hover",
    "browser_type",
    "browser_select",
    "browser_scroll",
    "browser_drag",
    "browser_press_key",
    "browser_edit_page",
    "browser_execute_script",
  ]);
  assert.ok(names.every(isBrowserToolName));
  assert.equal(isBrowserToolName("local_read_file"), false);
});

test("browser prompt treats page content as untrusted and requires verification", () => {
  const prompt = buildBrowserToolsSystemPrompt();
  assert.match(prompt, /不可信页面内容/);
  assert.match(prompt, /必须再次读取页面确认结果/);
  assert.match(prompt, /密码、令牌、Cookie/);
});
