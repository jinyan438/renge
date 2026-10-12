import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. Use isolated app data and intercept every model request.
const root = await mkdtemp(join(tmpdir(), "renge-composer-input-"));
let server, browser, page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  await fetch(`${server.url}/api/app-data`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {
      version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider],
      llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
      chatSessions: ["A", "B"].map(id => ({ id, title: `输入测试${id}`, mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: `seed-${id}`, role: "user", content: `输入测试${id}`, createdAt: now }], createdAt: now, updatedAt: now })),
    } }),
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/pi/chat", async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "text/event-stream", body: 'data: {"choices":[{"index":0,"delta":{"content":"文本已收到。"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' });
  });
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  const selectSession = id => page.locator(".chat-session-item").filter({ hasText: `输入测试${id}` }).locator("button").first().click();
  await selectSession("A");
  const input = page.getByPlaceholder("输入消息，可粘贴图片");
  const cards = page.locator(".chat-pasted-text-attachment");
  const height = () => input.evaluate(element => element.getBoundingClientRect().height);
  async function paste(text) {
    await page.evaluate(text => navigator.clipboard.writeText(text), text);
    await input.focus();
    await input.press("Control+V");
  }

  const initialHeight = await height();
  await input.fill("第一行\n第二行\n第三行\n第四行");
  assert.ok(await height() > initialHeight, "multiline input grows automatically");
  const longDraft = "保留手动输入的长文本\n".repeat(60);
  await input.fill(longDraft);
  const capped = await input.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, max: parseFloat(getComputedStyle(element).maxHeight), overflow: getComputedStyle(element).overflowY }));
  assert.equal(capped.height, capped.max, "manual input is capped at the CSS maximum");
  assert.ok(capped.scrollHeight > capped.height);
  assert.equal(capped.overflow, "auto");
  await selectSession("B");
  assert.equal(await input.inputValue(), "");
  assert.equal(await height(), initialHeight, "switching to an empty draft shrinks the input");
  await selectSession("A");
  assert.equal(await input.inputValue(), longDraft);
  assert.equal(await height(), capped.height, "restoring a draft recalculates its height");
  await input.fill("");
  assert.equal(await height(), initialHeight, "clearing shrinks the input");

  await paste("普通粘贴文本");
  await page.waitForFunction(() => document.querySelector("#send_textarea").value === "普通粘贴文本");
  assert.equal(await cards.count(), 0, "short clipboard text stays editable");
  await input.fill("");
  await paste("字".repeat(2_000));
  await page.waitForFunction(() => document.querySelector("#send_textarea").value.length === 2_000);
  assert.equal(await cards.count(), 0, "the 2000-character boundary remains inline");
  await input.fill("请阅读下面的配置：");
  const pasted = '  { "name": "renge-agent" }\r\n' + "完整长文本🙂".repeat(500) + "\r\n保留结尾空白  ";
  await paste(pasted);
  await cards.waitFor();
  assert.equal(await input.inputValue(), "请阅读下面的配置：", "attachment paste preserves the existing instruction");
  assert.match(await cards.locator("strong").textContent(), /name.*renge-agent/);
  assert.equal(await cards.getByText("粘贴的文本", { exact: true }).count(), 1);
  const preview = await cards.locator("strong").evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, overflow: getComputedStyle(element).textOverflow }));
  assert.equal(preview.overflow, "ellipsis");
  assert.ok(preview.scrollWidth > preview.width, "the card truncates only its visible preview");
  await selectSession("B");
  assert.equal(await cards.count(), 0);
  await selectSession("A");
  assert.equal(await cards.count(), 1, "pasted attachments follow their session draft");
  await paste("行\n".repeat(21));
  await page.waitForFunction(() => document.querySelectorAll(".chat-pasted-text-attachment").length === 2);
  await cards.last().getByRole("button", { name: "移除粘贴的文本" }).click();
  assert.equal(await cards.count(), 1, "removing one pasted attachment preserves the other");
  await page.locator(".chat-attachment-input").setInputFiles({ name: "普通附件.txt", mimeType: "text/plain", buffer: Buffer.from("普通附件内容") });
  await page.locator(".chat-pending-attachment").waitFor();
  assert.equal(await cards.count(), 1, "pasted text coexists with normal attachments");
  await page.locator(".chat-composer").screenshot({ path: ".runtime/composer-input-desktop.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill("窄屏长文本会自动换行并限制输入框高度。".repeat(100));
  await page.waitForFunction(() => {
    const input = document.querySelector("#send_textarea");
    return input.clientHeight === parseFloat(getComputedStyle(input).maxHeight);
  });
  const mobileCap = await height();
  assert.ok(mobileCap <= 140);
  const bounds = await cards.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, "pasted card fits a narrow screen");
  assert.ok(bounds.height >= 78, "mobile attachment remains fully visible");
  await input.fill("请阅读下面的配置：");
  await page.locator(".chat-composer").screenshot({ path: ".runtime/composer-input-mobile.png" });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".chat-message.assistant").filter({ hasText: "文本已收到。" }).waitFor();
  assert.equal(await cards.count(), 0, "sending clears attachment cards");
  assert.equal(await input.inputValue(), "");
  assert.ok(await height() < mobileCap);
  assert.equal(requests.length, 1);
  // Compare escaped payload content so CRLF, emoji and trailing spaces are covered.
  assert.ok(JSON.stringify(requests[0]).includes(JSON.stringify(pasted).slice(1, -1)), "the model receives the complete pasted text unchanged");
  let sent;
  const saveDeadline = Date.now() + 15_000;
  while (!sent && Date.now() < saveDeadline) {
    const payload = await (await fetch(`${server.url}/api/app-data`)).json();
    sent = payload.data.chatSessions.find(session => session.id === "A").messages.find(message => message.attachments?.some(attachment => attachment.id.startsWith("pasted-text-")));
    if (!sent) await delay(50);
  }
  assert.ok(sent, "the sent message reaches session persistence");
  assert.equal(sent.attachments.find(attachment => attachment.id.startsWith("pasted-text-")).textContent, pasted, "session persistence retains the full original text");
  assert.deepEqual(errors, []);
  console.log("Composer input browser checks passed: autosize, caps, paste cards, removal, session drafts, mobile layout, complete sending and persistence.");
} catch (error) {
  await page?.screenshot({ path: ".runtime/composer-input-failure.png" });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
