import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { emptyPocketState, makePocketContact } from "../src/pocketPhoneState.ts";
import { fixtureWechatTurn } from "./pocketPhoneInnerFixture.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-pocket-moments-"));
const key = "renge_pocket_phone_v1:moments-fixture";
const requests = []; const mainRequests = []; const errors = [];
let server; let browser; let page; let mode = "valid"; let releaseSlow;
const photo = "public/touxiang/1.png";
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "测试", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture", models: ["fixture"], updatedAt: now };
  const owner = makePocketContact({ name: "奶糖", avatar: "/touxiang/9.png", personality: "{{char}}是{{user}}的朋友，温柔，在花店工作", greeting: "", sourceLabel: "角色卡", sourceCharacterCardId: "owner-card" });
  const other = makePocketContact({ name: "薄荷", avatar: "/touxiang/10.png", personality: "喜欢园艺", greeting: "", sourceLabel: "自定义角色" });
  const npc = makePocketContact({ name: "阿禾", avatar: "/touxiang/3.png", personality: "奶糖的同事，负责花束", greeting: "", sourceLabel: "自定义角色" });
  owner.messages = [{ id: "wechat-fact", role: "assistant", content: "微信事实：整理窗边的花束", createdAt: now }];
  const state = { ...emptyPocketState(), contacts: [owner, other], characterPhones: { [owner.id]: { contacts: [npc], groups: [], wallet: { balance: 0, bills: [] }, notes: [{ id: "note-fact", title: "便签事实", body: "窗边的白花要换水", createdAt: now, wechatTime: "2031-02-28T15:45:00Z" }] } } };
  const seed = { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], userProfile: { nickname: "小月", bio: "用户喜欢画画", avatarImage: "/touxiang/20.png" },
    characterCards: [{ id: "owner-card", name: "奶糖", description: "奶糖在花店工作", personality: "温柔", firstMessage: "", characterBook: { id: "owner-book", name: "花店", entries: [{ content: "手机主人绑定世界书：花店在北街", constant: true }] }, createdAt: now, updatedAt: now }],
    worldBooks: [{ id: "active-book", name: "世界", entries: [{ content: "当前世界书：阿禾负责花束", constant: true }] }], activeWorldBookIds: ["active-book"],
    chatSessions: [{ id: "moments-fixture", title: "朋友圈测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: "main-fact", role: "user", content: "主会话事实：明天花店轮班", createdAt: now }], createdAt: now, updatedAt: now }] };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, timezoneId: "Asia/Shanghai" }); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); }, { key, state });
  await page.route("**/api/chat/completions", async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    const prompt = body.request.messages.at(-1).content;
    let output;
    if (prompt.includes("朋友圈互动生成任务")) output = prompt.includes("只让帖主回复")
      ? JSON.stringify({ likes: [], comments: [{ authorId: owner.id, text: "下次带你来花店", replyToId: "pocket:real-user" }] })
      : JSON.stringify({ likes: [owner.id, other.id], comments: [{ authorId: owner.id, text: "窗边的花真好看" }] });
    else if (prompt.includes("朋友圈动态生成任务")) output = mode === "invalid" ? JSON.stringify({ moments: [{ authorId: owner.id, text: "不完整的数据", pic: "", likes: [], comments: [] }, { authorId: "unknown", text: "错误人物", pic: "", likes: [], comments: [] }] })
      : prompt.includes("主人自己的动态") ? JSON.stringify({ moments: [{ authorId: owner.id, text: "奶糖私密心事", pic: "", location: "", visibility: "private", likes: [], comments: [] }] })
      : JSON.stringify({ moments: [{ authorId: owner.id, text: "奶糖的花店近况", pic: "一束白花放在窗边", location: "北街花店", visibility: "public", likes: [other.id], comments: [{ authorId: other.id, text: "白花好漂亮" }] }, { authorId: other.id, text: "薄荷的园艺日常", pic: "", location: "", visibility: "public", likes: [], comments: [] }] });
    else if (prompt.includes("便签生成任务")) output = JSON.stringify({ notes: [{ title: "参考朋友圈的便签", body: "记下朋友的花店近况" }] });
    else output = fixtureWechatTurn("微信参考朋友圈后的回复", requests.length);
    if (mode === "slow") { await new Promise(resolve => { releaseSlow = resolve; }); output = JSON.stringify({ moments: [{ authorId: owner.id, text: "取消后不应保存", pic: "", visibility: "public", likes: [], comments: [] }] }); }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content: output } }] }) }).catch(() => {});
  });
  await page.route("**/api/pi/chat", async route => {
    mainRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "已参考朋友圈内容。" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`, "data: [DONE]", "",
    ].join("\n\n") });
  });
  const phone = page.locator(".pocket-panel");
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const post = text => phone.locator(".pocket-moment-post").filter({ has: page.locator(".pocket-moment-text", { hasText: text }) });
  async function enterApp() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click(); await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    const maximize = page.getByRole("button", { name: "最大化窗口", exact: true }); if (await maximize.isVisible()) await maximize.click();
    await page.getByRole("button", { name: "展开右侧栏", exact: true }).click(); await page.getByRole("button", { name: /手机.*可爱手机/ }).click();
  }
  async function openMoments() { await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.getByRole("button", { name: "发现", exact: true }).click(); await phone.getByRole("button", { name: "朋友圈", exact: true }).click(); }
  async function openOwner(name = "奶糖") { await phone.getByRole("button", { name: "打开ta的手机", exact: true }).click(); await phone.getByRole("button", { name: `查看${name}的手机`, exact: true }).click(); }
  async function home() { await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click(); }
  async function ownHome() { await home(); await phone.getByRole("button", { name: "选择其他角色", exact: true }).click(); await phone.getByRole("button", { name: "返回手机桌面", exact: true }).click(); }
  async function publish(text, visibility = "public", image = false) {
    await phone.getByRole("button", { name: "发表朋友圈", exact: true }).click();
    await phone.getByLabel("朋友圈正文", { exact: true }).fill(text);
    await phone.getByLabel("朋友圈可见范围", { exact: true }).selectOption(visibility);
    if (visibility === "part") await phone.getByLabel("奶糖", { exact: true }).check();
    if (image) {
      await phone.getByLabel("朋友圈配图描述", { exact: true }).fill("窗边的花束"); await phone.getByLabel("朋友圈位置", { exact: true }).fill("北街花店");
      await phone.getByLabel("选择朋友圈图片", { exact: true }).setInputFiles(photo); await phone.getByAltText("待发布图片1", { exact: true }).waitFor();
      await phone.getByRole("button", { name: "发表", exact: true }).click();
    } else await phone.getByRole("button", { name: "发表", exact: true }).click();
    await post(text).waitFor();
  }
  async function operation(text, action) { const menu = post(text).getByRole("button", { name: "朋友圈操作", exact: true }); if (await menu.getAttribute("aria-expanded") !== "true") await menu.click(); await post(text).getByRole("button", { name: action, exact: true }).click(); }
  async function comment(text, content) { await operation(text, "评论"); await post(text).getByLabel("朋友圈评论", { exact: true }).fill(content); await post(text).getByRole("button", { name: "发送评论", exact: true }).click(); }
  async function mainMenu(text) {
    const button = page.locator(".chat-message").filter({ hasText: text }).first().locator(".chat-message-more");
    await button.scrollIntoViewIfNeeded(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await button.click();
  }
  await page.goto(server.url); await enterApp(); await openMoments();
  assert.equal(requests.length, 0); await phone.getByText("还没有朋友圈动态", { exact: true }).waitFor();
  await publish("公开花束照片", "public", true); await publish("用户私密日记", "private"); await publish("只给奶糖看的动态", "part");
  let saved = await read(); assert.equal(saved.moments.length, 3); assert.equal(saved.moments[0].images.length, 1); assert.equal(saved.moments[0].location, "北街花店");
  await post("公开花束照片").getByRole("button", { name: "查看朋友圈图片1", exact: true }).click(); await phone.getByRole("dialog", { name: "朋友圈图片", exact: true }).waitFor(); await page.keyboard.press("Escape");
  await phone.getByLabel("选择朋友圈封面", { exact: true }).setInputFiles(photo); await page.waitForFunction(key => !!JSON.parse(localStorage.getItem(key)).momentCovers?.["pocket:real-user"], key);
  await phone.getByRole("button", { name: "生成好友朋友圈", exact: true }).click(); await post("奶糖的花店近况").waitFor();
  const feedRequest = JSON.stringify(requests.at(-1).request.messages);
  for (const content of ["主会话事实：明天花店轮班", "微信事实：整理窗边的花束", "便签事实", "窗边的白花要换水", "当前世界书", "手机主人绑定世界书", "用户喜欢画画", "奶糖是小月的朋友", "朋友圈背景资料", "公开花束照片"]) assert.ok(feedRequest.includes(content), content);
  assert.doesNotMatch(feedRequest, /用户私密日记|只给奶糖看的动态/); assert.doesNotMatch(requests.at(-1).request.messages[0].content, /微信回复规则|9 项激素/);
  assert.equal((await read()).moments.length, 5);
  await operation("奶糖的花店近况", "赞"); await post("奶糖的花店近况").getByRole("button", { name: "取消赞", exact: true }).click();
  assert.equal((await read()).moments.find(item => item.text === "奶糖的花店近况").likes.length, 1);
  await comment("奶糖的花店近况", "想来看看这束花"); await operation("奶糖的花店近况", "让帖主回复");
  await post("奶糖的花店近况").getByText(/下次带你来花店/).waitFor();
  saved = await read(); assert.equal(saved.moments.find(item => item.text === "奶糖的花店近况").comments.at(-1).replyTo.id, "pocket:real-user");
  await operation("公开花束照片", "好友互动"); await post("公开花束照片").getByText(/窗边的花真好看/).waitFor();
  await post("公开花束照片").getByRole("button", { name: "回复奶糖的评论", exact: true }).click(); await post("公开花束照片").getByLabel("朋友圈评论", { exact: true }).fill("谢谢你"); await post("公开花束照片").getByRole("button", { name: "发送评论", exact: true }).click();
  await phone.screenshot({ path: ".runtime/pocket-moments-feed.png", animations: "disabled" });
  assert.equal(await phone.locator(".pocket-moments").evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await operation("用户私密日记", "编辑"); await phone.getByLabel("朋友圈正文", { exact: true }).fill("用户私密日记修改"); await phone.getByRole("button", { name: "发表", exact: true }).click();
  assert.equal((await read()).moments[1].id, saved.moments[1].id);
  await phone.getByRole("button", { name: "我的动态", exact: true }).click(); assert.equal(await phone.locator(".pocket-moment-post").count(), 3); await phone.getByRole("button", { name: "全部", exact: true }).click();
  await phone.getByRole("button", { name: "返回微信", exact: true }).click(); await phone.getByRole("button", { name: "我", exact: true }).click(); await phone.getByRole("button", { name: "朋友圈", exact: true }).click();
  assert.equal(await phone.locator(".pocket-moment-post").count(), 5);
  await page.getByPlaceholder("输入消息，可粘贴图片", { exact: true }).fill("参考朋友圈的近况"); await page.getByRole("button", { name: "发送", exact: true }).click(); await page.locator(".chat-message.assistant").filter({ hasText: "已参考朋友圈内容。" }).waitFor();
  const mainContext = JSON.stringify(mainRequests[0].request.messages); assert.match(mainContext, /【朋友圈 · 小月/); assert.match(mainContext, /【朋友圈 · 奶糖/); assert.match(mainContext, /公开花束照片/); assert.match(mainContext, /下次带你来花店/);
  await home(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.getByRole("button", { name: "微信", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: "薄荷" }).click();
  await phone.getByRole("button", { name: "发送消息", exact: true }).click(); await phone.getByText("微信参考朋友圈后的回复", { exact: true }).waitFor();
  let wechatContext = JSON.stringify(requests.at(-1).request.messages); assert.match(wechatContext, /朋友圈背景资料.*公开花束照片/); assert.doesNotMatch(wechatContext, /用户私密日记|只给奶糖看的动态/);
  await home(); await openOwner(); await openMoments();
  assert.equal(await post("用户私密日记修改").count(), 0); assert.equal(await post("只给奶糖看的动态").count(), 1); assert.equal(await post("公开花束照片").count(), 1);
  await operation("公开花束照片", "取消赞"); await post("公开花束照片").getByRole("button", { name: "赞", exact: true }).click(); await comment("只给奶糖看的动态", "只给你的回复");
  await phone.getByRole("button", { name: "生成 ta 的动态", exact: true }).click(); await post("奶糖私密心事").waitFor();
  let selfContext = JSON.stringify(requests.at(-1).request.messages); assert.match(selfContext, /只给奶糖看的动态/); assert.doesNotMatch(selfContext, /用户私密日记/);
  await phone.screenshot({ path: ".runtime/pocket-moments-owner.png", animations: "disabled" });
  await home(); await phone.getByRole("button", { name: "打开便签", exact: true }).click(); await phone.getByRole("button", { name: "生成便签", exact: true }).click(); await phone.locator(".pocket-note-row").filter({ hasText: "参考朋友圈的便签" }).waitFor();
  const notesContext = JSON.stringify(requests.at(-1).request.messages); assert.match(notesContext, /朋友圈背景资料.*奶糖私密心事/); assert.match(notesContext, /只给奶糖看的动态/); assert.doesNotMatch(notesContext, /用户私密日记/);
  await ownHome(); await openMoments(); assert.equal(await post("奶糖私密心事").count(), 0); assert.equal(await post("只给奶糖看的动态").getByText(/只给你的回复/).count(), 1);
  const photoPostId = (await read()).moments[0].id;
  await mainMenu("公开花束照片"); await page.locator(".chat-message-menu").getByRole("button", { name: "编辑", exact: true }).click(); await page.locator(".chat-inline-editor textarea").fill("主会话修改的花束动态"); await page.locator(".chat-inline-editor-actions").getByRole("button", { name: "保存", exact: true }).click();
  await post("主会话修改的花束动态").waitFor(); assert.equal((await read()).moments[0].id, photoPostId); assert.equal((await read()).moments[0].images.length, 1);
  await mainMenu("主会话修改的花束动态"); await page.locator(".chat-message-menu").getByRole("button", { name: "删除", exact: true }).click(); await post("主会话修改的花束动态").waitFor({ state: "detached" });
  assert.equal((await read()).moments.some(item => item.id === photoPostId), false); assert.equal(await page.locator(".chat-message").filter({ hasText: "窗边的花真好看" }).count(), 0);
  mode = "invalid"; const beforeInvalid = (await read()).moments; await phone.getByRole("button", { name: "生成好友朋友圈", exact: true }).click(); await phone.getByRole("alert").filter({ hasText: "名单外" }).waitFor(); assert.deepEqual((await read()).moments, beforeInvalid);
  mode = "slow"; await phone.getByRole("button", { name: "生成好友朋友圈", exact: true }).click(); await phone.getByRole("button", { name: "停止朋友圈生成", exact: true }).waitFor(); await home();
  await openOwner("薄荷"); await openMoments(); releaseSlow?.(); await page.waitForTimeout(200); mode = "valid";
  assert.equal((await read()).moments.some(item => item.text === "取消后不应保存"), false); assert.equal(await post("只给奶糖看的动态").count(), 0); assert.equal(await post("奶糖私密心事").count(), 0);
  await ownHome(); await openMoments(); await operation("用户私密日记修改", "删除"); await phone.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click(); await post("用户私密日记修改").waitFor({ state: "detached" });
  await page.reload(); await enterApp(); await openMoments();
  assert.equal(await post("主会话修改的花束动态").count(), 0); assert.equal(await post("用户私密日记修改").count(), 0); assert.equal(await post("只给奶糖看的动态").count(), 1);
  assert.ok((await read()).momentCovers["pocket:real-user"]); assert.equal(await page.locator(".chat-message").filter({ hasText: "窗边的花真好看" }).count(), 0);
  await phone.getByRole("button", { name: "清空当前朋友圈", exact: true }).click(); await phone.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click(); await phone.getByText("还没有朋友圈动态", { exact: true }).waitFor();
  assert.deepEqual((await read()).moments.map(item => item.text), ["奶糖私密心事"]);
  assert.deepEqual(errors, []);
  console.log("PASS: discover/profile entries, publishing/photos/cover/privacy, cross-phone feed/likes/comments/replies, generation/shared context/worldbooks, WeChat and notes visibility, main references and edits/deletion cascade, reload, atomic validation, cancellation and no runtime errors");
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: ".runtime/pocket-moments-failure.png" });
  throw error;
} finally {
  releaseSlow?.(); await browser?.close(); server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-pocket-moments-")));
  await rm(root, { recursive: true, force: true });
}
