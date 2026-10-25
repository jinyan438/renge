import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { strFromU8, unzipSync } from "fflate";
import { startRengeServer } from "../server.mjs";

// Run after npm run build; all settings and browser data belong to this fixture.
const root = await mkdtemp(join(tmpdir(), "renge-preset-favorites-"));
let server, browser, page;
const errors = [];
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const prompt = {
    identifier: "shared-id", name: "人物外貌描写", role: "assistant", content: "收藏的外貌描写内容",
    enabled: false, marker: false, systemPrompt: true, injectionPosition: 2, injectionDepth: 3, injectionOrder: 37,
  };
  const existing = { ...prompt, name: "原有模块", content: "不要覆盖的内容", enabled: true };
  const seed = {
    version: 1, activeChatPresetId: "source", chatPresets: [
      { id: "source", name: "来源预设", prompts: [prompt] },
      { id: "target", name: "目标预设", prompts: [existing] },
    ],
  };
  assert.equal((await fetch(`${server.url}/api/app-data`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }),
  })).ok, true);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  let editor = page.locator(".preset-prompt-editor");
  let favorites = page.locator(".preset-favorite-prompts");
  const saved = async () => (await (await fetch(`${server.url}/api/app-data`)).json()).data;
  async function waitSaved(predicate) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const data = await saved();
      if (predicate(data)) return data;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail("preset favorites did not persist");
  }
  async function openPresets() {
    await page.getByRole("button", { name: "打开系统设置", exact: true }).click();
    await page.getByRole("button", { name: "打开设置", exact: true }).click();
    await page.locator(".settings-nav").getByRole("button", { name: "预设", exact: true }).click();
    await page.locator(".preset-editor").waitFor();
  }
  async function choosePreset(name) {
    await page.locator(".preset-list-panel .provider-item").filter({ hasText: name }).click();
  }
  await page.goto(server.url);
  await openPresets();
  await choosePreset("来源预设");
  const favoriteButton = editor.getByRole("button", { name: "收藏模块", exact: true });
  const deleteButton = editor.getByRole("button", { name: "删除模块", exact: true });
  const favoriteBox = await favoriteButton.boundingBox(), deleteBox = await deleteButton.boundingBox();
  assert.ok(favoriteBox.x + favoriteBox.width <= deleteBox.x, "favorite button precedes delete on the left");
  await favoriteButton.click();
  assert.equal(await editor.getByRole("button", { name: "取消收藏", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await favorites.getByRole("button", { name: "人物外貌描写 已添加", exact: true }).isDisabled(), true);
  const afterFavorite = await waitSaved(data => data.favoriteChatPresetPrompts?.length === 1);
  assert.deepEqual(afterFavorite.favoriteChatPresetPrompts[0].prompt, prompt);

  await choosePreset("目标预设");
  await favorites.getByRole("button", { name: "人物外貌描写", exact: true }).click();
  assert.equal(await editor.getByRole("textbox", { name: /^提示词内容/ }).inputValue(), prompt.content);
  assert.equal(await editor.getByRole("combobox", { name: /^角色/ }).inputValue(), "assistant");
  assert.equal(await editor.getByRole("combobox", { name: /^位置/ }).inputValue(), "2");
  assert.equal(await editor.getByLabel("深度", { exact: true }).inputValue(), "3");
  assert.equal(await page.getByRole("checkbox", { name: `启用 ${prompt.name}`, exact: true }).isChecked(), true);
  const afterAdd = await waitSaved(data => data.chatPresets.find(preset => preset.id === "target").prompts.length === 2);
  const targetPrompts = afterAdd.chatPresets.find(preset => preset.id === "target").prompts;
  assert.deepEqual(targetPrompts[0], existing);
  assert.notEqual(targetPrompts[1].identifier, prompt.identifier);
  assert.deepEqual(targetPrompts[1], { ...prompt, identifier: targetPrompts[1].identifier, enabled: true });
  await editor.getByRole("textbox", { name: /^提示词内容/ }).fill("只修改目标副本");
  await waitSaved(data => data.chatPresets.find(preset => preset.id === "target").prompts[1].content === "只修改目标副本");
  await choosePreset("来源预设");
  assert.equal(await editor.getByRole("textbox", { name: /^提示词内容/ }).inputValue(), prompt.content);
  await deleteButton.click();
  assert.equal(await favorites.getByRole("button", { name: prompt.name, exact: true }).isEnabled(), true);
  await page.locator(".preset-editor-heading").getByRole("button", { name: "删除", exact: true }).click();
  await waitSaved(data => data.chatPresets.length === 1 && data.favoriteChatPresetPrompts.length === 1);

  // A fresh browser restores the global collection from disk without localStorage.
  await page.context().close();
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  editor = page.locator(".preset-prompt-editor");
  favorites = page.locator(".preset-favorite-prompts");
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.url);
  await openPresets();
  await page.getByRole("button", { name: "新建预设", exact: true }).click();
  await favorites.getByRole("button", { name: prompt.name, exact: true }).click();
  assert.equal(await editor.getByRole("textbox", { name: /^提示词内容/ }).inputValue(), prompt.content);
  await waitSaved(data => data.chatPresets.some(preset => preset.id !== "target" && preset.prompts.length === 1));
  await editor.screenshot({ path: ".runtime/preset-favorites-desktop.png", animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await editor.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  assert.equal(await favorites.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await editor.screenshot({ path: ".runtime/preset-favorites-mobile.png", animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1100 });

  await page.locator(".settings-nav").getByRole("button", { name: "数据", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份", exact: true }).click();
  const download = await downloadEvent;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const archive = unzipSync(Buffer.concat(chunks));
  const manifest = JSON.parse(strFromU8(archive["backup.json"]));
  assert.deepEqual(manifest.appData.favoriteChatPresetPrompts[0].prompt, prompt);
  await page.locator(".settings-nav").getByRole("button", { name: "预设", exact: true }).click();
  await favorites.getByRole("button", { name: `取消收藏 ${prompt.name}`, exact: true }).click();
  const afterRemove = await waitSaved(data => data.favoriteChatPresetPrompts.length === 0);
  assert.equal(afterRemove.chatPresets.length, 2);
  assert.equal(afterRemove.chatPresets.every(preset => preset.prompts.some(item => item.name === prompt.name)), true);
  await page.reload();
  await openPresets();
  assert.equal(await favorites.locator(".preset-favorite-item").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Preset favorites browser checks passed: button placement, cross-preset copies, conflicts, editing isolation, source deletion, clean-browser persistence, new presets, mobile layout, ZIP backup and removal.");
} catch (error) {
  await page?.screenshot({ path: ".runtime/preset-favorites-failure.png" }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-preset-favorites-")));
  await rm(root, { recursive: true, force: true });
}
