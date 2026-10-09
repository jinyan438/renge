import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { emptyPocketState, makePocketContact } from "../src/pocketPhoneState.ts";
import { POCKET_FRIEND_LIBRARY_KEY } from "../src/pocketFriendLibrary.ts";

const root = await mkdtemp(join(tmpdir(), "renge-friends-browser-"));
const requests = []; const errors = [];
let server; let browser; let page; let mode = "context"; let releaseSlow;
const firstKey = "renge_pocket_phone_v1:friends-one";
const secondKey = "renge_pocket_phone_v1:friends-two";
const role = (name, personality = `${name}是独立角色，喜欢画画。`) => ({ name, personality, greeting: `{{user}}，我是${name}。` });
const legacy = makePocketContact({ ...role("奶糖"), avatar: "/touxiang/3.png", sourceLabel: "自定义角色" });
legacy.messages.push({ id: "old-private-chat", role: "user", content: "原会话的私聊不会导入", createdAt: legacy.createdAt });

try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Friends Fixture", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture", apiType: "chat-completions", modelId: "friends-fixture", models: ["friends-fixture"], updatedAt: now };
  const card = { id: "cast-card", name: "北街群像", description: "季北是冷静的画家，白露是温柔的花店老板。", personality: "每个角色保持独立身份", firstMessage: "白露向季北递来一枝花。", alternateGreetings: ["季北推开画室的门。"], characterBook: { id: "cast-book", name: "北街人物", entries: [{ content: "季北喜欢蓝莓，白露喜欢向日葵。", enabled: true }, { content: "DISABLED_CARD_ROLE", enabled: false }] }, createdAt: now, updatedAt: now };
  const seed = { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], userProfile: { nickname: "小月", bio: "爱画画", avatarImage: "" }, characterCards: [card], personas: [],
    worldBooks: [{ id: "active-book", name: "花园", entries: [{ content: "阿禾在花店工作，林霖是她的朋友。", constant: true }, { content: "DISABLED_CONTEXT_ROLE", enabled: false, constant: true }] }, { id: "off-book", name: "未启用", entries: [{ content: "INACTIVE_BOOK_ROLE", constant: true }] }], activeWorldBookIds: ["active-book"],
    chatSessions: ["one", "two"].map(id => ({ id: `friends-${id}`, title: id === "one" ? "朋友识别会话一" : "朋友识别会话二", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: `history-${id}`, role: "assistant", content: id === "one" ? "林霖和阿禾一起走进花店，奶糖向他们挥手。" : "OTHER_SESSION_SECRET", createdAt: now }], createdAt: now, updatedAt: now })) };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ firstKey, state }) => { if (!localStorage.getItem(firstKey)) localStorage.setItem(firstKey, JSON.stringify(state)); }, { firstKey, state: { ...emptyPocketState(), contacts: [legacy] } });
  await page.route("**/api/chat/completions", async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    const currentMode = mode;
    if (currentMode === "slow") await new Promise(resolve => { releaseSlow = resolve; });
    const output = currentMode === "bad" ? "没有有效JSON" : JSON.stringify({ characters: currentMode === "card" ? [role("季北", "冷静的画家，喜欢蓝莓。"), role("白露", "温柔的花店老板，喜欢向日葵。")] : [role("奶糖"), role("小月"), role("阿禾", "花店店员，开朗，认识林霖。"), role("林霖", "画家，内向，认识阿禾。"), role(" 林霖 ")] });
    try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content: output } }] }) }); } catch { /* A canceled request may no longer have a route. */ }
  });
  const phone = page.locator(".pocket-panel");
  const dialog = () => phone.getByRole("dialog");
  const readPhone = key => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const readLibrary = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), POCKET_FRIEND_LIBRARY_KEY);
  async function enter() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    const maximize = page.getByRole("button", { name: "最大化窗口", exact: true }); if (await maximize.isVisible()) await maximize.click();
    await page.getByRole("button", { name: "展开右侧栏", exact: true }).click();
    await page.getByRole("button", { name: /手机.*可爱手机/ }).click();
  }
  async function openAdd() {
    if (await phone.getByRole("button", { name: "返回微信列表", exact: true }).isVisible()) await phone.getByRole("button", { name: "返回微信列表", exact: true }).click();
    await phone.getByRole("button", { name: "添加联系人", exact: true }).click();
  }
  async function recognize() { await dialog().getByRole("button", { name: "识别并生成人设", exact: true }).click(); }
  await page.goto(server.url); await enter();
  await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await openAdd();
  assert.equal(await dialog().getByLabel("从已有角色导入").locator('option[value^="card:"]').count(), 0);
  assert.deepEqual((await readLibrary()).characters.map(person => person.name), ["奶糖"]);
  await dialog().getByRole("button", { name: "上下文识别", exact: true }).click(); await recognize();
  await dialog().getByRole("checkbox", { name: "添加林霖", exact: true }).waitFor();
  assert.equal(await dialog().getByRole("checkbox").count(), 2);
  assert.equal(await dialog().getByRole("button", { name: "添加所选朋友（0）", exact: true }).isDisabled(), true);
  const contextRequest = JSON.stringify(requests.at(-1).request.messages);
  assert.match(contextRequest, /林霖和阿禾一起走进花店/); assert.match(contextRequest, /阿禾在花店工作/);
  assert.doesNotMatch(contextRequest, /OTHER_SESSION_SECRET|DISABLED_CONTEXT_ROLE|INACTIVE_BOOK_ROLE|DISABLED_CARD_ROLE/);
  await dialog().getByRole("checkbox", { name: "添加林霖", exact: true }).check();
  await phone.screenshot({ path: ".runtime/pocket-friends-context.png", animations: "disabled" });
  await dialog().getByRole("button", { name: "添加所选朋友（1）", exact: true }).click();
  assert.deepEqual((await readPhone(firstKey)).contacts.map(person => person.name), ["奶糖", "林霖"]);
  await openAdd(); await dialog().getByRole("button", { name: "上下文识别", exact: true }).click(); await recognize();
  await dialog().getByRole("checkbox", { name: "添加阿禾", exact: true }).waitFor();
  assert.equal(await dialog().getByRole("checkbox").count(), 1);
  assert.match(requests.at(-1).request.messages[0].content, /林霖/);
  await dialog().getByRole("button", { name: "全选", exact: true }).click();
  await dialog().getByRole("button", { name: "添加所选朋友（1）", exact: true }).click();
  assert.equal((await readPhone(firstKey)).contacts.length, 3);
  console.log("PASS: context recognition, player/duplicate exclusion and arbitrary candidate selection");

  await openAdd(); await dialog().getByRole("button", { name: "角色卡识别", exact: true }).click();
  await dialog().getByLabel("选择角色卡", { exact: true }).selectOption("cast-card"); mode = "card"; await recognize();
  await dialog().getByRole("checkbox", { name: "添加季北", exact: true }).waitFor();
  const cardRequest = JSON.stringify(requests.at(-1).request.messages);
  assert.match(cardRequest, /季北喜欢蓝莓/); assert.match(cardRequest, /白露向季北递来/); assert.match(cardRequest, /季北推开画室/);
  assert.doesNotMatch(cardRequest, /林霖和阿禾一起走进花店|OTHER_SESSION_SECRET|DISABLED_CARD_ROLE/);
  await dialog().getByRole("checkbox", { name: "添加季北", exact: true }).check();
  await dialog().getByRole("button", { name: "添加所选朋友（1）", exact: true }).click();
  assert.equal((await readPhone(firstKey)).contacts.find(person => person.name === "季北").sourceCharacterCardId, "cast-card");
  assert.equal((await readPhone(firstKey)).contacts.some(person => person.name === "白露"), false);
  assert.deepEqual(new Set((await readLibrary()).characters.map(person => person.name)), new Set(["奶糖", "林霖", "阿禾", "季北"]));
  console.log("PASS: selected card recognition reads enabled book plus greetings and saves only added characters");

  await openAdd(); await dialog().getByRole("button", { name: "上下文识别", exact: true }).click();
  const beforeFailure = await readPhone(firstKey); mode = "bad"; await recognize();
  await dialog().getByRole("alert").waitFor(); assert.deepEqual(await readPhone(firstKey), beforeFailure);
  mode = "slow"; await recognize();
  await page.waitForFunction(() => document.querySelector(".pocket-friend-tools .pocket-primary")?.textContent.includes("正在识别"));
  await dialog().getByRole("button", { name: "关闭联系人编辑", exact: true }).click();
  await openAdd(); releaseSlow(); mode = "context";
  await dialog().getByRole("button", { name: "角色库", exact: true }).click();
  assert.equal(await dialog().getByRole("checkbox").count(), 4);
  assert.deepEqual(await readPhone(firstKey), beforeFailure);
  await dialog().getByRole("button", { name: "关闭联系人编辑", exact: true }).click();
  console.log("PASS: malformed and canceled recognition never modifies contacts");

  await page.locator(".chat-session-item").filter({ hasText: "朋友识别会话二" }).click();
  await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await openAdd();
  await dialog().getByRole("button", { name: "角色库", exact: true }).click();
  for (const name of ["奶糖", "季北"]) await dialog().getByRole("checkbox", { name: `添加${name}`, exact: true }).check();
  await dialog().getByRole("button", { name: "添加所选朋友（2）", exact: true }).click();
  const imported = await readPhone(secondKey); const source = await readPhone(firstKey);
  assert.deepEqual(imported.contacts.map(person => person.name), ["奶糖", "季北"]);
  for (const contact of imported.contacts) {
    assert.notEqual(contact.id, source.contacts.find(person => person.name === contact.name).id);
    assert.equal(contact.messages.length, 1); assert.doesNotMatch(JSON.stringify(contact), /原会话的私聊不会导入/);
  }
  await openAdd();
  const libraryValue = await dialog().getByLabel("从已有角色导入").locator("option").filter({ hasText: "阿禾" }).getAttribute("value");
  await dialog().getByLabel("从已有角色导入").selectOption(libraryValue);
  await dialog().getByRole("button", { name: "添加到通讯录", exact: true }).click();
  assert.equal((await readPhone(secondKey)).contacts.length, 3);
  await openAdd(); await dialog().getByRole("button", { name: "角色库", exact: true }).click();
  assert.equal(await dialog().getByRole("checkbox", { name: "添加奶糖", exact: true }).isDisabled(), true);
  await phone.screenshot({ path: ".runtime/pocket-friends-library.png", animations: "disabled" });
  await dialog().getByRole("button", { name: "从角色库删除季北", exact: true }).click();
  await phone.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click();
  assert.equal((await readLibrary()).characters.some(person => person.name === "季北"), false);
  assert.ok((await readPhone(firstKey)).contacts.some(person => person.name === "季北"));
  assert.ok((await readPhone(secondKey)).contacts.some(person => person.name === "季北"));
  await page.reload(); await enter(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await openAdd();
  await dialog().getByRole("button", { name: "角色库", exact: true }).click();
  assert.equal(await dialog().getByRole("checkbox", { name: "添加季北", exact: true }).count(), 0);
  assert.equal(await dialog().evaluate(node => node.scrollWidth <= node.clientWidth), true);
  assert.deepEqual(errors, []);
  console.log("PASS: cross-session bulk/single import, fresh chat identities and deletion persists without deleting contacts");
} catch (error) {
  if (page) await page.screenshot({ path: ".runtime/pocket-friends-failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  releaseSlow?.(); await browser?.close(); server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-friends-browser-"))); await rm(root, { recursive: true, force: true });
}
