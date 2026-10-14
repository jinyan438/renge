import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { strToU8, zipSync } from "fflate";
import { startRengeServer } from "../server.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-backup-import-ui-"));
let controller, browser;
try {
  controller = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  browser = await chromium.launch({ headless: true });
  async function openData(page) {
    await page.goto(controller.url);
    await page.getByRole("button", { name: "打开系统设置", exact: true }).click();
    await page.getByRole("button", { name: "打开设置", exact: true }).click();
    await page.getByRole("button", { name: "数据", exact: true }).click();
  }
  const backup = zipSync({ "backup.json": strToU8(JSON.stringify({
    format: "renge-agent-complete-backup", version: 3, exportedAt: "2026-10-14T00:00:00Z",
    appData: { version: 1, personas: [], providers: [], characterCards: [{ id: "restored-card", name: "恢复角色" }],
      chatSessions: [{ id: "restored-session", title: "恢复会话", mode: "ai", messages: [] }] },
    localStorage: {}, assets: {}, managedFiles: [],
  })) });
  for (const failure of [
    { status: 400, body: JSON.stringify({ error: "fixture corrupt archive", cleared: true }) },
    { status: 200, body: "invalid success response" },
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on("dialog", dialog => dialog.accept());
    await page.route("**/api/app-data/import-complete", route => route.fulfill({
      status: failure.status, contentType: "application/json", body: failure.body,
    }));
    await openData(page);
    await page.evaluate(() => localStorage.setItem("renge_backup_failure_cache", "preserved"));
    let reloads = 0;
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) reloads++; });
    await page.locator(".data-backup-page input[type=file]").setInputFiles({ name: "fixture.zip", mimeType: "application/zip", buffer: Buffer.from(backup) });
    await page.locator(".data-backup-status.error").waitFor();
    await page.waitForTimeout(1000);
    assert.equal(reloads, 0, "failed imports must keep the error visible without reloading");
    assert.match(await page.locator(".data-backup-status.error").textContent(), /已暂停保存/);
    assert.equal(await page.evaluate(() => localStorage.getItem("renge_backup_failure_cache")), "preserved");
    assert.equal(await page.getByRole("button", { name: "导出完整备份", exact: true }).isDisabled(), true);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("dialog", dialog => dialog.accept());
  await openData(page);
  const reloaded = page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() });
  await page.locator(".data-backup-page input[type=file]").setInputFiles({ name: "fixture.zip", mimeType: "application/zip", buffer: Buffer.from(backup) });
  await reloaded;
  await page.getByRole("button", { name: "打开系统设置", exact: true }).waitFor();
  const restored = (await (await fetch(`${controller.url}/api/app-data`)).json()).data;
  assert.equal(restored.characterCards[0].id, "restored-card");
  assert.equal(restored.chatSessions[0].id, "restored-session");
  await context.close();
  // A failed native data read must not turn an empty fallback into a new backup.
  const nativeContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await nativeContext.addInitScript(() => {
    window.rengeAndroid = { isAndroid: true, getRootAccessStatus: async () => ({ granted: false }) };
  });
  const nativePage = await nativeContext.newPage();
  await nativePage.route("**/api/app-data", route => route.request().method() === "GET"
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "fixture native read failure" }) })
    : route.continue());
  await openData(nativePage);
  assert.match(await nativePage.locator(".data-backup-status.error").textContent(), /主数据读取失败.*暂停自动保存/);
  assert.equal(await nativePage.getByRole("button", { name: "导出完整备份", exact: true }).isDisabled(), true);
  nativePage.on("dialog", dialog => dialog.accept());
  await nativePage.route("**/api/app-data/import-complete", route => route.fulfill({
    status: 400, contentType: "application/json", body: JSON.stringify({ error: "fixture invalid ZIP", cleared: false }),
  }));
  await nativePage.locator(".data-backup-page input[type=file]").setInputFiles({ name: "fixture.zip", mimeType: "application/zip", buffer: Buffer.from(backup) });
  await nativePage.locator(".data-backup-status.error").filter({ hasText: "fixture invalid ZIP" }).waitFor();
  assert.equal(await nativePage.getByRole("button", { name: "导出完整备份", exact: true }).isDisabled(), true,
    "a rejected retry must retain the previous persistence suspension");
  await nativeContext.close();
  console.log("Backup import UI: failed/invalid responses preserve cache and errors; successful reload preserves cards/sessions; native read failures pause saving.");
} finally {
  await browser?.close();
  if (controller) await new Promise(resolve => controller.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
