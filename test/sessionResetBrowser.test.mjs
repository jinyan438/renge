import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. Isolated persistence; no external model requests.
const root = await mkdtemp(join(tmpdir(), "renge-session-reset-"));
let server, browser, page, releaseReset;
try {
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  browser = await chromium.launch({ headless: true });
  const oldTime = "2020-01-01T00:00:00.000Z";
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  const session = (id, mode = "ai") => ({
    id, title: id, mode, workspaceKey: "default", workspaceName: "默认工作区",
    messages: [{ id: `old-${id}`, role: "user", content: `old-history-${id}`, createdAt: oldTime }],
    pendingInputs: [{ id: `queued-${id}`, content: "old-queued-input", attachments: [], mode: "queue", sender: "user", createdAt: oldTime }],
    heartbeat: { enabled: false, event: "old-heartbeat", intervalMinutes: 42, loopLimit: 9, runCount: 3, updatedAt: oldTime },
    memoryPersonaIds: ["old-persona"], scriptVariables: { oldVariable: true },
    tavernMetadata: { oldMetadata: true }, characterWorldBookOverrides: { "old-book": null },
    statusBar: { enabled: true, values: { oldStatus: "old status" } },
    createdAt: oldTime, updatedAt: oldTime,
  });
  const card = { id: "fixture-card", name: "Reset character", firstMessage: "The first greeting.", alternateGreetings: ["Alternate greeting."], tavernVariables: { initialVariable: "initial value" }, extensions: { heavy: "large card data;".repeat(50000) }, createdAt: now, updatedAt: now };
  const seed = async (sessions, mode = "ai") => {
    const response = await fetch(`${server.url}/api/app-data`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { version: 1, chatMode: mode, activeProviderId: provider.id, providers: [provider], chatSessions: sessions,
        characterCards: [card], activeCharacterCardId: card.id, llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false } } }),
    });
    assert.equal(response.status, 200);
  };
  const read = async () => (await (await fetch(`${server.url}/api/app-data`)).json()).data;
  const errors = [], requests = [], resets = [];
  let failReset = false, holdReset = true, databaseReads = 0, confirmReset = true;
  const confirmations = [];
  async function openChat(id) {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15_000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", async dialog => {
      confirmations.push({ type: dialog.type(), message: dialog.message() });
      if (confirmReset) await dialog.accept();
      else await dialog.dismiss();
    });
    await page.route("**/api/app-data", async route => {
      if (route.request().method() === "GET") databaseReads++;
      await route.continue();
    });
    await page.route("**/api/pi/session", async route => {
      resets.push(route.request().postDataJSON());
      if (holdReset) await new Promise(resolve => { releaseReset = resolve; });
      await route.fulfill(failReset ? { status: 500, json: { error: "fixture reset failure" } } : { json: { ok: true } });
    });
    await page.route("**/api/pi/chat", async route => {
      requests.push(route.request().postDataJSON());
      const event = { choices: [{ index: 0, delta: { content: "fresh fixture reply" }, finish_reason: null }] };
      await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n` });
    });
    await page.goto(server.url);
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    await page.locator(".chat-session-item").filter({ hasText: id }).locator("button").first().click();
    await page.waitForTimeout(800);
  }
  async function savedReset(id) {
    for (let index = 0; index < 100; index++) {
      const saved = (await read()).chatSessions.find(candidate => candidate.id === id);
      if (saved.createdAt !== oldTime && !JSON.stringify(saved).includes("old-history")) return saved;
      await delay(50);
    }
    throw new Error("reset did not reach persistence");
  }
  function assertClean(saved, variables = {}) {
    assert.notEqual(saved.createdAt, oldTime);
    assert.deepEqual(saved.pendingInputs ?? [], []);
    assert.deepEqual(saved.memoryPersonaIds, []);
    assert.deepEqual(saved.scriptVariables, variables);
    assert.deepEqual(saved.tavernMetadata, {});
    assert.equal(saved.characterWorldBookOverrides, undefined);
    assert.equal(saved.heartbeat.enabled, false);
    assert.equal(saved.heartbeat.event, "");
    assert.equal(saved.heartbeat.runCount, 0);
    assert.equal(saved.statusBar.enabled, false);
    assert.deepEqual(saved.statusBar.values, {});
  }

  await seed([session("reset-ai"), { ...session("other-chat"), pendingInputs: [] }]);
  const imagePath = join(root, "session-images", "reset-ai", "old.png");
  const otherImage = join(root, "session-images", "other-chat", "keep.png");
  for (const id of ["reset-ai", "other-chat"]) await mkdir(join(root, "session-images", id), { recursive: true });
  await writeFile(imagePath, "old image"); await writeFile(otherImage, "keep image");
  await openChat("reset-ai");
  const otherBefore = (await read()).chatSessions.find(candidate => candidate.id === "other-chat");
  await page.evaluate(() => {
    for (const id of ["reset-ai", "other-chat"]) {
      localStorage.setItem(`renge_pocket_phone_v1:${id}`, JSON.stringify({ version: 1, contacts: [{ id: "old-contact", name: "Old phone contact", messages: [{ id: "old-phone-message", role: "assistant", content: "old phone history", createdAt: "2020-01-01T00:00:00.000Z" }] }] }));
      localStorage.setItem(`renge_pocket_red_v1:${id}`, JSON.stringify({ oldPhoneData: true }));
    }
  });
  await page.getByRole("button", { name: "展开右侧栏", exact: true }).click();
  await page.getByRole("button", { name: /手机.*可爱手机/ }).click();
  await page.locator(".pocket-panel").getByRole("button", { name: "打开微信", exact: true }).click();
  await page.locator(".pocket-panel").getByText("Old phone contact", { exact: true }).waitFor();
  const input = page.getByPlaceholder("输入消息，可粘贴图片");
  await input.fill("old draft");
  await page.locator(".chat-attachment-input").setInputFiles({ name: "old-note.txt", mimeType: "text/plain", buffer: Buffer.from("old attachment") });
  const readsBefore = databaseReads;
  confirmReset = false;
  const sessionBeforeCancel = (await read()).chatSessions.find(candidate => candidate.id === "reset-ai");
  await page.getByRole("button", { name: "重置当前会话", exact: true }).click();
  assert.equal(confirmations[0].type, "confirm");
  assert.match(confirmations[0].message, /清空该会话的所有数据/);
  assert.match(confirmations[0].message, /会话 ID 保持不变/);
  assert.match(confirmations[0].message, /无法撤销/);
  assert.equal(resets.length, 0, "cancel must not start backend cleanup");
  assert.equal(await input.inputValue(), "old draft", "cancel preserves the draft");
  assert.equal(await page.getByTitle("移除附件", { exact: true }).count(), 1, "cancel preserves attachments");
  await page.getByLabel("待处理消息", { exact: true }).getByText("old-queued-input", { exact: true }).waitFor();
  assert.deepEqual((await read()).chatSessions.find(candidate => candidate.id === "reset-ai"), sessionBeforeCancel);
  await access(imagePath);
  confirmReset = true;
  await page.getByRole("button", { name: "重置当前会话", exact: true }).click();
  await page.getByText("会话已清空。", { exact: true }).waitFor({ timeout: 2000 });
  assert.equal(confirmations.length, 2, "each click must request confirmation");
  assert.equal(await page.locator(".chat-message").count(), 0, "UI resets while Pi deletion is held indefinitely");
  assert.equal(await page.getByLabel("待处理消息").count(), 0);
  assert.equal(await input.inputValue(), "");
  assert.equal(await page.getByTitle("移除附件", { exact: true }).count(), 0);
  const savedAi = await savedReset("reset-ai");
  assert.equal(savedAi.id, "reset-ai"); assert.equal(savedAi.title, "新会话"); assertClean(savedAi);
  assert.deepEqual(savedAi.messages, []);
  assert.equal(databaseReads, readsBefore, "reset must not reload the entire app/card database");
  assert.deepEqual((await read()).chatSessions.find(candidate => candidate.id === "other-chat"), otherBefore);
  assert.deepEqual(await page.evaluate(() => [JSON.parse(localStorage.getItem("renge_pocket_phone_v1:reset-ai") || "{}").contacts ?? [], localStorage.getItem("renge_pocket_red_v1:reset-ai")]), [[], null]);
  assert.equal(await page.locator(".pocket-panel").getByText("Old phone contact", { exact: true }).count(), 0, "mounted phone must discard its old in-memory copy");
  assert.ok(await page.evaluate(() => localStorage.getItem("renge_pocket_phone_v1:other-chat")));
  await assert.rejects(access(imagePath)); await access(otherImage);

  await input.fill("new input after reset");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(requests.length, 0, "next generation waits for old Pi tree deletion");
  await page.locator(".chat-session-item").filter({ hasText: "other-chat" }).locator("button").first().click();
  holdReset = false; releaseReset();
  for (let index = 0; !requests.length && index < 100; index++) await delay(50);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sessionId, "reset-ai");
  assert.doesNotMatch(JSON.stringify(requests[0].request.messages), /old-history|old-queued-input|oldVariable/);
  await page.locator(".chat-message").getByText("old-history-other-chat", { exact: true }).waitFor();
  assert.equal(await page.getByText("fresh fixture reply", { exact: true }).count(), 0);
  await page.close();

  const roleSession = { ...session("reset-role", "roleplay"), roleplayCharacterCardId: card.id, roleplayGreetingIndex: 1 };
  await seed([roleSession, { ...session("other-role", "roleplay"), pendingInputs: [] }], "roleplay");
  await openChat("reset-role");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "重置当前会话", exact: true }).click();
  await page.getByText("The first greeting.", { exact: true }).waitFor({ timeout: 2000 });
  const savedRole = await savedReset("reset-role");
  assertClean(savedRole, { initialVariable: "initial value" });
  assert.equal(savedRole.id, "reset-role");
  assert.equal(savedRole.mode, "roleplay");
  assert.equal(savedRole.roleplayCharacterCardId, card.id);
  assert.equal(savedRole.roleplayGreetingIndex, 0);
  assert.equal(savedRole.messages.length, 1);
  assert.equal(savedRole.messages[0].source, "roleplay-greeting");
  await page.reload();
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.getByText("The first greeting.", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("待处理消息").count(), 0);
  await page.close();

  await seed([session("reset-failure")]);
  await openChat("reset-failure");
  failReset = true;
  await page.getByRole("button", { name: "重置当前会话", exact: true }).click();
  await page.getByText(/后台清理或保存失败：fixture reset failure/).waitFor();
  assert.equal(await page.locator(".chat-message").count(), 0);
  const requestCount = requests.length;
  await page.getByPlaceholder("输入消息，可粘贴图片").fill("must not reuse stale history");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".chat-composer .chat-status").getByText(/fixture reset failure/).waitFor();
  assert.equal(requests.length, requestCount, "failed cleanup prevents stale Pi history reuse");
  await page.reload();
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.getByPlaceholder("输入消息，可粘贴图片").fill("reload must not reuse stale history");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".chat-composer .chat-status").getByText(/fixture reset failure/).waitFor();
  assert.equal(requests.length, requestCount, "interrupted cleanup must remain pending across reloads");
  failReset = false;
  await page.getByRole("button", { name: "重置当前会话", exact: true }).click();
  await page.getByRole("button", { name: "重置当前会话", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="重置当前会话"]').disabled);
  await page.getByPlaceholder("输入消息，可粘贴图片").fill("successful retry");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText("fresh fixture reply", { exact: true }).waitFor();
  assert.equal(requests.length, requestCount + 1);
  await page.close();

  await seed(["delete-current", "delete-other"].map(id => ({ ...session(id), pendingInputs: [] })));
  for (const id of ["delete-current", "delete-other"]) {
    await mkdir(join(root, "session-images", id), { recursive: true });
    await writeFile(join(root, "session-images", id, "saved.png"), "saved image");
  }
  await openChat("delete-current");
  const deleteOther = page.locator(".chat-session-item").filter({ hasText: "delete-other" }).getByTitle("删除会话", { exact: true });
  confirmReset = false;
  const deletionBaseline = (await read()).chatSessions;
  const cleanupCount = resets.length;
  await deleteOther.click();
  assert.equal(confirmations.at(-1).type, "confirm");
  assert.match(confirmations.at(-1).message, /确定删除会话「delete-other」/);
  assert.match(confirmations.at(-1).message, /无法撤销/);
  assert.equal(resets.length, cleanupCount, "cancel deletion must not clear backend history");
  assert.deepEqual((await read()).chatSessions, deletionBaseline, "cancel deletion preserves both saved conversations");
  await access(join(root, "session-images", "delete-other", "saved.png"));
  confirmReset = true;
  const otherImageDeletion = page.waitForResponse(response => response.url().endsWith("/api/session-images/delete-other") && response.request().method() === "DELETE");
  await deleteOther.click();
  await deleteOther.waitFor({ state: "hidden" });
  assert.equal((await otherImageDeletion).status(), 200);
  await assert.rejects(access(join(root, "session-images", "delete-other", "saved.png")));
  assert.equal(await page.evaluate(() => localStorage.getItem("renge_active_chat_session")), "delete-current", "deleting a background conversation preserves the selected conversation");
  await access(join(root, "session-images", "delete-current", "saved.png"));

  const deleteCurrent = page.locator(".chat-session-item").filter({ hasText: "delete-current" }).getByTitle("删除会话", { exact: true });
  const currentTitle = (await page.locator(".chat-session-item").filter({ hasText: "delete-current" }).locator("button").first().textContent()).trim();
  confirmReset = false;
  await page.getByPlaceholder("输入消息，可粘贴图片").fill("keep draft when deletion is canceled");
  await deleteCurrent.click();
  assert.ok(confirmations.at(-1).message.includes(`确定删除会话「${currentTitle}」`));
  assert.equal(await page.getByPlaceholder("输入消息，可粘贴图片").inputValue(), "keep draft when deletion is canceled");
  assert.equal(await page.locator(".chat-session-item").count(), 1);
  await access(join(root, "session-images", "delete-current", "saved.png"));
  confirmReset = true;
  const currentImageDeletion = page.waitForResponse(response => response.url().endsWith("/api/session-images/delete-current") && response.request().method() === "DELETE");
  await deleteCurrent.click();
  await deleteCurrent.waitFor({ state: "hidden" });
  assert.equal((await currentImageDeletion).status(), 200);
  await assert.rejects(access(join(root, "session-images", "delete-current", "saved.png")));
  assert.equal(await page.locator(".chat-session-item").count(), 1, "deleting the last conversation creates a usable replacement");
  assert.notEqual(await page.evaluate(() => localStorage.getItem("renge_active_chat_session")), "delete-current");
  let savedAfterDeletion;
  for (let index = 0; index < 100; index++) {
    savedAfterDeletion = (await read()).chatSessions;
    if (savedAfterDeletion.every(candidate => !candidate.id.startsWith("delete-"))) break;
    await delay(50);
  }
  assert.equal(savedAfterDeletion.length, 1);
  assert.ok(savedAfterDeletion.every(candidate => !candidate.id.startsWith("delete-")), "confirmed deletion reaches persistence");
  assert.deepEqual(errors, []);
  assert.ok(resets.every(reset => ["reset-ai", "reset-role", "reset-failure", "delete-current", "delete-other"].includes(reset.sessionId)));
  console.log("Session reset browser regression passed: reset/delete confirmation and cancellation, immediate reset after confirmation, ID preservation, defaults, greeting, queues, drafts, images, phone stores, slow/failed cleanup, scoped generation, retry, persistence, mobile layout and last-conversation replacement.");
} catch (error) {
  if (page && !page.isClosed()) {
    console.error("Visible statuses:", await page.locator(".chat-status").allTextContents());
    await mkdir(".runtime", { recursive: true });
    await page.screenshot({ path: ".runtime/session-reset-failure.png" });
  }
  throw error;
} finally {
  releaseReset?.();
  await browser?.close();
  if (server) { server.server.closeAllConnections(); await new Promise(resolve => server.server.close(resolve)); }
  await rm(root, { recursive: true, force: true });
}
