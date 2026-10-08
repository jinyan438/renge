import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { emptyPocketState, makePocketContact } from "../src/pocketPhoneState.ts";
import { fixtureWechatTurn } from "./pocketPhoneInnerFixture.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-wechat-clock-"));
const key = "renge_pocket_phone_v1:clock-fixture";
const realStart = new Date(2026, 9, 8, 6).getTime();
const local = (day, hour) => new Date(2000, 5, day, hour).toISOString();
let server; let browser; let page; let mainReply = "当前时间：6月10日早上7点。角色走进教室。";
const errors = []; const requests = [];
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date(realStart).toISOString();
  const provider = { id: "fixture", name: "测试", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture", models: ["fixture"], updatedAt: now };
  const seed = { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], userProfile: { nickname: "小月", bio: "", avatarImage: "/touxiang/20.png" },
    chatSessions: [{ id: "clock-fixture", title: "微信虚拟时间测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: "scene", role: "assistant", content: "当前时间：6月6日晚上8点。", createdAt: now }], createdAt: now, updatedAt: now }] };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  const owner = makePocketContact({ name: "奶糖", avatar: "/touxiang/9.png", personality: "朋友", greeting: "", sourceLabel: "自定义角色" });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, timezoneId: "Asia/Shanghai" }); page.setDefaultTimeout(15000);
  await page.clock.setFixedTime(realStart);
  await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); }, { key, state: { ...emptyPocketState(), contacts: [owner], wechatClock: { initialTime: local(6, 20), initialRealTime: realStart } } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/chat/completions", async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content: fixtureWechatTurn("生成的微信回复", requests.length) } }] }) });
  });
  await page.route("**/api/pi/chat", async route => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: mainReply }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`, "data: [DONE]", "",
    ].join("\n\n") });
  });
  const phone = page.locator(".pocket-panel");
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  async function showPhone() {
    const expand = page.getByRole("button", { name: "展开右侧栏", exact: true }); if (await expand.isVisible()) await expand.click();
    await page.getByRole("button", { name: /手机.*可爱手机/ }).click();
    await phone.getByRole("button", { name: "打开微信", exact: true }).waitFor();
  }
  async function openOwnChat() { await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: "奶糖" }).click(); }
  async function queue(text) { await phone.locator(".pocket-composer textarea").fill(text); await phone.getByRole("button", { name: "发送消息", exact: true }).click(); }
  async function openMirror() { await phone.getByRole("button", { name: "打开ta的手机", exact: true }).click(); await phone.getByRole("button", { name: "查看奶糖的手机", exact: true }).click(); await phone.getByRole("button", { name: "打开微信", exact: true }).click(); await phone.locator(".pocket-contact-row").filter({ hasText: "小月" }).click(); }
  async function sendMain(text) { await page.getByPlaceholder("输入消息，可粘贴图片", { exact: true }).fill(text); await page.getByRole("button", { name: "发送", exact: true }).click(); await page.locator(".chat-message.assistant").filter({ hasText: mainReply }).last().waitFor(); }

  await page.goto(server.url); await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click(); await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  const maximize = page.getByRole("button", { name: "最大化窗口", exact: true }); if (await maximize.isVisible()) await maximize.click();
  await showPhone(); assert.equal(await phone.locator(".pocket-status > span").first().innerText(), "20:00");
  await openOwnChat(); await queue("第一次发消息");
  assert.equal((await read()).contacts[0].messages.at(-1).wechatTime, local(6, 20));
  await page.clock.setFixedTime(realStart + 27 * 3600000); await queue("过了27小时的消息");
  let saved = await read(); const secondId = saved.contacts[0].messages.at(-1).id;
  assert.equal(saved.contacts[0].messages.at(-1).wechatTime, local(7, 23));
  assert.equal(await phone.locator(".pocket-status > span").first().innerText(), "23:00");
  assert.match(await phone.locator(".pocket-message-time").last().innerText(), /6\/7.*23:00/);
  await phone.getByRole("button", { name: "发送消息", exact: true }).click(); await phone.locator(".pocket-message.assistant").filter({ hasText: "生成的微信回复" }).waitFor();
  assert.equal((await read()).contacts[0].messages.at(-1).wechatTime, local(7, 23));
  assert.match(requests.at(-1).request.messages[0].content, /微信时间变量[\s\S]*6\/7.*23:00/);
  const storyAnchor = (await read()).wechatClock.storyRealTime;
  await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click(); await openMirror();
  assert.equal(await phone.locator(`[data-message-id="${secondId}"] .pocket-message.assistant`).count(), 1);
  assert.match(await phone.locator(".pocket-message-time").last().innerText(), /6\/7.*23:00/);
  await page.reload(); await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click(); await page.getByRole("button", { name: "开始对话", exact: true }).last().click(); await showPhone();
  assert.equal((await read()).wechatClock.storyRealTime, storyAnchor);
  assert.equal(await phone.locator(".pocket-status > span").first().innerText(), "23:00");
  await phone.getByRole("button", { name: "关闭手机模块", exact: true }).click(); await sendMain("继续剧情");
  await page.waitForFunction(({ key, expected }) => JSON.parse(localStorage.getItem(key)).wechatClock.storyTime === expected, { key, expected: local(10, 7) });
  await showPhone(); assert.equal(await phone.locator(".pocket-status > span").first().innerText(), "07:00");
  await openOwnChat(); await queue("正文校准后的消息"); saved = await read();
  assert.equal(saved.contacts[0].messages.at(-1).wechatTime, local(10, 7));
  assert.equal(saved.contacts[0].messages.find(message => message.id === secondId).wechatTime, local(7, 23));
  const oldStoryKey = saved.wechatClock.storyKey;
  mainReply = "明天早上九点见。"; await sendMain("约一下明天");
  assert.equal((await read()).wechatClock.storyKey, oldStoryKey);
  assert.equal(await phone.locator(".pocket-status > span").first().innerText(), "07:00");
  await phone.screenshot({ path: ".runtime/wechat-virtual-clock.png", animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log("PASS: independent WeChat time, exact 27-hour fallback, main-body priority with closed and open phones, unchanged historical times, shared owner clock, generation context and reload");
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: ".runtime/wechat-clock-failure.png" });
  throw error;
} finally {
  await browser?.close(); server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-wechat-clock-")));
  await rm(root, { recursive: true, force: true });
}
