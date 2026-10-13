import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Neutral cards exercise DOM decorators without importing personal card data.
// Run after npm run build; storage and the browser profile are isolated.
const root = await mkdtemp(join(tmpdir(), "renge-greeting-render-"));
const morning = "晨光照进房间。\n\n旅人〔日常〕「早上好。」\n\n<IllustrationImpl ref=\"landscape#1\" />\n\n窗外传来鸟鸣。";
const evening = "夕阳照亮庭院。\n\n旅人〔开心〕「欢迎回来。」\n\n桌上摆着一杯茶。";
const chooser = '```html\n<button id="opening" onclick="setChatMessages([{message_id:0,swipe_id:1}])">进入清晨开局</button>\n```';
const parentDomFixture = `
window.decorateTavernFixture = (index, hidden = false) => {
  const box = document.querySelector('#chat .mes[mesid="' + index + '"] .mes_text');
  window.previousGreetingBox = box;
  box.classList.add('fixture-decorated');
  if (index === 0) box.style.minWidth = '500px';
  box.querySelectorAll(':scope > p').forEach(p => {
    const text = p.textContent;
    while (p.firstChild) {
      const child = p.firstChild;
      p.removeChild(child);
      // Fail promptly instead of hanging the browser if the host silently
      // rejects a removal; real paragraph decorators use this clearing loop.
      if (p.firstChild === child) throw new Error('Tavern removeChild did not remove the paragraph child');
    }
    const span = document.createElement('span');
    span.className = 'fixture-line';
    span.textContent = text;
    p.appendChild(span);
    p.dataset.fixtureParagraph = 'true';
  });
  if (hidden) box.style.display = 'none';
};
window.exerciseTavernFixtureMutations = () => {
  const box = document.querySelector('#chat .mes .mes_text');
  const target = document.createElement('div');
  box.appendChild(target);
  const check = (value, expected) => {
    if (value !== expected) throw new Error('Unexpected Tavern DOM mutation result');
  };
  target.textContent = 'first';
  check(target.textContent, 'first');
  target.innerHTML = '<b>second</b>';
  check(target.textContent, 'second');
  const span = document.createElement('span');
  span.textContent = 'third';
  target.replaceChild(span, target.firstChild);
  check(target.textContent, 'third');
  span.replaceWith('fourth');
  check(target.textContent, 'fourth');
  target.replaceChildren(document.createElement('i'));
  target.firstChild.outerHTML = '<em>fifth</em>';
  check(target.textContent, 'fifth');
  target.firstChild.remove();
  check(target.childNodes.length, 0);
  target.remove();
  // Replacing the body's contents is allowed; replacing/removing the body is not.
  box.replaceChildren(...box.childNodes);
  const app = document.getElementById('root');
  const attempts = [
    () => app.parentNode.removeChild(app),
    () => app.parentNode.replaceChild(document.createElement('div'), app),
    () => app.remove(),
    () => app.replaceWith('blocked'),
    () => app.replaceChildren('blocked'),
    () => { app.textContent = 'blocked'; },
    () => { app.innerHTML = 'blocked'; },
    () => { app.outerHTML = '<div>blocked</div>'; },
    () => box.remove(),
    () => { box.outerHTML = '<div>blocked</div>'; },
    () => { document.getElementById('chat').textContent = 'blocked'; },
  ];
  return attempts.map(attempt => {
    try { attempt(); return 'not rejected'; } catch (error) { return error.name; }
  });
};
window.startTavernObserverFixture = () => {
  window.fixtureObserverCalls = 0;
  const observer = new MutationObserver(() => {
    window.fixtureObserverCalls += 1;
    if (window.fixtureObserverCalls > 20) {
      observer.disconnect();
      throw new Error('Paragraph observer did not settle');
    }
    document.querySelectorAll('#chat .mes').forEach(message => {
      if (message.querySelector('.mes_text > p:not([data-fixture-paragraph])')) {
        window.decorateTavernFixture(Number(message.getAttribute('mesid')));
      }
    });
  });
  observer.observe(document.getElementById('chat'), { childList: true, subtree: true });
};
`;
let server;
let browser;
let page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const card = {
    id: "render-card", name: "旅人", firstMessage: chooser,
    alternateGreetings: [morning, evening, evening], createdAt: now, updatedAt: now,
  };
  const script = {
    id: "decorator", name: "Paragraph decorator fixture", enabled: true,
    content: `
      const script = parent.document.createElement('script');
      script.textContent = ${JSON.stringify(parentDomFixture)};
      parent.document.body.appendChild(script);
      parent.__greetingRuntimeReady = true;
    `,
  };
  const seed = {
    version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true,
    chatMultiBubbleEnabled: false, activeCharacterCardId: card.id,
    characterCards: [card], tavernScripts: [script],
    chatSessions: [{
      id: "render-chat", title: "角色渲染测试", mode: "roleplay", roleplayCharacterCardId: card.id,
      roleplayGreetingIndex: 0,
      messages: [{ id: "greeting", role: "assistant", source: "roleplay-greeting", content: chooser, createdAt: now }],
      createdAt: now, updatedAt: now,
    }],
  };
  assert.equal((await fetch(`${server.url}/api/app-data`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }),
  })).ok, true);
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => window.__greetingRuntimeReady, null, { timeout: 90_000 });
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.frameLocator(".chat-html-frame").getByRole("button", { name: "进入清晨开局" }).click();
  const message = page.locator('#chat .mes[mesid="0"]');
  await message.getByText("晨光照进房间。", { exact: true }).waitFor();
  assert.match(await message.innerText(), /窗外传来鸟鸣/);
  assert.equal(await message.locator(".roleplay-greeting-count").textContent(), "2/4");
  assert.equal(await message.locator(".mes_text > p").count(), 4,
    "paragraph decorators can reach each paragraph and illustration marker directly");
  assert.deepEqual(await page.evaluate(() => window.exerciseTavernFixtureMutations()),
    Array(11).fill("NoModificationAllowedError"),
    "real Tavern scripts can rewrite content but protected UI mutations fail explicitly");
  assert.equal(await page.locator("#root #chat .mes_text").count(), 1);

  // Tavern decorators replace paragraph children and add classes/styles directly.
  // React must discard this DOM when the message is replaced, while keeping it
  // intact on unrelated variable/composer updates.
  await page.evaluate(() => window.decorateTavernFixture(0));
  await page.getByPlaceholder("输入消息，可粘贴图片").fill("保留装饰");
  assert.equal(await message.locator(".fixture-line").count(), 4);
  await page.evaluate(async () => {
    await window.TavernHelper.replaceVariables({ fixture: true }, { type: "message", message_id: 0 });
  });
  assert.equal(await message.locator(".fixture-line").count(), 4,
    "variable updates retain paragraph decorations");
  await message.locator(".roleplay-greeting-next").click();
  await message.getByText("夕阳照亮庭院。", { exact: true }).waitFor();
  assert.match(await message.innerText(), /桌上摆着一杯茶/);
  assert.equal(await message.locator(".roleplay-greeting-count").textContent(), "3/4");
  assert.equal(await message.locator(".mes_text").evaluate(box => box === window.previousGreetingBox), false,
    "a new opening receives a clean message container");
  assert.equal(await message.locator(".fixture-decorated").count(), 0);
  assert.equal(await message.locator(".fixture-line").count(), 0);
  await message.locator(".mes_text").evaluate(box => { box.style.display = "none"; });
  await page.evaluate(async () => {
    await window.TavernHelper.setChatMessages([{ message_id: 0, swipe_id: 3 }]);
  });
  await message.getByText("夕阳照亮庭院。", { exact: true }).waitFor();
  assert.equal(await message.locator(".roleplay-greeting-count").textContent(), "4/4",
    "swiping to identical content also clears the previous opening's DOM state");

  // Editing a decorated ordinary message also needs a fresh React tree.
  await page.evaluate(async () => {
    await window.TavernHelper.createChatMessages([{ role: "assistant", message: "正文第一段。\n\n正文第二段。" }]);
  });
  const ordinary = page.locator('#chat .mes[mesid="1"]');
  await ordinary.getByText("正文第一段。", { exact: true }).waitFor();
  await page.evaluate(() => window.decorateTavernFixture(1, true));
  await page.evaluate(async () => {
    await window.TavernHelper.setChatMessages([{ message_id: 1, message: "修改后第一段。\n\n修改后第二段。" }]);
  });
  await ordinary.getByText("修改后第一段。", { exact: true }).waitFor();
  await ordinary.getByText("修改后第二段。", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await ordinary.locator(".chat-bubble").evaluate(el => el.scrollWidth <= el.clientWidth + 1),
    "replaced text fits the mobile bubble");

  // A same-length edit in a long message must not be missed by sampled hashes.
  await page.evaluate(async () => {
    await window.TavernHelper.createChatMessages([{ role: "assistant", message: "a".repeat(10_000) }]);
  });
  const longMessage = page.locator('#chat .mes[mesid="2"]');
  await longMessage.locator(".mes_text").waitFor();
  await longMessage.locator(".mes_text").evaluate(box => {
    box.style.display = "none";
  });
  await page.evaluate(async () => {
    await window.TavernHelper.setChatMessages([{ message_id: 2, message: "ab" + "a".repeat(9998) }]);
  });
  await longMessage.locator(".mes_text").waitFor({ state: "visible" });
  assert.equal(await longMessage.locator(".mes_text").textContent(), "ab" + "a".repeat(9998));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(async () => {
    window.startTavernObserverFixture();
    await window.TavernHelper.setChatMessages([{ message_id: 0, swipe_id: 1 }]);
  });
  await message.locator(".fixture-line").filter({ hasText: "窗外传来鸟鸣" }).waitFor();
  const observerCalls = await page.evaluate(async () => {
    await new Promise(resolve => {
      let frames = 0;
      const tick = () => ++frames === 6 ? resolve() : requestAnimationFrame(tick);
      requestAnimationFrame(tick);
    });
    return window.fixtureObserverCalls;
  });
  assert.ok(observerCalls > 0 && observerCalls < 10, "observer-driven decoration settles and animation frames keep running");
  await page.getByPlaceholder("输入消息，可粘贴图片").fill("界面仍可响应");
  await page.evaluate(async () => {
    await window.TavernHelper.setChatMessages([{ message_id: 0, swipe_id: 3 }]);
  });
  await message.locator(".fixture-line").filter({ hasText: "桌上摆着一杯茶" }).waitFor();

  await page.reload();
  await page.waitForFunction(() => window.__greetingRuntimeReady, null, { timeout: 90_000 });
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await message.getByText("夕阳照亮庭院。", { exact: true }).waitFor();
  await ordinary.getByText("修改后第二段。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await window.TavernHelper.getChatMessages(0))[0].swipe_id), 3,
    "the selected opening is restored even after the greeting controls are hidden by later messages");
  assert.deepEqual(errors, []);
  console.log("PASS: real Tavern DOM clearing, protected UI rejection, observer responsiveness, opening selection, decorated DOM replacement, editing, mobile layout and reload");
} catch (error) {
  await page?.screenshot({ path: ".runtime/greeting-render-failure.png" });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
