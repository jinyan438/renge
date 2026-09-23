import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run against a production build. An optional import exercises the actual remote script.
const root = await mkdtemp(join(tmpdir(), "renge-tavern-browser-"));
const dataDir = join(root, "data");
const profile = join(root, "browser");
const launchOptions = { headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined };
let server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
let context;
const closeServer = () => new Promise(resolve => server.server.close(resolve));
try {
  const script = process.env.TAVERN_SCRIPT_FILE
    ? JSON.parse(await readFile(process.env.TAVERN_SCRIPT_FILE, "utf8"))
    : { id: "fixture-script", name: "Persistence fixture", enabled: true, content: "parent.__rengeRuntimeFixtureReady = true;" };
  const now = new Date().toISOString();
  const seed = {
    version: 1, tavernScripts: [script], chatMode: "roleplay", activeCharacterCardId: "fixture-card",
    chatSessions: [{
      id: "fixture-chat", title: "Persistence fixture", mode: "roleplay", roleplayCharacterCardId: "fixture-card",
      messages: [{ id: "greeting", role: "assistant", content: "The story begins.", createdAt: now }],
      createdAt: now, updatedAt: now,
    }, {
      id: "other-fixture-chat", title: "Other conversation", mode: "roleplay", roleplayCharacterCardId: "fixture-card",
      messages: [{ id: "other-greeting", role: "assistant", content: "A separate story begins.", createdAt: now }],
      createdAt: now, updatedAt: now,
    }],
    characterCards: [{
      id: "fixture-card", name: "Fixture", firstMessage: "The story begins.",
      characterBook: { id: "fixture-book", name: "Fixture World", entries: [
        { uid: "1", comment: "untouched", content: "Keep this entry" },
        { uid: "2", comment: "database", content: "Database content" },
      ] }, createdAt: now, updatedAt: now,
    }],
  };
  assert.equal((await fetch(`${server.url}/api/app-data`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }),
  })).ok, true);
  context = await chromium.launchPersistentContext(profile, launchOptions);
  let page = await context.newPage();
  const waitForRuntime = async (page) => {
    await page.goto(server.url);
    await page.waitForFunction(() => window.__rengeRuntimeFixtureReady || window.__ACU_STAR_DB_III_LOADED__, null, { timeout: 90000 });
  };
  await waitForRuntime(page);
  const xinghe = await page.evaluate(() => Boolean(window.__ACU_STAR_DB_III_LOADED__));
  if (xinghe) {
    await page.getByText("SP·数据库 IX", { exact: true }).click();
    await page.getByRole("switch").first().click();
    await page.getByRole("button", { name: "新建预设", exact: true }).click();
    await page.locator('input[type="text"]').last().fill("Persistent fixture API");
    await page.getByRole("button", { name: "保存并选中预设", exact: true }).click();
  }
  await page.evaluate(async () => {
    const ctx = window.SillyTavern.getContext();
    const imported = await import("/scripts/extensions.js");
    if (imported.extension_settings !== ctx.extensionSettings) throw new Error("Settings exports disagree");
    ctx.extensionSettings.persistenceFixture = { sequence: 1 };
    await ctx.saveSettingsDebounced();
    imported.extension_settings.persistenceFixture.sequence = 2;
    await imported.saveSettingsDebounced();
    ctx.chatMetadata.persistenceFixture = { scope: "chat" };
    ctx.chat[0].persistenceFixture = { rows: [["saved", "yes"]] };
    await ctx.saveChat();
    const th = window.TavernHelper;
    const before = await th.getLorebookEntries("Fixture World");
    await th.setLorebookEntries("Fixture World", [{ uid: "2", comment: "updated", position: "at_depth_as_system", depth: 2, type: "constant" }]);
    const after = await th.getLorebookEntries("Fixture World");
    if (after.length !== before.length || after[0].content !== before[0].content || after[1].content !== before[1].content || after[1].comment !== "updated" || after[1].position !== "at_depth_as_system" || after[1].type !== "constant") throw new Error("Partial update lost lorebook data");
    await th.setLorebookEntries("Fixture World", [{ ...after[1], comment: "renamed again", type: "selective" }]);
    if ((await th.getLorebookEntries("Fixture World"))[1].type !== "selective") throw new Error("Entry type failed to switch");
    if ((await th.getLorebookEntries("Fixture World"))[1].comment !== "renamed again") throw new Error("Legacy comment was shadowed by name alias");
    const uids = await th.createLorebookEntries("Fixture World", [{ comment: "temporary", content: "remove" }]);
    if (uids.length !== 1 || typeof uids[0] !== "string") throw new Error("Wrong createLorebookEntries result");
    await th.deleteLorebookEntries("Fixture World", uids);
    if ((await th.getLorebookEntries("Fixture World")).length !== 2) throw new Error("Entry deletion failed");
    await th.replaceVariables({ value: "script data" }, { type: "script" });
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("renge-tavern-persistence-fixture", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("cache");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("cache", "readwrite");
        transaction.objectStore("cache").put({ vector: [0.25, 0.75] }, "index");
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  const persisted = JSON.parse(await readFile(join(dataDir, "app-data.json"), "utf8"));
  assert.equal(persisted.tavernExtensionSettings.persistenceFixture.sequence, 2);
  assert.equal(persisted.chatSessions[0].tavernMetadata.persistenceFixture.scope, "chat");
  assert.equal(persisted.chatSessions[0].messages[0].extra.persistenceFixture.rows[0][1], "yes");
  assert.equal(persisted.chatSessions[0].characterWorldBookOverrides["fixture-card"].entries[1].comment, "renamed again");
  assert.equal("characterWorldBookOverrides" in persisted.chatSessions[1], false, "lorebook edits must stay in the current conversation");
  assert.deepEqual(
    persisted.characterCards[0].characterBook.entries.map(entry => [entry.comment, entry.content]),
    [["untouched", "Keep this entry"], ["database", "Database content"]],
    "lorebook edits must leave the character card unchanged",
  );
  assert.equal(persisted.tavernScripts[0].data.value, "script data");
  await context.close();
  context = null;
  const port = server.port;
  await closeServer();
  server = await startRengeServer({ host: "127.0.0.1", port, dataDir });
  context = await chromium.launchPersistentContext(profile, launchOptions);
  page = await context.newPage();
  await waitForRuntime(page);
  assert.equal(await page.evaluate(async () => {
    const entries = await window.TavernHelper.getLorebookEntries("Fixture World");
    return entries[1]?.comment;
  }), "renamed again", "the current conversation must restore its own lorebook override");
  assert.deepEqual(await page.evaluate(async () => {
    const ctx = window.SillyTavern.getContext();
    const cache = await new Promise((resolve, reject) => {
      const request = indexedDB.open("renge-tavern-persistence-fixture", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("cache").objectStore("cache").get("index");
        read.onsuccess = () => { db.close(); resolve(read.result); };
        read.onerror = () => reject(read.error);
      };
    });
    return [ctx.extensionSettings.persistenceFixture.sequence, ctx.chatMetadata.persistenceFixture.scope, ctx.chat[0].persistenceFixture.rows[0][1], cache.vector];
  }), [2, "chat", "yes", [0.25, 0.75]]);
  if (xinghe) {
    await page.getByText("SP·数据库 IX", { exact: true }).click();
    await page.getByText("Persistent fixture API", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("switch").first().getAttribute("aria-checked"), "true");
    if (process.env.TAVERN_SCREENSHOT_DIR) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: join(process.env.TAVERN_SCREENSHOT_DIR, "xinghe-desktop.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(process.env.TAVERN_SCREENSHOT_DIR, "xinghe-mobile.png"), fullPage: true });
    }
  }
  // A clean browser must recover authoritative data even without its old localStorage.
  await context.close();
  context = await chromium.launchPersistentContext(join(root, "fresh-browser"), launchOptions);
  page = await context.newPage();
  await waitForRuntime(page);
  assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.persistenceFixture.sequence), 2);
  await page.route("**/api/app-data", route => route.request().method() === "PATCH" ? route.fulfill({ status: 500, body: "{}" }) : route.continue());
  assert.equal(await page.evaluate(async () => {
    const ctx = window.SillyTavern.getContext();
    ctx.chatMetadata.persistenceFixture.failedWrite = true;
    try { await ctx.saveChat(); return false; } catch { return true; }
  }), true, "saveChat must reject a failed disk write");
  console.log("PASS: settings, script data, chat tables/metadata, lorebook patches, IndexedDB, process restart, clean browser recovery and failed-save reporting");
} finally {
  await context?.close();
  await closeServer();
  await rm(root, { recursive: true, force: true });
}
