import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { emptyPocketState, makePocketContact } from "../src/pocketPhoneState.ts";
import { fixtureWechatTurn } from "./pocketPhoneInnerFixture.mjs";
import { parsePocketCalendarTime } from "../src/pocketCalendarState.ts";

const root = await mkdtemp(join(tmpdir(), "renge-pocket-calendar-"));
const key = "renge_pocket_phone_v1:calendar-fixture";
const realStart = new Date(2026, 9, 8, 6).getTime();
const initialTime = parsePocketCalendarTime("2000-06-06", "20:00");
const mainRequests = []; const phoneRequests = []; const errors = [];
let server; let browser; let page; let mainReply = "已经记住新的时间了。";
let blockCalendarSave = false;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date(realStart).toISOString();
  const provider = { id: "fixture", name: "测试", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture", models: ["fixture"], updatedAt: now };
  const seed = { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], userProfile: { nickname: "小月", bio: "", avatarImage: "/touxiang/20.png" },
    chatSessions: [{ id: "calendar-fixture", title: "日历测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: "scene", role: "assistant", content: "当前时间：6月6日晚上8点。", createdAt: now }], createdAt: now, updatedAt: now }] };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  const owner = makePocketContact({ name: "奶糖", avatar: "/touxiang/9.png", personality: "朋友", greeting: "", sourceLabel: "自定义角色" });
  owner.messages = [{ id: "before-jump", role: "user", content: "跳转前的信息", createdAt: now }];
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, timezoneId: "Asia/Shanghai" }); page.setDefaultTimeout(15000);
  await page.clock.setFixedTime(realStart);
  await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); }, { key, state: { ...emptyPocketState(), contacts: [owner], wechatClock: { initialTime, initialRealTime: realStart } } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/app-data", async route => {
    if (blockCalendarSave && ["PATCH", "PUT"].includes(route.request().method())) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture unavailable" }) });
    else await route.continue();
  });
  await page.route("**/api/chat/completions", async route => {
    phoneRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content: fixtureWechatTurn("收到日历后的消息", phoneRequests.length) } }] }) });
  });
  await page.route("**/api/pi/chat", async route => {
    mainRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: mainReply }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`, "data: [DONE]", "",
    ].join("\n\n") });
  });
  const phone = page.locator(".pocket-panel");
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  async function showPhone() {
    const expand = page.getByRole("button", { name: "展开右侧栏", exact: true }); if (await expand.isVisible()) await expand.click();
    await page.getByRole("button", { name: /手机.*可爱手机/ }).click(); await phone.getByRole("button", { name: "打开日历", exact: true }).waitFor();
  }
  async function enterApp() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click(); await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    const maximize = page.getByRole("button", { name: "最大化窗口", exact: true }); if (await maximize.isVisible()) await maximize.click();
  }
  async function jump(date, time) {
    await phone.getByLabel("跳转日期", { exact: true }).fill(date); await phone.getByLabel("跳转时间", { exact: true }).fill(time);
    await phone.getByRole("button", { name: "跳转到选定时间", exact: true }).click(); await phone.locator(".pocket-calendar-feedback").waitFor();
  }
  async function sendMain(content) {
    const count = mainRequests.length;
    await page.getByPlaceholder("输入消息，可粘贴图片", { exact: true }).fill(content); await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.locator(".chat-message.assistant").filter({ hasText: mainReply }).last().waitFor();
    assert.equal(mainRequests.length, count + 1);
  }
  await page.goto(server.url); await enterApp(); await showPhone(); await phone.getByRole("button", { name: "打开日历", exact: true }).click();
  assert.equal(await phone.getByLabel("跳转日期", { exact: true }).inputValue(), "2000-06-06");
  assert.equal(await phone.getByRole("button", { name: "跳转到选定时间", exact: true }).isDisabled(), true);
  await phone.getByRole("button", { name: "下个月", exact: true }).click(); assert.equal(await phone.getByLabel("跳转日期", { exact: true }).inputValue(), "2000-07-06");
  await phone.getByRole("button", { name: "2000年7月12日", exact: true }).click(); assert.equal(await phone.getByLabel("跳转日期", { exact: true }).inputValue(), "2000-07-12");
  await phone.getByRole("button", { name: "查看当前时间", exact: true }).click();
  await jump("2031-02-28", "23:45");
  let saved = await read(); assert.equal(saved.wechatClock.storyTime, parsePocketCalendarTime("2031-02-28", "23:45"));
  assert.equal(saved.contacts[0].messages.length, 1); assert.equal(saved.contacts[0].messages[0].wechatTime, initialTime);
  assert.equal(await phone.getByRole("button", { name: "跳转到选定时间", exact: true }).isDisabled(), true);
  const firstContext = page.locator(".chat-message.user").filter({ hasText: "当前剧情时间：2031年2月28日 23:45" }); assert.equal(await firstContext.count(), 1);
  await phone.screenshot({ path: ".runtime/pocket-calendar.png", animations: "disabled" });
  await sendMain("按照选定的时间继续");
  assert.match(JSON.stringify(mainRequests.at(-1).request.messages), /日历.*时间更新/);
  assert.match(JSON.stringify(mainRequests.at(-1).request.messages), /2031年2月28日 23:45/);
  const scopeBefore = mainRequests.at(-1).piSessionScope;
  await phone.getByRole("button", { name: "返回手机桌面", exact: true }).click(); await phone.getByRole("button", { name: "打开ta的手机", exact: true }).click(); await phone.getByRole("button", { name: "查看奶糖的手机", exact: true }).click();
  await phone.getByRole("button", { name: "打开日历", exact: true }).click(); assert.equal(await phone.getByLabel("跳转日期", { exact: true }).inputValue(), "2031-02-28");
  await page.clock.setFixedTime(realStart + 3600000); await jump("2019-07-12", "07:05");
  assert.equal((await read()).wechatClock.storyTime, parsePocketCalendarTime("2019-07-12", "07:05"));
  await phone.getByRole("button", { name: "返回手机桌面", exact: true }).click(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: "小月" }).click();
  await phone.locator(".pocket-composer textarea").fill("日历跳转后的消息"); await phone.getByRole("button", { name: "发送消息", exact: true }).click();
  assert.equal((await read()).contacts[0].messages.at(-1).wechatTime, parsePocketCalendarTime("2019-07-12", "07:05"));
  await phone.getByRole("button", { name: "发送消息", exact: true }).click(); await phone.locator(".pocket-message.assistant").filter({ hasText: "收到日历后的消息" }).waitFor();
  assert.match(phoneRequests.at(-1).request.messages[0].content, /当前微信时间：7\/12.*07:05/);
  assert.match(JSON.stringify(phoneRequests.at(-1).request.messages), /2019年7月12日 07:05/);
  await page.reload(); await enterApp(); await showPhone(); await phone.getByRole("button", { name: "打开日历", exact: true }).click();
  assert.equal(await phone.getByLabel("跳转日期", { exact: true }).inputValue(), "2019-07-12");
  assert.equal(await phone.getByLabel("跳转时间", { exact: true }).inputValue(), "07:05");
  assert.equal(await page.locator(".chat-message.user").filter({ hasText: "当前剧情时间：2019年7月12日 07:05" }).count(), 1);
  mainReply = "当前时间：2020年3月1日12:30。"; await sendMain("进入下一段剧情");
  await page.waitForFunction(({ key, expected }) => JSON.parse(localStorage.getItem(key)).wechatClock.storyTime === expected, { key, expected: parsePocketCalendarTime("2020-03-01", "12:30") });
  assert.notEqual(mainRequests.at(-1).piSessionScope, scopeBefore);
  await phone.getByRole("button", { name: "查看当前时间", exact: true }).click();
  assert.equal(await phone.getByLabel("跳转日期", { exact: true }).inputValue(), "2020-03-01");
  assert.equal(await phone.getByLabel("跳转时间", { exact: true }).inputValue(), "12:30");
  await phone.getByLabel("跳转日期", { exact: true }).fill(""); assert.equal(await phone.getByRole("button", { name: "跳转到选定时间", exact: true }).isDisabled(), true);
  await phone.getByRole("button", { name: "查看当前时间", exact: true }).click();
  blockCalendarSave = true;
  await phone.getByLabel("跳转日期", { exact: true }).fill("2035-08-15"); await phone.getByLabel("跳转时间", { exact: true }).fill("16:20");
  await phone.getByRole("button", { name: "跳转到选定时间", exact: true }).click();
  await phone.getByRole("button", { name: "重试保存时间", exact: true }).waitFor();
  assert.equal(await phone.locator(".pocket-calendar-feedback").count(), 0);
  blockCalendarSave = false;
  await phone.getByRole("button", { name: "重试保存时间", exact: true }).click(); await phone.locator(".pocket-calendar-feedback").waitFor();
  assert.equal(await page.locator(".chat-message.user").filter({ hasText: "当前剧情时间：2035年8月15日 16:20" }).count(), 1);
  const handle = page.locator(".right-sidebar-resize-handle"); const bounds = await handle.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + 170, bounds.y + bounds.height / 2, { steps: 12 }); await page.mouse.up();
  assert.equal(await phone.locator(".pocket-calendar").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await phone.screenshot({ path: ".runtime/pocket-calendar-narrow.png", animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log("PASS: calendar browsing, date/time jumps in both phones, one context record, main and WeChat requests, persistence and retry, body priority, invalid input and narrow layout");
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: ".runtime/pocket-calendar-failure.png" });
  throw error;
} finally {
  await browser?.close(); server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-pocket-calendar-")));
  await rm(root, { recursive: true, force: true });
}
