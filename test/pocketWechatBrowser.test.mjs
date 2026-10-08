import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { emptyPocketState, makePocketContact } from "../src/pocketPhoneState.ts";
import { fixtureWechatTurn } from "./pocketPhoneInnerFixture.mjs";

// Built client, isolated storage, local fixture model; no real account changes.
const root = await mkdtemp(join(tmpdir(), "renge-wechat-browser-"));
let server; let browser; let page;
const requests = []; const errors = [];
let texts = ["收到啦"];
const key = "renge_pocket_phone_v1:wechat-fixture";
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "本地测试", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture", models: ["fixture"], updatedAt: now };
  const seed = { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], userProfile: { nickname: "小月", bio: "", avatarImage: "" }, chatSessions: [{ id: "wechat-fixture", title: "微信测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [], createdAt: now, updatedAt: now }] };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  const state = { ...emptyPocketState(), contacts: [makePocketContact({ name: "奶糖", avatar: "/touxiang/9.png", personality: "小月的朋友，喜欢草莓", greeting: "", sourceLabel: "自定义角色" })] };
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); }, { key, state });
  await page.route("**/api/chat/completions", async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content: fixtureWechatTurn(JSON.stringify({ texts }), requests.length) } }] }) });
  });
  const phone = page.locator(".pocket-panel");
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  async function openPhone() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    const maximize = page.getByRole("button", { name: "最大化窗口", exact: true }); if (await maximize.isVisible()) await maximize.click();
    await page.getByRole("button", { name: "展开右侧栏", exact: true }).click();
    await page.getByRole("button", { name: /手机.*可爱手机/ }).click();
    await phone.getByRole("button", { name: "打开微信", exact: true }).click();
  }
  async function openMe() {
    const back = phone.getByRole("button", { name: "返回微信列表", exact: true }); if (await back.isVisible()) await back.click();
    await phone.getByRole("navigation", { name: "微信导航" }).getByRole("button", { name: "我", exact: true }).click();
  }
  async function openWallet() { await openMe(); await phone.getByRole("button", { name: "服务", exact: true }).click(); await phone.getByRole("button", { name: "钱包", exact: true }).click(); }
  async function openChat() {
    await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click();
    await phone.getByRole("button", { name: "打开微信", exact: true }).click();
    await phone.locator(".pocket-contact-row").filter({ hasText: "奶糖" }).click();
  }
  async function attachment(kind) {
    if (await phone.getByRole("button", { name: "更多聊天功能", exact: true }).getAttribute("aria-expanded") !== "true") await phone.getByRole("button", { name: "更多聊天功能", exact: true }).click();
    await phone.locator(".pocket-wx-attach-panel").getByRole("button", { name: kind, exact: true }).click();
    return phone.getByRole("dialog");
  }
  async function generate(nextTexts) {
    texts = nextTexts; const count = requests.length;
    await phone.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.waitForFunction(({ key, count }) => JSON.parse(localStorage.getItem(key)).contacts[0].innerHistory?.length === count + 1, { key, count });
    await phone.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  }
  await page.goto(server.url); await openPhone();
  await openMe(); await phone.screenshot({ path: ".runtime/wechat-me.png", animations: "disabled" });
  await phone.getByRole("button", { name: "服务", exact: true }).click();
  assert.match(await phone.locator(".pocket-wx-pay-card").innerText(), /¥0\.00/);
  await phone.screenshot({ path: ".runtime/wechat-service.png", animations: "disabled" });
  await phone.getByRole("button", { name: "钱包", exact: true }).click();
  await phone.screenshot({ path: ".runtime/wechat-wallet.png", animations: "disabled" });
  await phone.getByRole("button", { name: /^零钱 ¥/, exact: true }).click();
  assert.equal(await phone.getByLabel("零钱余额", { exact: true }).innerText(), "¥0.00");
  await phone.getByRole("button", { name: "修改余额", exact: true }).click();
  await phone.getByRole("dialog").getByLabel("零钱金额", { exact: true }).fill("100.00");
  await phone.getByRole("button", { name: "保存余额", exact: true }).click();
  assert.equal((await read()).wallet.balance, 100);
  await phone.screenshot({ path: ".runtime/wechat-balance.png", animations: "disabled" });
  await openChat();
  await phone.getByRole("button", { name: "更多聊天功能", exact: true }).click();
  assert.deepEqual(await phone.locator(".pocket-wx-attach-panel button small").allTextContents(), ["转账", "图片", "语音", "位置"]);
  await phone.screenshot({ path: ".runtime/wechat-attachments.png", animations: "disabled" });
  let dialog = await attachment("转账");
  await dialog.getByLabel("转账金额", { exact: true }).fill("100.01");
  await dialog.getByRole("button", { name: "确认转账", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "余额不足" }).waitFor();
  assert.equal((await read()).wallet.balance, 100);
  await dialog.getByLabel("转账金额", { exact: true }).fill("5.20");
  await dialog.getByLabel("转账说明", { exact: true }).fill("午饭钱");
  await dialog.getByRole("button", { name: "确认转账", exact: true }).click();
  assert.equal((await read()).wallet.balance, 94.8); assert.equal(requests.length, 0);
  const outgoing = (await read()).contacts[0].messages.at(-1);
  await generate([`[收款:${outgoing.id}]`, "谢谢"]);
  assert.match(requests[0].request.messages[0].content, /待你处理的用户转账编号/);
  assert.match(requests[0].request.messages[0].content, new RegExp(outgoing.id));
  await phone.locator(".pocket-message.user .pocket-wx-transfer.status-received").waitFor();
  await generate(["[转账:12.34:奶茶钱]"]);
  await phone.getByRole("button", { name: "确认收款", exact: false }).click();
  assert.equal((await read()).wallet.balance, 107.14);
  assert.equal(await phone.getByRole("button", { name: "确认收款", exact: false }).count(), 0);
  await generate(["[转账:1.00:退还测试]"]);
  await phone.locator(".pocket-wx-transfer-actions").getByRole("button", { name: "退还", exact: true }).click();
  assert.equal((await read()).wallet.balance, 107.14);
  dialog = await attachment("图片");
  await dialog.getByLabel("图片描述", { exact: true }).fill("一盘刚做好的草莓蛋糕");
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await phone.getByRole("button", { name: "查看聊天图片", exact: true }).last().click();
  await phone.getByRole("dialog", { name: "聊天图片", exact: true }).waitFor();
  await phone.getByRole("button", { name: "关闭图片预览", exact: true }).click();
  dialog = await attachment("图片");
  await dialog.locator('input[type="file"]').setInputFiles("public/touxiang/1.png");
  await dialog.locator(".pocket-wx-photo-preview").waitFor();
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  assert.match((await read()).contacts[0].messages.at(-1).attachment.url, /^data:image\/jpeg;base64,/);
  dialog = await attachment("语音");
  await dialog.getByLabel("语音时长", { exact: true }).fill("5");
  await dialog.getByLabel("语音内容", { exact: true }).fill("今天一起吃蛋糕吧");
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await phone.getByRole("button", { name: "展开语音文字", exact: true }).click();
  await phone.locator(".pocket-wx-voice p").filter({ hasText: "今天一起吃蛋糕吧" }).waitFor();
  dialog = await attachment("位置");
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "请填写地点名称" }).waitFor();
  await dialog.getByLabel("地点名称", { exact: true }).fill("学校南门");
  await dialog.getByLabel("详细地址", { exact: true }).fill("文华路 18 号");
  await phone.screenshot({ path: ".runtime/wechat-location-compose.png", animations: "disabled" });
  const beforeLocation = requests.length;
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  assert.equal(requests.length, beforeLocation);
  assert.deepEqual((await read()).contacts[0].messages.at(-1).attachment, { kind: "location", name: "学校南门", address: "文华路 18 号" });
  const sentLocation = phone.locator(".pocket-message.user .pocket-wx-location");
  assert.match(await sentLocation.innerText(), /学校南门.*文华路 18 号/s);
  await sentLocation.click();
  await phone.getByRole("dialog", { name: "位置信息", exact: true }).getByText("文华路 18 号", { exact: true }).waitFor();
  await phone.screenshot({ path: ".runtime/wechat-location-details.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await phone.getByRole("dialog", { name: "位置信息", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await sentLocation.evaluate(node => node === document.activeElement), true);
  await generate(["[图片:窗边的草莓蛋糕]", "[语音:3:好呀，等我一下]", "[位置:星光咖啡店:文华路 20 号一楼]"]);
  assert.match(JSON.stringify(requests.at(-1)), /图片.*草莓蛋糕/); assert.match(JSON.stringify(requests.at(-1)), /语音 5秒.*一起吃蛋糕/);
  assert.match(JSON.stringify(requests.at(-1)), /位置：学校南门.*文华路 18 号/);
  assert.match(requests.at(-1).request.messages[0].content, /\[位置:地点名称:详细地址\]/);
  const receivedLocation = phone.locator(".pocket-message.assistant .pocket-wx-location");
  assert.match(await receivedLocation.innerText(), /星光咖啡店.*文华路 20 号一楼/s);
  await receivedLocation.click();
  await phone.getByRole("dialog", { name: "位置信息", exact: true }).getByText("星光咖啡店", { exact: true }).waitFor();
  await phone.getByRole("button", { name: "关闭位置信息", exact: true }).click();
  assert.equal(await phone.locator(".pocket-message.assistant .pocket-wx-image").count(), 1);
  await phone.screenshot({ path: ".runtime/wechat-rich-chat.png", animations: "disabled" });
  await openWallet(); await phone.getByRole("button", { name: "账单", exact: true }).click();
  assert.equal(await phone.locator(".pocket-wx-bill").count(), 3);
  await phone.screenshot({ path: ".runtime/wechat-bills.png", animations: "disabled" });
  await page.reload(); await openPhone(); await openWallet();
  assert.equal((await read()).wallet.balance, 107.14);
  assert.deepEqual((await read()).contacts[0].messages.filter(message => message.attachment?.kind === "location").map(message => message.attachment.name), ["学校南门", "星光咖啡店"]);
  await phone.getByRole("button", { name: /^零钱 ¥/, exact: true }).click();
  assert.equal(await phone.getByLabel("零钱余额", { exact: true }).innerText(), "¥107.14");
  // Exercise the actual sidebar resize handle and ensure the new pages fit.
  const handle = page.locator(".right-sidebar-resize-handle");
  const bounds = await handle.boundingBox();
  if (bounds) { await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + 160, bounds.y + bounds.height / 2, { steps: 12 }); await page.mouse.up(); }
  assert.equal(await phone.locator(".pocket-wx-account").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await phone.screenshot({ path: ".runtime/wechat-wallet-narrow.png", animations: "disabled" });
  await openChat();
  assert.equal(await phone.locator(".pocket-wx-location").count(), 2);
  assert.equal(await phone.locator(".pocket-wx-location").evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), true);
  await phone.getByRole("button", { name: "更多聊天功能", exact: true }).click();
  assert.equal(await phone.locator(".pocket-wx-attach-panel").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await phone.screenshot({ path: ".runtime/wechat-location-narrow.png", animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log("PASS: wallet editing/reload, insufficient funds, NPC and user receipts, refusal, photo upload/preview, voice expansion, user and character locations, shared model context, narrow sidebar, no runtime errors");
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: ".runtime/wechat-test-failure.png" });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-wechat-browser-")));
  await rm(root, { recursive: true, force: true });
}
