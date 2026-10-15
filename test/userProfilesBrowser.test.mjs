import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { strFromU8, unzipSync } from "fflate";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. All data and model replies are isolated fixtures.
const root = await mkdtemp(join(tmpdir(), "renge-user-profiles-"));
const errors = [], requests = [];
let server, browser, page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "测试", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture", models: ["fixture"], updatedAt: now };
  const legacy = { nickname: "原用户", bio: "原用户喜欢画画", avatarImage: "/touxiang/20.png", sendToAi: true, updatedAt: now };
  const seed = { version: 1, userProfile: legacy, providers: [provider], activeProviderId: provider.id, chatMode: "ai",
    llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
    chatSessions: [{ id: "fixture-chat", title: "资料测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: "seed", role: "user", content: "资料测试", createdAt: now }], createdAt: now, updatedAt: now }],
  };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/pi/chat", async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "资料测试回复" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n` });
  });
  const form = page.locator(".user-profile-settings");
  const selector = form.getByLabel("当前使用的用户", { exact: true });
  const nickname = form.getByLabel("用户昵称", { exact: true });
  const bio = form.getByLabel("用户简介", { exact: true });
  const sendToAi = form.getByLabel("发送用户昵称和简介给 AI", { exact: true });
  const saved = async () => (await (await fetch(`${server.url}/api/app-data`)).json()).data;
  async function openProfiles(target = page) {
    const chat = target.getByRole("region", { name: "Renge 对话工作区", exact: true });
    if (await chat.isVisible()) await chat.getByRole("button", { name: "最小化窗口", exact: true }).click();
    await target.getByRole("button", { name: "打开系统设置", exact: true }).click();
    await target.getByRole("button", { name: "打开设置", exact: true }).click();
    await target.locator(".settings-nav").getByRole("button", { name: "用户资料", exact: true }).click();
    await target.locator(".user-profile-settings").waitFor();
  }
  async function waitSaved(predicate) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const data = await saved();
      if (predicate(data)) return data;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail("profile changes did not persist");
  }
  await page.goto(server.url);
  await openProfiles();
  assert.equal(await nickname.inputValue(), legacy.nickname);
  assert.equal(await bio.inputValue(), legacy.bio);
  assert.equal(await sendToAi.isChecked(), true);
  assert.equal(await form.getByRole("button", { name: "删除用户", exact: true }).isDisabled(), true);
  const originalId = await selector.inputValue();
  await form.getByRole("button", { name: "新增用户", exact: true }).click();
  const secondId = await selector.inputValue();
  assert.notEqual(secondId, originalId);
  assert.equal(await nickname.inputValue(), "新用户");
  assert.equal(await bio.inputValue(), "");
  assert.equal(await sendToAi.isChecked(), false);
  await nickname.fill("小林");
  await bio.fill("第二份资料：喜欢园艺");
  await sendToAi.check();
  await form.locator('input[type="file"]').setInputFiles({ name: "avatar.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="green"/></svg>') });
  await page.getByRole("button", { name: "保存头像", exact: true }).click();
  await form.locator(".avatar-upload img").waitFor();
  const secondAvatar = await form.locator(".avatar-upload img").getAttribute("src");
  assert.match(secondAvatar, /^data:image\/png/);
  await selector.selectOption(originalId);
  assert.equal(await nickname.inputValue(), legacy.nickname);
  assert.equal(await bio.inputValue(), legacy.bio);
  assert.equal(await form.locator(".avatar-upload img").getAttribute("src"), legacy.avatarImage);
  await selector.selectOption(secondId);
  await waitSaved(data => data.userProfiles?.length === 2 && data.activeUserProfileId === secondId && data.userProfile.bio.includes("园艺"));
  await page.screenshot({ path: ".runtime/user-profiles-desktop.png", animations: "disabled" });

  // The selected profile, avatar and fields survive a reload and a fresh browser context.
  await page.reload();
  await openProfiles();
  assert.equal(await selector.inputValue(), secondId);
  assert.equal(await nickname.inputValue(), "小林");
  assert.equal(await bio.inputValue(), "第二份资料：喜欢园艺");
  assert.equal(await sendToAi.isChecked(), true);
  await form.locator(".avatar-upload img").waitFor();
  const fresh = await browser.newPage();
  await fresh.goto(server.url);
  await fresh.getByRole("button", { name: "打开系统设置", exact: true }).click();
  await fresh.getByRole("button", { name: "打开设置", exact: true }).click();
  await fresh.locator(".settings-nav").getByRole("button", { name: "用户资料", exact: true }).click();
  assert.equal(await fresh.getByLabel("当前使用的用户", { exact: true }).inputValue(), secondId);
  assert.equal(await fresh.getByLabel("用户昵称", { exact: true }).inputValue(), "小林");
  await fresh.close();

  // Actual request construction and sender display use only the selected profile.
  await page.getByLabel("关闭设置窗口", { exact: true }).click();
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  assert.equal(await page.locator(".composer-sender-summary").getAttribute("title"), "发送身份：小林");
  await page.getByPlaceholder("输入消息，可粘贴图片").fill("请参考当前资料");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".chat-message.assistant").filter({ hasText: "资料测试回复" }).waitFor();
  assert.equal(requests.length, 1);
  assert.match(JSON.stringify(requests[0]), /第二份资料：喜欢园艺/);
  assert.doesNotMatch(JSON.stringify(requests[0]), /原用户喜欢画画/);

  // Disabling injection for one profile leaves the other profile's switch intact.
  await openProfiles();
  await sendToAi.uncheck();
  await selector.selectOption(originalId);
  assert.equal(await sendToAi.isChecked(), true);
  await selector.selectOption(secondId);
  assert.equal(await sendToAi.isChecked(), false);
  await page.getByLabel("关闭设置窗口", { exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.locator(".chat-composer").getByPlaceholder("输入消息，可粘贴图片").fill("再验证资料开关");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".chat-message.assistant").length >= 2);
  assert.equal(requests.length, 2);
  assert.doesNotMatch(JSON.stringify(requests[1]), /第二份资料：喜欢园艺|原用户喜欢画画/);

  await openProfiles();
  // Export the real ZIP before deletion, then restore it after validating deletion.
  await page.locator(".settings-nav").getByRole("button", { name: "数据", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份", exact: true }).click();
  const download = await downloadEvent;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const backup = Buffer.concat(chunks);
  const archive = unzipSync(backup);
  const manifest = JSON.parse(strFromU8(archive["backup.json"]));
  assert.equal(manifest.appData.userProfiles.length, 2);
  assert.equal(manifest.appData.activeUserProfileId, secondId);
  assert.ok(Object.values(archive).some(bytes => Buffer.from(bytes).equals(Buffer.from(secondAvatar.split(",")[1], "base64"))), "backup includes the second profile avatar");
  await page.locator(".settings-nav").getByRole("button", { name: "用户资料", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await form.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await form.screenshot({ path: ".runtime/user-profiles-mobile.png", animations: "disabled" });
  page.once("dialog", dialog => dialog.dismiss());
  await form.getByRole("button", { name: "删除用户", exact: true }).click();
  assert.equal(await selector.locator("option").count(), 2);
  page.once("dialog", dialog => dialog.accept());
  await form.getByRole("button", { name: "删除用户", exact: true }).click();
  assert.equal(await selector.inputValue(), originalId);
  assert.equal(await nickname.inputValue(), legacy.nickname);
  assert.equal(await form.getByRole("button", { name: "删除用户", exact: true }).isDisabled(), true);
  await waitSaved(data => data.userProfiles?.length === 1 && data.activeUserProfileId === originalId && data.userProfile.nickname === legacy.nickname);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await openProfiles();
  assert.equal(await selector.locator("option").count(), 1);
  assert.equal(await selector.inputValue(), originalId);
  await page.close();
  assert.equal((await fetch(`${server.url}/api/app-data/import-complete`, { method: "PUT", body: backup })).status, 200);
  const restored = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  restored.on("pageerror", error => errors.push(error.message));
  await restored.goto(server.url);
  await openProfiles(restored);
  assert.equal(await restored.getByLabel("当前使用的用户", { exact: true }).inputValue(), secondId);
  assert.equal(await restored.getByLabel("当前使用的用户", { exact: true }).locator("option").count(), 2);
  assert.equal(await restored.getByLabel("用户简介", { exact: true }).inputValue(), "第二份资料：喜欢园艺");
  assert.equal(await restored.getByLabel("发送用户昵称和简介给 AI", { exact: true }).isChecked(), false);
  const restoredAvatar = await restored.locator(".user-profile-settings .avatar-upload img").getAttribute("src");
  const restoredImage = restoredAvatar.startsWith("data:")
    ? Buffer.from(restoredAvatar.split(",")[1], "base64")
    : await (await restored.request.get(new URL(restoredAvatar, server.url).href)).body();
  assert.deepEqual(restoredImage, Buffer.from(secondAvatar.split(",")[1], "base64"));
  assert.deepEqual(errors, []);
  console.log("User profile browser checks passed: migration, add/edit/avatar, switching, persistence, AI requests, mobile layout, deletion and ZIP backup restore.");
} catch (error) {
  await page?.screenshot({ path: ".runtime/user-profiles-failure.png" }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  // Only this test's freshly created temporary directory is removed.
  assert.ok(root.startsWith(join(tmpdir(), "renge-user-profiles-")));
  await rm(root, { recursive: true, force: true });
}
