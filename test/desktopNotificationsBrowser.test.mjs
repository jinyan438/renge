import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron } from "playwright";

// Exercise real IPC and native window activation, replacing only OS toast display.
const root = await mkdtemp(join(tmpdir(), "renge-desktop-notifications-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
Object.assign(env, { RENGE_DATA_DIR: join(root, "data"), RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"),
  RENGE_ELECTRON_CACHE_DIR: join(root, "cache") });
let app, chat;
const errors = [], requests = [];
async function waitFor(predicate, message) {
  const deadline = Date.now() + 15_000;
  while (!await predicate() && Date.now() < deadline) await delay(20);
  assert.ok(await predicate(), message);
}
try {
  const now = new Date().toISOString();
  await mkdir(join(root, "data"));
  await writeFile(join(root, "data", "app-data.json"), JSON.stringify({ version: 1, chatMode: "ai",
    activeProviderId: "fixture", providers: [{ id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1",
      apiKey: "fixture", apiType: "chat-completions", modelId: "fixture", models: ["fixture"], updatedAt: now }],
    llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
    chatSessions: ["A", "B"].map(id => ({ id, title: `通知会话${id}`, mode: "ai", workspaceKey: "default",
      workspaceName: "默认工作区", messages: [{ id: `seed-${id}`, role: "user", content: `通知会话${id}`, createdAt: now }],
      createdAt: now, updatedAt: now })),
  }));
  app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
  app.context().on("page", page => page.on("pageerror", error => errors.push(error.message)));
  const home = await app.firstWindow();
  home.on("pageerror", error => errors.push(error.message));
  home.setDefaultTimeout(15_000);
  await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
  await app.evaluate(({ Notification }) => {
    globalThis.completionNotifications = [];
    Notification.isSupported = () => true;
    Notification.prototype.show = function () { globalThis.completionNotifications.push(this); };
  });
  await home.route("**/api/pi/chat", route => { requests.push({ route, body: route.request().postDataJSON() }); });
  const created = app.waitForEvent("window");
  await home.getByRole("button", { name: "开始对话", exact: true }).click();
  chat = await created;
  chat.setDefaultTimeout(15_000);
  const select = id => chat.locator(".chat-session-item").filter({ hasText: `通知会话${id}` }).locator("button").first().click();
  const active = () => chat.locator(".chat-session-item.active").innerText();
  const input = () => chat.getByPlaceholder("输入消息，可粘贴图片");
  const assertOpened = async id => {
    await waitFor(async () => (await active()).includes(`通知会话${id}`), `notification selects session ${id}`);
    await waitFor(() => app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getTitle() === "Renge Agent Lab — Agent Chat");
      return win?.isVisible() && !win.isMinimized() && win.isFocused();
    }), "notification restores and focuses Agent Chat");
    assert.equal(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().endsWith("/desktop-window.html")).isMinimized()), true,
    "notification leaves the desktop home minimized");
  };
  const clickNotification = index => app.evaluate((_electron, target) => {
    globalThis.completionNotifications[target].emit("click");
  }, index);
  const notify = sessionId => home.evaluate(id => window.rengeDesktop.notifyConversationCompleted({ content: `会话${id}已完成`, sessionId: id }), sessionId);
  const minimizeHome = () => app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().endsWith("/desktop-window.html")).minimize();
  });

  // Finish A while B is active: the originating run must supply the target ID.
  await select("A");
  await input().fill("完成会话A的输出");
  await chat.getByRole("button", { name: "发送", exact: true }).click();
  await waitFor(() => requests.length === 1, "A starts generating");
  assert.equal(requests[0].body.sessionId, "A");
  await select("B");
  await input().fill("会话B保留的草稿");
  await minimizeHome();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(win => win.webContents.getTitle() === "Renge Agent Lab — Agent Chat").minimize();
  });
  const runId = requests[0].body.runId;
  await requests[0].route.fulfill({ contentType: "text/event-stream", body: [
    { pi: { type: "run_start", runId } }, { pi: { type: "run_ready", runId } },
    { choices: [{ index: 0, delta: { content: "会话A完成后的回复" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ].map(payload => `data: ${JSON.stringify(payload)}\n\n`).join("") + "data: [DONE]\n\n" });
  await waitFor(() => app.evaluate(() => globalThis.completionNotifications.length === 1), "background completion creates a notification");
  assert.match(await active(), /通知会话B/, "completion alone keeps the current conversation");
  await clickNotification(0);
  await assertOpened("A");
  await chat.getByText("会话A完成后的回复", { exact: true }).waitFor();
  await select("B");
  assert.equal(await input().inputValue(), "会话B保留的草稿");

  // Each outstanding toast keeps its own destination; an open window is reused.
  assert.equal((await notify("B")).ok, true);
  await clickNotification(0);
  await assertOpened("A");
  await clickNotification(1);
  await assertOpened("B");
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
  assert.equal(await input().inputValue(), "会话B保留的草稿");

  // A toast can reopen a closed chat without waking the desktop home.
  await chat.close();
  await waitFor(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1), "chat closes");
  const reopened = app.waitForEvent("window");
  await clickNotification(0);
  chat = await reopened;
  chat.setDefaultTimeout(15_000);
  await assertOpened("A");
  await chat.getByText("会话A完成后的回复", { exact: true }).waitFor();

  // Re-clicking the selected session must retain its draft and keyboard focus.
  await input().fill("通知后继续输入");
  await clickNotification(0);
  await assertOpened("A");
  assert.equal(await input().inputValue(), "通知后继续输入");
  await input().click();
  await chat.keyboard.press("End");
  await chat.keyboard.type(" works");
  assert.equal(await input().inputValue(), "通知后继续输入 works");

  // A stale toast does not reopen a deleted session.
  await chat.locator(".chat-session-item.active").getByTitle("删除会话", { exact: true }).click();
  await chat.locator("dialog.desktop-message-dialog").getByRole("button", { name: "确定", exact: true }).click();
  await chat.getByText("会话和对应角色记忆目录已删除。", { exact: true }).waitFor();
  await chat.close();
  await clickNotification(0);
  await delay(300);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal((await home.evaluate(() => window.rengeDesktop.notifyConversationCompleted({ content: "missing target" }))).ok, false);
  assert.deepEqual(errors, []);
  console.log("Desktop notifications passed: background completion target, minimized home/chat, multiple toasts, window reuse/reopen, draft preservation, keyboard input and deleted sessions.");
} catch (error) {
  console.error("Desktop notification diagnostics", { errors, text: await chat?.locator("body").innerText().catch(() => "closed") });
  throw error;
} finally {
  await app?.close();
  assert.ok(root.startsWith(join(tmpdir(), "renge-desktop-notifications-")));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
