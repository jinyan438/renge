import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

const root = await mkdtemp(join(tmpdir(), "renge-desktop-windows-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
Object.assign(env, {
  RENGE_DATA_DIR: join(root, "data"),
  RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"),
  RENGE_ELECTRON_CACHE_DIR: join(root, "cache"),
});
let app, fixture;
try {
  const now = new Date().toISOString();
  const image = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#d6eee6"/></svg>').toString("base64")}`;
  await mkdir(join(root, "data"));
  await writeFile(join(root, "data", "app-data.json"), JSON.stringify({
    version: 1, chatMode: "ai", chatRenderedEditingEnabled: true,
    chatSessions: [{ id: "native-test", title: "独立窗口测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区",
      messages: [{ id: "native-image", role: "assistant", content: `独立窗口图片\n\n![窗口内预览](${image})`, createdAt: now }], createdAt: now, updatedAt: now }],
  }));
  fixture = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<title>Native browser fixture</title><h1>Native browser fixture</h1>");
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
  const home = await app.firstWindow();
  home.setDefaultTimeout(20_000);
  const errors = [];
  app.context().on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  home.on("pageerror", (error) => errors.push(error.message));
  await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
  const open = async (name, id) => {
    const [page] = await Promise.all([
      app.waitForEvent("window"),
      home.getByRole("button", { name, exact: true }).click(),
    ]);
    page.setDefaultTimeout(20_000);
    await page.locator(`body[data-desktop-window="${id}"]`).waitFor();
    return page;
  };
  const nativeState = (id) => app.evaluate(({ BrowserWindow }, target) => {
    const win = BrowserWindow.getAllWindows().find((item) => item.webContents.getTitle() === `Renge Agent Lab — ${target}`);
    return win && { bounds: win.getBounds(), maximized: win.isMaximized(), minimized: win.isMinimized(), visible: win.isVisible() };
  }, id);
  const chat = await open("开始对话", "chat");
  const input = chat.getByPlaceholder("输入消息，可粘贴图片");
  await input.fill("拖出主窗口后保留的草稿");
  assert.equal(await home.locator(".chat-shell").count(), 0, "module content lives outside the main document");
  assert.equal(await chat.locator(".managed-window-drag-handle").evaluate((node) => getComputedStyle(node).getPropertyValue("-webkit-app-region")), "drag");
  assert.equal(await chat.locator(".portfolio-window-light.close").evaluate((node) => getComputedStyle(node).getPropertyValue("-webkit-app-region")), "no-drag");
  assert.equal(await chat.locator(".window-resize-handle").count(), 0);

  // Native bounds are screen coordinates and do not clamp to the main window.
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().endsWith("/desktop-window.html"));
    const child = BrowserWindow.getAllWindows().find((win) => win.webContents.getTitle().endsWith("— Agent Chat"));
    main.setBounds({ x: 40, y: 40, width: 1040, height: 720 });
    child.setBounds({ x: 800, y: 120, width: 920, height: 640 });
  });
  const outside = await nativeState("Agent Chat");
  assert.ok(outside.bounds.x + outside.bounds.width > 1080, "chat extends past the main window's right edge");
  const fallbackStyle = await chat.addStyleTag({ content: ".managed-window-drag-handle { -webkit-app-region: no-drag !important; }" });
  await chat.mouse.move(400, 20);
  await chat.mouse.down();
  await chat.mouse.move(460, 40);
  await chat.mouse.up();
  assert.ok((await nativeState("Agent Chat")).bounds.x > outside.bounds.x, "pointer dragging also moves the native window when OS drag regions are unavailable");
  await fallbackStyle.evaluate((element) => element.remove());
  assert.equal(await input.inputValue(), "拖出主窗口后保留的草稿");
  await chat.getByLabel("最小化窗口", { exact: true }).click();
  await home.waitForFunction(() => true);
  assert.equal((await nativeState("Agent Chat")).minimized, true);
  await home.getByRole("button", { name: "开始对话", exact: true }).click();
  await input.waitFor({ state: "visible" });
  assert.equal((await nativeState("Agent Chat")).minimized, false);
  assert.equal(await input.inputValue(), "拖出主窗口后保留的草稿");
  await chat.getByLabel("最大化窗口", { exact: true }).click();
  await chat.getByLabel("还原窗口", { exact: true }).waitFor();
  assert.equal((await nativeState("Agent Chat")).maximized, true);
  await chat.getByLabel("还原窗口", { exact: true }).click();
  await chat.getByLabel("最大化窗口", { exact: true }).waitFor();

  await chat.getByRole("button", { name: "放大查看：窗口内预览", exact: true }).click();
  await chat.getByRole("dialog", { name: "图片预览：窗口内预览", exact: true }).waitFor();
  assert.equal(await home.locator("dialog:modal").count(), 0, "image modal belongs to the chat window");
  await chat.keyboard.press("Escape");

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().endsWith("/desktop-window.html")).minimize();
  });
  await input.fill("主页最小化后仍可输入");
  assert.equal(await input.inputValue(), "主页最小化后仍可输入");
  await input.fill("拖出主窗口后保留的草稿");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().endsWith("/desktop-window.html")).restore();
  });
  await chat.locator("dialog:modal").waitFor({ state: "detached" });
  await chat.locator(".chat-message-more").click();
  await chat.locator(".chat-message-menu").getByRole("button", { name: "编辑", exact: true }).click();
  const editor = chat.locator('[contenteditable="true"]');
  await editor.evaluate((element) => {
    element.querySelector("p").append(document.createTextNode(" 保留跨窗口编辑。"));
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await chat.locator(".chat-inline-editor-actions").getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.ok((await chat.locator(".chat-thread").innerText()).includes("保留跨窗口编辑。"));

  await chat.getByLabel("展开右侧栏", { exact: true }).click();
  await chat.getByRole("button", { name: /^浏览器 AI/ }).click();
  const address = chat.getByLabel("浏览器地址", { exact: true });
  await address.fill(`http://127.0.0.1:${fixture.address().port}/`);
  await address.press("Enter");
  await chat.getByRole("tab", { name: "Native browser fixture", exact: true }).waitFor().catch(async (error) => {
    console.log("Native browser diagnostics", await chat.evaluate(() => ({
      text: document.body.innerText,
      webviews: Array.from(document.querySelectorAll("webview")).map((node) => {
        try { return { src: node.src, id: node.getWebContentsId(), url: node.getURL() }; }
        catch (error) { return { src: node.src, error: error.message, constructor: node.constructor.name }; }
      }),
    })), errors);
    console.log(await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((item) => ({ id: item.id, type: item.getType(), url: item.getURL(), title: item.getTitle() }))));
    await chat.screenshot({ path: ".runtime/desktop-native-browser-error.png" });
    throw error;
  });
  await chat.getByLabel("更多浏览器选项", { exact: true }).click();
  await chat.getByLabel("浏览器菜单", { exact: true }).waitFor();
  await chat.keyboard.press("Escape");

  const settings = await open("系统设置", "settings");
  await settings.locator(".settings-window-shell").waitFor();
  assert.equal(await input.inputValue(), "拖出主窗口后保留的草稿", "opening settings preserves the live chat tree");
  const settingsClosed = settings.waitForEvent("close");
  await settings.getByLabel("关闭设置窗口", { exact: true }).click().catch((error) => {
    if (!settings.isClosed()) throw error;
  });
  await settingsClosed;
  await open("系统设置", "settings");
  await open("人格工作室", "studio");
  // Home summary windows use the same native host.
  const summary = await open("打开角色卡管理", "home-characters");
  await summary.getByRole("dialog").waitFor();
  await summary.getByLabel("最小化窗口", { exact: true }).click();
  await home.getByRole("button", { name: "打开角色卡管理", exact: true }).click();
  assert.equal((await nativeState("角色卡管理")).minimized, false);
  const createdCharacters = app.waitForEvent("window");
  await summary.getByRole("button", { name: "打开管理器", exact: true }).click().catch((error) => {
    if (!summary.isClosed()) throw error;
  });
  const characters = await createdCharacters;
  await characters.locator(".portfolio-window-shell").waitFor();

  await mkdir(".runtime", { recursive: true });
  await chat.screenshot({ path: ".runtime/desktop-native-chat.png" });
  assert.deepEqual(errors, [], "native portals must not raise renderer errors");
  assert.equal(await home.evaluate(() => window.open("about:blank", "untrusted-window") === null), true);
  await home.reload();
  await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, "main reload closes all state-dependent child windows");
  console.log("Desktop native windows passed: outside bounds, drafts, home minimization, minimize/restore, maximize, image modal, message editing, sidebar webview, settings reopen, studio, home summaries, popup restrictions and reload cleanup.");
} finally {
  await app?.close();
  fixture?.closeAllConnections();
  await new Promise((resolve) => fixture ? fixture.close(resolve) : resolve());
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
