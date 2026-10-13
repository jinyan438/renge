import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Exercise card-owned images and a parent-mounted HUD with neutral local assets.
// Run after npm run build; application data and the browser profile are isolated.
const root = await mkdtemp(join(tmpdir(), "renge-card-visuals-"));
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#597fbc"/><circle cx="30" cy="25" r="12" fill="#ffe09b"/></svg>')}`;
const opening = (scene, time, location) => `${scene}第一段。\n\n旅人〔开心〕「一起出发吧。」\n\n<IllustrationImpl ref="landscape#1" />\n\n旅人〔日常〕「继续往前走。」\n\n${scene}最后一段。\n\n<initvar>\nenv:\n  time: "${time}"\n  location: ${location}\n</initvar>`;
const morning = opening("清晨", "07:20", "旅店");
const evening = opening("傍晚", "18:10", "庭院");
const chooser = '```html\n<button onclick="setChatMessages([{message_id:0, swipe_id:1}])">进入清晨</button>\n```';
const scriptContent = `
  const host = parent.document;
  const style = host.createElement('style');
  style.textContent = '.visual-avatar{width:40px;height:40px;vertical-align:middle;margin-right:8px}.visual-illustration{display:block;width:180px;max-width:100%;height:auto}.visual-hud{position:fixed;right:12px;top:12px;z-index:2147483000;background:#172033;color:white;border-radius:8px;padding:12px}';
  // Many card decorators assume a dark host and replace its prose typography.
  style.textContent += '.visual-prose{font-family:monospace;font-size:30px;color:#e8eef6}.visual-dialogue,.visual-narrative{font-family:serif;font-size:26px;color:#eef5fb}';
  style.textContent += '.visual-panel{background:#172033;color:#eef5fb;font-family:serif}.visual-caption{color:#ffffff;font-family:serif;font-size:12px}';
  style.textContent += '.visual-speaker{color:#ffcf9a;font-family:serif;font-size:22px}.visual-speaker-alt{color:#9fd8ff}';
  host.head.appendChild(style);
  const hud = host.createElement('aside');
  hud.className = 'visual-hud';
  hud.setAttribute('aria-label', '角色浮动状态');
  host.body.appendChild(hud);
  const paint = () => {
    const message = getChatMessages(0)[0];
    const box = host.querySelector('#chat .mes[mesid="0"] .mes_text');
    if (!message || !box) return;
    const env = getVariables({type:'message', message_id:0}).stat_data?.env;
    if (env) hud.textContent = env.time + ' · ' + env.location;
    const lines = message.message.replace(/<initvar>[\\s\\S]*?<\\/initvar>/gi, '').trim().split(/\\n{2,}/);
    let index = 0;
    for (const paragraph of box.querySelectorAll(':scope > p')) {
      if (!lines[index]) break;
      if (paragraph.dataset.visualDone === 'true') { index++; continue; }
      const source = lines[index];
      if (source.startsWith('<IllustrationImpl')) {
        if (paragraph.textContent.trim()) continue;
        const art = host.createElement('img');
        art.className = 'visual-illustration';
        art.alt = '风景插画';
        art.src = ${JSON.stringify(image)};
        const panel = host.createElement('details');
        panel.className = 'visual-panel';
        panel.open = true;
        panel.innerHTML = '<summary>插画说明</summary><span class="visual-caption">独立面板文字</span>';
        paragraph.replaceChildren(art, panel);
      } else {
        if (!paragraph.textContent.includes(source)) continue;
        if (source.startsWith('旅人〔')) {
          const avatar = host.createElement('img');
          avatar.className = 'visual-avatar';
          avatar.alt = '角色对话头像';
          avatar.src = ${JSON.stringify(image)};
          const alternate = source.includes('〔日常〕');
          const speaker = host.createElement(alternate ? 'strong' : 'b');
          speaker.className = 'visual-speaker' + (alternate ? ' visual-speaker-alt' : '');
          if (alternate) {
            const label = host.createElement('span');
            label.textContent = '旅人';
            speaker.appendChild(label);
          } else speaker.textContent = '旅人';
          const dialogue = host.createElement('span');
          dialogue.className = 'visual-dialogue';
          dialogue.textContent = source.replace(/^旅人〔[^〕]*〕/, '');
          paragraph.replaceChildren(avatar, speaker, dialogue);
        } else {
          const narrative = host.createElement('span');
          narrative.className = 'visual-narrative';
          narrative.textContent = source;
          paragraph.replaceChildren(narrative);
        }
      }
      paragraph.classList.add('visual-prose');
      paragraph.dataset.visualDone = 'true';
      index++;
    }
  };
  const schedule = () => setTimeout(paint, 0);
  ['chat_changed', 'message_swiped', 'character_message_rendered', 'mag_variable_initialized', 'variable_changed'].forEach(event => eventOn(event, schedule));
  let observedChat;
  const observer = new parent.MutationObserver(schedule);
  setInterval(() => {
    const chat = host.getElementById('chat');
    if (chat && chat !== observedChat) {
      observer.disconnect();
      observer.observe(chat, {childList:true, subtree:true});
      observedChat = chat;
      schedule();
    }
  }, 100);
  parent.__visualRuntimeReady = true;
`;
let server;
let browser;
let page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const card = {
    id: "visual-card", name: "旅人", firstMessage: chooser, alternateGreetings: [morning, evening],
    tavernScripts: [{id:"visual-script", name:"Card visual fixture", enabled:true, autoRun:true, runOn:"startup", content:scriptContent}],
    regexScripts: [{id:"hide-init", scriptName:"Hide variable initialization", findRegex:"/<initvar>[\\s\\S]*?<\\/initvar>/gi", replaceString:"", placement:[2], markdownOnly:true, disabled:false}],
    createdAt: now, updatedAt: now,
  };
  const seed = {
    version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true, chatMultiBubbleEnabled: false,
    chatPersonalization: {messageFontFamily:"lxgw-wenkai-screen", messageFontSize:18, quoteStyleEnabled:true, quoteStyleColor:"#bb6600", italicStyleEnabled:true, italicStyleColor:"#665599"},
    activeCharacterCardId: card.id, characterCards: [card],
    chatSessions: [{id:"visual-chat", title:"视觉渲染测试", mode:"roleplay", roleplayCharacterCardId:card.id, roleplayGreetingIndex:0,
      messages:[{id:"greeting", role:"assistant", source:"roleplay-greeting", content:chooser, createdAt:now}], createdAt:now, updatedAt:now}],
  };
  assert.equal((await fetch(`${server.url}/api/app-data`, {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({data:seed})})).ok, true);
  browser = await chromium.launch({ headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || undefined });
  page = await browser.newPage({viewport:{width:1440, height:1000}});
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const openChat = async () => {
    await page.waitForFunction(() => window.__visualRuntimeReady, null, {timeout:90_000});
    await page.getByRole("button", {name:"打开Agent Chat", exact:true}).click();
    await page.getByRole("button", {name:"开始对话", exact:true}).last().click();
  };
  const assertVisuals = async (scene, status) => {
    const message = page.locator('#chat .mes[mesid="0"]');
    await message.getByText(`${scene}最后一段。`, {exact:true}).waitFor();
    await message.getByAltText("角色对话头像").first().waitFor();
    await message.getByAltText("风景插画").waitFor();
    await page.getByLabel("角色浮动状态").getByText(status, {exact:true}).waitFor();
    assert.equal(await message.locator(".visual-avatar").count(), 2,
      "dialogue avatars render both before and after the illustration slot");
    assert.equal(await message.locator(".visual-illustration").count(), 1);
    const typography = await message.locator(".mes_text").evaluate(box => {
      const properties = element => {
        const style = getComputedStyle(element);
        return {family:style.fontFamily, size:style.fontSize, color:style.color};
      };
      return {base:properties(box), decorated:[...box.querySelectorAll('.visual-prose, .visual-dialogue, .visual-narrative')].map(properties)};
    });
    assert.match(typography.base.family, /LXGW WenKai Screen/);
    assert.equal(typography.base.size, "18px");
    assert.equal(typography.base.color, "rgb(32, 42, 51)");
    assert.deepEqual(typography.decorated, typography.decorated.map(() => typography.base),
      "card prose and dialogue retain the host font, size and readable text color");
    assert.deepEqual(await message.locator('.visual-speaker').evaluateAll(names => names.map(name => getComputedStyle(name).color)),
      ["rgb(255, 207, 154)", "rgb(159, 216, 255)"],
      "bold and strong speaker labels retain their card-defined colors");
    assert.equal(await message.locator('.visual-speaker-alt > span').evaluate(name => getComputedStyle(name).color), "rgb(159, 216, 255)",
      "nested speaker text inherits its label color");
    assert.equal(await page.getByLabel("角色浮动状态").evaluate(panel => getComputedStyle(panel).color), "rgb(255, 255, 255)",
      "the card's independent dark HUD retains its own text color");
    assert.deepEqual(await message.locator('.visual-caption').evaluate(element => {
      const style = getComputedStyle(element);
      return {color:style.color, family:style.fontFamily, size:style.fontSize};
    }), {color:"rgb(255, 255, 255)", family:"serif", size:"12px"},
      "embedded card panels retain their typography");
    await message.locator("img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.ok(await message.locator("img").evaluateAll(images => images.every(image => image.naturalWidth > 0)));
    assert.ok(await message.locator(".chat-bubble").evaluate(bubble => bubble.scrollWidth <= bubble.clientWidth + 1));
    assert.ok(await message.locator("img").evaluateAll(images => images.every(image => {
      const rect = image.getBoundingClientRect();
      const bubble = image.closest('.chat-bubble').getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= bubble.left && rect.right <= bubble.right + 1
        && rect.top >= bubble.top && rect.bottom <= bubble.bottom + 1;
    })), "avatars and illustrations fit inside their bubble without clipping");
    assert.ok(await page.getByLabel("角色浮动状态").evaluate(panel => {
      const rect = panel.getBoundingClientRect();
      return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    }), "floating status remains inside the desktop and mobile viewport");
  };
  await page.goto(server.url);
  await openChat();
  await page.frameLocator(".chat-html-frame").getByRole("button", {name:"进入清晨"}).click();
  await assertVisuals("清晨", "07:20 · 旅店");
  await page.evaluate(async () => {
    await window.TavernHelper.insertOrAssignVariables({stat_data:{env:{time:"08:15", location:"街道"}}}, {type:"message", message_id:0});
  });
  await assertVisuals("清晨", "08:15 · 街道");
  await page.locator(".roleplay-greeting-next").click();
  await assertVisuals("傍晚", "18:10 · 庭院");
  await page.evaluate(async () => {await window.TavernHelper.setChatMessages([{message_id:0, swipe_id:1}]);});
  await assertVisuals("清晨", "07:20 · 旅店");
  await page.setViewportSize({width:390, height:844});
  await assertVisuals("清晨", "07:20 · 旅店");
  await page.reload();
  await openChat();
  await assertVisuals("清晨", "07:20 · 旅店");
  assert.equal(await page.getByLabel("角色浮动状态").count(), 1, "reload keeps a single floating status panel");
  await page.evaluate(async () => {
    await window.TavernHelper.createChatMessages([{role:'assistant', message:'正文「引用文字」和 *斜体文字*、**强调文字**，以及 `inlineCode`。'}]);
  });
  const plainMessage = page.locator('#chat .mes[mesid="1"]');
  await plainMessage.locator('.chat-personalized-quote').waitFor();
  assert.equal(await plainMessage.locator('.chat-personalized-quote').evaluate(element => getComputedStyle(element).color), "rgb(187, 102, 0)");
  assert.equal(await plainMessage.locator('.chat-personalized-italic').evaluate(element => getComputedStyle(element).color), "rgb(102, 85, 153)");
  assert.equal(await plainMessage.locator('.mes_text strong').evaluate(element => getComputedStyle(element).color), "rgb(32, 42, 51)",
    "ordinary Markdown emphasis still inherits the readable prose color");
  assert.match(await plainMessage.locator('code').evaluate(element => getComputedStyle(element).fontFamily), /mono/i,
    "inline code keeps its monospace font");
  assert.deepEqual(errors, []);
  console.log("PASS: card-scoped scripts render decoded dialogue avatars, illustrations and floating status across opening selection, variable updates, swipes, mobile layout and reload");
} catch (error) {
  await page?.screenshot({path:".runtime/tavern-visuals-failure.png"});
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, {recursive:true, force:true});
}
