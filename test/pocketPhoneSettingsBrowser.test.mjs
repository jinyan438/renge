import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { emptyPocketState, makePocketContact } from "../src/pocketPhoneState.ts";
import { POCKET_PROMPTS } from "../src/pocketPhonePrompts.ts";
import { POCKET_PROMPTS_STORAGE_KEY } from "../src/pocketPhonePromptStorage.ts";
import { fixtureWechatTurn } from "./pocketPhoneInnerFixture.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-phone-settings-"));
const key = "renge_pocket_phone_v1:settings-fixture";
const otherKey = "renge_pocket_phone_v1:other-settings-fixture";
const requests = []; const errors = [];
let server; let browser; let page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "测试", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture", models: ["fixture", "other"], updatedAt: now };
  const owner = makePocketContact({ name: "奶糖", avatar: "/touxiang/9.png", personality: "温柔，在花店工作", greeting: "", sourceLabel: "自定义" });
  const other = makePocketContact({ name: "薄荷", avatar: "/touxiang/10.png", personality: "喜欢园艺", greeting: "", sourceLabel: "自定义" });
  const seed = { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], userProfile: { nickname: "小月", bio: "爱画画", avatarImage: "/touxiang/20.png" }, chatSessions: [{ id: "settings-fixture", title: "手机设置测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: "fact-one", role: "user", content: "手机设置测试事实", createdAt: now }], createdAt: now, updatedAt: now }, { id: "other-settings-fixture", title: "第二个提示词会话", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: "fact-two", role: "user", content: "第二个提示词会话的事实", createdAt: now }], createdAt: now, updatedAt: now }] };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  const legacy = `${POCKET_PROMPTS.find(p => p.id === "wechat.innerPrivacy").defaultText}\n当前会话旧提示词`;
  const otherLegacy = `${POCKET_PROMPTS.find(p => p.id === "notes.context").defaultText}\n其他会话旧提示词`;
  await page.addInitScript(({ key, otherKey, state, otherState }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); if (!localStorage.getItem(otherKey)) localStorage.setItem(otherKey, JSON.stringify(otherState)); }, { key, otherKey,
    state: { ...emptyPocketState(), contacts: [owner], settings: { ...emptyPocketState().settings, promptOverrides: { "wechat.innerPrivacy": legacy } } },
    otherState: { ...emptyPocketState(), contacts: [other], settings: { ...emptyPocketState().settings, promptOverrides: { "wechat.innerPrivacy": "另一个旧版本", "notes.context": otherLegacy } } },
  });
  await page.route("**/api/chat/completions", async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    const text = body.request.messages.at(-1).content;
    let output = fixtureWechatTurn("新的微信回复", requests.length);
    if (text.includes("便签生成任务")) output = JSON.stringify({ notes: [{ title: "提示词便签", body: "整理花束" }] });
    else if (text.includes("ta 的手机生成任务")) output = JSON.stringify({ contacts: [{ name: "阿禾", personality: "花店同事", messages: [] }], groups: [{ name: "同事群", members: [{ name: "阿禾" }], messages: [] }] });
    else if (text.includes("朋友圈")) output = JSON.stringify({ moments: [{ authorId: owner.id, text: "修改提示词后的朋友圈", pic: "", location: "", visibility: "public", visibleTo: [], likes: [], comments: [] }] });
    else if (text.includes("小红书生成任务")) output = JSON.stringify({ actors: [{ id: "new:1", name: "花友", nickname: "花瓣日记", personality: "爱插花的店员", profile: {} }], notes: [{ authorId: "new:1", author: "花瓣日记", title: "提示词笔记", content: "给花束搭配颜色", tags: ["花束"], category: "生活", comments: [] }] });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content: output } }] }) });
  });
  const phone = page.locator(".pocket-panel");
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const readPrompts = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).prompts, POCKET_PROMPTS_STORAGE_KEY);
  const readOther = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), otherKey);
  async function enter() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click(); await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    const maximize = page.getByRole("button", { name: "最大化窗口", exact: true }); if (await maximize.isVisible()) await maximize.click();
    await page.getByRole("button", { name: "展开右侧栏", exact: true }).click(); await page.getByRole("button", { name: /手机.*可爱手机/ }).click();
  }
  async function openSettings() { await phone.getByRole("button", { name: "打开手机设置", exact: true }).click(); }
  async function home() { await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click(); }
  async function promptEditor(id) {
    const def = POCKET_PROMPTS.find(prompt => prompt.id === id);
    const outer = phone.locator(".pocket-settings-card").filter({ has: page.getByText("提示词修改", { exact: true }) });
    if (!await outer.evaluate(node => node.open)) await outer.locator(":scope > summary").click();
    const app = outer.locator(".pocket-prompt-app").filter({ has: page.getByText(def.group, { exact: true }) });
    if (!await app.evaluate(node => node.open)) await app.locator(":scope > summary").click();
    const item = app.locator(`[data-prompt-id="${id}"]`);
    if (!await item.evaluate(node => node.open)) await item.locator(":scope > summary").click();
    return item;
  }
  await page.goto(server.url); await enter(); await openSettings();
  assert.deepEqual(await readPrompts(), { "wechat.innerPrivacy": legacy, "notes.context": otherLegacy }); assert.equal((await read()).settings.promptOverrides, undefined);
  assert.equal(await phone.locator(".pocket-settings-card").count(), 4);
  assert.equal(await phone.getByLabel("模型渠道", { exact: true }).isVisible(), false);
  await phone.getByText("API（全局共用）", { exact: true }).click();
  await phone.getByLabel("模型渠道", { exact: true }).selectOption("fixture"); await phone.getByLabel("聊天模型", { exact: true }).selectOption("other");
  await phone.getByText("手机主题", { exact: true }).click(); await phone.getByRole("button", { name: "薄荷布丁", exact: true }).click(); await phone.getByRole("switch").click();
  await phone.getByLabel("我的昵称", { exact: true }).fill("月月");
  await phone.getByText("手机主题", { exact: true }).click(); await phone.getByText("API（全局共用）", { exact: true }).click();
  await phone.locator(".pocket-settings").evaluate(node => { node.scrollTop = 0; }); await phone.screenshot({ path: ".runtime/pocket-settings-folded.png", animations: "disabled" });
  for (const id of ["wechat.style", "phone.time", "character.task", "notes.task", "moments.task", "red.feed"]) {
    const item = await promptEditor(id); const def = POCKET_PROMPTS.find(prompt => prompt.id === id);
    assert.equal(await item.locator("textarea").inputValue(), def.defaultText);
    await item.locator("textarea").fill(`${def.defaultText}\n自定义测试:${id}`);
    assert.equal((await readPrompts())[id], undefined);
    await item.getByRole("button", { name: "保存提示词", exact: true }).click();
    assert.match((await readPrompts())[id], /自定义测试/); assert.equal((await read()).settings.promptOverrides, undefined);
    await item.locator(":scope > summary").click();
  }
  const notesEditor = await promptEditor("notes.task"); await notesEditor.locator("textarea").fill(""); await notesEditor.getByRole("button", { name: "保存提示词", exact: true }).click(); await notesEditor.getByText("提示词不能为空。", { exact: true }).waitFor();
  assert.match((await readPrompts())["notes.task"], /自定义测试/);
  await page.reload(); await enter(); await openSettings();
  const reloaded = await promptEditor("notes.task"); assert.match(await reloaded.locator("textarea").inputValue(), /自定义测试:notes.task/);
  await reloaded.getByRole("button", { name: "保存提示词", exact: true }).scrollIntoViewIfNeeded();
  await phone.screenshot({ path: ".runtime/pocket-settings-prompt-editor.png", animations: "disabled" });
  assert.equal(await phone.locator(".pocket-settings").evaluate(node => node.scrollWidth <= node.clientWidth), true);
  // A second window updates a mounted editor through the browser storage event.
  const sibling = await page.context().newPage(); await sibling.goto(server.url);
  await sibling.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); saved.prompts["wechat.style"] += "\n跨窗口共用提示词"; localStorage.setItem(key, JSON.stringify(saved)); }, POCKET_PROMPTS_STORAGE_KEY);
  const sharedEditor = await promptEditor("wechat.style"); await page.waitForFunction(() => document.getElementById("pocket-prompt-wechat.style").value.includes("跨窗口共用提示词")); await sibling.close();
  assert.match(await sharedEditor.locator("textarea").inputValue(), /跨窗口共用提示词/);
  // Switch without reloading. Only prompts are shared; appearance and contacts
  // stay in their own phone, and B's actual model request uses A's saved prompts.
  await page.locator(".chat-session-item").filter({ hasText: "第二个提示词会话" }).click(); await openSettings();
  const otherEditor = await promptEditor("notes.task"); assert.match(await otherEditor.locator("textarea").inputValue(), /自定义测试:notes.task/);
  assert.equal((await readOther()).settings.theme, "rose"); assert.equal((await readOther()).settings.promptOverrides, undefined);
  await home(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: "薄荷" }).click(); await phone.getByRole("button", { name: "发送消息", exact: true }).click(); await phone.getByText("新的微信回复", { exact: true }).waitFor();
  assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:wechat.style/); assert.match(JSON.stringify(requests.at(-1).request.messages), /跨窗口共用提示词/); assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:phone.time/); assert.equal(requests.at(-1).request.model, "fixture");
  assert.equal((await read()).contacts[0].messages.length, 0);
  await page.locator(".chat-session-item").filter({ hasText: "手机设置测试" }).click();
  await home(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: owner.name }).click();
  await phone.getByRole("button", { name: "发送消息", exact: true }).click(); await phone.getByText("新的微信回复", { exact: true }).waitFor();
  assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:wechat.style/); assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:phone.time/); assert.equal(requests.at(-1).request.model, "other");
  await home(); await openSettings(); const styleEditor = await promptEditor("wechat.style");
  await styleEditor.getByRole("button", { name: "恢复默认", exact: true }).click(); assert.equal((await readPrompts())["wechat.style"], undefined); assert.equal(await styleEditor.locator("textarea").inputValue(), POCKET_PROMPTS.find(p => p.id === "wechat.style").defaultText);
  await home(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: owner.name }).click(); await phone.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).contacts[0].messages.length === 2, key); assert.doesNotMatch(JSON.stringify(requests.at(-1).request.messages), /自定义测试:wechat.style/);
  await home(); await phone.getByRole("button", { name: "打开小红书", exact: true }).click(); await phone.getByRole("button", { name: "生成小红书笔记", exact: true }).click(); await phone.getByText("提示词笔记", { exact: true }).first().waitFor(); assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:red.feed/);
  await home(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.getByRole("button", { name: "发现", exact: true }).click(); await phone.getByRole("button", { name: "朋友圈", exact: true }).click(); await phone.getByRole("button", { name: "生成好友朋友圈", exact: true }).click(); await phone.getByText("修改提示词后的朋友圈", { exact: true }).waitFor(); assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:moments.task/);
  await home(); await phone.getByRole("button", { name: "打开ta的手机", exact: true }).click(); await phone.getByRole("button", { name: "查看奶糖的手机", exact: true }).click(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.getByRole("button", { name: "生成联系人", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: "阿禾" }).waitFor(); assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:character.task/);
  await home(); await phone.getByRole("button", { name: "打开便签", exact: true }).click(); await phone.getByRole("button", { name: "生成便签", exact: true }).click(); await phone.getByText("提示词便签", { exact: true }).waitFor(); assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:notes.task/);
  await home(); await openSettings(); const taEditor = await promptEditor("notes.task"); assert.match(await taEditor.locator("textarea").inputValue(), /自定义测试:notes.task/);
  await page.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); saved.settings.promptOverrides = { "notes.task": "不应复活的旧提示词" }; localStorage.setItem(key, JSON.stringify(saved)); }, otherKey);
  await phone.getByRole("button", { name: "全部恢复默认", exact: true }).click(); assert.deepEqual(await readPrompts(), {});
  assert.equal(await taEditor.locator("textarea").inputValue(), POCKET_PROMPTS.find(p => p.id === "notes.task").defaultText);
  assert.equal((await read()).settings.theme, "mint"); assert.equal((await read()).settings.largeText, true); assert.equal((await read()).characterPhones[owner.id].groups.length, 1);
  await page.locator(".chat-session-item").filter({ hasText: "第二个提示词会话" }).click(); await openSettings(); const resetEditor = await promptEditor("notes.task"); assert.equal(await resetEditor.locator("textarea").inputValue(), POCKET_PROMPTS.find(p => p.id === "notes.task").defaultText);
  await page.reload(); await enter(); await openSettings(); const restoredEditor = await promptEditor("notes.task"); assert.equal(await restoredEditor.locator("textarea").inputValue(), POCKET_PROMPTS.find(p => p.id === "notes.task").defaultText); assert.deepEqual(await readPrompts(), {});
  assert.deepEqual(errors, []);
  console.log("PASS: global legacy migration, cross-session/window saved prompts reaching WeChat/time/character/groups/notes/moments/red requests, independent phone records and appearance, empty edit validation, global defaults restoration without stale resurrection, reload, shared ta settings and no overflow/runtime errors");
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: ".runtime/pocket-settings-failure.png" });
  throw error;
} finally {
  await browser?.close(); server?.server.closeAllConnections(); if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-phone-settings-"))); await rm(root, { recursive: true, force: true });
}
