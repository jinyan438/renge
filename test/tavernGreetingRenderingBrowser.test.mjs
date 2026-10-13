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
const chooser = `\`\`\`html
<button id="opening" onclick="selectOpening()">进入清晨开局</button>
<script>
async function selectOpening() {
  const messages = await getChatMessages('0', { include_swipes: true });
  await setChatMessage(String(messages[0].swipes[1]), 0, {
    swipe_id: 1, refresh: 'display_and_render_current',
  });
}
</script>
\`\`\``;
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
  window.fixtureObserver = observer;
};
window.decorateTavernSequenceFixture = () => {
  const box = document.querySelector('#chat .mes[mesid="0"] .mes_text');
  const lines = getChatMessages(0)[0].message.trim().split(/\\r?\\n\\s*\\r?\\n/);
  let index = 0;
  for (const paragraph of box.querySelectorAll(':scope > p')) {
    const source = lines[index];
    if (!source) break;
    if (source.startsWith('<IllustrationImpl')) {
      // Tavern paragraph decorators reserve empty paragraphs for illustrations.
      // Literal placeholder text used to stop the sequential cursor here,
      // leaving every following dialogue/narrative paragraph undecorated.
      if (paragraph.textContent.trim()) continue;
      const illustration = document.createElement('span');
      illustration.className = 'fixture-illustration';
      illustration.textContent = '风景插画';
      paragraph.replaceChildren(illustration);
    } else {
      if (!paragraph.textContent.includes(source)) continue;
      const line = document.createElement('span');
      line.className = 'fixture-sequence-line';
      line.textContent = source;
      paragraph.replaceChildren(line);
    }
    index += 1;
  }
  return index;
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
  await page.locator(".chat-html-frame").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(async () => (await window.TavernHelper.getChatMessages(0))[0].message), morning,
    "the content-first singular API must not replace the opening with its message id");
  await message.getByText("晨光照进房间。", { exact: true }).waitFor();
  assert.match(await message.innerText(), /窗外传来鸟鸣/);
  assert.equal(await message.locator(".roleplay-greeting-count").textContent(), "2/4");
  assert.equal(await page.evaluate(async () => {
    await window.TavernHelper.replaceVariables({ scene: "morning" }, { type: "message", message_id: 0 });
    await window.SillyTavern.getContext().saveChat();
    return (await window.TavernHelper.getChatMessages(0))[0].swipes.length;
  }), 4, "saving script variables must retain the greeting's opening list");
  assert.equal(await page.evaluate(() => window.TavernHelper.getVariables({ type: "message", message_id: 0 }).scene),
    "morning", "saving a nonzero greeting swipe retains its variables");
  assert.equal(await message.locator(".mes_text > p").count(), 4,
    "paragraph decorators can reach each paragraph and illustration marker directly");
  assert.equal(await page.evaluate(() => window.decorateTavernSequenceFixture()), 4,
    "an illustration placeholder must not block decoration of the following paragraphs");
  assert.equal(await message.locator(".fixture-illustration").count(), 1);
  await message.locator(".fixture-sequence-line").filter({ hasText: "窗外传来鸟鸣" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.exerciseTavernFixtureMutations()),
    Array(11).fill("NoModificationAllowedError"),
    "real Tavern scripts can rewrite content but protected UI mutations fail explicitly");
  assert.equal(await page.locator("#root #chat .mes_text").count(), 1);
  await page.evaluate(async () => {
    const greetings = await window.TavernHelper.getChatMessages('0', { include_swipes: true });
    await window.TavernHelper.setChatMessage(greetings[0].swipes[2], 0, { swipe_id: 2 });
  });
  await message.getByText("夕阳照亮庭院。", { exact: true }).waitFor();
  assert.equal(await message.locator(".roleplay-greeting-count").textContent(), "3/4");
  await page.evaluate(async () => {
    const greetings = await window.TavernHelper.getChatMessages('0', { include_swipes: true });
    await window.TavernHelper.setChatMessage(0, greetings[0].swipes[1], { swipe_id: 1 });
  });
  await message.getByText("晨光照进房间。", { exact: true }).waitFor();
  assert.equal(await message.locator(".roleplay-greeting-count").textContent(), "2/4");

  // Recover a previously corrupted opening without requiring a new conversation.
  await page.evaluate(async () => {
    await window.TavernHelper.setChatMessage('0', 0);
  });
  await message.getByText("0", { exact: true }).waitFor();
  await page.evaluate(async () => {
    const greetings = await window.TavernHelper.getChatMessages(0, { include_swipes: true });
    await window.TavernHelper.setChatMessage(greetings[0].swipes[1], 0, { swipe_id: 1 });
  });
  await message.getByText("晨光照进房间。", { exact: true }).waitFor();
  assert.equal(await message.locator(".roleplay-greeting-count").textContent(), "2/4");

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

  const markerContent = [
    "通用标记之前。",
    "<SceneArt ref='window > dawn' />",
    '<IllustrationImpl ref="landscape#2"/><InlineScene/>',
    "通用标记之后。",
    "",
    '`<IllustrationImpl ref="code" />`',
    "",
    "<StatusPlaceHolderImpl>",
    "",
    '```text\n<SceneArt ref="fenced-code" />\n```',
  ].join("\r\n");
  await page.evaluate(async content => {
    await window.TavernHelper.createChatMessages([{ role: "assistant", message: content }]);
  }, markerContent);
  const markerMessage = page.locator('#chat .mes[mesid="3"]');
  await markerMessage.getByText("通用标记之后。", { exact: true }).waitFor();
  assert.equal(await markerMessage.locator(".mes_text > p").count(), 5,
    "marker-only lines keep their paragraph even without surrounding blank lines");
  assert.equal(await markerMessage.locator("[data-tavern-placeholder]").count(), 4,
    "different custom markers, adjacent markers and legacy Impl tags remain inert slots");
  assert.equal((await markerMessage.locator(".mes_text > p").nth(1).textContent()).trim(), "");
  assert.equal((await markerMessage.locator(".mes_text > p").nth(4).textContent()).trim(), "");
  assert.equal(await markerMessage.locator("code").first().textContent(), '<IllustrationImpl ref="code" />',
    "inline code retains literal placeholder syntax");
  assert.equal((await markerMessage.locator("pre code").textContent()).trim(), '<SceneArt ref="fenced-code" />',
    "fenced code retains literal placeholder syntax");
  assert.equal(await markerMessage.locator(".chat-html-frame").count(), 0,
    "placeholders do not become isolated HTML frames");
  assert.equal(await page.evaluate(() => window.TavernHelper.getChatMessages(3)[0].message), markerContent,
    "display normalization leaves raw card content available to scripts and persistence");

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

  // A rendering-mode change also replaces DOM that card decorators own.
  await page.evaluate(() => {
    window.fixtureObserver.disconnect();
    window.decorateTavernFixture(0, true);
  });
  const htmlToggle = page.getByLabel("渲染 HTML", { exact: true });
  await htmlToggle.evaluate(input => input.click());
  await message.locator(".mes_text").waitFor({ state: "visible" });
  assert.equal(await markerMessage.locator("[data-tavern-placeholder]").count(), 0,
    "disabling HTML rendering restores literal marker text in a clean DOM tree");
  assert.match(await markerMessage.locator(".mes_text").textContent(), /<SceneArt ref='window > dawn' \/>/);
  await htmlToggle.evaluate(input => input.click());
  await markerMessage.locator("[data-tavern-placeholder]").first().waitFor({ state: "attached" });
  assert.equal(await markerMessage.locator("[data-tavern-placeholder]").count(), 4);

  await page.reload();
  await page.waitForFunction(() => window.__greetingRuntimeReady, null, { timeout: 90_000 });
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await message.getByText("夕阳照亮庭院。", { exact: true }).waitFor();
  await ordinary.getByText("修改后第二段。", { exact: true }).waitFor();
  assert.equal(await markerMessage.locator("[data-tavern-placeholder]").count(), 4,
    "placeholder slots survive reload");
  assert.equal(await page.evaluate(async () => (await window.TavernHelper.getChatMessages(0))[0].swipe_id), 3,
    "the selected opening is restored even after the greeting controls are hidden by later messages");
  assert.deepEqual(errors, []);
  console.log("PASS: Tavern DOM clearing, protected UI rejection, complete decoration across illustration slots, generic/adjacent placeholders, literal code, opening selection, editing, mobile layout and reload");
} catch (error) {
  await page?.screenshot({ path: ".runtime/greeting-render-failure.png" });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
