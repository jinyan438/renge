import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { emptyPocketState, makePocketContact } from "../src/pocketPhoneState.ts";
import { fixtureWechatTurn } from "./pocketPhoneInnerFixture.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-character-phone-"));
let server; let browser; let page;
const errors = []; const requests = [];
const key = "renge_pocket_phone_v1:character-phone-fixture";
let reply = "同事收到角色的微信"; let slowResolve;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "测试", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture", models: ["fixture"], updatedAt: now };
  const seed = { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider],
    userProfile: { nickname: "小月", bio: "用户喜欢画画", avatarImage: "/touxiang/20.png" },
    characterCards: [{ id: "owner-card", name: "奶糖", description: "奶糖在花店工作", personality: "温柔", firstMessage: "", characterBook: { id: "owner-book", name: "花店", entries: [{ content: "手机主人绑定世界书：花店在北街", constant: true }] }, createdAt: now, updatedAt: now }],
    worldBooks: [{ id: "active-book", name: "世界", entries: [{ content: "当前世界书：同事阿禾负责花束", constant: true }] }], activeWorldBookIds: ["active-book"],
    chatSessions: [{ id: "character-phone-fixture", title: "角色手机测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: "main-fact", role: "user", content: "主会话事实：明天花店轮班", createdAt: now }], createdAt: now, updatedAt: now }] };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  const owner = makePocketContact({ name: "奶糖", avatar: "/touxiang/9.png", personality: "{{char}}是{{user}}的朋友，温柔，在花店工作", greeting: "", sourceLabel: "角色卡", sourceCharacterCardId: "owner-card" });
  owner.messages = [{ id: "real-user", role: "user", content: "用户手机发出的消息", createdAt: now }, { id: "real-owner", role: "assistant", content: "角色已有的回复", createdAt: now }];
  owner.messages.push({ id: "multiline-user", role: "user", content: "用户手动换行第一段\n用户手动换行第二段", createdAt: now },
    { id: "multiline-owner", role: "assistant", content: "角色回复第一段\n角色回复第二段\n角色回复第三段\n角色回复第四段", createdAt: now });
  const other = makePocketContact({ name: "薄荷", avatar: "/touxiang/10.png", personality: "喜欢园艺", greeting: "", sourceLabel: "自定义角色" });
  const state = { ...emptyPocketState(), contacts: [owner, other] };
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); }, { key, state });
  await page.route("**/api/chat/completions", async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    const prompt = body.request.messages.at(-1).content;
    let output;
    if (prompt.includes("ta 的手机生成任务")) output = JSON.stringify({ contacts: [{ name: "阿禾", personality: "奶糖的花店同事，开朗，负责花束", avatarIndex: 3, messages: prompt.includes("messages必须为空数组") ? [] : [{ from: "ta", text: "明天一起值班" }, { from: "them", text: "好，我带花束" }] }, { name: "小月", personality: "禁止生成的用户", messages: [] }] });
    else output = fixtureWechatTurn(reply, requests.length);
    if (slowResolve === true) await new Promise(resolve => { slowResolve = resolve; });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content: output } }] }) }).catch(() => {});
  });
  const phone = page.locator(".pocket-panel");
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  async function openPhone() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    const maximize = page.getByRole("button", { name: "最大化窗口", exact: true }); if (await maximize.isVisible()) await maximize.click();
    await page.getByRole("button", { name: "展开右侧栏", exact: true }).click();
    await page.getByRole("button", { name: /手机.*可爱手机/ }).click();
  }
  async function openOwner(name = "奶糖") {
    await phone.getByRole("button", { name: "打开ta的手机", exact: true }).click();
    await phone.getByRole("button", { name: `查看${name}的手机`, exact: true }).click();
    await phone.getByRole("button", { name: "打开微信", exact: true }).click();
  }
  async function openContact(name) { await phone.locator(".pocket-contact-row").filter({ hasText: name }).click(); }
  async function queue(content) { await phone.locator(".pocket-composer textarea").fill(content); await phone.getByRole("button", { name: "发送消息", exact: true }).click(); }
  async function generate() { await phone.getByRole("button", { name: "发送消息", exact: true }).click(); await phone.locator(".pocket-message.assistant").filter({ hasText: reply }).last().waitFor(); }
  async function backToOwnHome() { await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click(); await phone.getByRole("button", { name: "选择其他角色", exact: true }).click(); await phone.getByRole("button", { name: "返回手机桌面", exact: true }).click(); }

  await page.goto(server.url); await openPhone(); await openOwner();
  assert.equal(requests.length, 0);
  await phone.getByRole("button", { name: "生成联系人", exact: true }).click();
  await phone.locator(".pocket-contact-row").filter({ hasText: "阿禾" }).waitFor();
  assert.equal((await read()).characterPhones[owner.id].contacts.length, 1);
  assert.equal((await read()).characterPhones[owner.id].contacts[0].messages.length, 0);
  const genRequest = JSON.stringify(requests[0].request.messages);
  assert.match(genRequest, /主会话事实：明天花店轮班/); assert.match(genRequest, /当前世界书：同事阿禾/); assert.match(genRequest, /手机主人绑定世界书/);
  await phone.getByRole("button", { name: "生成聊天记录", exact: true }).click();
  await phone.locator(".pocket-contact-row").filter({ hasText: "好，我带花束" }).waitFor();
  await openContact("阿禾");
  assert.equal(await phone.locator(".pocket-message.user").filter({ hasText: "明天一起值班" }).count(), 1);
  await queue("以奶糖身份发给同事"); await generate();
  const npcRequest = requests.at(-1).request.messages;
  assert.match(npcRequest[0].content, /扮演「阿禾」/); assert.match(npcRequest[0].content, /与「奶糖」/); assert.match(npcRequest[0].content, /奶糖是小月的朋友/);
  const npcSaved = (await read()).characterPhones[owner.id].contacts[0];
  assert.equal(npcSaved.messages.at(-1).content, reply);
  await phone.getByRole("button", { name: "返回微信列表", exact: true }).click();
  await openContact("小月");
  assert.equal(await phone.locator(".pocket-message.assistant").filter({ hasText: "用户手机发出的消息" }).count(), 1);
  assert.equal(await phone.locator(".pocket-message.user").filter({ hasText: "角色已有的回复" }).count(), 1);
  assert.equal(await phone.locator('[data-message-id="multiline-owner"] .pocket-message.user').count(), 4);
  assert.equal(await phone.locator('[data-message-id="multiline-user"] .pocket-message.assistant').count(), 1);
  assert.equal(await phone.getByRole("button", { name: "编辑联系人", exact: true }).isDisabled(), true);
  await queue("从角色手机发给用户"); reply = "用户模拟回复角色"; await generate();
  const mirrorRequest = requests.at(-1).request.messages;
  assert.match(mirrorRequest[0].content, /扮演「小月」/); assert.match(mirrorRequest[0].content, /与「奶糖」/);
  assert.equal(mirrorRequest.filter(message => message.content === "从角色手机发给用户").length, 1);
  assert.equal(mirrorRequest.find(message => message.content === "从角色手机发给用户").role, "user");
  assert.equal(mirrorRequest.find(message => message.content === "用户手机发出的消息").role, "assistant");
  let saved = await read();
  assert.equal(saved.contacts[0].messages.at(-2).role, "assistant"); assert.equal(saved.contacts[0].messages.at(-1).role, "user");
  assert.equal(saved.characterPhones[owner.id].contacts.length, 1);
  await phone.screenshot({ path: ".runtime/character-phone-sync.png", animations: "disabled" });
  await backToOwnHome(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await openContact("奶糖");
  assert.equal(await phone.locator('[data-message-id="multiline-owner"] .pocket-message.assistant').count(), 4);
  assert.equal(await phone.locator('[data-message-id="multiline-user"] .pocket-message.user').count(), 1);
  assert.equal(await phone.locator(".pocket-message.assistant").filter({ hasText: "从角色手机发给用户" }).count(), 1);
  assert.equal(await phone.locator(".pocket-message.user").filter({ hasText: "用户模拟回复角色" }).count(), 1);
  await queue("用户手机的新消息");
  await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click(); await openOwner(); await openContact("小月");
  assert.equal(await phone.locator(".pocket-message.assistant").filter({ hasText: "用户手机的新消息" }).count(), 1);
  await backToOwnHome(); await openOwner("薄荷");
  assert.equal(await phone.locator(".pocket-contact-row").filter({ hasText: "阿禾" }).count(), 0);
  await page.reload(); await openPhone(); await openOwner();
  assert.equal(await phone.locator(".pocket-contact-row").filter({ hasText: "阿禾" }).count(), 1);
  await phone.screenshot({ path: ".runtime/character-phone-list.png", animations: "disabled" });
  await openContact("小月");
  assert.equal(await phone.locator('[data-message-id="multiline-owner"] .pocket-message.user').count(), 4);
  assert.equal(await phone.locator('[data-message-id="multiline-user"] .pocket-message.assistant').count(), 1);
  await phone.getByRole("button", { name: "返回微信列表", exact: true }).click();
  await openContact("阿禾");
  assert.equal(await phone.locator(".pocket-message.assistant").filter({ hasText: "同事收到角色的微信" }).count(), 1);
  // A request from a previous owner must never write into the new phone.
  reply = "取消后不应写入"; slowResolve = true;
  await queue("准备取消的请求"); await phone.getByRole("button", { name: "发送消息", exact: true }).click();
  await phone.getByLabel("对方正在输入", { exact: true }).waitFor();
  await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click(); await phone.getByRole("button", { name: "选择其他角色", exact: true }).click();
  await phone.getByRole("button", { name: "查看薄荷的手机", exact: true }).click();
  if (typeof slowResolve === "function") slowResolve();
  await page.waitForTimeout(300);
  saved = await read();
  assert.equal(saved.characterPhones[owner.id].contacts[0].messages.some(message => message.content === reply), false);
  assert.deepEqual(errors, []);
  console.log("PASS: owner selection, contact/chat generation, context and worldbooks, NPC chat, synchronized user chat in both directions, owner isolation, reload, cancellation, no runtime errors");
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: ".runtime/character-phone-failure.png" });
  throw error;
} finally {
  if (typeof slowResolve === "function") slowResolve();
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-character-phone-")));
  await rm(root, { recursive: true, force: true });
}
