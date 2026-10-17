import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Neutral fixtures reproduce script-mounted opening forms and shared-board
// frame lookup. Never load personal cards, app data, or a live model provider.
const root = await mkdtemp(join(tmpdir(), "renge-runner-compat-"));
let server, browser;
try {
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const form = `<input id="name" value="Traveller"><button id="save">Save opening</button><output id="result"></output>
    <script>
      document.getElementById('save').onclick = () => parent.postMessage({fixture: 'save', name: document.getElementById('name').value}, '*');
      addEventListener('message', event => { if (event.data?.fixture === 'saved') document.getElementById('result').textContent = event.data.name; });
    </script>`;
  const script = `
    const host = parent;
    function mount() {
      const slot = host.document.querySelector('[data-runner-opening]');
      if (!slot || slot.dataset.mounted) return;
      slot.dataset.mounted = 'yes';
      const frame = host.document.createElement('iframe');
      frame.title = 'Runner opening fixture'; frame.sandbox = 'allow-scripts';
      frame.srcdoc = ${JSON.stringify(form)};
      slot.replaceChildren(frame);
      host.__fixtureOpeningFrame = frame;
    }
    new MutationObserver(mount).observe(host.document.getElementById('chat'), {childList:true,subtree:true});
    mount();
    host.__FIXTURE_CALENDAR__ = {get: () => ({date: getVariables({type:'chat'}).date || 'Day 1'})};
    host.addEventListener('message', async event => {
      if (event.source !== host.__fixtureOpeningFrame?.contentWindow || event.data?.fixture !== 'save') return;
      try {
        const name = event.data.name;
        await updateVariablesWith(vars => ({...vars, name, date:'Day 2'}), {type:'chat'});
        const book = getCharWorldbookNames('current').primary;
        await createWorldbookEntries(book, [{name:'Saved opening', content:'PROFILE: '+name,
          strategy:{type:'constant'}, extra:{profile_source:'runner-fixture',nested:{name}}}]);
        const entry = (await getWorldbook(book)).find(entry => entry.extra?.profile_source === 'runner-fixture');
        if (entry?.extra.nested.name !== name) throw new Error('Worldbook metadata lost');
        setInput('Begin as '+name);
        injectPrompts([{id:'profile-once',position:'in_chat',depth:0,role:'system',content:'ONCE_PROFILE '+name}], {once:true});
        injectPrompts([{id:'persistent',position:'in_chat',depth:1,role:'system',content:'PERSISTENT_RULE'}]);
        injectPrompts([{id:'removed',content:'REMOVED_RULE'}]).uninject();
        injectPrompts([{id:'removed-by-id',content:'REMOVED_BY_ID'}]); uninjectPrompts(['removed-by-id']);
        injectPrompts([{id:'filtered',content:'FILTERED_RULE',filter:async()=>false}]);
        injectPrompts([{id:'scan',position:'none',content:'fixture-world-key',should_scan:true}]);
        event.source.postMessage({fixture:'saved',name}, '*');
      } catch (error) { host.__fixtureError = error.message; }
    });
    eventOn(tavern_events.GENERATION_AFTER_COMMANDS, () => {
      injectPrompts([{id:'plot',position:'in_chat',depth:0,role:'system',content:'PLOT_HOOK'}]);
    });
    eventOn(tavern_events.GENERATION_ENDED, () => { host.__fixtureEnded = (host.__fixtureEnded||0)+1; });
    host.__fixtureReady = true;
  `;
  const seed = {
    version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true,
    activeCharacterCardId: "card", activeProviderId: "provider",
    providers: [{id:"provider", name:"Fixture", apiBaseUrl:"http://fixture.invalid/v1", apiKey:"fixture", apiType:"chat-completions",modelId:"fixture-model",models:["fixture-model"],updatedAt:now}],
    llmContextSettings: {skills:false,mcpTools:false,workspaceTools:false},
    tavernScripts: [
      {id:"background-fixture",name:"Background startup fixture",enabled:true,content:"parent.__fixtureBackgroundReady = true;"},
      {id:"runner-fixture",name:"Runner compatibility fixture",enabled:true,content:script},
    ],
    characterCards: [{id:"card",name:"Runner fixture",firstMessage:'<div data-runner-opening="yes">Opening loading</div>',
      characterBook:{id:"book",name:"Runner World",entries:[{uid:"lore",keys:["fixture-world-key"],content:"SCANNED_WORLD_LORE"}]},createdAt:now,updatedAt:now}],
    chatSessions: ["one","two"].map(id => ({id,title:`Runner ${id}`,mode:"roleplay",roleplayCharacterCardId:"card",
      messages:[{id:`greeting-${id}`,role:"assistant",source:"roleplay-greeting",content:'<div data-runner-opening="yes">Opening loading</div>',createdAt:now}],createdAt:now,updatedAt:now})),
  };
  assert.equal((await fetch(`${server.url}/api/app-data`, {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:seed})})).ok, true);
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
  const requests = [];
  await page.route("**/api/pi/chat", async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({contentType:"text/event-stream",body:
      `data: ${JSON.stringify({choices:[{index:0,delta:{content:"Fixture reply"},finish_reason:null}]})}\n\n`+
      `data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:"stop"}]})}\n\ndata: [DONE]\n\n`});
  });
  await page.goto(server.url);
  await page.waitForFunction(() => window.__fixtureBackgroundReady);
  await page.getByRole("button",{name:"打开Agent Chat",exact:true}).click();
  await page.getByRole("button",{name:"开始对话",exact:true}).last().click();
  await page.locator(".chat-session-item").filter({hasText:"Runner one"}).click();
  await page.waitForFunction(() => window.__fixtureReady && document.querySelector('[data-runner-opening] iframe'));
  const opening = page.frameLocator('iframe[title="Runner opening fixture"]');
  await opening.locator("#name").fill("Alex");
  await opening.locator("#save").click();
  await opening.locator("#result").getByText("Alex",{exact:true}).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('[data-runner-opening] iframe') === window.__fixtureOpeningFrame), true,
    "variable, worldbook and composer updates must preserve the mounted opening frame");
  const input = page.getByPlaceholder("输入消息，可粘贴图片");
  assert.equal(await input.inputValue(), "Begin as Alex");
  assert.equal(await page.evaluate(() => typeof TavernHelper.getTavernHelperVersion()), "string");
  assert.equal(await page.evaluate(() => typeof TavernHelper.getTavernVersion()), "string");

  async function send(text, sequence) {
    const ended = await page.evaluate(() => window.__fixtureEnded || 0);
    await input.fill(text);
    await page.getByRole("button",{name:"发送",exact:true}).click();
    await page.waitForFunction(n => window.__fixtureEnded >= n, ended + 1);
    assert.equal(requests.length, sequence);
    return JSON.stringify(requests.at(-1));
  }
  const first = await send("Begin as Alex", 1);
  const firstMessages = requests[0].request.messages;
  const firstUserIndex = firstMessages.findIndex(message => message.role === 'user' && message.content === 'Begin as Alex');
  assert.equal(firstMessages[firstUserIndex - 1].content, 'PERSISTENT_RULE', 'depth one precedes the last message');
  assert.equal(firstMessages[firstUserIndex + 1].content, 'ONCE_PROFILE Alex', 'depth zero follows the last message');
  for (const text of ["ONCE_PROFILE Alex","PERSISTENT_RULE","PLOT_HOOK","SCANNED_WORLD_LORE","PROFILE: Alex"]) assert.ok(first.includes(text), text);
  for (const text of ["REMOVED_RULE","REMOVED_BY_ID","FILTERED_RULE","\"content\":\"fixture-world-key\""]) assert.ok(!first.includes(text), text);
  const second = await send("Continue", 2);
  assert.ok(second.includes("PERSISTENT_RULE"), "default injections persist across generations");
  assert.ok(!second.includes("ONCE_PROFILE"), "once injections expire after generation");

  await page.locator(".chat-session-item").filter({hasText:"Runner two"}).click();
  await page.waitForFunction(() => SillyTavern.getContext().chatId === 'two');
  const other = await send("Separate story", 3);
  assert.ok(!other.includes("PERSISTENT_RULE"), "injections belong to the conversation that installed them");
  assert.ok(!other.includes("PROFILE: Alex"), "saved profiles belong to their conversation");
  await page.locator(".chat-session-item").filter({hasText:"Runner one"}).click();
  await page.waitForFunction(() => SillyTavern.getContext().chatId === 'one');

  // Two previews in one message use parent aliases to locate their source and
  // occurrence, just like shared-board entry frames. The mirror stays detached.
  const preview = `\`\`\`html
    <html data-fixture="board"><body><output id="lookup"></output><script>
      const P=window.parent, frames=Array.from(P.document.querySelectorAll('iframe'));
      const own=frames.find(f=>f.contentWindow===window), mes=own.closest('.mes');
      const same=frames.filter(f=>f.contentDocument.documentElement.dataset.fixture==='board');
      const raw=P.SillyTavern.getContext().chat[Number(mes.getAttribute('mesid'))].mes;
      document.getElementById('lookup').textContent=JSON.stringify({index:Number(mes.getAttribute('mesid')),part:same.indexOf(own),raw:raw.includes('SOURCE_TOKEN'),hostExposed:!!P.document.getElementById('root'),date:window.parent.__FIXTURE_CALENDAR__.get().date});
      P.document.body.dataset.detached='yes';
    </script></body></html>
  \`\`\``;
  await page.evaluate(async content => TavernHelper.createChatMessages([{role:"assistant",message:content}]), `SOURCE_TOKEN\n\n${preview}\n\n${preview}`);
  const previews = page.locator("#chat .mes").last().locator("iframe.chat-html-frame");
  await previews.nth(1).waitFor();
  for (let part=0; part<2; part++) {
    const frame = await (await previews.nth(part).elementHandle()).contentFrame();
    await frame.waitForFunction(() => document.querySelector('#lookup')?.textContent, undefined, {polling:50});
    assert.deepEqual(JSON.parse(await frame.locator("#lookup").textContent()), {index:5,part,raw:true,hostExposed:false,date:"Day 2"});
    assert.notEqual(new URL(frame.url()).hostname, new URL(page.url()).hostname, "frontend documents retain a separate origin");
    await frame.evaluate(() => { window.originalChat = SillyTavern.getContext().chat; });
  }
  assert.equal(await page.evaluate(() => document.body.dataset.detached), undefined);
  await page.evaluate(async () => TavernHelper.setChatMessages([{message_id:1,message:'Updated user source'}]));
  await page.waitForFunction(() => getChatMessages(1)[0].message === 'Updated user source');
  for (let part=0; part<2; part++) {
    const frame = await (await previews.nth(part).elementHandle()).contentFrame();
    // Offscreen previews intentionally suspend animation frames. Context sync
    // remains live and must be checked independently of animation scheduling.
    await frame.waitForFunction(() => SillyTavern.getContext().chat[1].mes === 'Updated user source', undefined, {polling:50}).catch(async error => {
      console.error('Preview sync:', await frame.evaluate(() => ({chat:SillyTavern.getContext().chat.map(m=>m.mes.slice(0,50)),api:getChatMessages(1)})));
      throw error;
    });
    assert.equal(await frame.evaluate(() => originalChat === SillyTavern.getContext().chat), true);
  }
  // Active fragments must remain inside the isolated preview, including
  // entity-obfuscated URL schemes and embedded document content.
  for (const content of [
    '<div id="active-fragment" onclick="window.fixtureLeak=1">Click</div>',
    '<a id="active-fragment" href="java&#x73;cript:window.fixtureLeak=1">Link</a>',
    '<div id="active-fragment"><template><script>window.fixtureLeak=1</script></template></div>',
  ]) {
    await page.evaluate(async html => TavernHelper.createChatMessages([{role:"assistant",message:html}]), content);
    await page.locator("#chat .mes").last().locator("iframe.chat-html-frame").waitFor();
    assert.equal(await page.locator("#chat #active-fragment").count(), 0);
  }

  const saved = JSON.parse(await readFile(join(root,"data","app-data.json"),"utf8"));
  const profileEntry = saved.chatSessions.find(chat=>chat.id==='one').characterWorldBookOverrides.card.entries.find(entry=>entry.extra?.profile_source);
  assert.equal(profileEntry.extra.nested.name, "Alex");
  assert.equal(saved.characterCards[0].characterBook.entries.some(entry=>entry.extra?.profile_source), false);
  await page.reload();
  await page.getByRole("button",{name:"打开Agent Chat",exact:true}).click();
  await page.getByRole("button",{name:"开始对话",exact:true}).last().click();
  await page.waitForFunction(() => window.__fixtureReady);
  assert.equal(await page.evaluate(async () => (await TavernHelper.getWorldbook('Runner World')).find(entry=>entry.extra?.profile_source).extra.nested.name), "Alex");
  await page.locator(".chat-session-item").filter({hasText:"Runner two"}).click();
  await page.waitForFunction(() => SillyTavern.getContext().chatId === 'two');
  assert.equal(await page.evaluate(async () => (await TavernHelper.getWorldbook('Runner World')).some(entry=>entry.extra?.profile_source)), false);
  assert.deepEqual(errors, []);
  console.log("PASS: script-mounted opening, saved profile metadata, normal-generation prompt injections, scan-only lore activation, isolated multi-frame source lookup and reload/session isolation");
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve=>server.server.close(resolve));
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
