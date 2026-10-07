import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. Uses isolated app data and local fixture models only.
const root = await mkdtemp(join(tmpdir(), "renge-pocket-browser-"));
const requests = [];
const mainRequests = [];
let mode = "success";
let releaseSlowReply;
let browser;
let page;
let server;
const reply = "给你留了最甜的草莓，我们一起吃吧 🍓";
let fixtureReply = reply;
const upstream = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push({ path: request.url, body });
  if (mode === "fail") {
    mode = "success";
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "fixture temporary unavailable" } }));
    return;
  }
  if (mode === "slow") { mode = "success"; await new Promise(resolve => { releaseSlowReply = resolve; }); }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(request.url.endsWith("responses")
    ? { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: fixtureReply }] }] }
    : { choices: [{ message: { role: "assistant", content: fixtureReply } }] }));
});

try {
  await mkdir(".runtime", { recursive: true });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture-chat", name: "Phone Fixture", apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture-key", apiType: "chat-completions", modelId: "phone-chat", models: ["phone-chat"], updatedAt: now };
  const seed = {
    version: 1, chatMode: "ai", activeProviderId: provider.id, activePersonaId: "fixture-persona",
    providers: [provider, { ...provider, id: "fixture-responses", name: "Responses Fixture", apiType: "responses", modelId: "phone-responses", models: ["phone-responses", "phone-other"] }],
    userProfile: { nickname: "小月", bio: "喜欢画画和草莓", avatarImage: "" },
    personas: [{ id: "fixture-persona", name: "薄荷", description: "薄荷是一个喜欢种花的温柔朋友。", entryTypes: [{ id: "type", name: "喜好", influence: "HIGH", entries: [{ id: "enabled", key: "喜欢", value: "向日葵", enabled: true }, { id: "disabled", key: "不应导入", value: "disabled-persona-entry", enabled: false }] }], modelProfile: { provider: "", model: "", temperature: 1, responseStyle: "" }, createdAt: now, updatedAt: now }],
    characterCards: [{ id: "fixture-card", name: "月岛", nickname: "", description: "{{char}}是{{user}}的青梅竹马。", personality: "耐心、可爱，记得对方的喜好。", scenario: "放学后一起买甜点。", firstMessage: "{{user}}，今天也想和你一起回家。", messageExample: "", systemPrompt: "", characterBook: { id: "card-phone-world", name: "月岛的世界", entries: [{ content: "月岛角色卡世界书", constant: true }] }, createdAt: now, updatedAt: now }],
    worldBooks: [{ id: "phone-world", name: "草莓花园", entries: [
      { id: "first", content: "手机世界书第一条", constant: true, position: "before_char", order: 1 },
      { id: "second", content: "手机世界书第二条", constant: true, position: "before_char", order: 2 },
      { id: "depth", keys: ["草莓"], content: "{{char}}和{{user}}的花园在北街", position: "at_depth", depth: 1 },
      { id: "off", content: "DISABLED_PHONE_LORE", constant: true, enabled: false },
    ] }, { id: "inactive-phone-world", name: "未启用世界书", entries: [{ content: "INACTIVE_PHONE_LORE", constant: true }] }],
    activeWorldBookIds: ["phone-world"],
    chatSessions: ["One", "Two"].map(title => ({ id: `phone-${title.toLowerCase()}`, title: `Phone ${title}`, mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: `main-${title}`, role: "user", content: `Phone ${title}`, createdAt: now }], createdAt: now, updatedAt: now })),
  };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(15000);
  const mainReply = "主会话回复：记住了明天一起画画。";
  await page.route("**/api/pi/chat", async route => {
    mainRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: mainReply }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]", "",
    ].join("\n\n") });
  });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const phone = page.locator(".pocket-panel");
  async function openPhone() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    const maximize = page.getByRole("button", { name: "最大化窗口", exact: true });
    if (await maximize.isVisible()) await maximize.click();
    await page.getByRole("button", { name: "展开右侧栏", exact: true }).click();
    await page.getByRole("button", { name: /手机.*可爱手机/ }).click();
    await phone.getByRole("button", { name: "打开微信", exact: true }).waitFor();
  }
  async function waitForReply() {
    await phone.locator(".pocket-message.assistant").filter({ hasText: reply }).last().waitFor();
    await phone.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  }
  async function send(content) {
    await phone.locator(".pocket-composer textarea").fill(content);
    await phone.getByRole("button", { name: "发送消息", exact: true }).click();
  }
  async function sendMain(content) {
    const count = mainRequests.length;
    await page.getByPlaceholder("输入消息，可粘贴图片", { exact: true }).fill(content);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByRole("button", { name: "发送", exact: true }).waitFor();
    assert.equal(mainRequests.length, count + 1);
    await page.locator(".chat-message.assistant").filter({ hasText: mainReply }).nth(count).waitFor();
  }
  await page.goto(server.url);
  await openPhone();
  await page.locator(".chat-session-item").filter({ hasText: "Phone One" }).click();
  await sendMain("先记住明天一起画画");
  await phone.screenshot({ path: ".runtime/pocket-home.png", animations: "disabled" });
  await phone.getByRole("button", { name: "打开微信", exact: true }).click();
  await phone.getByRole("button", { name: "添加第一位朋友", exact: true }).click();
  let editor = phone.getByRole("dialog");
  await editor.getByLabel("朋友的名字", { exact: true }).fill("奶糖");
  await editor.getByLabel(/角色设定/).fill("奶糖是小月的好朋友，活泼可爱，喜欢草莓甜点。");
  await editor.getByLabel(/第一句招呼/).fill("{{user}}，一起去买草莓吧！");
  await editor.getByRole("button", { name: "添加到通讯录", exact: true }).click();
  await phone.getByText("小月，一起去买草莓吧！", { exact: true }).waitFor();
  await send("今天想吃草莓");
  await waitForReply();
  assert.equal(requests.length, 1);
  assert.match(requests[0].body.request?.messages?.[0]?.content ?? requests[0].body.messages[0].content, /奶糖/);
  assert.match(JSON.stringify(requests[0].body), /喜欢画画和草莓/);
  const firstHistory = requests[0].body.messages;
  const texts = firstHistory.map(message => message.content);
  assert.ok(texts.findIndex(text => text.includes("先记住明天一起画画")) < texts.findIndex(text => text.includes("小月，一起去买草莓吧！")));
  assert.match(JSON.stringify(firstHistory), /主会话回复：记住了明天一起画画/);
  const mainBackground = firstHistory.find(message => message.content.includes(mainReply));
  assert.equal(mainBackground.role, "user");
  assert.match(mainBackground.content, /主会话背景资料/);
  assert.equal(firstHistory.find(message => message.content === "小月，一起去买草莓吧！").role, "assistant");
  assert.match(firstHistory[0].content, /独立于主会话的文风/);
  assert.ok(texts[0].indexOf("手机世界书第一条") < texts[0].indexOf("手机世界书第二条"));
  assert.match(firstHistory.at(-2).content, /奶糖和小月的花园在北街/);
  assert.match(firstHistory.at(-1).content, /今天想吃草莓/);
  assert.doesNotMatch(JSON.stringify(firstHistory), /DISABLED_PHONE_LORE|INACTIVE_PHONE_LORE|Phone Two/);
  await sendMain("知道奶糖刚才发了什么吗？");
  const secondMain = mainRequests.at(-1).request.messages.map(message => typeof message.content === "string" ? message.content : JSON.stringify(message.content));
  assert.ok(secondMain.findIndex(text => text.includes("先记住明天一起画画")) < secondMain.findIndex(text => text.includes("今天想吃草莓")));
  assert.ok(secondMain.findIndex(text => text.includes(reply)) < secondMain.findIndex(text => text.includes("知道奶糖刚才发了什么吗？")));
  assert.match(secondMain.find(text => text.includes(reply)), /微信 · 奶糖 → 小月/);
  assert.notEqual(mainRequests[0].piSessionScope, mainRequests[1].piSessionScope);
  assert.equal(await page.locator(".chat-message.assistant").filter({ hasText: reply }).count(), 1);
  console.log("PASS: bidirectional ordered main/WeChat context, worldbook matching/depth and refreshed Pi history");
  console.log("PASS: custom contact, greeting macros and model-backed role reply");

  mode = "fail";
  await send("你会陪我去吗？");
  await phone.getByText("fixture temporary unavailable", { exact: true }).waitFor();
  await phone.getByRole("button", { name: "重试回复", exact: true }).click();
  await phone.locator(".pocket-message.assistant").filter({ hasText: reply }).nth(1).waitFor();
  assert.deepEqual(requests[1].body, requests[2].body);
  const retryHistory = requests[2].body.messages.map(message => message.content);
  assert.ok(retryHistory.findIndex(text => text.includes("知道奶糖刚才发了什么吗？")) < retryHistory.findIndex(text => text.includes("你会陪我去吗？")));
  assert.equal(await phone.locator(".pocket-message.user").count(), 2);
  mode = "slow";
  await send("这条消息先等等");
  await phone.getByRole("button", { name: "停止回复", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector(".pocket-typing"));
  while (!releaseSlowReply) await new Promise(resolve => setTimeout(resolve, 10));
  await sendMain("微信还在等待时记下这条主会话内容");
  await phone.getByRole("button", { name: "停止回复", exact: true }).click();
  releaseSlowReply();
  await phone.getByRole("button", { name: "重试回复", exact: true }).click();
  await phone.locator(".pocket-message.assistant").filter({ hasText: reply }).nth(2).waitFor();
  const concurrentHistory = requests.at(-1).body.messages.map(message => message.content);
  assert.ok(concurrentHistory.findIndex(text => text.includes("这条消息先等等")) < concurrentHistory.findIndex(text => text.includes("微信还在等待时记下这条主会话内容")));
  assert.equal(await page.locator(".chat-message.user").filter({ hasText: "这条消息先等等" }).count(), 1);
  assert.equal(await phone.locator(".pocket-message.user").count(), 3);
  assert.equal(await phone.locator(".pocket-message.assistant").count(), 4);
  await phone.screenshot({ path: ".runtime/pocket-chat.png", animations: "disabled" });
  console.log("PASS: failure retry and canceled reply do not duplicate outgoing messages");

  await phone.getByRole("button", { name: "返回微信列表", exact: true }).click();
  await phone.getByRole("button", { name: "添加联系人", exact: true }).click();
  editor = phone.getByRole("dialog");
  await editor.getByLabel("从已有角色导入").selectOption("persona:fixture-persona");
  assert.match(await editor.getByLabel(/角色设定/).inputValue(), /向日葵/);
  assert.doesNotMatch(await editor.getByLabel(/角色设定/).inputValue(), /disabled-persona-entry/);
  await editor.getByRole("button", { name: "添加到通讯录", exact: true }).click();
  await phone.getByRole("button", { name: "编辑联系人", exact: true }).click();
  editor = phone.getByRole("dialog");
  await editor.getByLabel("朋友的名字", { exact: true }).fill("薄荷同学");
  await editor.getByRole("button", { name: "保存小档案", exact: true }).click();
  await phone.getByText("薄荷同学", { exact: true }).first().waitFor();
  console.log("PASS: persona import uses enabled traits, and contact editing preserves the conversation");

  await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click();
  await phone.getByRole("button", { name: "打开手机设置", exact: true }).click();
  await phone.getByLabel("模型渠道").selectOption("fixture-responses");
  await phone.getByLabel("聊天模型").selectOption("phone-other");
  await phone.getByRole("button", { name: "薄荷布丁", exact: true }).click();
  await phone.getByRole("switch").click();
  assert.equal(await phone.getByRole("switch").getAttribute("aria-checked"), "true");
  await phone.locator(".pocket-settings").evaluate(node => { node.scrollTop = 0; });
  await phone.screenshot({ path: ".runtime/pocket-settings.png", animations: "disabled" });
  await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click();
  await phone.getByRole("button", { name: "打开微信", exact: true }).click();
  await phone.getByRole("button", { name: "添加联系人", exact: true }).click();
  editor = phone.getByRole("dialog");
  await editor.getByLabel("从已有角色导入").selectOption("card:fixture-card");
  await editor.getByRole("button", { name: "添加到通讯录", exact: true }).click();
  await phone.getByText("小月，今天也想和你一起回家。", { exact: true }).waitFor();
  await send("一起走吧");
  await waitForReply();
  assert.equal(requests.at(-1).path, "/v1/responses");
  assert.equal(requests.at(-1).body.model, "phone-other");
  assert.match(JSON.stringify(requests.at(-1).body), /月岛是小月的青梅竹马/);
  assert.match(JSON.stringify(requests.at(-1).body), /月岛角色卡世界书/);
  console.log("PASS: character-card import, selectable model, Responses API, themes and large text");

  await phone.getByRole("button", { name: "编辑联系人", exact: true }).click();
  await phone.getByRole("button", { name: "清空聊天", exact: true }).click();
  await phone.getByRole("alertdialog").getByRole("button", { name: "再想想", exact: true }).click();
  await phone.getByRole("button", { name: "关闭联系人编辑", exact: true }).click();
  assert.equal(await phone.locator(".pocket-message").count(), 3);
  await phone.getByRole("button", { name: "编辑联系人", exact: true }).click();
  await phone.getByRole("button", { name: "清空聊天", exact: true }).click();
  await phone.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click();
  assert.equal(await phone.locator(".pocket-message").count(), 0);
  assert.equal(await page.locator(".chat-message").filter({ hasText: "小月，今天也想和你一起回家。" }).count(), 0);
  assert.equal(await page.locator(".chat-message").filter({ hasText: "一起走吧" }).count(), 0);
  await phone.getByRole("button", { name: "编辑联系人", exact: true }).click();
  await phone.getByRole("button", { name: "删除联系人", exact: true }).click();
  await phone.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click();
  assert.equal(await phone.locator(".pocket-contact-row").count(), 2);
  await phone.getByLabel("搜索联系人").fill("奶糖");
  assert.equal(await phone.locator(".pocket-contact-row").count(), 1);
  await phone.getByLabel("搜索联系人").fill("找不到的朋友");
  await phone.getByText("还没有找到这位朋友", { exact: true }).waitFor();
  console.log("PASS: search and destructive actions require confirmation");

  await page.locator(".chat-session-item").filter({ hasText: "Phone Two" }).click();
  await phone.getByRole("button", { name: "打开微信", exact: true }).click();
  assert.equal(await phone.locator(".pocket-contact-row").count(), 0);
  await page.locator(".chat-session-item").filter({ hasText: "Phone One" }).click();
  assert.equal(await phone.locator(".pocket-device.theme-mint.large-text").count(), 1);
  await page.reload();
  await openPhone();
  assert.equal(await phone.locator(".pocket-device.theme-mint.large-text").count(), 1);
  await phone.getByRole("button", { name: "打开微信", exact: true }).click();
  assert.equal(await phone.locator(".pocket-contact-row").count(), 2);
  await phone.locator(".pocket-contact-row").filter({ hasText: "奶糖" }).click();
  assert.equal(await phone.locator(".pocket-message.user").count(), 3);
  assert.equal(await phone.locator(".pocket-message.assistant").count(), 4);
  assert.equal(await page.locator(".chat-message.user").filter({ hasText: "今天想吃草莓" }).count(), 1);
  assert.equal(await page.locator(".chat-message.assistant").filter({ hasText: reply }).count(), 3);
  console.log("PASS: session isolation and saved contacts, history, model and appearance after reload");

  const splitParts = ["哪科没写啊", "抄整份不行的，老李看得出来。哪道不会我下课讲给你。"];
  fixtureReply = splitParts.join("\r\n\r\n");
  await send("手机分段测试");
  const splitGroup = phone.locator(".pocket-message-group").filter({ hasText: splitParts[0] });
  await splitGroup.locator(".pocket-message-bubble").filter({ hasText: splitParts[1] }).waitFor();
  await phone.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  assert.deepEqual(await splitGroup.locator(".pocket-message-bubble").allTextContents(), splitParts);
  assert.equal(await splitGroup.locator(".pocket-avatar").count(), 2);
  const storedReply = await page.evaluate(() => JSON.parse(localStorage.getItem("renge_pocket_phone_v1:phone-one")).contacts.find(contact => contact.name === "奶糖").messages.at(-1));
  assert.equal(storedReply.content, fixtureReply);
  fixtureReply = reply;
  await send("保留原文检验");
  await phone.locator(".pocket-message.assistant").filter({ hasText: reply }).nth(3).waitFor();
  assert.equal(requests.at(-1).body.input.filter(message => JSON.stringify(message.content).includes(splitParts[0]) && JSON.stringify(message.content).includes(splitParts[1])).length, 1);
  await page.reload();
  await openPhone();
  await phone.getByRole("button", { name: "打开微信", exact: true }).click();
  await phone.locator(".pocket-contact-row").filter({ hasText: "奶糖" }).click();
  assert.deepEqual(await phone.locator(".pocket-message-group").filter({ hasText: splitParts[0] }).locator(".pocket-message-bubble").allTextContents(), splitParts);
  console.log("PASS: reply paragraphs render as separate bubbles after reload, while storage and shared context retain one original message");

  const handle = page.locator(".right-sidebar-resize-handle");
  const bounds = await handle.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 160, bounds.y + bounds.height / 2, { steps: 12 });
  await page.mouse.up();
  const width = await page.locator(".status-bar-sidebar").evaluate(node => node.clientWidth);
  assert.ok(width <= 270, `Expected a narrow phone sidebar, got ${width}`);
  assert.equal(await phone.locator(".pocket-screen").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await phone.screenshot({ path: ".runtime/pocket-narrow.png", animations: "disabled" });
  await page.setViewportSize({ width: 1600, height: 500 });
  await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click();
  await phone.getByRole("button", { name: "打开微信", exact: true }).waitFor();
  assert.equal(await phone.locator(".pocket-stage").evaluate(node => {
    node.scrollTop = 0;
    return node.querySelector(".pocket-device").getBoundingClientRect().top >= node.getBoundingClientRect().top;
  }), true);
  await phone.screenshot({ path: ".runtime/pocket-short.png", animations: "disabled" });
  assert.deepEqual(pageErrors, []);
  console.log("PASS: 260px sidebar, short window, and no browser runtime errors");
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: ".runtime/pocket-test-failure.png" });
    console.error((await page.locator("body").innerText()).slice(-3500));
  }
  throw error;
} finally {
  releaseSlowReply?.();
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-pocket-browser-")));
  await rm(root, { recursive: true, force: true });
}
