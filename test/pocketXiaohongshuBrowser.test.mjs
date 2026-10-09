import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { emptyPocketState, POCKET_AVATARS } from "../src/pocketPhoneState.ts";
import { fixtureWechatTurn } from "./pocketPhoneInnerFixture.mjs";

// Isolated local app data and fixture models; never contact a user's provider.
const root = await mkdtemp(join(tmpdir(), "renge-red-browser-"));
const requests = [], mainRequests = [];
let mode = "success", round = 0, replies = 0, releaseSlow;
let server, browser, page;
const text = message => typeof message.content === "string" ? message.content : (message.content || []).map(part => part.text || "").join("");
const nicknames = { 奶糖: "草莓画画中", 薄荷: "薄荷花园", 同桌: "画本同桌", 街角咖啡: "周末一杯", 影子: "夜色日记" };
const upstream = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ path: request.url, body });
  if (mode === "fail") { mode = "success"; response.writeHead(503, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "fixture temporarily unavailable" } })); return; }
  if (mode === "slow") { mode = "success"; await new Promise(resolve => { releaseSlow = resolve; }); }
  const prompt = (body.messages || body.input).map(text).join("\n");
  const selectedMatch = prompt.match(/已勾选的生成角色及最新设定：(\[[^\n]*\])/);
  const allowed = selectedMatch ? JSON.parse(selectedMatch[1]) : [];
  const fresh = () => ({ authorId: `new:person-${round}`, author: `鹿鹿种花${round}` });
  const author = name => { const role = allowed.find(role => role.name === name) || allowed[0]; return role ? { authorId: role.id, author: role.nickname || nicknames[role.name] } : fresh(); };
  let output;
  if (mode === "bad") { mode = "success"; output = '{"notes":[{"author":"奶糖","title":"不应部分保存","content":"有效"},{"title":"无效"}]}'; }
  else if (mode === "unselected") { mode = "success"; output = JSON.stringify({ notes: [{ authorId: "contact:friend", author: "奶糖", title: "未勾选角色的帖子", content: "不能保存" }] }); }
  else if (prompt.includes("本次任务：增量生成")) {
    round++;
    const target = JSON.parse(prompt.match(/本次笔记生成目标：([^\n]+)/)[1]);
    output = JSON.stringify({ actors: [...allowed.filter(role => !role.nickname).map(role => ({ id: role.id, name: role.name, nickname: nicknames[role.name] })), { id: fresh().authorId, name: `许鹿${round}`, nickname: fresh().author, personality: "北街花店的店员，性格温柔慢热，喜欢水彩和植物，说话简短，有自己的生活，刚加入社区。", profile: { handle: `deer_${round}`, bio: "心里有光便是晴天\n每天都是值得纪念的日子", gender: "女", age: 22, location: "北街", following: 12, followers: 1083, receivedLikes: 3836, background: "ocean" } }], notes: [
      { ...author("奶糖"), title: `北街画画日常 ${round}`, content: `第${round}次去北街的草莓花园画画，记得带上水彩和画本。`, tags: ["草莓", "画画"], category: "生活", coverText: `今天\n也想和你\n一起画画`, coverTone: "mint", likes: 24, saves: 5, comments: [{ ...author("同桌"), content: `第${round}篇：这个画本真好看！`, likes: 2 }] },
      { ...author("薄荷"), title: `花园里的小事 ${round}`, content: `第${round}篇：浇完花，坐下来看看今天的云。`, tags: ["生活"], category: "情感", coverText: "慢慢来\n日子会开花", coverTone: "rose", comments: [{ ...author("街角咖啡"), content: "周末也想来看看花。" }] },
      { ...fresh(), title: `周末灵感 ${round}`, content: `第${round}篇：散步时发现了新的灵感，分享给喜欢日常的朋友。`, tags: ["周末"], category: "生活", coverText: "留一点时间\n给自己", coverTone: "cream", comments: [] },
    ].map(note => target.topic ? { ...note, title: `${target.topic} · ${note.title}`, content: `${target.topic}。${note.content}`, tags: [target.topic] } : target.category !== "推荐" ? { ...note, category: target.category, tags: [target.category] } : note) });
  } else if (selectedMatch) {
    replies++; const author = prompt.match(/本次优先发言角色：([^。]+)/)?.[1] || "奶糖";
    output = JSON.stringify({ replies: [{ author, content: `生成回复 ${replies}：当然可以，一起去北街画画吧！`, likes: 0 }] });
  } else output = fixtureWechatTurn("微信里的新朋友回复：一起画画吧。");
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
    personas: [{ id: "mint", name: "薄荷", avatarImage: "/api/app-data/assets/fixture-mint.png", description: "喜欢种花的温柔朋友" }, { id: "desk", name: "同桌", description: "喜欢画画" }, { id: "shadow", name: "影子", description: "UNCHECKED_ROLE_SETTING" }, { id: "coffee", name: "街角咖啡", avatarImage: "/api/app-data/assets/fixture-coffee.png", description: "分享周末的日常" }].map(persona => ({ ...persona, entryTypes: [], modelProfile: { provider: "", model: "", temperature: 1, responseStyle: "" }, createdAt: now, updatedAt: now })),
    characterCards: [{ id: "friend-card", name: "奶糖", description: "{{char}}是{{user}}的绘画搭档", personality: "活泼，喜欢草莓", firstMessage: "", characterBook: { id: "friend-book", entries: [{ content: "奶糖角色卡世界书", constant: true }] }, createdAt: now, updatedAt: now }],
    worldBooks: [{ id: "active", entries: [{ content: "草莓花园世界书", constant: true, position: "before_char" }, { content: "{{char}}记得{{user}}喜欢草莓", keys: ["草莓"], position: "at_depth", depth: 1 }, { content: "DISABLED_RED_LORE", constant: true, enabled: false }] }, { id: "inactive", entries: [{ content: "INACTIVE_RED_LORE", constant: true }] }], activeWorldBookIds: ["active"],
    chatSessions: ["one", "two"].map(id => ({ id: `red-${id}`, title: `Red ${id}`, mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: `message-${id}`, role: "user", content: id === "one" ? "小月和奶糖约好周末去北街画画" : "这是另一个会话，不应泄露", createdAt: now }], createdAt: now, updatedAt: now })),
  };
  seed.characterCards.push({ id: "card-only", name: "仅角色卡", avatarDataUrl: "/api/app-data/assets/fixture-coffee.png", description: "不能直接导入小红书", createdAt: now, updatedAt: now });
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" });
  const phoneSeed = { ...emptyPocketState(), contacts: [{ id: "friend", name: "奶糖", avatar: "/touxiang/1.png", personality: "奶糖是小月的绘画搭档", greeting: "", sourceLabel: "角色卡", sourceCharacterCardId: "friend-card", createdAt: now, messages: [{ id: "greeting", role: "assistant", content: "微信里约好了带草莓去画画", createdAt: now }] }] };
  await context.addInitScript(value => { if (!localStorage.getItem("renge_pocket_phone_v1:red-one")) localStorage.setItem("renge_pocket_phone_v1:red-one", JSON.stringify(value)); }, phoneSeed);
  page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.route("**/api/app-data/assets/fixture-*.png", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1N0AAAAASUVORK5CYII=", "base64") }));
  const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
  const dialogs = []; page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
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
  async function generate(expected, visibleCount = expected) { await red.getByRole("button", { name: "生成小红书笔记", exact: true }).click(); await page.waitForFunction(({ total, visible }) => JSON.parse(localStorage.getItem("renge_pocket_red_v1:red-one")).notes.length === total && document.querySelectorAll(".xhs-card").length === visible, { total: expected, visible: visibleCount }); await red.getByRole("button", { name: "生成小红书笔记", exact: true }).waitFor({ state: "visible" }); }
  async function chooseCategory(name) { await red.getByRole("button", { name: "展开频道分类", exact: true }).click(); await red.locator(".xhs-category-picker").getByRole("button", { name, exact: true }).click(); }
  const feedTarget = request => JSON.parse((request.body.messages || request.body.input).map(text).join("\n").match(/本次笔记生成目标：([^\n]+)/)[1]);
  async function comment(content) { await red.getByRole("button", { name: "说点什么...", exact: true }).click(); await red.getByRole("textbox", { name: "评论内容", exact: true }).fill(content); await red.getByRole("dialog").getByRole("button", { name: "发送", exact: true }).click(); }
  const waitReplies = count => page.waitForFunction(count => { const state = JSON.parse(localStorage.getItem("renge_pocket_red_v1:red-one")); return state.comments.filter(comment => comment.responseToId).length === count && state.pendingReplies.length === 0; }, count);
  async function sendMain(content) { const count = mainRequests.length; await page.getByPlaceholder("输入消息，可粘贴图片", { exact: true }).fill(content); await page.getByRole("button", { name: "发送", exact: true }).click(); await page.locator(".chat-message.assistant").filter({ hasText: mainReply }).nth(count).waitFor(); }
  async function mainMenu(content) { const button = page.locator(".chat-message").filter({ hasText: content }).first().locator(".chat-message-more"); await button.scrollIntoViewIfNeeded(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await button.click(); }

  await page.goto(server.url); await openPhone();
  assert.equal(await red.locator(".xhs-card").count(), 0);
  assert.equal(await red.getByText("为什么领导很少请假？", { exact: true }).count(), 0);
  assert.equal(await red.getByRole("button", { name: "生成小红书笔记", exact: true }).isDisabled(), false);
  await red.getByRole("button", { name: "选择生成角色", exact: true }).click();
  assert.equal(await checkbox("仅角色卡").count(), 0);
  assert.equal(await red.getByText("勾选的角色才会发帖、评论和回复", { exact: true }).count(), 0);
  assert.ok(await red.getByRole("checkbox").count() >= 5); assert.equal(await red.locator('.xhs-role-choice input:checked').count(), 0);
  for (const name of ["奶糖", "薄荷", "同桌", "街角咖啡"]) await checkbox(name).check();
  assert.equal(await checkbox("影子").isChecked(), false);
  assert.equal(await checkbox("奶糖").evaluate(node => getComputedStyle(node).accentColor), "rgb(255, 36, 66)");
  await phone.screenshot({ path: ".runtime/xiaohongshu-role-picker.png", animations: "disabled" });
  await home();
  assert.equal(await red.getByText("先在「我」勾选生成角色", { exact: true }).count(), 0);
  assert.equal(await red.locator(".xhs-role-shortcut").innerText(), "");
  await generate(3); const firstState = await readState(); const firstIds = firstState.notes.map(note => note.id);
  assert.equal(firstState.actors.length, 5);
  assert.equal(firstState.actors.find(actor => actor.name === "奶糖").nickname, nicknames.奶糖);
  assert.ok(firstState.notes.every(note => note.author === firstState.actors.find(actor => actor.id === note.authorId).nickname));
  assert.ok(firstState.comments.every(comment => comment.author === firstState.actors.find(actor => actor.id === comment.actorId).nickname));
  assert.ok(firstState.notes.some(note => note.authorId.startsWith("community:")));
  assert.match(firstState.actors.find(actor => actor.origin === "community").personality, /花店/);
  assert.equal(firstState.actors.find(actor => actor.name === "奶糖").avatar, "/touxiang/1.png");
  assert.equal(firstState.actors.find(actor => actor.name === "薄荷").avatar, "/api/app-data/assets/fixture-mint.png");
  assert.equal(firstState.actors.find(actor => actor.name === "街角咖啡").avatar, "/api/app-data/assets/fixture-coffee.png");
  assert.ok(POCKET_AVATARS.includes(firstState.actors.find(actor => actor.name === "同桌").avatar));
  const firstRequest = JSON.stringify(requests[0].body);
  assert.match(firstRequest, /小月和奶糖约好周末去北街画画/); assert.match(firstRequest, /微信里约好了带草莓去画画/); assert.match(firstRequest, /草莓花园世界书/);
  assert.doesNotMatch(firstRequest, /DISABLED_RED_LORE|INACTIVE_RED_LORE|这是另一个会话|微信回复规则|UNCHECKED_ROLE_SETTING/);
  assert.equal(requests[0].body.model, "fixture-chat");
  assert.deepEqual(feedTarget(requests[0]), { category: "推荐" });
  await phone.screenshot({ path: ".runtime/xiaohongshu-generated-home.png", animations: "disabled" });
  await sendMain("记住小红书刚生成的笔记"); const firstScope = mainRequests.at(-1).piSessionScope;
  assert.match(JSON.stringify(mainRequests.at(-1).request.messages), /小红书 · 草莓画画中/);
  await chooseCategory("游戏");
  assert.match(await red.getByRole("textbox", { name: "想看的小红书内容", exact: true }).getAttribute("placeholder"), /按游戏生成/);
  await generate(6, 3); const second = await readState(); firstIds.forEach(id => assert.ok(second.notes.some(note => note.id === id)));
  assert.deepEqual(feedTarget(requests.at(-1)), { category: "游戏" });
  assert.ok(second.notes.slice(0, 3).every(note => note.category === "游戏"));
  assert.equal(await red.getByRole("navigation", { name: "发现分类", exact: true }).getByRole("button", { name: "游戏", exact: true }).getAttribute("aria-pressed"), "true");
  await phone.screenshot({ path: ".runtime/xiaohongshu-category-generation.png", animations: "disabled" });
  assert.match(JSON.stringify(requests.at(-1).body), /北街画画日常 1/); assert.match(JSON.stringify(requests.at(-1).body), /记住小红书刚生成的笔记/);
  assert.equal(second.notes.find(note => note.title === "北街画画日常 2").avatar, firstState.notes.find(note => note.title === "北街画画日常 1").avatar);
  await sendMain("第二轮笔记也记住"); assert.notEqual(mainRequests.at(-1).piSessionScope, firstScope);
  await red.getByRole("textbox", { name: "想看的小红书内容", exact: true }).fill("  古风婚礼穿搭和配色  ");
  mode = "bad"; await red.getByRole("button", { name: "生成小红书笔记", exact: true }).click(); await red.getByRole("button", { name: "重试生成", exact: true }).waitFor();
  assert.deepEqual(feedTarget(requests.at(-1)), { topic: "古风婚礼穿搭和配色" });
  assert.equal((await readState()).notes.length, 6); assert.equal(await red.getByText("不应部分保存", { exact: true }).count(), 0);
  await red.getByRole("textbox", { name: "想看的小红书内容", exact: true }).fill("下一次想看甜品"); await chooseCategory("职场");
  await red.getByRole("button", { name: "重试生成", exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll(".xhs-card").length === 9);
  assert.deepEqual(feedTarget(requests.at(-1)), { topic: "古风婚礼穿搭和配色" });
  assert.ok((await readState()).notes.slice(0, 3).every(note => note.content.includes("古风婚礼穿搭和配色")));
  assert.equal(await red.getByRole("navigation", { name: "发现分类", exact: true }).getByRole("button", { name: "推荐", exact: true }).getAttribute("aria-pressed"), "true");
  await red.getByRole("textbox", { name: "想看的小红书内容", exact: true }).fill("");
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
  await phone.getByRole("button", { name: "打开手机设置", exact: true }).click(); await phone.getByText("API（全局共用）", { exact: true }).click(); await phone.getByLabel("模型渠道", { exact: true }).selectOption("responses");
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
  assert.equal(await red.locator(".xhs-generation-toolbar").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  const topicBounds = await red.getByRole("textbox", { name: "想看的小红书内容", exact: true }).boundingBox();
  const generateBounds = await red.getByRole("button", { name: "生成小红书笔记", exact: true }).boundingBox();
  assert.ok(topicBounds.width >= 80 && topicBounds.x + topicBounds.width <= generateBounds.x);
  await phone.screenshot({ path: ".runtime/xiaohongshu-generation-toolbar-narrow.png", animations: "disabled" });
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
  assert.equal(deskState.notes.slice(0, 3).filter(note => note.author === nicknames.同桌).length, 2);
  assert.ok(deskState.notes[0].authorId.startsWith("community:"));
  const pool = body => JSON.parse((body.messages || body.input).map(text).join("\n").match(/已勾选的生成角色及最新设定：(\[[^\n]*\])/)[1]);
  assert.deepEqual(pool(requests.at(-1).body).map(role => role.name), ["同桌"]);
  const replyCount = deskState.comments.filter(comment => comment.responseToId).length;
  await red.getByRole("button", { name: "打开笔记：北街画画日常 1", exact: true }).click();
  await comment("原作者取消勾选后只由已选角色回复"); await waitReplies(replyCount + 1);
  assert.equal((await readState()).comments.at(-1).author, nicknames.同桌);
  await back(); await profile(); await checkbox("同桌").uncheck(); await home();
  assert.equal(await red.getByRole("button", { name: "生成小红书笔记", exact: true }).isDisabled(), false);
  await red.getByRole("button", { name: "打开笔记：北街画画日常 1", exact: true }).click();
  const beforePending = requests.length;
  await comment("全部取消勾选时社区人物仍可回复"); await waitReplies(replyCount + 2);
  assert.equal(requests.length, beforePending + 1);
  assert.ok((await readState()).comments.at(-1).actorId.startsWith("community:"));
  await back(); await profile(); await checkbox("影子").check();
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
  assert.deepEqual((await readState()).actors.slice(0, actorAvatars.length).map(actor => actor.avatar), actorAvatars);
  await phone.screenshot({ path: ".runtime/xiaohongshu-role-picker-narrow.png", animations: "disabled" });
  const beforeClear = await readState();
  const otherSession = { ...beforeClear, selectedRoleIds: [] };
  await page.evaluate(value => localStorage.setItem("renge_pocket_red_v1:red-two", JSON.stringify(value)), otherSession);
  const phoneBeforeClear = await page.evaluate(() => localStorage.getItem("renge_pocket_phone_v1:red-one"));
  const assertCleared = async () => {
    const state = await readState();
    for (const key of ["notes", "comments", "liked", "saved", "likedComments", "followed", "hidden", "history", "pendingReplies"]) assert.deepEqual(state[key], []);
    assert.deepEqual(state.selectedRoleIds, beforeClear.selectedRoleIds);
    assert.equal(await red.getByRole("dialog").count(), 0); assert.equal(await red.locator(".xhs-toast, .xhs-generation-error, .xhs-generation-status").count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("renge_pocket_phone_v1:red-one")), phoneBeforeClear);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("renge_pocket_red_v1:red-two"))), otherSession);
    await page.waitForFunction(async () => { const { data } = await fetch("/api/app-data").then(response => response.json()); const messages = data.chatSessions.find(session => session.id === "red-one").messages; return !messages.some(message => message.source === "xiaohongshu") && messages.some(message => message.source === "wechat") && messages.some(message => message.content === "小月和奶糖约好周末去北街画画"); });
  };
  await red.getByRole("button", { name: "清空", exact: true }).click(); await assertCleared();
  assert.deepEqual((await readState()).actors, beforeClear.actors);
  await home(); assert.equal(await red.locator(".xhs-card").count(), 0);
  await page.reload(); await openPhone(); assert.equal(await red.locator(".xhs-card").count(), 0);
  mode = "slow"; await red.getByRole("button", { name: "生成小红书笔记", exact: true }).click();
  while (!releaseSlow) await new Promise(resolve => setTimeout(resolve, 10));
  await profile(); await red.getByRole("button", { name: "清空", exact: true }).click();
  releaseSlow(); releaseSlow = undefined; await assertCleared();
  await home(); await generate(3);
  assert.equal((await readState()).notes.some(note => beforeClear.notes.some(old => old.id === note.id)), false);
  const newNote = (await readState()).notes[0];
  await red.getByRole("button", { name: `打开笔记：${newNote.title}`, exact: true }).click(); mode = "slow";
  await comment("清空时也取消正在生成的评论回复");
  while (!releaseSlow) await new Promise(resolve => setTimeout(resolve, 10));
  await back(); await profile(); await red.getByRole("button", { name: "清空", exact: true }).click();
  releaseSlow(); releaseSlow = undefined; await assertCleared();
  await page.reload(); await openPhone(); await profile(); await assertCleared();
  assert.equal(await checkbox("同桌").isChecked(), true);
  await checkbox("同桌").uncheck(); await home(); await generate(3);
  const generated = await readState(); const stranger = generated.actors.find(actor => actor.id === generated.notes[0].authorId);
  assert.notEqual(stranger.name, stranger.nickname);
  assert.ok(generated.notes.every(note => note.author === stranger.nickname));
  assert.deepEqual(generated.selectedRoleIds, []);
  assert.ok(generated.notes.every(note => note.authorId === stranger.id));
  assert.ok(POCKET_AVATARS.includes(stranger.avatar)); assert.equal(stranger.profile.age, 22);
  await red.getByRole("button", { name: `查看${stranger.nickname}的主页`, exact: true }).first().click();
  assert.equal(await red.locator(".xhs-person-page").count(), 1); assert.equal(await red.locator(".xhs-bottom-nav").count(), 0);
  assert.equal(await red.getByText("22岁", { exact: false }).count(), 1);
  assert.equal(await red.locator(".xhs-person-identity img").getAttribute("src"), stranger.avatar);
  assert.equal(await red.locator(".xhs-person-identity h2").evaluate(node => getComputedStyle(node).color), "rgb(255, 255, 255)");
  assert.equal(await red.locator(".xhs-person-actions").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await red.getByRole("button", { name: "查看人物资料", exact: true }).click();
  assert.match(await red.getByRole("dialog").innerText(), /北街花店的店员/);
  await red.getByRole("button", { name: "关闭弹层", exact: true }).click();
  await red.getByRole("button", { name: "收藏", exact: true }).click();
  assert.equal(await red.locator(".xhs-card").count(), 0);
  await red.getByRole("button", { name: "笔记", exact: true }).click();
  await red.getByRole("button", { name: "搜索人物笔记", exact: true }).click();
  await red.getByRole("textbox", { name: "搜索此人的笔记", exact: true }).fill(generated.notes[0].title);
  assert.equal(await red.locator(".xhs-card").count(), 1);
  await red.getByRole("button", { name: "搜索人物笔记", exact: true }).click();
  await red.getByRole("button", { name: "关注", exact: true }).click();
  assert.ok((await readState()).followed.includes(stranger.nickname));
  await phone.screenshot({ path: ".runtime/xiaohongshu-person-narrow.png", animations: "disabled" });
  await red.getByRole("button", { name: `打开笔记：${generated.notes[0].title}`, exact: true }).click();
  await comment("没有勾选角色，也回复一下吧"); await waitReplies(1);
  assert.equal((await readState()).comments.at(-1).actorId, stranger.id);
  await red.locator(".xhs-note-header").getByRole("button", { name: `查看${stranger.nickname}的主页`, exact: true }).click();
  await red.getByRole("button", { name: "返回人物主页上一页", exact: true }).click();
  assert.equal(await red.locator(".xhs-note-header").count(), 1);
  await back();
  assert.equal(await red.locator(".xhs-person-page").count(), 1);
  const contactCount = await page.evaluate(() => JSON.parse(localStorage.getItem("renge_pocket_phone_v1:red-one")).contacts.length);
  await red.getByRole("button", { name: "发私信", exact: true }).click();
  await phone.locator(".pocket-wechat-header").getByText(stranger.nickname, { exact: true }).waitFor();
  const friendship = await page.evaluate(() => JSON.parse(localStorage.getItem("renge_pocket_phone_v1:red-one")));
  assert.equal(friendship.contacts.length, contactCount + 1);
  const newFriend = friendship.contacts.find(contact => contact.sourceXiaohongshuActorId === stranger.id);
  assert.equal(newFriend.avatar, stranger.avatar); assert.match(newFriend.personality, /花店的店员/); assert.deepEqual(newFriend.messages, []);
  await phone.getByRole("textbox", { name: `给${stranger.nickname}发消息`, exact: true }).fill("我们来聊聊水彩吧");
  await phone.getByRole("button", { name: "发送消息", exact: true }).click();
  await phone.getByRole("button", { name: "发送消息", exact: true }).click();
  await phone.getByText("微信里的新朋友回复：一起画画吧。", { exact: true }).waitFor();
  assert.match(JSON.stringify(requests.at(-1).body), /花店的店员/); assert.match(JSON.stringify(requests.at(-1).body), /草莓花园世界书/);
  await page.evaluate(() => localStorage.setItem("renge-chat-right-sidebar-width", "430"));
  await page.reload(); await openPhone();
  await red.getByRole("button", { name: `查看${stranger.nickname}的主页`, exact: true }).first().click();
  assert.equal(await red.locator(".xhs-person-identity img").getAttribute("src"), stranger.avatar);
  await phone.screenshot({ path: ".runtime/xiaohongshu-person-profile.png", animations: "disabled" });
  await red.getByRole("button", { name: "发私信", exact: true }).click();
  await phone.locator(".pocket-wechat-header").getByText(stranger.nickname, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("renge_pocket_phone_v1:red-one")).contacts.length), contactCount + 1);
  assert.equal(await phone.getByText("我们来聊聊水彩吧", { exact: true }).count(), 1);
  await phone.getByRole("button", { name: "编辑联系人", exact: true }).click();
  assert.equal(await phone.getByRole("textbox", { name: "朋友的名字", exact: true }).inputValue(), stranger.name);
  assert.equal(await phone.getByRole("textbox", { name: "昵称", exact: true }).inputValue(), stranger.nickname);
  await phone.getByRole("textbox", { name: "昵称", exact: true }).fill("鹿鹿今天开花");
  await phone.getByRole("button", { name: "保存小档案", exact: true }).click();
  await phone.locator(".pocket-wechat-header").getByText("鹿鹿今天开花", { exact: true }).waitFor();
  const editedFriend = await page.evaluate(id => JSON.parse(localStorage.getItem("renge_pocket_phone_v1:red-one")).contacts.find(contact => contact.id === id), newFriend.id);
  assert.equal(editedFriend.name, stranger.name); assert.equal(editedFriend.nickname, "鹿鹿今天开花");
  assert.equal(editedFriend.messages.length, 2);
  await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click();
  await phone.getByRole("button", { name: "打开小红书", exact: true }).click();
  await red.getByRole("button", { name: "查看鹿鹿今天开花的主页", exact: true }).first().click();
  assert.equal(await red.locator(".xhs-person-identity h2").innerText(), "鹿鹿今天开花");
  assert.ok((await readState()).followed.includes("鹿鹿今天开花"));
  assert.deepEqual(dialogs, []);
  assert.deepEqual(pageErrors, []);
  console.log("PASS: label and custom-topic generation, request snapshots on retry, narrow input toolbar, independent generated people and profiles, mixed authors, no-selection replies, persona persistence, private-message WeChat friend/chat/dedup/reload, avatar pool, role filtering, silent clear/cancellation, shared context, queued replies, Responses and narrow layout");
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: ".runtime/xiaohongshu-test-failure.png" }); console.error((await page.locator("body").innerText()).slice(-3500)); }
  throw error;
} finally {
  releaseSlow?.(); await browser?.close(); server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-red-browser-"))); await rm(root, { recursive: true, force: true });
}
