import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { emptyPocketState, makePocketContact } from "../src/pocketPhoneState.ts";
import { fixtureWechatTurn } from "./pocketPhoneInnerFixture.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-pocket-notes-"));
const key = "renge_pocket_phone_v1:notes-fixture";
const requests = []; const mainRequests = []; const errors = [];
let server; let browser; let page; let mode = "valid"; let releaseSlow;
const generated = [{ title: "花店待办", body: "明天上午9点换水\n整理窗边的花束" }, { title: "周末灵感", body: "试试淡蓝和白色的搭配\n先留给自己看看" }];
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "测试", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture", models: ["fixture"], updatedAt: now };
  const owner = makePocketContact({ name: "奶糖", avatar: "/touxiang/9.png", personality: "{{char}}是{{user}}的朋友，温柔，在花店工作", greeting: "", sourceLabel: "角色卡", sourceCharacterCardId: "owner-card" });
  const other = makePocketContact({ name: "薄荷", avatar: "/touxiang/10.png", personality: "喜欢园艺", greeting: "", sourceLabel: "自定义角色" });
  owner.messages = [{ id: "wechat-record", role: "assistant", content: "微信事实：记得整理花束", createdAt: now }];
  const seed = { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], userProfile: { nickname: "小月", bio: "用户喜欢画画", avatarImage: "/touxiang/20.png" },
    characterCards: [{ id: "owner-card", name: "奶糖", description: "奶糖在花店工作", personality: "温柔", firstMessage: "", characterBook: { id: "owner-book", name: "花店", entries: [{ content: "手机主人绑定世界书：花店在北街", constant: true }] }, createdAt: now, updatedAt: now }],
    worldBooks: [{ id: "active-book", name: "世界", entries: [{ content: "当前世界书：同事阿禾负责花束", constant: true }] }], activeWorldBookIds: ["active-book"],
    chatSessions: [{ id: "notes-fixture", title: "便签测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [
      { id: "main-fact", role: "user", content: "主会话事实：明天花店轮班", createdAt: now },
      { id: "red-fact", role: "assistant", source: "xiaohongshu", content: "小红书事实：分享花束配色", createdAt: now, extra: { pocketPhone: { contactId: "red-ref", messageId: "red-fact", contactName: "奶糖", userName: "小月", contactAvatar: owner.avatar } } },
    ], createdAt: now, updatedAt: now }] };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, timezoneId: "Asia/Shanghai" }); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); }, { key, state: { ...emptyPocketState(), contacts: [owner, other] } });
  await page.route("**/api/chat/completions", async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    const prompt = body.request.messages.at(-1).content;
    let output = prompt.includes("便签生成任务") ? mode === "invalid" ? JSON.stringify({ notes: [{ title: "无效数据", body: 123 }] }) : JSON.stringify({ notes: generated }) : fixtureWechatTurn("微信参考便签后的回复");
    if (mode === "slow") { await new Promise(resolve => { releaseSlow = resolve; }); output = JSON.stringify({ notes: [{ title: "取消后不应保存", body: "迟到的便签" }] }); }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content: output } }] }) }).catch(() => {});
  });
  await page.route("**/api/pi/chat", async route => {
    mainRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "已参考便签内容。" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`, "data: [DONE]", "",
    ].join("\n\n") });
  });
  const phone = page.locator(".pocket-panel");
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  async function enterApp() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click(); await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    const maximize = page.getByRole("button", { name: "最大化窗口", exact: true }); if (await maximize.isVisible()) await maximize.click();
    await page.getByRole("button", { name: "展开右侧栏", exact: true }).click(); await page.getByRole("button", { name: /手机.*可爱手机/ }).click();
  }
  async function openOwner(name = "奶糖") {
    await phone.getByRole("button", { name: "打开ta的手机", exact: true }).click(); await phone.getByRole("button", { name: `查看${name}的手机`, exact: true }).click();
    await phone.getByRole("button", { name: "打开便签", exact: true }).click();
  }
  async function ownerHome() { await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click(); }
  async function ownHome() { await ownerHome(); await phone.getByRole("button", { name: "选择其他角色", exact: true }).click(); await phone.getByRole("button", { name: "返回手机桌面", exact: true }).click(); }
  async function mainMenu(text) {
    const button = page.locator(".chat-message").filter({ hasText: text }).first().locator(".chat-message-more");
    await button.scrollIntoViewIfNeeded(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await button.click();
  }
  await page.goto(server.url); await enterApp();
  assert.equal(await phone.getByRole("button", { name: "打开便签", exact: true }).count(), 0);
  await openOwner(); assert.equal(requests.length, 0); await phone.getByText("还没有便签", { exact: true }).waitFor();
  const initialWechat = (await read()).contacts[0].messages;
  await phone.getByRole("button", { name: "新建便签", exact: true }).click();
  await phone.getByLabel("便签标题", { exact: true }).fill("手写清单"); await phone.getByLabel("便签正文", { exact: true }).fill("浇花\n检查花瓶");
  await phone.getByRole("button", { name: "保存便签", exact: true }).click(); await phone.locator(".pocket-note-row").filter({ hasText: "手写清单" }).waitFor();
  assert.equal((await read()).characterPhones[owner.id].notes.length, 1);
  await phone.getByRole("button", { name: "生成便签", exact: true }).click(); await phone.locator(".pocket-note-row").filter({ hasText: "周末灵感" }).waitFor();
  const request = JSON.stringify(requests[0].request.messages);
  for (const text of ["主会话事实：明天花店轮班", "微信事实：记得整理花束", "小红书事实：分享花束配色", "当前世界书", "手机主人绑定世界书", "用户喜欢画画", "奶糖是小月的朋友", "便签背景资料", "手写清单"]) assert.ok(request.includes(text), text);
  assert.doesNotMatch(requests[0].request.messages[0].content, /微信回复规则|9 项激素/);
  let saved = await read(); assert.equal(saved.characterPhones[owner.id].notes.length, 3); assert.deepEqual(saved.contacts[0].messages, initialWechat);
  await phone.screenshot({ path: ".runtime/pocket-notes-list.png", animations: "disabled" });
  assert.equal(await phone.locator(".pocket-notes").evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await phone.getByLabel("搜索便签", { exact: true }).fill("淡蓝"); assert.equal(await phone.locator(".pocket-note-row").count(), 1);
  await phone.locator(".pocket-note-row").click(); assert.equal(await phone.locator(".pocket-note-detail p").innerText(), generated[1].body);
  await phone.screenshot({ path: ".runtime/pocket-notes-detail.png", animations: "disabled" });
  const editedId = saved.characterPhones[owner.id].notes[2].id;
  await phone.getByRole("button", { name: "编辑便签", exact: true }).click(); await phone.getByLabel("便签标题", { exact: true }).fill("新的灵感"); await phone.getByLabel("便签正文", { exact: true }).fill("修改后的便签\n第二行");
  await phone.getByRole("button", { name: "保存便签", exact: true }).click(); await phone.locator(".pocket-note-detail").getByText("新的灵感", { exact: true }).waitFor();
  assert.equal((await read()).characterPhones[owner.id].notes[2].id, editedId);
  await page.getByPlaceholder("输入消息，可粘贴图片", { exact: true }).fill("请参考 ta 的便签"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".chat-message.assistant").filter({ hasText: "已参考便签内容。" }).waitFor();
  const mainContext = JSON.stringify(mainRequests[0].request.messages); assert.match(mainContext, /【便签 · 奶糖/); assert.match(mainContext, /修改后的便签/);
  assert.equal(await page.locator(".chat-message").filter({ hasText: "新的灵感" }).count(), 1);
  await ownerHome(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: "小月" }).click();
  await phone.getByRole("button", { name: "发送消息", exact: true }).click(); await phone.getByText("微信参考便签后的回复", { exact: true }).waitFor();
  assert.match(JSON.stringify(requests.at(-1).request.messages), /便签背景资料.*修改后的便签/);
  await ownerHome(); await phone.getByRole("button", { name: "打开便签", exact: true }).click();
  mode = "invalid"; await phone.getByRole("button", { name: "生成便签", exact: true }).click(); await phone.getByRole("alert").filter({ hasText: "便签内容格式有误" }).waitFor();
  assert.equal((await read()).characterPhones[owner.id].notes.length, 3); mode = "valid";
  await ownHome(); await openOwner("薄荷"); await phone.getByText("还没有便签", { exact: true }).waitFor();
  await page.reload(); await enterApp(); await openOwner(); assert.equal(await phone.locator(".pocket-note-row").count(), 3);
  await phone.locator(".pocket-note-row").filter({ hasText: "新的灵感" }).click();
  await mainMenu("修改后的便签"); await page.locator(".chat-message-menu").getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".chat-inline-editor textarea").fill("主会话修改标题\n从主会话同步回来的正文"); await page.locator(".chat-inline-editor-actions").getByRole("button", { name: "保存", exact: true }).click();
  await phone.locator(".pocket-note-detail h2").getByText("主会话修改标题", { exact: true }).waitFor();
  assert.equal((await read()).characterPhones[owner.id].notes[2].body, "从主会话同步回来的正文");
  await mainMenu("从主会话同步回来的正文"); await page.locator(".chat-message-menu").getByRole("button", { name: "删除", exact: true }).click();
  await phone.locator(".pocket-notes-list").waitFor(); assert.equal((await read()).characterPhones[owner.id].notes.length, 2);
  await phone.locator(".pocket-note-row").filter({ hasText: "手写清单" }).click(); await phone.getByRole("button", { name: "删除便签", exact: true }).click();
  await phone.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click(); await phone.locator(".pocket-notes-list").waitFor();
  assert.equal((await read()).characterPhones[owner.id].notes.length, 1); assert.equal(await page.locator(".chat-message").filter({ hasText: "手写清单" }).count(), 0);
  mode = "slow"; await phone.getByRole("button", { name: "生成便签", exact: true }).click(); await phone.getByRole("button", { name: "停止生成便签", exact: true }).waitFor();
  await ownHome(); await openOwner("薄荷"); releaseSlow?.(); await page.waitForTimeout(200);
  saved = await read(); assert.equal(saved.characterPhones[owner.id].notes.length, 1); assert.equal(saved.characterPhones[other.id]?.notes?.length || 0, 0);
  assert.equal(saved.characterPhones[owner.id].notes.some(note => note.title === "取消后不应保存"), false);
  await page.reload(); await enterApp(); await openOwner(); assert.equal(await phone.locator(".pocket-note-row").count(), 1);
  assert.equal(await page.locator(".chat-message").filter({ hasText: "从主会话同步回来的正文" }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: notes generation, shared context/worldbooks, main and WeChat references, search/detail/CRUD, owner isolation, reload, bidirectional edits/deletes, cancellation, no runtime errors");
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: ".runtime/pocket-notes-failure.png" });
  throw error;
} finally {
  releaseSlow?.(); await browser?.close(); server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  const resolvedTemp = join(tmpdir(), "renge-pocket-notes-"); assert.ok(root.startsWith(resolvedTemp));
  await rm(root, { recursive: true, force: true });
}
