import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";
import { createTavernVisualSeed } from "./fixtures/tavernVisualCard.mjs";

// Exercise card-owned images and a parent-mounted HUD with neutral local assets.
// Run after npm run build; application data and the browser profile are isolated.
const root = await mkdtemp(join(tmpdir(), "renge-card-visuals-"));
let server;
let browser;
let page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const seed = createTavernVisualSeed();
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
