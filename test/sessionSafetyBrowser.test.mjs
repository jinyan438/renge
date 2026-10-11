import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. All persistence and model responses are isolated.
const root = await mkdtemp(join(tmpdir(), "renge-session-browser-"));
let server;
let browser;
let currentPage;
try {
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  browser = await chromium.launch({ headless: true });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  const session = (id, messages = [{ id: `seed-${id}`, role: "user", content: id, createdAt: now }]) => ({ id, title: id, mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages, createdAt: now, updatedAt: now });
  const seed = async (chatSessions, extra = {}) => {
    const response = await fetch(`${server.url}/api/app-data`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false }, chatSessions, ...extra } }),
    });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).sessionVersions, "replacement imports must return the new baseline versions");
  };
  const read = async () => (await fetch(`${server.url}/api/app-data`)).json();
  const errors = [];
  async function openChat(id, android = false) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    currentPage = page;
    page.setDefaultTimeout(15_000);
    page.on("pageerror", error => errors.push(error.message));
    if (android) await page.addInitScript(() => { window.RengeAndroidNative = {}; });
    let replyCount = 0;
    await page.route("**/api/pi/chat", async route => {
      const text = ++replyCount === 2 ? "这里是新增的续写内容。" : "fixture reply";
      const content = { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] };
      await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(content)}\n\ndata: [DONE]\n\n` });
    });
    await page.goto(server.url);
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    const item = android ? page.locator(".chat-session-item").first()
      : page.locator(".chat-session-item").filter({ hasText: id });
    await item.click();
    await page.waitForTimeout(1_000); // finish initial normalization/autosave
    return page;
  }
  async function send(page, content) {
    await page.getByPlaceholder("输入消息，可粘贴图片").fill(content);
    const request = page.waitForRequest("**/api/pi/chat");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const body = (await request).postDataJSON();
    await page.locator(".chat-message.assistant").filter({ hasText: "fixture reply" }).last().waitFor();
    return body;
  }
  async function remoteEdit(id, text) {
    const baseline = await read();
    const original = baseline.data.chatSessions.find(s => s.id === id);
    const edited = { ...original, messages: [...original.messages, { id: `remote-${text}`, role: "user", content: text, createdAt: now }] };
    const response = await fetch(`${server.url}/api/app-data`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: {}, sessionPatch: { upserts: [{ session: edited, expectedVersion: baseline.sessionVersions[id] }], deletes: [] } }),
    });
    assert.equal(response.status, 200);
  }

  await seed([session("client-a"), session("client-b")]);
  const page = await openChat("client-a");
  await remoteEdit("client-b", "remote B must survive");
  const successfulSave = page.waitForResponse(response => response.url().endsWith("/api/app-data") && response.request().method() === "PATCH" && response.status() === 200);
  await send(page, "local A");
  const patch = (await successfulSave).request().postDataJSON();
  assert.equal(patch.data.chatSessions, undefined);
  assert.deepEqual(patch.sessionPatch.upserts.map(item => item.session.id), ["client-a"]);
  assert.match(JSON.stringify((await read()).data.chatSessions.find(s => s.id === "client-b")), /remote B must survive/);
  await page.locator(".chat-composer .chat-status").getByText("回复已生成。", { exact: true }).waitFor();
  await page.locator(".chat-message.assistant").filter({ hasText: "fixture reply" }).last().locator(".chat-message-more").click();
  const continuation = page.waitForRequest("**/api/pi/chat");
  await page.locator(".chat-message-menu").getByRole("button", { name: "续写", exact: true }).click();
  assert.equal((await continuation).postDataJSON().piHistoryMode, "replace", "continuation must supply authoritative history");
  await page.locator(".chat-composer .chat-status").getByText("续写已完成。", { exact: true }).waitFor();
  await page.waitForTimeout(700);
  await remoteEdit("client-a", "remote A must survive");
  await send(page, "stale local A");
  const warning = page.locator(".app-data-save-error");
  await warning.waitFor();
  assert.match(await warning.textContent(), /另一窗口修改/);
  await warning.getByRole("button", { name: "导出本页备份" }).waitFor();
  const savedA = JSON.stringify((await read()).data.chatSessions.find(s => s.id === "client-a"));
  assert.match(savedA, /remote A must survive/);
  assert.doesNotMatch(savedA, /stale local A/);
  await page.close();

  const messages = Array.from({ length: 12 }, (_, index) => ({ id: `old-${index}`, role: index % 2 ? "assistant" : "user", content: `第${index}轮讨论需求。` + "需要保留项目目标和已经确定的方案。".repeat(220), createdAt: now }));
  await seed([session("android-chat", messages)], { contextCompressionSettings: { enabled: true, modelLimits: [{ id: "limit", modelId: provider.modelId, maxContextTokens: 16_384 }] } });
  const android = await openChat("android-chat", true);
  let summaryRequests = 0;
  await android.route("**/api/chat/completions", async route => {
    summaryRequests++;
    await route.fulfill({ json: { choices: [{ message: { role: "assistant", content: "项目目标和约束已确认，继续实现现有方案。" } }] } });
  });
  const normalRequest = await send(android, "继续讨论");
  assert.ok(summaryRequests > 0, "Android Pi must actually request automatic summaries");
  assert.ok(JSON.stringify(normalRequest.request.messages).length < JSON.stringify(messages).length, "Android automatic compression must shorten the upstream input");
  await android.locator(".chat-composer .chat-status").getByText("回复已生成。", { exact: true }).waitFor();
  let snapshot;
  await android.route("**/api/pi/compact", async route => {
    snapshot = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await android.locator(".context-token-menu summary").click();
  await android.getByRole("button", { name: "立即压缩", exact: true }).click();
  await android.getByText("Pi 已完成手动上下文压缩。", { exact: true }).waitFor();
  assert.ok(snapshot.originalMessages.length > 0);
  assert.ok(JSON.stringify(snapshot.compactedMessages).length < JSON.stringify(snapshot.originalMessages).length, "manual compression must send a real shorter prefix to Android");
  assert.deepEqual(errors, []);
  console.log("Session browser regression passed: independent save, visible conflict, Android automatic and manual compression.");
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    console.error("Visible status:", await currentPage.locator(".chat-status").allTextContents());
    await currentPage.screenshot({ path: ".runtime/session-safety-browser-failure.png" });
  }
  throw error;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
