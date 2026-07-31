import assert from "node:assert/strict";
import test from "node:test";
import {
  browserToolDefinitions,
  buildAndroidBrowserIntentUrl,
  buildBrowserDocumentContentProbeScript,
  buildBrowserPageReadScript,
  buildBrowserScriptExecutionWrapper,
  buildBrowserToolsSystemPrompt,
  calculateBrowserFitZoomFactor,
  isAndroidAppShell,
  isBrowserAddressInputAvailable,
  isBrowserToolName,
  normalizeBrowserAddress,
  openAndroidBrowserAddress,
} from "../src/browserSidebarRuntime.ts";

test("keeps the browser address input editable in Android and Electron shells", () => {
  assert.equal(isBrowserAddressInputAvailable(true, false), true);
  assert.equal(isBrowserAddressInputAvailable(false, true), true);
  assert.equal(isBrowserAddressInputAvailable(false, false), false);
});

test("detects the Android app shell before the JavaScript bridge is injected", () => {
  assert.equal(isAndroidAppShell("?rengePlatform=android", "Mozilla/5.0"), true);
  assert.equal(isAndroidAppShell("", "Mozilla/5.0 RengeAgentLabAndroid"), true);
  assert.equal(isAndroidAppShell("", "Mozilla/5.0 Chrome/138"), false);
});

test("routes Android app navigation through the native intent scheme", async () => {
  const intentUrls = [];
  const result = await openAndroidBrowserAddress(
    "https://www.bilibili.com",
    {
      async openBrowser() {
        throw new Error("wrapper bridge should not be used");
      },
    },
    undefined,
    (intentUrl) => intentUrls.push(intentUrl),
  );

  assert.equal(
    buildAndroidBrowserIntentUrl("https://www.bilibili.com"),
    "renge-browser://open?url=https%3A%2F%2Fwww.bilibili.com",
  );
  assert.deepEqual(intentUrls, [
    "renge-browser://open?url=https%3A%2F%2Fwww.bilibili.com",
  ]);
  assert.deepEqual(result, { ok: true, url: "https://www.bilibili.com" });
});

test("opens Android browser addresses through the injected wrapper when available", async () => {
  const calls = [];
  const result = await openAndroidBrowserAddress(
    "https://example.com/docs",
    {
      async openBrowser(options) {
        calls.push(options);
        return { ok: true, url: options.url };
      },
    },
    {
      openBrowser() {
        throw new Error("raw bridge should not be used");
      },
    },
  );

  assert.deepEqual(calls, [{ url: "https://example.com/docs" }]);
  assert.deepEqual(result, { ok: true, url: "https://example.com/docs" });
});

test("falls back to the raw Android bridge before the wrapper is injected", async () => {
  const calls = [];
  const result = await openAndroidBrowserAddress(
    "https://example.com/docs",
    {},
    {
      openBrowser(optionsJson) {
        calls.push(JSON.parse(optionsJson));
        return JSON.stringify({ ok: true, url: "https://example.com/docs" });
      },
    },
  );

  assert.deepEqual(calls, [{ url: "https://example.com/docs" }]);
  assert.deepEqual(result, { ok: true, url: "https://example.com/docs" });
});

test("detects whether an about:blank document contains user-visible content", () => {
  const script = buildBrowserDocumentContentProbeScript();
  const runProbe = (body) => new Function("document", `return ${script};`)({ body });

  assert.equal(runProbe({ innerText: "", textContent: "", children: [] }), false);
  assert.equal(
    runProbe({
      innerText: "",
      textContent: "console.log('setup')",
      children: [{ tagName: "SCRIPT" }, { tagName: "STYLE" }],
    }),
    false,
  );
  assert.equal(runProbe({ innerText: "开始游戏", textContent: "开始游戏", children: [] }), true);
  assert.equal(runProbe({ innerText: "", textContent: "", children: [{ tagName: "CANVAS" }] }), true);
  assert.equal(runProbe({ innerText: "", textContent: "", children: [{ tagName: "BUTTON" }] }), true);
});

test("builds a syntactically valid page-reading script", () => {
  const script = buildBrowserPageReadScript({ mode: "snapshot" });
  assert.doesNotThrow(() => new Function(`return ${script};`));
  assert.match(script, /replace\(\/\\n\{3,\}\/g, '\\n\\n'\)/);
});

test("captures page-script errors and normalizes non-JSON results", async () => {
  const expressionWrapper = buildBrowserScriptExecutionWrapper(
    `(() => { const value = { answer: 42 }; value.self = value; return value; })()`,
  );
  const expressionResult = await new Function(`return ${expressionWrapper};`)();
  assert.deepEqual(expressionResult, {
    __rengeBrowserScriptExecution: true,
    ok: true,
    value: { answer: 42, self: "[circular]" },
  });

  const statementWrapper = buildBrowserScriptExecutionWrapper(
    `const items = [1, 2, 3]; return { count: items.length };`,
    false,
  );
  const statementResult = await new Function(`return ${statementWrapper};`)();
  assert.deepEqual(statementResult.value, { count: 3 });

  const errorWrapper = buildBrowserScriptExecutionWrapper(
    `(() => { throw new TypeError("logo missing"); })()`,
  );
  const errorResult = await new Function(`return ${errorWrapper};`)();
  assert.equal(errorResult.ok, false);
  assert.equal(errorResult.error.name, "TypeError");
  assert.equal(errorResult.error.message, "logo missing");
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
