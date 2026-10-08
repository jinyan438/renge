import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { emptyPocketState, POCKET_AVATARS } from "../src/pocketPhoneState.ts";

// Isolated local app data and fixture models; never contact a user's provider.
const root = await mkdtemp(join(tmpdir(), "renge-red-browser-"));
const requests = [], mainRequests = [];
let mode = "success", round = 0, replies = 0, releaseSlow;
let server, browser, page;
const text = message => typeof message.content === "string" ? message.content : (message.content || []).map(part => part.text || "").join("");
const upstream = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ path: request.url, body });
  if (mode === "fail") { mode = "success"; response.writeHead(503, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "fixture temporarily unavailable" } })); return; }
  if (mode === "slow") { mode = "success"; await new Promise(resolve => { releaseSlow = resolve; }); }
  const prompt = (body.messages || body.input).map(text).join("\n");
  const allowed = JSON.parse(prompt.match(/已勾选的生成角色及最新设定：(\[[^\n]*\])/)[1]);
  const author = name => { const role = allowed.find(role => role.name === name) || allowed[0]; return { authorId: role.id, author: role.name }; };
  let output;
  if (mode === "bad") { mode = "success"; output = '{"notes":[{"author":"奶糖","title":"不应部分保存","content":"有效"},{"title":"无效"}]}'; }
  else if (mode === "unselected") { mode = "success"; output = JSON.stringify({ notes: [{ authorId: "contact:friend", author: "奶糖", title: "未勾选角色的帖子", content: "不能保存" }] }); }
  else if (prompt.includes("本次任务：增量生成")) {
    round++;
    output = JSON.stringify({ notes: [
      { ...author("奶糖"), title: `北街画画日常 ${round}`, content: `第${round}次去北街的草莓花园画画，记得带上水彩和画本。`, tags: ["草莓", "画画"], category: "生活", coverText: `今天\n也想和你\n一起画画`, coverTone: "mint", likes: 24, saves: 5, comments: [{ ...author("同桌"), content: `第${round}篇：这个画本真好看！`, likes: 2 }] },
      { ...author("薄荷"), title: `花园里的小事 ${round}`, content: `第${round}篇：浇完花，坐下来看看今天的云。`, tags: ["生活"], category: "情感", coverText: "慢慢来\n日子会开花", coverTone: "rose", comments: [] },
      { ...author("街角咖啡"), title: `周末灵感 ${round}`, content: `第${round}篇：散步时发现了新的灵感，分享给喜欢日常的朋友。`, tags: ["周末"], category: "生活", coverText: "留一点时间\n给自己", coverTone: "cream", comments: [] },
    ] });
  } else {
    replies++; const author = prompt.match(/本次优先发言角色：([^。]+)/)?.[1] || "奶糖";
    output = JSON.stringify({ replies: [{ author, content: `生成回复 ${replies}：当然可以，一起去北街画画吧！`, likes: 0 }] });
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(request.url.endsWith("responses") ? { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: output }] }] } : { choices: [{ message: { role: "assistant", content: output } }] }));
});

