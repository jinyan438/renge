import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Exercise neutral compiled-card patterns without personal cards or CDN access.
// Run after npm run build; all conversations and persistence are isolated.
const root = await mkdtemp(join(tmpdir(), "renge-html-dependencies-"));
const headScript = `<script>
window.headState = errorCatched(function() {
  return { name: z.object({ name: z.string().prefault('旅人') }).parse({}).name,
    tokens: ['$&', '$1', '$\u0060', "$'", '$$'] };
})();
</script>`;
const frontend = `<div id="app"></div>
<script type="module">
await waitGlobalInitialized('Mvu');
if (headState && headState.name !== '旅人') throw new Error('Classic head script did not initialize');
const schema = z.z.object({ name: z.z.string().prefault('旅人'), age: z.z.coerce.number().prefault(22) });
const defaults = schema.parse({});
const store = errorCatched(function() { return { value: this.value }; }).call({ value: defaults });
if (store.then || store.value.age !== 22) throw new Error('Synchronous store was converted to a promise');
if ((await errorCatched(async () => defaults.age)()) !== 22) throw new Error('Async callback failed');
const sorted = _({ second: 2, first: 1 }).entries().sortBy(entry => entry[0]).map(entry => entry[1]).value();
if (!_.isEqual(sorted, [1, 2]) || !_.has(getVariables({ type: 'message' }), 'stat_data')) throw new Error('Lodash or message variables missing');
document.getElementById('app').innerHTML = '<form><h2><i class="fa-solid fa-pen-to-square"></i>通用档案表单</h2><label>姓名<input value="旅人"></label><button type="button">添加关系人物</button><button type="submit">保存档案</button><output></output></form>';
document.querySelector('form [type=button]').onclick = () => document.querySelector('output').textContent = '关系人物已添加';
document.querySelector('form').onsubmit = async event => {
  event.preventDefault();
  const name = document.querySelector('input').value;
  await updateVariablesWith(vars => _.set(vars, 'stat_data.name', name), { type: 'message' });
  await createChatMessages([{ role: 'user', message: '已创建档案：' + name }]);
  await setInput('继续：' + name);
  toastr.success('档案已保存');
  document.querySelector('output').textContent = '已保存：' + name;
};
</script>`;
const documents = [
  `<!doctype html><html><head data-card="yes">${headScript}</head><body>${frontend}</body></html>`,
  `<html lang="zh"><body>${headScript}${frontend}</body></html>`,
  `${headScript}${frontend}`,
];
const vueDocument = `<head>${headScript}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fixture">
<style>body{margin:0;min-height:50vh}form{padding:12px}input{max-width:100%;box-sizing:border-box}</style></head>
<body><div id="app"></div><script type="module">
const { createApp, ref } = Vue;
if (typeof Vue.compile !== 'function') throw new Error('Vue template compiler missing');
createApp({setup() {
  const name = ref('旅人'), result = ref('');
  const add = () => { result.value = '关系人物已添加'; };
  const save = async () => {
    const data = Mvu.getMvuData({type:'message'});
    await Mvu.replaceMvuData(_.set(data, 'stat_data.name', name.value), {type:'message'});
    await createChatMessages([{role:'user', message:'已创建档案：' + name.value}]);
    await setInput('继续：' + name.value);
    result.value = '已保存：' + name.value;
  };
  return {name,result,add,save};
},template:'<form @submit.prevent="save"><h2>通用档案表单</h2><label>姓名<input v-model="name"></label><button type="button" @click="add">添加关系人物</button><button type="submit">保存档案</button><output>{{result}}</output></form>'}).mount('#app');
// Packed documents must receive the same parent-reference compatibility as
// ordinary frontends, without exposing the real host document.
if (window.parent.document !== document) throw new Error('Packed parent reference was not isolated');
</script></body>`;
documents.push(`<body><script>(function(){var h=new TextDecoder().decode(Uint8Array.from(atob('${Buffer.from(vueDocument).toString('base64')}'),function(c){return c.charCodeAt(0)}));document.write(h)})();</script></body>`);
let server, browser, page;
try {
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const card = { id: "dependency-card", name: "表单测试", firstMessage: "开场正文。\n\n<OpeningPlaceHolder/>", createdAt: now, updatedAt: now,
    extensions: { regex_scripts: [{ id: "opening-form", scriptName: "通用开场表单", findRegex: "<OpeningPlaceHolder/>",
      // Escape the dollar in script literals so the card regex's intentional
      // capture substitution does not consume it before HTML injection.
      replaceString: `\`\`\`html\n${documents[0].replaceAll("$1", "\\u00241")}\n\`\`\``, placement: [2], markdownOnly: true, promptOnly: false, disabled: false }] } };
  const seed = { version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true, chatMultiBubbleEnabled: false,
    activeCharacterCardId: card.id, characterCards: [card], chatSessions: [{ id: "dependency-chat", title: "HTML 表单测试", mode: "roleplay",
      roleplayCharacterCardId: card.id, messages: documents.map((doc, index) => ({ id: `form-${index}`, role: "assistant",
        content: index === 0 ? card.firstMessage : `\`\`\`html\n${doc}\n\`\`\``, variables: { stat_data: { name: "待初始化" } }, createdAt: now })),
      createdAt: now, updatedAt: now }] };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route(/https:\/\//, route => route.abort());
  const pendingFonts = [];
  await page.route('https://fonts.googleapis.com/**', route => { pendingFonts.push(route); });
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.getByText("开场正文。", { exact: true }).waitFor();
  await page.locator('.chat-bubble-dot').first().click();
  for (let index = 0; index < documents.length; index++) {
    const message = page.locator(`#chat .mes[mesid="${index}"]`);
    await message.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.waitForFunction(index => !document.querySelector(`#chat .mes[mesid="${index}"] .chat-html-preview-placeholder`)?.textContent.includes('正在同步'), index);
    // Opening the chat initially scrolls to its newest message; explicitly
    // mount older previews through the same control available to the user.
    await message.locator('.chat-html-preview-placeholder button').evaluateAll(buttons => buttons.forEach(button => button.click()));
    const locator = message.locator("iframe.chat-html-frame");
    await locator.waitFor();
    const focusFrame = async () => {
      await page.locator('.chat-bubble-dot').nth(index).click();
      await locator.evaluate(element => element.scrollIntoView({block:'start',behavior:'instant'}));
      await page.waitForFunction(element => !element.parentElement.classList.contains('inactive'), await locator.elementHandle());
    };
    await focusFrame();
    const frame = await (await locator.elementHandle()).contentFrame();
    await frame.getByRole("heading", { name: "通用档案表单" }).waitFor();
    if (index === documents.length - 1) {
      assert.equal(pendingFonts.length, 1, "Vue mounts while the optional font stylesheet is still pending");
      for (const route of pendingFonts) await route.fulfill({contentType:'text/css',body:'/* fixture font loaded */'});
      await frame.waitForFunction(() => document.querySelector('link[href*="fonts.googleapis.com"]').media === 'all');
      assert.ok((await locator.boundingBox()).height < 900, "packed viewport styles do not create a height feedback loop");
    }
    assert.deepEqual(await frame.evaluate(() => window.headState.tokens), ["$&", "$1", "$`", "$'", "$$"]);
    assert.ok((await locator.boundingBox()).height > 60, "rendered form is measured instead of remaining blank");
    assert.equal(await frame.evaluate(async () => {
      await document.fonts.load('900 16px "Font Awesome 6 Free"');
      return document.fonts.check('900 16px "Font Awesome 6 Free"');
    }), true, "icons load within the isolated preview origin");
    await focusFrame();
    await frame.getByRole("button", { name: "添加关系人物" }).click();
    await frame.getByText("关系人物已添加", { exact: true }).waitFor();
    await frame.getByLabel("姓名").fill(`旅人${index}`);
    await focusFrame();
    await frame.getByRole("button", { name: "保存档案" }).click();
    await frame.getByText(`已保存：旅人${index}`, { exact: true }).waitFor();
    await page.getByText(`已创建档案：旅人${index}`, { exact: true }).waitFor();
    await page.waitForFunction(name => document.querySelector('textarea[placeholder="输入消息，可粘贴图片"]')?.value === `继续：${name}`, `旅人${index}`);
    await frame.waitForFunction(name => getVariables({ type: "message" }).stat_data.name === name, `旅人${index}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const first = page.locator('#chat .mes[mesid="0"]');
  await first.scrollIntoViewIfNeeded();
  await first.frameLocator("iframe").getByRole("heading", { name: "通用档案表单" }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.getByText(`已创建档案：旅人${documents.length - 1}`, { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: regex openings, classic/module startup, packed Vue templates, nonblocking fonts, Zod 4 namespaces, full Lodash, literal tokens, icons, forms, variables, messages, mobile layout and reload without CDN access");
} catch (error) {
  console.log(await page?.locator('#chat .mes').evaluateAll(messages => messages.map(m=>({id:m.getAttribute('mesid'),frames:m.querySelectorAll('iframe').length,preview:m.querySelector('.chat-html-preview')?.className,text:m.innerText.slice(0,110)}))));
  console.log(await page?.locator('.chat-html-frame').evaluateAll(frames => frames.map(frame => ({ height: frame.clientHeight, active: frame.parentElement.className }))));
  await page?.screenshot({ path: ".runtime/html-dependencies-failure.png" });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
