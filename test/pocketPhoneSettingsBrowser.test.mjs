import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { emptyPocketState, makePocketContact } from "../src/pocketPhoneState.ts";
import { POCKET_PROMPTS } from "../src/pocketPhonePrompts.ts";
import { fixtureWechatTurn } from "./pocketPhoneInnerFixture.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-phone-settings-"));
const key = "renge_pocket_phone_v1:settings-fixture";
const requests = []; const errors = [];
let server; let browser; let page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "测试", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture", models: ["fixture", "other"], updatedAt: now };
  const owner = makePocketContact({ name: "奶糖", avatar: "/touxiang/9.png", personality: "温柔，在花店工作", greeting: "", sourceLabel: "自定义" });
  const seed = { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], userProfile: { nickname: "小月", bio: "爱画画", avatarImage: "/touxiang/20.png" }, chatSessions: [{ id: "settings-fixture", title: "手机设置测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [], createdAt: now, updatedAt: now }] };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); }, { key, state: { ...emptyPocketState(), contacts: [owner] } });
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
    assert.equal((await read()).settings.promptOverrides?.[id], undefined);
    await item.getByRole("button", { name: "保存提示词", exact: true }).click();
    assert.match((await read()).settings.promptOverrides[id], /自定义测试/);
    await item.locator(":scope > summary").click();
  }
  const notesEditor = await promptEditor("notes.task"); await notesEditor.locator("textarea").fill(""); await notesEditor.getByRole("button", { name: "保存提示词", exact: true }).click(); await notesEditor.getByText("提示词不能为空。", { exact: true }).waitFor();
  assert.match((await read()).settings.promptOverrides["notes.task"], /自定义测试/);
  await page.reload(); await enter(); await openSettings();
  const reloaded = await promptEditor("notes.task"); assert.match(await reloaded.locator("textarea").inputValue(), /自定义测试:notes.task/);
  await reloaded.getByRole("button", { name: "保存提示词", exact: true }).scrollIntoViewIfNeeded();
  await phone.screenshot({ path: ".runtime/pocket-settings-prompt-editor.png", animations: "disabled" });
  assert.equal(await phone.locator(".pocket-settings").evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await home(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: owner.name }).click();
  await phone.getByRole("button", { name: "发送消息", exact: true }).click(); await phone.getByText("新的微信回复", { exact: true }).waitFor();
  assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:wechat.style/); assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:phone.time/); assert.equal(requests.at(-1).request.model, "other");
  await home(); await openSettings(); const styleEditor = await promptEditor("wechat.style");
  await styleEditor.getByRole("button", { name: "恢复默认", exact: true }).click(); assert.equal((await read()).settings.promptOverrides["wechat.style"], undefined); assert.equal(await styleEditor.locator("textarea").inputValue(), POCKET_PROMPTS.find(p => p.id === "wechat.style").defaultText);
  await home(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: owner.name }).click(); await phone.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).contacts[0].messages.length === 2, key); assert.doesNotMatch(JSON.stringify(requests.at(-1).request.messages), /自定义测试:wechat.style/);
  await home(); await phone.getByRole("button", { name: "打开小红书", exact: true }).click(); await phone.getByRole("button", { name: "生成小红书笔记", exact: true }).click(); await phone.getByText("提示词笔记", { exact: true }).first().waitFor(); assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:red.feed/);
  await home(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.getByRole("button", { name: "发现", exact: true }).click(); await phone.getByRole("button", { name: "朋友圈", exact: true }).click(); await phone.getByRole("button", { name: "生成好友朋友圈", exact: true }).click(); await phone.getByText("修改提示词后的朋友圈", { exact: true }).waitFor(); assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:moments.task/);
  await home(); await phone.getByRole("button", { name: "打开ta的手机", exact: true }).click(); await phone.getByRole("button", { name: "查看奶糖的手机", exact: true }).click(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.getByRole("button", { name: "生成联系人", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: "阿禾" }).waitFor(); assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:character.task/);
  await home(); await phone.getByRole("button", { name: "打开便签", exact: true }).click(); await phone.getByRole("button", { name: "生成便签", exact: true }).click(); await phone.getByText("提示词便签", { exact: true }).waitFor(); assert.match(JSON.stringify(requests.at(-1).request.messages), /自定义测试:notes.task/);
  await home(); await openSettings(); const taEditor = await promptEditor("notes.task"); assert.match(await taEditor.locator("textarea").inputValue(), /自定义测试:notes.task/);
  await phone.getByRole("button", { name: "全部恢复默认", exact: true }).click(); assert.deepEqual((await read()).settings.promptOverrides, {});
  assert.equal(await taEditor.locator("textarea").inputValue(), POCKET_PROMPTS.find(p => p.id === "notes.task").defaultText);
  assert.equal((await read()).settings.theme, "mint"); assert.equal((await read()).settings.largeText, true); assert.equal((await read()).characterPhones[owner.id].groups.length, 1);
  assert.deepEqual(errors, []);
  console.log("PASS: functional collapsible settings, saved/reloaded prompt edits reaching WeChat/time/character/groups/notes/moments/red requests, empty edit validation, single/all defaults restoration, shared ta settings and no overflow/runtime errors");
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: ".runtime/pocket-settings-failure.png" });
  throw error;
} finally {
  await browser?.close(); server?.server.closeAllConnections(); if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-phone-settings-"))); await rm(root, { recursive: true, force: true });
}
