import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Neutral preset-shaped output; storage and browser profiles are isolated.
// Run after npm run build.
const root = await mkdtemp(join(tmpdir(), "renge-prose-render-"));
const prose = '第一段，清晨的街道很安静。\n\n“第二段，早上好。”\n\n*第三段，窗边落下一束光。*';
const fixtures = [
  `<scenario>\n<!-- strategize: keep this comment hidden -->\n----\n${prose}\n\n<IllustrationImpl ref="morning#1"/>\n\n最后一段。\n</scenario>`,
  `<narrative>\n${prose}\n</narrative>`,
  `<SceneText>\n<story>\n${prose}\n</story>\n</SceneText>`,
  '<story>第一段。</story><narrative>第二段。</narrative>',
  '<story>代码前。\n\n```xml\n<scenario>这是代码示例。</scenario>\n```\n\n代码后。\n</story>',
];
let server, browser, page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const seed = {
    version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true, chatMultiBubbleEnabled: false,
    activeCharacterCardId: "prose-card",
    characterCards: [{ id: "prose-card", name: "旅人", firstMessage: "正文排版测试", createdAt: now, updatedAt: now }],
    tavernScripts: [{ id: "prose-runtime", name: "Prose fixture", enabled: true, content: "parent.__proseRuntimeReady = true;" }],
    chatSessions: [{ id: "prose-chat", title: "正文排版测试", mode: "roleplay", roleplayCharacterCardId: "prose-card",
      messages: [{ id: "greeting", role: "assistant", content: "正文排版测试", createdAt: now }], createdAt: now, updatedAt: now }],
  };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => window.__proseRuntimeReady);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();

  for (const [index, content] of fixtures.entries()) {
    await page.evaluate(content => window.TavernHelper.createChatMessages([{ role: "assistant", message: content }]), content);
    const message = page.locator(`#chat .mes[mesid="${index + 1}"]`);
    await message.locator(".mes_text > p.chat-text-part").first().waitFor();
    const paragraphs = message.locator(".mes_text > p.chat-text-part");
    assert.equal(await paragraphs.count(), index === 0 ? 5 : index < 3 ? 3 : 2);
    assert.equal(await message.locator("iframe.chat-html-frame, scenario, narrative, story, scenetext").count(), 0,
      "bare prose wrappers must not become HTML frames or merge Markdown into one text node");
    if (index < 3) {
      assert.equal(await paragraphs.nth(1).innerText(), "“第二段，早上好。”");
      assert.equal(await paragraphs.nth(2).locator("em").innerText(), "第三段，窗边落下一束光。");
    }
    if (index === 0) {
      assert.equal(await message.locator("hr.chat-markdown-hr").count(), 1);
      assert.equal(await message.locator("[data-tavern-placeholder]").count(), 1);
      assert.doesNotMatch(await message.locator(".mes_text").innerText(), /strategize|IllustrationImpl/);
    }
    if (index === 4) assert.equal(await message.locator("pre code").innerText(), "<scenario>这是代码示例。</scenario>");
    assert.equal(await page.evaluate(index => window.TavernHelper.getChatMessages(index)[0].message, index + 1), content,
      "display normalization must not change raw messages used by scripts or persistence");
  }

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const paragraphs = page.locator('#chat .mes[mesid="1"] .mes_text > p.chat-text-part');
    const positions = await paragraphs.evaluateAll(elements => elements.map(element => ({
      top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom,
    })));
    assert.ok(positions[1].top > positions[0].bottom, "paragraphs retain visible spacing on desktop and mobile");
  }
  const mixed = `<scenario>\n${prose}\n</scenario>\n<details><summary>摘要</summary><p>独立的状态面板。</p></details>`;
  await page.evaluate(content => window.TavernHelper.createChatMessages([{ role: "assistant", message: content }]), mixed);
  const mixedMessage = page.locator('#chat .mes[mesid="6"]');
  await mixedMessage.locator(".mes_text > p.chat-text-part").first().waitFor();
  assert.equal(await mixedMessage.locator(".mes_text > p.chat-text-part").count(), 3);
  assert.equal(await mixedMessage.locator("details > summary").innerText(), "摘要",
    "adjacent real HTML panels retain their own rendering");
  await page.getByLabel("渲染 HTML", { exact: true }).evaluate(input => input.click());
  assert.equal(await page.locator('#chat .mes[mesid="2"] .mes_text > p.chat-text-part').count(), 3,
    "prose layout also works with HTML rendering disabled");
  await page.reload();
  await page.waitForFunction(() => window.__proseRuntimeReady);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  assert.equal(await page.locator('#chat .mes[mesid="2"] .mes_text > p.chat-text-part').count(), 3,
    "saved conversations also regain paragraph layout when reopened");
  assert.deepEqual(errors, []);
  console.log("Tavern prose rendering passed: arbitrary/nested wrappers, paragraph spacing, Markdown, code, placeholders, raw source and mobile.");
} catch (error) {
  await page?.screenshot({ path: ".runtime/tavern-prose-failure.png", fullPage: true });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
