import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { SIDEBAR_BROWSER_PARTITION } from "../electron/sidebar-browser-navigation.mjs";

// Run after npm run build. Native dialogs are recorded and canceled, so no
// filesystem operations or real destructive commands can be authorized here.
const root = await mkdtemp(join(tmpdir(), "renge-desktop-dialogs-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
Object.assign(env, { RENGE_DATA_DIR: join(root, "data"), RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"),
  RENGE_ELECTRON_CACHE_DIR: join(root, "cache") });
let app, home, settings, studio;
const errors = [];
try {
  await mkdir(".runtime", { recursive: true });
  app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
  app.context().on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  app.context().on("dialog", async (dialog) => {
    errors.push(`Unexpected native JavaScript dialog: ${dialog.message()}`);
    await dialog.dismiss().catch(() => {});
  });
  home = await app.firstWindow();
  home.on("pageerror", (error) => errors.push(error.message));
  home.setDefaultTimeout(15_000);
  await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
  await home.evaluate(() => {
    window.confirm = () => { throw new Error("Confirmation was shown on the desktop home"); };
    window.alert = () => { throw new Error("Alert was shown on the desktop home"); };
  });
  async function open(name, id) {
    const created = app.waitForEvent("window");
    await home.getByRole("button", { name, exact: true }).click();
    const page = await created;
    page.setDefaultTimeout(15_000);
    await page.locator(`body[data-desktop-window="${id}"]`).waitFor();
    return page;
  }
  async function focus(page) {
    await page.bringToFront();
    await page.waitForFunction(() => document.hasFocus());
  }
  const windowId = async (page) => app.evaluate(({ BrowserWindow }, title) =>
    BrowserWindow.getAllWindows().find((win) => win.webContents.getTitle() === title)?.id, await page.title());
  settings = await open("系统设置", "settings");
  const settingsId = await windowId(settings);
  await focus(settings);
  await settings.evaluate(() => {
    window.dialogMessages = [];
    window.confirm = (message) => { window.dialogMessages.push(message); return true; };
  });
  await settings.locator(".settings-nav").getByRole("button", { name: "数据", exact: true }).click();
  await settings.getByRole("button", { name: "清除所有数据", exact: true }).click();
  await settings.getByRole("dialog", { name: "最终确认", exact: true }).waitFor();
  assert.equal(await home.getByRole("dialog", { name: "最终确认", exact: true }).count(), 0);
  assert.match((await settings.evaluate(() => window.dialogMessages))[0], /清除全部应用数据/);
  // Moving focus must not move an already open overlay to another page.
  const chat = await open("开始对话", "chat");
  await settings.getByRole("dialog", { name: "最终确认", exact: true }).waitFor();
  assert.equal(await chat.getByRole("dialog", { name: "最终确认", exact: true }).count(), 0);
  await settings.getByLabel("取消清除所有数据", { exact: true }).click();
  await settings.locator(".settings-nav").getByRole("button", { name: "用户资料", exact: true }).click();
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>';
  await settings.locator('.user-profile-settings input[type="file"]').setInputFiles({ name: "avatar.svg", mimeType: "image/svg+xml", buffer: Buffer.from(image) });
  await settings.getByRole("dialog", { name: "裁剪头像", exact: true }).waitFor();
  assert.equal(await home.getByRole("dialog", { name: "裁剪头像", exact: true }).count(), 0);
  await settings.getByRole("dialog", { name: "裁剪头像", exact: true }).getByRole("button", { name: "取消", exact: true }).click();

  studio = await open("人格工作室", "studio");
  await studio.evaluate(() => {
    window.alertMessages = [];
    window.alert = (message) => window.alertMessages.push(message);
  });
  await focus(studio);
  await studio.locator('input[accept*="text/markdown"]').setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("") });
  await studio.waitForFunction(() => window.alertMessages.length === 1).catch(async (error) => {
    console.log("Dialog diagnostics", errors, await Promise.all(app.context().pages().map(async (page) => ({
      title: await page.title(), state: await page.evaluate(() => ({ focused: document.hasFocus(), alert: window.alert.toString(), messages: window.alertMessages })),
    }))));
    throw error;
  });
  assert.match((await studio.evaluate(() => window.alertMessages))[0], /导入失败/);

  await app.evaluate(({ dialog }) => {
    globalThis.dialogCalls = [];
    const record = (parent, options) => globalThis.dialogCalls.push({ parentId: parent?.id, title: options.title });
    dialog.showOpenDialog = async (parent, options) => { record(parent, options); return { canceled: true, filePaths: [] }; };
    dialog.showSaveDialog = async (parent, options) => { record(parent, options); return { canceled: true }; };
    dialog.showMessageBox = async (parent, options) => { record(parent, options); return { response: 1 }; };
  });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().endsWith("/desktop-window.html")).minimize();
  });
  // IPC is shared by the portal's main renderer, but each dialog must use the
  // focused module window, including authorization after asynchronous path checks.
  await focus(settings);
  await home.evaluate(async () => {
    await window.rengeDesktop.selectWorkspace();
    await window.rengeDesktop.selectSkillFolder();
    await window.rengeDesktop.importTemporaryFiles();
    await window.rengeDesktop.importSidebarBrowserProfile();
  });
  const chatId = await windowId(chat);
  await focus(chat);
  await home.evaluate(async (outsidePath) => {
    await window.rengeDesktop.setFullAccess({ enabled: false });
    await window.rengeDesktop.writeFile({ path: outsidePath, content: "must not be written" }).catch(() => {});
    await window.rengeDesktop.runCommand({ command: "git", args: ["reset", "--hard"] });
    await window.rengeDesktop.runCommand({ command: "echo must not run" });
  }, join(root, "must-not-exist.txt"));
  let calls = await app.evaluate(() => globalThis.dialogCalls);
  assert.equal(calls.length, 7);
  assert.deepEqual(calls.slice(0, 4).map((call) => call.parentId), Array(4).fill(settingsId));
  assert.deepEqual(calls.slice(4).map((call) => call.parentId), Array(3).fill(chatId));
  assert.match(calls[4].title, /非工作区/);
  assert.match(calls[5].title, /Git/);
  assert.match(calls[6].title, /非白名单/);

  const guestId = await chat.evaluate(async (partition) => {
    const view = document.createElement("webview");
    view.setAttribute("partition", partition);
    view.src = "about:blank";
    const ready = new Promise((resolve) => view.addEventListener("dom-ready", resolve, { once: true }));
    document.body.appendChild(view);
    await ready;
    return view.getWebContentsId();
  }, SIDEBAR_BROWSER_PARTITION);
  // Hold the capture until focus has moved elsewhere. The save dialog must
  // retain the window that requested the screenshot, not the new focused page.
  await app.evaluate(({ webContents }, id) => {
    const guest = webContents.fromId(id);
    const capture = guest.capturePage.bind(guest);
    guest.capturePage = () => new Promise((resolve, reject) => {
      globalThis.finishDialogCapture = () => capture().then(resolve, reject);
    });
  }, guestId);
  await home.evaluate((id) => {
    window.captureResult = window.rengeDesktop.captureSidebarBrowserPage({ webContentsId: id });
  }, guestId);
  await app.evaluate(async () => {
    const deadline = Date.now() + 5_000;
    while (typeof globalThis.finishDialogCapture !== "function") {
      if (Date.now() >= deadline) throw new Error("Screenshot did not start");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
  await focus(settings);
  await app.evaluate(() => globalThis.finishDialogCapture());
  await home.evaluate(() => window.captureResult);
  calls = await app.evaluate(() => globalThis.dialogCalls);
  assert.equal(calls.at(-1).parentId, chatId);
  assert.equal(calls.at(-1).title, "保存网页截图");

  // Closing a previously active module must leave a usable parent for later dialogs.
  await studio.close();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().endsWith("/desktop-window.html")).restore();
  });
  await focus(home);
  await home.evaluate(() => window.rengeDesktop.selectWorkspace());
  calls = await app.evaluate(() => globalThis.dialogCalls);
  assert.equal(calls.at(-1).parentId, await windowId(home));
  await settings.locator(".settings-nav").getByRole("button", { name: "数据", exact: true }).click();
  await settings.getByRole("button", { name: "清除所有数据", exact: true }).click();
  await settings.getByRole("dialog", { name: "最终确认", exact: true }).waitFor();
  await settings.close();
  settings = await open("系统设置", "settings");
  assert.equal(await home.getByRole("dialog", { name: "最终确认", exact: true }).count(), 0);
  assert.equal(await settings.getByRole("dialog", { name: "最终确认", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  await settings.screenshot({ path: ".runtime/desktop-dialogs-settings.png" });
  console.log("Desktop dialog ownership passed: confirmation, async alert, stable overlays, avatar crop, four file pickers, three permission prompts, delayed screenshot save, minimized home and closed-window fallback.");
} catch (error) {
  await settings?.screenshot({ path: ".runtime/desktop-dialogs-failure.png" }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  assert.ok(root.startsWith(join(tmpdir(), "renge-desktop-dialogs-")));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
