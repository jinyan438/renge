import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Neutral cards reproduce clipped effects and CSS-sized media without personal data.
// Run after npm run build; persistence is isolated from the user's application.
const root = await mkdtemp(join(tmpdir(), "renge-html-layout-"));
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="100"><rect width="2000" height="100" fill="pink"/></svg>')}`;
const responsiveCard = `<style>
  *{box-sizing:border-box}body{margin:8px;font:16px/1.6 sans-serif}
  .card{position:relative;overflow:hidden;padding:20px;background:#fff1f5;border:2px solid #e0557f;border-radius:16px}
  .shine{position:absolute;left:-150%;top:-100%;width:300%;height:300%;transform:rotate(12deg);pointer-events:none}
  .content{position:relative}.choices{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
  label{display:block;padding:12px;border:1px solid pink;border-radius:8px}
  .clip{height:24px;margin:10px 0}.clip>div{width:6000px;height:18px;background:#f7b6cd}
  canvas,svg,img{display:block;width:100%;height:120px}canvas{height:160px}
  summary,button{font:inherit}button{padding:10px 24px}
  @media(max-width:520px){.choices{grid-template-columns:1fr}}
</style><main class="card"><i class="shine"></i><div class="content">
  <h1>旅人登记表</h1><p>请选择出发地点，文字应保持原始尺寸。</p>
  <div class="choices">${["庭院", "图书馆", "钟楼", "花园"].map((name, index) => `<label><input type="radio" name="scene" ${index === 0 ? "checked" : ""}>${name}</label>`).join("")}</div>
  ${["hidden", "clip", "auto", "scroll"].map(overflow => `<div class="clip" style="overflow:${overflow}"><div></div></div>`).join("")}
  <canvas width="300" height="150"></canvas>
  <svg viewBox="0 0 2000 100" preserveAspectRatio="none"><rect x="-5000" width="12000" height="100" fill="#f7b6cd"/></svg>
  <img src="${image}" style="object-fit:cover" alt="背景装饰">
  <details><summary>更多选项</summary><div style="height:500px">展开后应完整显示</div></details>
  <button onclick="this.textContent='已选择'">确认选择</button>
</div></main>`;
const fixedCard = `<style>body{margin:8px}.fixed{width:1600px;height:500px;background:#fff1f5;font:24px sans-serif}</style><div class="fixed">固定宽度界面</div>`;
const documents = [responsiveCard, fixedCard, `${responsiveCard}<!--${"heavy fixture ".repeat(42_000)}-->`];
let server, browser, page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const seed = {
    version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true, chatMultiBubbleEnabled: false,
    tavernScripts: [{ id: "layout-runtime", name: "Layout fixture", enabled: true, content: "parent.__layoutRuntimeReady = true;" }],
    activeCharacterCardId: "layout-card",
    characterCards: [{ id: "layout-card", name: "布局测试", firstMessage: "布局测试", createdAt: now, updatedAt: now }],
    chatSessions: [{ id: "layout-chat", title: "HTML 布局测试", mode: "roleplay", roleplayCharacterCardId: "layout-card",
      messages: [{ id: "greeting", role: "assistant", content: "布局测试", createdAt: now }],
      createdAt: now, updatedAt: now }],
  };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => window.__layoutRuntimeReady);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();

  for (const [index, content] of documents.entries()) {
    // Add one current message at a time so older previews do not compete with initial auto-scroll.
    await page.evaluate(content => window.TavernHelper.createChatMessages([{ role: "assistant", message: content }]), `\`\`\`html\n${content}\n\`\`\``);
    const message = page.locator(`#chat .mes[mesid="${index + 1}"]`);
    await message.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.waitForFunction(index => !document.querySelector(`#chat .mes[mesid="${index}"] .chat-html-preview-placeholder`)?.textContent.includes("正在同步"), index + 1);
    await message.locator(".chat-html-preview-placeholder button").evaluateAll(buttons => buttons.forEach(button => button.click()));
    const locator = message.locator("iframe.chat-html-frame");
    await locator.waitFor();
    const frame = await (await locator.elementHandle()).contentFrame();
    await frame.locator(index === 1 ? ".fixed" : ".card").waitFor();
    for (const width of [1440, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await locator.scrollIntoViewIfNeeded();
      if (index === 1) {
        await frame.waitForFunction(() => {
          const rect = document.querySelector(".fixed").getBoundingClientRect();
          return Number(document.body.style.zoom) < 1 && rect.right <= innerWidth + 1 && rect.width > innerWidth * 0.9;
        });
      } else {
        await frame.waitForFunction(() => (!document.body.style.zoom || Number(document.body.style.zoom) === 1) &&
          document.querySelector("button").getBoundingClientRect().bottom <= innerHeight);
        const layout = await frame.evaluate(() => ({
          font: getComputedStyle(document.querySelector("p")).fontSize,
          columns: getComputedStyle(document.querySelector(".choices")).gridTemplateColumns.split(" ").length,
          width: document.documentElement.scrollWidth, viewport: innerWidth,
          canvas: document.querySelector("canvas").getBoundingClientRect().height,
          image: document.querySelector("img").getBoundingClientRect().height,
        }));
        assert.equal(layout.font, "16px", "responsive text retains its authored size");
        assert.equal(layout.canvas, 160, "canvas drawing-buffer ratio must not change its CSS height");
        assert.equal(layout.image, 120, "object-fit media retains its CSS dimensions");
        assert.ok(layout.width <= layout.viewport + 1, "clipped or scrollable children do not widen the document");
        assert.ok(width === 390 ? layout.columns === 1 : layout.columns >= 3, "cards reflow instead of shrinking text");
        // Toggle inside the frame without scrolling the chat away from the layout under test.
        await frame.getByText("更多选项", { exact: true }).evaluate(element => element.click());
        await frame.waitForFunction(() => document.querySelector("details").open &&
          document.querySelector("button").getBoundingClientRect().bottom <= innerHeight);
        await frame.getByText("更多选项", { exact: true }).evaluate(element => element.click());
        await frame.getByRole("button").evaluate(element => element.click());
        await frame.getByRole("button", { name: "已选择", exact: true }).waitFor();
      }
      assert.ok(await message.locator(".chat-bubble").evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS: desktop/mobile responsive cards, clipped animation layers, hidden/clip/auto/scroll containers, CSS-sized canvas/SVG/images, expanded details, interactions, heavy cards and genuine fixed-width scaling");
} catch (error) {
  console.log(await page?.locator("#chat .mes").evaluateAll(messages => messages.map(message => ({ index: message.getAttribute("mesid"), previews: message.querySelectorAll(".chat-html-preview").length, frames: message.querySelectorAll("iframe").length, placeholders: [...message.querySelectorAll(".chat-html-preview-placeholder")].map(element => element.textContent), text: message.textContent.slice(0, 100) }))));
  await page?.screenshot({ path: ".runtime/html-layout-failure.png" });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
