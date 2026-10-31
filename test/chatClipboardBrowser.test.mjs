import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, _electron as electron } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. Exercise actual copy buttons and the system clipboard
// with isolated storage, including the portal whose opener is unfocused.
const desktop = process.argv.includes("--desktop");
const root = await mkdtemp(join(tmpdir(), "renge-clipboard-"));
const message = "剪贴板回归测试：只复制这段文字。\n第二行保留中文与空格。";
const source = 'const greeting = "你好，Renge";\nconsole.log(greeting);';
let server, browser, app, page, home;
const errors = [];
try {
  await mkdir(join(root, "data"));
  await mkdir(".runtime", { recursive: true });
  const now = new Date().toISOString();
  const data = { version: 1, chatMode: "ai", chatRenderedEditingEnabled: true,
    chatSessions: [{ id: "clipboard", title: "剪贴板回归测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区",
      messages: [{ id: "user", role: "user", content: message, createdAt: now },
        { id: "code", role: "assistant", content: `\`\`\`js\n${source}\n\`\`\``, createdAt: now }], createdAt: now, updatedAt: now }] };
  if (desktop) {
    await writeFile(join(root, "data", "app-data.json"), JSON.stringify(data));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
    Object.assign(env, { RENGE_DATA_DIR: join(root, "data"), RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"), RENGE_ELECTRON_CACHE_DIR: join(root, "cache") });
    app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
    home = await app.firstWindow();
    home.on("pageerror", error => errors.push(error.message));
    [page] = await Promise.all([app.waitForEvent("window"), home.getByRole("button", { name: "开始对话", exact: true }).click()]);
    await page.locator('body[data-desktop-window="chat"]').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().endsWith("/desktop-window.html")).minimize());
    // Electron can report both portal documents as focused. Make the opener's
    // clipboard restriction deterministic, as on systems that enforce focus.
    await home.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async () => { throw new DOMException("Document is not focused", "NotAllowedError"); } });
      document.execCommand = () => false;
    });
  } else {
    server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
    await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
    await page.goto(server.url);
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  }
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  const readClipboard = async () => (desktop ? await app.evaluate(({ clipboard }) => clipboard.readText())
    : await page.evaluate(() => window.fixtureReadClipboard())).replace(/\r\n/g, "\n");
  await page.evaluate(() => { window.fixtureReadClipboard = navigator.clipboard.readText.bind(navigator.clipboard); });
  const user = page.locator(".chat-message.user");
  const bubble = user.locator(".chat-bubble");
  const menu = page.locator(".chat-message-menu");
  const code = page.locator(".chat-code-block");
  await bubble.waitFor();
  const renderedMessage = (await bubble.innerText()).trim();
  assert.equal(renderedMessage, message);
  async function copyBubble() {
    await user.locator(".chat-message-more").click();
    await menu.getByRole("button", { name: "复制", exact: true }).click();
    await menu.waitFor({ state: "detached" });
  }
  async function selectText() {
    return bubble.evaluate(element => {
      const doc = element.ownerDocument;
      const node = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
      const selection = doc.defaultView.getSelection();
      selection.setBaseAndExtent(node, 7, node, 0);
      return selection.toString();
    });
  }

  await copyBubble();
  assert.equal(await readClipboard(), renderedMessage, "copies the rendered bubble from its own window");
  const selected = await selectText();
  await copyBubble();
  assert.equal(await readClipboard(), selected, "copies only the selected text");
  await page.evaluate(() => getSelection().removeAllRanges());
  await code.getByRole("button", { name: "复制", exact: true }).click();
  await page.getByText("已复制代码块。", { exact: true }).waitFor();
  assert.equal(await readClipboard(), source, "code copy preserves the source and line breaks");
  if (desktop) {
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getTitle()), "Renge Agent Lab — Agent Chat");
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().endsWith("/desktop-window.html")).isFocused()), false,
      "the test does not focus the opener to make copy work");
  }

  // Simulate a restricted browser and an environment with no Clipboard API.
  for (const mode of ["denied", "missing"]) {
    await page.evaluate(mode => {
      if (mode === "denied") Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async () => { throw new DOMException("Clipboard blocked", "NotAllowedError"); } });
      else Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    }, mode);
    const selected = await selectText();
    await copyBubble();
    assert.equal(await readClipboard(), selected, `${mode}: DOM fallback copies the selection`);
    assert.equal(await page.evaluate(() => getSelection().toString()), selected, `${mode}: copy preserves the selection`);
    assert.deepEqual(await page.evaluate(() => [getSelection().anchorOffset, getSelection().focusOffset]), [7, 0], `${mode}: copy preserves selection direction`);
    await page.evaluate(() => getSelection().removeAllRanges());
    const input = page.getByPlaceholder("输入消息，可粘贴图片");
    await input.fill("保留输入框选区");
    await input.evaluate(node => { node.focus(); node.setSelectionRange(2, 5); });
    // click() in the DOM keeps the composer focused while invoking the copy handler.
    await code.getByRole("button", { name: "复制", exact: true }).evaluate(node => node.click());
    await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA" && document.activeElement.value === "保留输入框选区");
    assert.equal(await readClipboard(), source, `${mode}: code copy uses the same fallback`);
    assert.deepEqual(await input.evaluate(node => [node.selectionStart, node.selectionEnd]), [2, 5]);
  }
  // Failed fallback must display an error, without reporting success or leaking
  // a temporary textarea or an unhandled rejected promise.
  await page.evaluate(() => { document.execCommand = () => false; });
  await code.getByRole("button", { name: "复制", exact: true }).click();
  await page.getByText("复制失败：浏览器未允许写入剪贴板。", { exact: true }).waitFor();
  assert.equal(await page.locator('textarea[readonly]').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`Clipboard checks passed (${desktop ? "desktop" : "web"}): bubble, selection, code, denied/missing API fallback, focus restoration and failure feedback.`);
} catch (error) {
  await page?.screenshot({ path: `.runtime/clipboard-failure-${desktop ? "desktop" : "web"}.png` }).catch(() => {});
  throw error;
} finally {
  await app?.close(); await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-clipboard-")));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