try {
  await mkdir(".runtime", { recursive: true });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Red Fixture", apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-chat", models: ["fixture-chat"], updatedAt: now };
  const seed = {
    version: 1, chatMode: "ai", activeProviderId: provider.id,
    providers: [provider, { ...provider, id: "responses", name: "Red Responses", apiType: "responses", modelId: "fixture-responses", models: ["fixture-responses"] }],
    userProfile: { nickname: "小月", bio: "喜欢草莓和画画", avatarImage: "" },
    personas: [{ id: "mint", name: "薄荷", avatarImage: "/api/app-data/assets/fixture-mint.png", description: "喜欢种花的温柔朋友" }, { id: "desk", name: "同桌", description: "喜欢画画" }, { id: "shadow", name: "影子", description: "UNCHECKED_ROLE_SETTING" }].map(persona => ({ ...persona, entryTypes: [], modelProfile: { provider: "", model: "", temperature: 1, responseStyle: "" }, createdAt: now, updatedAt: now })),
    characterCards: [{ id: "friend-card", name: "奶糖", description: "{{char}}是{{user}}的绘画搭档", personality: "活泼，喜欢草莓", firstMessage: "", characterBook: { id: "friend-book", entries: [{ content: "奶糖角色卡世界书", constant: true }] }, createdAt: now, updatedAt: now }],
    worldBooks: [{ id: "active", entries: [{ content: "草莓花园世界书", constant: true, position: "before_char" }, { content: "{{char}}记得{{user}}喜欢草莓", keys: ["草莓"], position: "at_depth", depth: 1 }, { content: "DISABLED_RED_LORE", constant: true, enabled: false }] }, { id: "inactive", entries: [{ content: "INACTIVE_RED_LORE", constant: true }] }], activeWorldBookIds: ["active"],
    chatSessions: ["one", "two"].map(id => ({ id: `red-${id}`, title: `Red ${id}`, mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: `message-${id}`, role: "user", content: id === "one" ? "小月和奶糖约好周末去北街画画" : "这是另一个会话，不应泄露", createdAt: now }], createdAt: now, updatedAt: now })),
  };
  seed.characterCards.push({ id: "coffee", name: "街角咖啡", avatarDataUrl: "/api/app-data/assets/fixture-coffee.png", description: "分享周末的日常", createdAt: now, updatedAt: now });
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" });
  const phoneSeed = { ...emptyPocketState(), contacts: [{ id: "friend", name: "奶糖", avatar: "/touxiang/1.png", personality: "奶糖是小月的绘画搭档", greeting: "", sourceLabel: "角色卡", sourceCharacterCardId: "friend-card", createdAt: now, messages: [{ id: "greeting", role: "assistant", content: "微信里约好了带草莓去画画", createdAt: now }] }] };
  await context.addInitScript(value => { if (!localStorage.getItem("renge_pocket_phone_v1:red-one")) localStorage.setItem("renge_pocket_phone_v1:red-one", JSON.stringify(value)); }, phoneSeed);
  page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.route("**/api/app-data/assets/fixture-*.png", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1N0AAAAASUVORK5CYII=", "base64") }));
  const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
  const mainReply = "主会话已经参考小红书里的内容。";
  await page.route("**/api/pi/chat", async route => {
    mainRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: [`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: mainReply }, finish_reason: null }] })}`, 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}', "data: [DONE]", ""].join("\n\n") });
  });
  const phone = page.locator(".pocket-panel"), red = phone.locator(".xhs-app");
  async function openPhone() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    const maximize = page.getByRole("button", { name: "最大化窗口", exact: true }); if (await maximize.isVisible()) await maximize.click();
    await page.getByRole("button", { name: "展开右侧栏", exact: true }).click();
    await page.getByRole("button", { name: /手机.*可爱手机/ }).click();
    await phone.getByRole("button", { name: "打开小红书", exact: true }).click();
  }
  const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem("renge_pocket_red_v1:red-one")));
  const home = () => red.getByRole("button", { name: "首页", exact: true }).click();
  const back = () => red.getByRole("button", { name: "返回小红书列表", exact: true }).click();
  const profile = () => red.getByRole("button", { name: "我", exact: true }).click();
  const checkbox = name => red.getByRole("checkbox", { name: `参与生成：${name}`, exact: true });
  async function generate(expected) { await red.getByRole("button", { name: "生成小红书笔记", exact: true }).click(); await page.waitForFunction(count => document.querySelectorAll(".xhs-card").length === count, expected); await red.getByRole("button", { name: "生成小红书笔记", exact: true }).waitFor({ state: "visible" }); }
  async function comment(content) { await red.getByRole("button", { name: "说点什么...", exact: true }).click(); await red.getByRole("textbox", { name: "评论内容", exact: true }).fill(content); await red.getByRole("dialog").getByRole("button", { name: "发送", exact: true }).click(); }
  const waitReplies = count => page.waitForFunction(count => { const state = JSON.parse(localStorage.getItem("renge_pocket_red_v1:red-one")); return state.comments.filter(comment => comment.responseToId).length === count && state.pendingReplies.length === 0; }, count);
  async function sendMain(content) { const count = mainRequests.length; await page.getByPlaceholder("输入消息，可粘贴图片", { exact: true }).fill(content); await page.getByRole("button", { name: "发送", exact: true }).click(); await page.locator(".chat-message.assistant").filter({ hasText: mainReply }).nth(count).waitFor(); }
  async function mainMenu(content) { const button = page.locator(".chat-message").filter({ hasText: content }).first().locator(".chat-message-more"); await button.scrollIntoViewIfNeeded(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await button.click(); }

  await page.goto(server.url); await openPhone();
  assert.equal(await red.locator(".xhs-card").count(), 0);
  assert.equal(await red.getByText("为什么领导很少请假？", { exact: true }).count(), 0);
  assert.equal(await red.getByRole("button", { name: "生成小红书笔记", exact: true }).isDisabled(), true);
  await red.getByRole("button", { name: "选择生成角色", exact: true }).click();
  assert.ok(await red.getByRole("checkbox").count() >= 5); assert.equal(await red.locator('.xhs-role-choice input:checked').count(), 0);
  for (const name of ["奶糖", "薄荷", "同桌", "街角咖啡"]) await checkbox(name).check();
  assert.equal(await checkbox("影子").isChecked(), false);
  assert.equal(await checkbox("奶糖").evaluate(node => getComputedStyle(node).accentColor), "rgb(255, 36, 66)");
  await phone.screenshot({ path: ".runtime/xiaohongshu-role-picker.png", animations: "disabled" });
  await home();
  await generate(3); const firstState = await readState(); const firstIds = firstState.notes.map(note => note.id);
  assert.equal(firstState.actors.length, 4);
  assert.equal(firstState.actors.find(actor => actor.name === "奶糖").avatar, "/touxiang/1.png");
  assert.equal(firstState.actors.find(actor => actor.name === "薄荷").avatar, "/api/app-data/assets/fixture-mint.png");
  assert.equal(firstState.actors.find(actor => actor.name === "街角咖啡").avatar, "/api/app-data/assets/fixture-coffee.png");
  assert.ok(POCKET_AVATARS.includes(firstState.actors.find(actor => actor.name === "同桌").avatar));
  const firstRequest = JSON.stringify(requests[0].body);
  assert.match(firstRequest, /小月和奶糖约好周末去北街画画/); assert.match(firstRequest, /微信里约好了带草莓去画画/); assert.match(firstRequest, /草莓花园世界书/);
  assert.doesNotMatch(firstRequest, /DISABLED_RED_LORE|INACTIVE_RED_LORE|这是另一个会话|微信回复规则|UNCHECKED_ROLE_SETTING/);
  assert.equal(requests[0].body.model, "fixture-chat");
  await phone.screenshot({ path: ".runtime/xiaohongshu-generated-home.png", animations: "disabled" });
  await sendMain("记住小红书刚生成的笔记"); const firstScope = mainRequests.at(-1).piSessionScope;
  assert.match(JSON.stringify(mainRequests.at(-1).request.messages), /小红书 · 奶糖/);
  await generate(6); const second = await readState(); firstIds.forEach(id => assert.ok(second.notes.some(note => note.id === id)));
  assert.match(JSON.stringify(requests.at(-1).body), /北街画画日常 1/); assert.match(JSON.stringify(requests.at(-1).body), /记住小红书刚生成的笔记/);
  assert.equal(second.notes.find(note => note.title === "北街画画日常 2").avatar, firstState.notes.find(note => note.title === "北街画画日常 1").avatar);
  await sendMain("第二轮笔记也记住"); assert.notEqual(mainRequests.at(-1).piSessionScope, firstScope);
  mode = "bad"; await red.getByRole("button", { name: "生成小红书笔记", exact: true }).click(); await red.getByRole("button", { name: "重试生成", exact: true }).waitFor();
  assert.equal((await readState()).notes.length, 6); assert.equal(await red.getByText("不应部分保存", { exact: true }).count(), 0);
  await red.getByRole("button", { name: "重试生成", exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll(".xhs-card").length === 9);
  await red.getByRole("button", { name: "打开笔记：北街画画日常 1", exact: true }).click();
  await red.getByRole("button", { name: "点赞笔记", exact: true }).click(); await red.getByRole("button", { name: "收藏笔记", exact: true }).click();
  await comment("我也想一起去北街画画"); await waitReplies(1);
  let state = await readState(); const submitted = state.comments.find(comment => comment.content === "我也想一起去北街画画");
  assert.equal(state.comments.find(comment => comment.responseToId === submitted.id).parentId, submitted.id);
  assert.match(JSON.stringify(requests.at(-1).body), /奶糖角色卡世界书/); assert.match(JSON.stringify(requests.at(-1).body), /我也想一起去北街画画/);
  await phone.screenshot({ path: ".runtime/xiaohongshu-generated-comments.png", animations: "disabled" });
  const rootComment = red.locator(".xhs-comment").filter({ hasText: "第1篇：这个画本真好看！" });
  await rootComment.getByRole("button", { name: "回复", exact: true }).click(); await red.getByRole("textbox", { name: "评论内容", exact: true }).fill("回复同桌，也来一起画吧"); await red.getByRole("dialog").getByRole("button", { name: "发送", exact: true }).click(); await waitReplies(2);
  mode = "slow"; await comment("第一条排队评论"); await page.waitForFunction(() => !!document.querySelector(".xhs-generation-status"));
  while (!releaseSlow) await new Promise(resolve => setTimeout(resolve, 10));
  const slowRequest = JSON.stringify(requests.at(-1).body);
  await comment("第二条排队评论"); assert.doesNotMatch(slowRequest, /第二条排队评论/);
  releaseSlow(); releaseSlow = undefined; await waitReplies(4);
  mode = "fail"; await comment("失败后只重试角色回复"); await red.getByText("fixture temporarily unavailable", { exact: true }).waitFor();
  const userCount = (await readState()).comments.filter(comment => comment.actorId === "self").length;
  await red.getByRole("button", { name: "重试生成", exact: true }).click(); await waitReplies(5);
  assert.equal((await readState()).comments.filter(comment => comment.actorId === "self").length, userCount);
  mode = "slow"; await comment("生成期间被改的评论");
  while (!releaseSlow) await new Promise(resolve => setTimeout(resolve, 10));
  await mainMenu("生成期间被改的评论"); await page.locator(".chat-message-menu").getByRole("button", { name: "编辑", exact: true }).click(); await page.locator(".chat-inline-editor textarea").fill("在《北街画画日常 1》下评论\n\n生成期间更新后的评论"); await page.locator(".chat-inline-editor-actions").getByRole("button", { name: "保存", exact: true }).click();
  await red.getByText("相关笔记或评论已修改，请重试生成。", { exact: true }).waitFor();
  releaseSlow(); releaseSlow = undefined;
  await red.getByRole("button", { name: "重试生成", exact: true }).click(); await waitReplies(6);
  assert.match(JSON.stringify(requests.at(-1).body), /生成期间更新后的评论/); assert.doesNotMatch(JSON.stringify(requests.at(-1).body), /生成期间被改的评论/);
  await mainMenu("我也想一起去北街画画"); await page.locator(".chat-message-menu").getByRole("button", { name: "编辑", exact: true }).click(); await page.locator(".chat-inline-editor textarea").fill("在《北街画画日常 1》下评论\n\n主会话里改过的评论"); await page.locator(".chat-inline-editor-actions").getByRole("button", { name: "保存", exact: true }).click();
  assert.equal((await readState()).comments.find(comment => comment.id === submitted.id).content, "主会话里改过的评论");
  await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click();
  await mainMenu("生成回复 1："); await page.locator(".chat-message-menu").getByRole("button", { name: "删除", exact: true }).click();
  assert.equal((await readState()).comments.filter(comment => comment.content.startsWith("生成回复 1：")).length, 0);
  await phone.getByRole("button", { name: "打开手机设置", exact: true }).click(); await phone.getByLabel("模型渠道", { exact: true }).selectOption("responses");
  await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click(); await phone.getByRole("button", { name: "打开小红书", exact: true }).click();
  await generate(12); assert.ok(requests.at(-1).path.endsWith("responses")); assert.equal(requests.at(-1).body.model, "fixture-responses");
  assert.match(JSON.stringify(requests.at(-1).body), /主会话里改过的评论/); assert.doesNotMatch(JSON.stringify(requests.at(-1).body), /生成回复 1：/);
  await red.getByRole("button", { name: "发布笔记", exact: true }).click(); await red.getByRole("textbox", { name: "笔记标题", exact: true }).fill("我自己的笔记"); await red.getByRole("textbox", { name: "笔记正文", exact: true }).fill("自己的内容会保留 #日常"); await red.getByRole("dialog").getByRole("button", { name: "发布笔记", exact: true }).click();
  await back(); assert.equal(await red.locator(".xhs-card").count(), 1); await home(); assert.equal(await red.locator(".xhs-card").count(), 13);
  await page.locator(".chat-session-item").filter({ hasText: "Red two" }).click(); await phone.getByRole("button", { name: "打开小红书", exact: true }).click(); assert.equal(await red.locator(".xhs-card").count(), 0);
  await page.locator(".chat-session-item").filter({ hasText: "小月和奶糖约好周末去北街画画" }).click(); await phone.getByRole("button", { name: "打开小红书", exact: true }).click(); assert.equal(await red.locator(".xhs-card").count(), 13);
  await page.waitForFunction(async () => { const { data } = await fetch("/api/app-data").then(response => response.json()); return data.chatSessions.find(session => session.id === "red-one").messages.some(message => message.source === "xiaohongshu" && message.content.includes("我自己的笔记")); });
  const actorAvatars = (await readState()).actors.map(actor => actor.avatar);
  await page.evaluate(() => localStorage.setItem("renge-chat-right-sidebar-width", "260")); await page.reload(); await openPhone();
  assert.equal(await red.locator(".xhs-card").count(), 13); assert.deepEqual((await readState()).actors.map(actor => actor.avatar), actorAvatars);
  await red.getByRole("button", { name: "打开笔记：北街画画日常 1", exact: true }).click();
  assert.equal(await red.getByRole("button", { name: "取消点赞笔记", exact: true }).count(), 1);
  assert.equal(await red.getByRole("button", { name: "取消收藏笔记", exact: true }).count(), 1);
  assert.equal(await red.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  assert.equal(await red.locator(".xhs-interactions").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await phone.screenshot({ path: ".runtime/xiaohongshu-generated-narrow.png", animations: "disabled" });
  await back(); await profile();
  assert.equal(await red.locator(".xhs-role-picker").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  for (const name of ["奶糖", "薄荷", "同桌", "街角咖啡"]) assert.equal(await checkbox(name).isChecked(), true);
  for (const name of ["奶糖", "薄荷", "街角咖啡"]) await checkbox(name).uncheck();
  await home(); mode = "unselected";
  await red.getByRole("button", { name: "生成小红书笔记", exact: true }).click(); await red.getByText("模型使用了未勾选的角色，请重试生成。", { exact: true }).waitFor();
  assert.equal((await readState()).notes.length, 13);
  await red.getByRole("button", { name: "重试生成", exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll(".xhs-card").length === 16);
  const deskState = await readState();
  assert.deepEqual(deskState.notes.slice(0, 3).map(note => note.author), ["同桌", "同桌", "同桌"]);
  const pool = body => JSON.parse((body.messages || body.input).map(text).join("\n").match(/已勾选的生成角色及最新设定：(\[[^\n]*\])/)[1]);
  assert.deepEqual(pool(requests.at(-1).body).map(role => role.name), ["同桌"]);
  const replyCount = deskState.comments.filter(comment => comment.responseToId).length;
  await red.getByRole("button", { name: "打开笔记：北街画画日常 1", exact: true }).click();
  await comment("原作者取消勾选后只由已选角色回复"); await waitReplies(replyCount + 1);
  assert.equal((await readState()).comments.at(-1).author, "同桌");
  await back(); await profile(); await checkbox("同桌").uncheck(); await home();
  assert.equal(await red.getByRole("button", { name: "生成小红书笔记", exact: true }).isDisabled(), true);
  await red.getByRole("button", { name: "打开笔记：北街画画日常 1", exact: true }).click();
  const beforePending = requests.length;
  await comment("全部取消勾选时保留评论等待角色回复");
  await red.getByText("请先到「我」勾选参与生成的角色。", { exact: true }).waitFor(); assert.equal(requests.length, beforePending);
  await back(); await profile(); await checkbox("影子").check(); await waitReplies(replyCount + 2);
  assert.equal((await readState()).comments.at(-1).author, "影子");
  await home(); mode = "slow";
  await red.getByRole("button", { name: "生成小红书笔记", exact: true }).click();
  while (!releaseSlow) await new Promise(resolve => setTimeout(resolve, 10));
  await profile(); await checkbox("影子").uncheck(); await checkbox("同桌").check();
  releaseSlow(); releaseSlow = undefined;
  await red.locator(".xhs-generation-status").waitFor({ state: "hidden" });
  assert.equal((await readState()).notes.length, 16);
  await home(); await generate(19);
  assert.deepEqual(pool(requests.at(-1).body).map(role => role.name), ["同桌"]);
  await page.reload(); await openPhone(); await profile();
  assert.equal(await checkbox("同桌").isChecked(), true); assert.equal(await checkbox("奶糖").isChecked(), false); assert.equal(await checkbox("影子").isChecked(), false);
  assert.deepEqual((await readState()).actors.filter(actor => actor.name !== "影子").map(actor => actor.avatar), actorAvatars);
  await phone.screenshot({ path: ".runtime/xiaohongshu-role-picker-narrow.png", animations: "disabled" });
  assert.deepEqual(pageErrors, []);
  console.log("PASS: role opt-in and persistence, strict author/comment/reply pools, cancellation on selection changes, own avatars and stable random fallback, incremental model generation, main/WeChat/worldbook context, queued replies/retries, main edits/deletes, Responses, posting, isolation, reload and narrow layout");
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: ".runtime/xiaohongshu-test-failure.png" }); console.error((await page.locator("body").innerText()).slice(-3500)); }
  throw error;
} finally {
  releaseSlow?.(); await browser?.close(); server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-red-browser-"))); await rm(root, { recursive: true, force: true });
}
