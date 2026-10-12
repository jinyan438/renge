import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. All images, storage and model responses are fixtures.
const root = await mkdtemp(join(tmpdir(), "renge-image-preview-"));
const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#e5f5ee"/><circle cx="800" cy="500" r="300" fill="#059b4d"/><text x="800" y="520" text-anchor="middle" font-size="72" fill="white">Image preview</text></svg>');
const dataUrl = `data:image/svg+xml;base64,${image.toString("base64")}`;
let server;
let browser;
let page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], modelInputModes: { "fixture-model": ["text", "image"] }, updatedAt: now };
  const attachment = name => ({ id: name, name, type: "image/svg+xml", size: image.length, dataUrl, createdAt: now });
  const response = await fetch(`${server.url}/api/app-data`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {
      version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider],
      chatRenderedEditingEnabled: true, chatMultiBubbleEnabled: false,
      llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
      chatSessions: [{ id: "image-test", title: "图片预览测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [
        { id: "user-image", role: "user", content: "用户附件", attachments: [attachment("用户图片.svg")], createdAt: now },
        { id: "assistant-image", role: "assistant", content: "AI 附件", attachments: [{ ...attachment("AI图片.svg"), downloadUrl: "/fixture-image.svg" }], createdAt: now },
        { id: "user-markdown", role: "user", content: `![用户正文图片](${dataUrl})`, createdAt: now },
        { id: "assistant-markdown", role: "assistant", content: "![AI正文图片](/fixture-image.svg)", createdAt: now },
        { id: "assistant-url", role: "assistant", content: "https://fixture.invalid/generated.png", createdAt: now },
      ], createdAt: now, updatedAt: now }],
    } }),
  });
  assert.ok(response.ok);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/fixture-image.svg", route => route.fulfill({ contentType: "image/svg+xml", body: image }));
  await page.route("https://fixture.invalid/generated.png", route => route.fulfill({ contentType: "image/svg+xml", body: image }));
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  const dialog = page.getByRole("dialog", { name: /^图片预览：/ });
  async function openPreview(name, scope = page) {
    const trigger = scope.getByRole("button", { name: `放大查看：${name}`, exact: true });
    await trigger.click();
    await dialog.waitFor();
    await page.waitForFunction(() => {
      const img = document.querySelector(".chat-image-preview-canvas img");
      return img?.naturalWidth > 0 && img.style.width;
    });
    assert.equal(await dialog.locator("img").getAttribute("alt"), name);
    assert.equal(await page.locator("dialog:modal").count(), 1, "the preview is above desktop windows and makes the background inert");
    return trigger;
  }
  for (const name of ["用户图片.svg", "AI图片.svg", "用户正文图片", "AI正文图片", "生成的图片"]) {
    await openPreview(name);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
  }

  // Native keyboard activation, focus containment, and focus restoration.
  const keyboardTrigger = page.getByRole("button", { name: "放大查看：AI正文图片", exact: true });
  await keyboardTrigger.focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), "keyboard focus stays inside the modal");
  }
  await dialog.getByRole("button", { name: "关闭图片预览", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.ok(await keyboardTrigger.evaluate(el => el === document.activeElement));

  // Zoom expands both dimensions and remains scrollable instead of clipping.
  await openPreview("AI正文图片");
  const initial = await dialog.locator("img").boundingBox();
  await dialog.getByRole("button", { name: "放大图片", exact: true }).click();
  const enlarged = await dialog.locator("img").boundingBox();
  assert.ok(enlarged.width > initial.width * 1.4);
  assert.ok(await dialog.locator(".chat-image-preview-stage").evaluate(el => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight));
  await dialog.getByRole("button", { name: "缩小图片", exact: true }).click();
  assert.equal(await dialog.locator(".chat-image-preview-controls > span").textContent(), "1×");
  await dialog.locator("img").click();
  assert.equal(await dialog.locator(".chat-image-preview-controls > span").textContent(), "2×");
  await dialog.getByRole("button", { name: "适应窗口", exact: true }).click();
  await page.screenshot({ path: ".runtime/image-preview-desktop.png" });
  await dialog.locator(".chat-image-preview-canvas").click({ position: { x: 2, y: 2 } });
  await dialog.waitFor({ state: "detached" });

  // Wrapping images in preview buttons must preserve rendered-message editing.
  const markdownMessage = page.locator(".chat-message.assistant").filter({ has: keyboardTrigger });
  const more = markdownMessage.locator(".chat-message-more");
  await more.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await more.click();
  await page.locator(".chat-message-menu").getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator('[contenteditable="true"]');
  await editor.evaluate(el => {
    el.querySelector("p").append(document.createTextNode(" 图片已编辑。"));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator(".chat-inline-editor-actions").getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(await markdownMessage.locator("img.chat-inline-image").getAttribute("src"), "/fixture-image.svg");
  await openPreview("AI正文图片");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });

  // Uploads keep a separate removal action, and sending keeps images previewable.
  const upload = page.locator(".chat-attachment-input");
  await upload.setInputFiles([
    { name: "待发送.svg", mimeType: "image/svg+xml", buffer: image },
    { name: "说明.txt", mimeType: "text/plain", buffer: Buffer.from("fixture") },
  ]);
  const pending = page.locator(".chat-pending-attachments");
  await openPreview("待发送.svg", pending);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await pending.locator(".chat-pending-attachment").filter({ hasText: "待发送.svg" }).getByRole("button", { name: "移除附件", exact: true }).click();
  assert.equal(await pending.locator("img").count(), 0);
  assert.equal(await dialog.count(), 0);
  assert.equal(await pending.getByRole("button", { name: /^放大查看/ }).count(), 0, "text attachments stay ordinary files");
  await pending.getByRole("button", { name: "移除附件", exact: true }).click();
  await upload.setInputFiles({ name: "已发送.svg", mimeType: "image/svg+xml", buffer: image });
  await page.route("**/api/pi/chat", route => route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "收到图片。\n\n![新AI图片](/fixture-image.svg)" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`,
  }));
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText("收到图片。", { exact: true }).waitFor();
  await openPreview("已发送.svg", page.locator(".chat-message.user"));
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await openPreview("新AI图片");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.locator(".chat-message.assistant .chat-attachment-card a").getAttribute("href"), "/fixture-image.svg", "downloads remain independent of previews");

  await page.setViewportSize({ width: 390, height: 844 });
  await openPreview("已发送.svg", page.locator(".chat-message.user"));
  const mobileImage = await dialog.locator("img").boundingBox();
  assert.ok(mobileImage.x >= 0 && mobileImage.x + mobileImage.width <= 391);
  assert.ok(mobileImage.y >= 0 && mobileImage.y + mobileImage.height <= 845);
  assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "controls fit the mobile viewport");
  await page.screenshot({ path: ".runtime/image-preview-mobile.png" });
  await dialog.getByRole("button", { name: "放大图片", exact: true }).click();
  await dialog.getByRole("button", { name: "关闭图片预览", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const mobileTrigger = await openPreview("新AI图片");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  const thumbnail = await mobileTrigger.boundingBox();
  assert.ok(thumbnail.x >= 0 && thumbnail.x + thumbnail.width <= 391, "inline image buttons fit the mobile chat bubble");
  assert.deepEqual(errors, []);
  console.log("Image preview browser checks passed: composer uploads, user/AI attachments, Markdown, bare URLs, zoom, closing, keyboard focus, rendered editing, streaming, sending, and mobile layout.");
} catch (error) {
  await page?.screenshot({ path: ".runtime/image-preview-failure.png" });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
