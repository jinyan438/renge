import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. All storage and model responses are isolated fixtures.
const root = await mkdtemp(join(tmpdir(), "renge-markdown-"));
const source = 'const greeting = (name: string) => `你好，${name}`;\nconsole.log(greeting("Renge"));';
const largeCode = "const value = 1; ".repeat(2000);
const tableText = "长文字自然换行，表格不会撑开整个聊天窗口。".repeat(8);
const prose = [
  "# 阅读测试", "", "正文包含 **重点**、`行内代码`、*斜体* 和 [链接](https://example.com)，校验值 `E1C4E9A5…168F40DC7`。",
  "", "## 清晰的层次", "", "> 引用内容", "", "### 待办", "",
  "- [x] 已完成", "- [ ] 待完成", "", "3. 第三步", "4. 第四步", "",
  "| 内容 | 说明 | 数值 |", "| :--- | :---: | ---: |", `| 排版 | ${tableText} | 12 |`,
].join("\n");
let server;
let browser;
let page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  await fetch(`${server.url}/api/app-data`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {
      version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider],
      chatRenderedEditingEnabled: true, chatMultiBubbleEnabled: false,
      chatPersonalization: { messageFontFamily: "lxgw-wenkai-screen", messageFontSize: 18 },
      llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
      chatSessions: [{ id: "markdown-test", title: "Markdown 测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [
        { id: "user", role: "user", content: "Markdown 测试", createdAt: now },
        { id: "prose", role: "assistant", content: prose, createdAt: now },
        { id: "code", role: "assistant", content: `\`\`\`typescript\n${source}\n\`\`\``, createdAt: now },
        { id: "plain", role: "assistant", content: '```unknown\n<script>window.markdownExecuted = true</script>\n```', createdAt: now },
        { id: "large", role: "assistant", content: `\`\`\`js\n${largeCode}\n\`\`\``, createdAt: now },
      ], createdAt: now, updatedAt: now }],
    } }),
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  const proseMessage = page.locator(".chat-message.assistant").filter({ has: page.getByRole("heading", { name: "阅读测试", exact: true }) });
  const highlighted = page.locator(".chat-code-block").filter({ hasText: 'console.log(greeting("Renge"))' });
  await highlighted.locator(".hljs-keyword").first().waitFor();
  assert.equal(await highlighted.locator("pre").textContent(), source);
  await highlighted.getByRole("button", { name: "复制", exact: true }).click();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), source, "copy uses the original source (with OS clipboard line endings)");
  assert.equal(await page.evaluate(() => window.markdownExecuted), undefined);
  assert.equal(await page.locator(".chat-code-block").filter({ hasText: "window.markdownExecuted" }).locator(".hljs").count(), 0);
  const large = page.locator(".chat-code-block").filter({ hasText: "const value = 1;" });
  assert.ok((await large.locator("pre").textContent()).trimEnd() === largeCode.trimEnd(), "large code retains every source character");
  assert.equal(await large.locator(".hljs").count(), 0, "large blocks remain plain text");

  assert.equal(await proseMessage.locator("ol").getAttribute("start"), "3");
  assert.equal(await proseMessage.locator(".chat-markdown-task").count(), 2);
  assert.equal(await proseMessage.locator(".chat-markdown-task input:checked").count(), 1);
  assert.equal(await proseMessage.locator(".chat-markdown-task input:disabled").count(), 2);
  assert.deepEqual(await proseMessage.locator("th").evaluateAll(cells => cells.map(cell => getComputedStyle(cell).textAlign)), ["left", "center", "right"]);
  const tableCell = proseMessage.locator("td").nth(1);
  assert.equal(await tableCell.textContent(), tableText);
  assert.equal(await tableCell.evaluate(cell => getComputedStyle(cell).whiteSpace), "normal");
  const font = await proseMessage.locator(".mes_text").evaluate(el => ({
    family: getComputedStyle(el).fontFamily,
    size: getComputedStyle(el).fontSize,
  }));
  assert.match(font.family, /LXGW WenKai Screen/, "the chosen message font is preserved");
  assert.equal(font.size, "18px", "the chosen message size is preserved");
  assert.equal(await proseMessage.locator("code.chat-inline-code-digest").textContent(), "E1C4E9A5…168F40DC7");

  // Rendering edits must preserve numbering, table alignment, and task state.
  const more = proseMessage.locator(".chat-message-more");
  await more.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await more.click();
  await page.locator(".chat-message-menu").getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator('[contenteditable="true"]');
  await editor.waitFor();
  await editor.evaluate(el => {
    el.querySelector("p").append(document.createTextNode(" 已编辑。"));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator(".chat-inline-editor-actions").getByRole("button", { name: "保存", exact: true }).click();
  await page.locator('[contenteditable="true"]').waitFor({ state: "detached" });
  assert.equal(await proseMessage.locator("ol").getAttribute("start"), "3");
  assert.deepEqual(await proseMessage.locator("th").evaluateAll(cells => cells.map(cell => cell.style.textAlign)), ["left", "center", "right"]);
  assert.equal(await proseMessage.locator("input:checked").count(), 1);
  assert.match(await proseMessage.textContent(), /已编辑。/);

  await page.setViewportSize({ width: 390, height: 844 });
  const table = proseMessage.getByRole("region", { name: "表格，可横向滚动" });
  await table.scrollIntoViewIfNeeded();
  const bounds = await table.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, "table fits the mobile viewport");
  assert.ok(await table.evaluate(el => el.scrollWidth > el.clientWidth), "wide tables scroll inside their own container");
  await table.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.activeElement?.scrollLeft > 0);
  const bubble = proseMessage.locator(".chat-bubble");
  assert.ok(await bubble.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "the message has no horizontal overflow");
  await page.locator(".chat-workspace").screenshot({ path: ".runtime/markdown-mobile-check.png" });

  // Unrelated composer edits must leave the existing highlighted DOM intact.
  await page.evaluate(() => { window.markdownCodeNode = document.querySelector(".hljs-keyword"); });
  const input = page.getByPlaceholder("输入消息，可粘贴图片");
  await input.fill("检查流式输出");
  assert.equal(await page.evaluate(() => window.markdownCodeNode === document.querySelector(".hljs-keyword")), true);
  await page.route("**/api/pi/chat", route => route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "## 流式完成\n\n正文 **重点**。" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`,
  }));
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("heading", { name: "流式完成", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Markdown browser checks passed: highlighting, copy, large code fallback, rendered editing, mobile scrolling, and completed streaming.");
} catch (error) {
  await page?.screenshot({ path: ".runtime/markdown-failure.png" });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
