import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

// Run after npm run build. Use isolated application data and real keyboard
// events: fill() alone cannot detect an Electron window that lost input focus.
const root = await mkdtemp(join(tmpdir(), "renge-desktop-focus-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
Object.assign(env, { RENGE_DATA_DIR: join(root, "data"), RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"),
  RENGE_ELECTRON_CACHE_DIR: join(root, "cache") });
let app, chat;
const errors = [];
try {
  const now = new Date().toISOString();
  await mkdir(join(root, "data"));
  await mkdir(".runtime", { recursive: true });
  await writeFile(join(root, "data", "app-data.json"), JSON.stringify({ version: 1, chatMode: "ai",
    chatSessions: ["focus-first", "focus-second"].map(id => ({ id, title: id, mode: "ai", workspaceKey: "default",
      workspaceName: "默认工作区", messages: [], createdAt: now, updatedAt: now })),
  }));
  app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
  app.context().on("page", page => page.on("pageerror", error => errors.push(error.message)));
  app.context().on("dialog", async dialog => {
    errors.push(`Blocking JavaScript dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });
  const home = await app.firstWindow();
  home.on("pageerror", error => errors.push(error.message));
  async function open(name, id) {
    const created = app.waitForEvent("window");
    await home.getByRole("button", { name, exact: true }).click();
    const page = await created;
    page.setDefaultTimeout(10_000);
    await page.locator(`body[data-desktop-window="${id}"]`).waitFor();
    return page;
  }
  chat = await open("开始对话", "chat");
  const input = () => chat.getByPlaceholder("输入消息，可粘贴图片");
  const modal = () => chat.locator("dialog.desktop-message-dialog");
  const workspace = () => chat.locator(".chat-workspace-item").filter({ hasText: "默认工作区" });
  async function typeDraft(text) {
    await input().click();
    await chat.keyboard.press("ControlOrMeta+A");
    await chat.keyboard.type(text);
    assert.equal(await input().inputValue(), text, "physical keyboard input reaches the composer");
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getTitle()),
      "Renge Agent Lab — Agent Chat", "chat keeps native window focus");
  }
  await typeDraft("draft before confirmation");
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getFocusedWindow();
    globalThis.redundantActivations = [];
    for (const name of ["show", "focus"]) {
      const original = win[name].bind(win);
      win[name] = (...args) => { globalThis.redundantActivations.push(name); return original(...args); };
    }
  });
  await typeDraft("draft before confirmation");
  await workspace().click({ button: "right" });
  await modal().waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.redundantActivations), [],
    "clicking inside an already focused native window must not re-show or re-focus it");
  await chat.screenshot({ path: ".runtime/desktop-focus-dialog.png" });
  assert.equal(await home.locator("dialog.desktop-message-dialog").count(), 0);
  assert.equal(await modal().getByRole("button", { name: "取消", exact: true }).evaluate(node => node === node.ownerDocument.activeElement), true,
    "destructive confirmations initially focus Cancel");
  await chat.keyboard.press("Escape");
  await modal().waitFor({ state: "detached" });
  assert.equal(await input().inputValue(), "draft before confirmation");
  assert.equal(await chat.locator(".chat-session-item").count(), 2);
  await typeDraft("typing after escape");
  await workspace().click({ button: "right" });
  await modal().waitFor();
  await chat.keyboard.press("Tab");
  assert.equal(await modal().getByRole("button", { name: "确定", exact: true }).evaluate(node => node === node.ownerDocument.activeElement), true);
  await chat.keyboard.press("Tab");
  assert.equal(await modal().getByRole("button", { name: "取消", exact: true }).evaluate(node => node === node.ownerDocument.activeElement), true);
  await chat.keyboard.press("Enter");
  await modal().waitFor({ state: "detached" });
  assert.equal(await chat.locator(".chat-session-item").count(), 2, "Enter on Cancel does not delete sessions");

  // A dialog stays in its requesting document while another module is used.
  await workspace().click({ button: "right" });
  const settings = await open("系统设置", "settings");
  assert.equal(await settings.locator("dialog.desktop-message-dialog").count(), 0);
  await modal().waitFor();
  await modal().getByRole("button", { name: "取消", exact: true }).click();
  await typeDraft("typing after switching windows");
  await settings.close();
  await workspace().click({ button: "right" });
  await modal().waitFor();
  // Simulate a script/another module adding a session during confirmation.
  await chat.getByRole("button", { name: "新建会话", exact: true }).evaluate(node => node.click());
  await modal().getByRole("button", { name: "确定", exact: true }).click();
  await chat.getByText("工作区会话和对应角色记忆目录已删除。", { exact: true }).waitFor();
  assert.equal(await chat.locator(".chat-session-item").count(), 1, "sessions added after confirmation opened are preserved");
  await typeDraft("new session survives confirmation");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().endsWith("/desktop-window.html")).minimize();
  });

  // Repeat cancel/accept, including deletion of the active and last sessions.
  for (let round = 0; round < 3; round++) {
    const count = await chat.locator(".chat-session-item").count();
    await chat.locator(".chat-session-item.active").getByTitle("删除会话", { exact: true }).click();
    await modal().getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await chat.locator(".chat-session-item").count(), count);
    await typeDraft(`cancel session ${round}`);
    await chat.locator(".chat-session-item.active").getByTitle("删除会话", { exact: true }).click();
    await modal().getByRole("button", { name: "确定", exact: true }).click();
    await chat.getByText("会话和对应角色记忆目录已删除。", { exact: true }).waitFor();
    await typeDraft(`deleted session ${round}`);
    await workspace().click({ button: "right" });
    await modal().getByRole("button", { name: "确定", exact: true }).click();
    await chat.getByText("工作区会话和对应角色记忆目录已删除。", { exact: true }).waitFor();
    await typeDraft(`deleted workspace ${round}`);
  }
  await chat.getByRole("button", { name: "重置当前会话", exact: true }).click();
  await modal().getByRole("button", { name: "确定", exact: true }).click();
  await input().evaluate(node => { if (node.value) throw new Error("Reset must clear the draft"); });
  await typeDraft("typing after reset");
  await chat.getByRole("button", { name: "重置当前会话", exact: true }).click();
  await modal().waitFor();
  await chat.getByRole("button", { name: "新建会话", exact: true }).evaluate(node => node.click());
  await modal().getByRole("button", { name: "确定", exact: true }).click();
  assert.equal(await chat.locator(".chat-session-item").count(), 2);
  await chat.locator(".chat-session-item:not(.active)").locator("button").first().click();
  assert.equal(await input().inputValue(), "typing after reset", "a stale reset confirmation must not clear a different active session or its drafts");
  // Closing a module cancels its pending confirmation; reopening starts clean.
  await workspace().click({ button: "right" });
  await modal().waitFor();
  await chat.close();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().endsWith("/desktop-window.html")).restore();
  });
  chat = await open("开始对话", "chat");
  assert.equal(await modal().count(), 0);
  await typeDraft("typing after reopen");
  await chat.screenshot({ path: ".runtime/desktop-focus.png" });
  assert.deepEqual(errors, []);
  console.log("Desktop focus passed: no redundant native activation, keyboard input after Escape, Tab/Enter, cancel, reset, repeated session/workspace deletion, concurrent session changes, window switching, minimized home and pending-dialog closure.");
} catch (error) {
  await chat?.screenshot({ path: ".runtime/desktop-focus-failure.png" }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  assert.ok(root.startsWith(join(tmpdir(), "renge-desktop-focus-")));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
