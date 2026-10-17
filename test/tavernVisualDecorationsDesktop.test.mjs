import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { createTavernVisualSeed } from "./fixtures/tavernVisualCard.mjs";

// A browser-only regression cannot catch scripts decorating the opener while
// React renders the actual message paragraphs into a native chat window.
const root = await mkdtemp(join(tmpdir(), "renge-tavern-desktop-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
Object.assign(env, {
  RENGE_DATA_DIR: join(root, "data"),
  RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"),
  RENGE_ELECTRON_CACHE_DIR: join(root, "cache"),
});
let app;
try {
  await mkdir(join(root, "data"));
  await writeFile(join(root, "data", "app-data.json"), JSON.stringify(createTavernVisualSeed()));
  app = await electron.launch({args:[resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout:60_000});
  const home = await app.firstWindow();
  await home.getByRole("button", {name:"开始对话", exact:true}).waitFor();
  const openChat = async () => {
    const [chat] = await Promise.all([
      app.waitForEvent("window"),
      home.getByRole("button", {name:"开始对话", exact:true}).click(),
    ]);
    chat.setDefaultTimeout(12_000);
    return chat;
  };
  let chat = await openChat();
  const errors = [];
  home.on("pageerror", error => errors.push(error.message));
  chat.on("pageerror", error => errors.push(error.message));
  const assertVisuals = async (scene, status) => {
    const message = chat.locator('#chat .mes[mesid="0"]');
    await message.getByText(`${scene}最后一段。`, {exact:true}).waitFor();
    await message.getByAltText("角色对话头像").first().waitFor();
    await message.getByAltText("风景插画").waitFor();
    await chat.getByLabel("角色浮动状态").getByText(status, {exact:true}).waitFor();
    assert.equal(await message.locator(".visual-avatar").count(), 2);
    assert.equal(await message.locator(".visual-illustration").count(), 1);
    await message.locator("img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.ok(await message.locator("img").evaluateAll(images => images.every(image => image.naturalWidth > 0)));
    assert.equal(await chat.locator('iframe[title="酒馆脚本运行环境"]').count(), 1);
    assert.equal(await home.locator('iframe[title="酒馆脚本运行环境"]').count(), 0);
    assert.equal(await home.locator(".visual-hud").count(), 0, "decorations must belong to the visible chat window");
    assert.deepEqual(await message.locator(".visual-speaker").evaluateAll(names => names.map(name => getComputedStyle(name).color)),
      ["rgb(255, 207, 154)", "rgb(159, 216, 255)"]);
    assert.equal(await message.locator(".visual-dialogue").first().evaluate(element => getComputedStyle(element).color), "rgb(32, 42, 51)");
  };
  await chat.frameLocator(".chat-html-frame").getByRole("button", {name:"进入清晨", exact:true}).click();
  await assertVisuals("清晨", "07:20 · 旅店");
  assert.equal(await chat.evaluate(() => window.__visualProtectionProbe()), "NoModificationAllowedError",
    "Tavern UI protection uses the native chat window's DOM realm");
  await chat.getByRole("button", {name:/^切换到下一条开场白/}).click();
  await assertVisuals("傍晚", "18:10 · 庭院");
  await app.evaluate(({BrowserWindow}) => {
    BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith("/desktop-window.html")).minimize();
  });
  await chat.evaluate(async () => {
    await window.TavernHelper.setChatMessages([{message_id:0, swipe_id:1}]);
    await window.TavernHelper.insertOrAssignVariables({stat_data:{env:{time:"08:15", location:"街道"}}}, {type:"message", message_id:0});
  });
  await assertVisuals("清晨", "08:15 · 街道");
  await chat.close();
  await home.locator('iframe[title="酒馆脚本运行环境"]').waitFor({state:"detached"});
  await app.evaluate(({BrowserWindow}) => {
    const home = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith("/desktop-window.html"));
    home.restore();
    home.show();
  });
  chat = await openChat();
  chat.on("pageerror", error => errors.push(error.message));
  await assertVisuals("清晨", "08:15 · 街道");
  assert.equal(await chat.getByLabel("角色浮动状态").count(), 1, "reopening mounts exactly one status panel");
  assert.deepEqual(errors, []);
  console.log("PASS: native chat owns Tavern scripts, decoded avatars/illustrations, status, name/prose colors, swipes, minimized opener and reopen");
} finally {
  await app?.close();
  await rm(root, {recursive:true, force:true, maxRetries:5, retryDelay:200});
}
