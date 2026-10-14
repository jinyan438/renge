import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { strFromU8, unzipSync } from "fflate";
import { startRengeServer } from "../server.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-backup-browser-"));
const dataDir = join(root, "data");
const files = {
  ".pi/sessions/fixture.jsonl": Buffer.from('{"fixture":true}\n'),
  "skills/fixture/SKILL.md": Buffer.from("fixture skill"),
  "tavern-script-assets/yuyuan/yuyuan.readable.js": Buffer.from("window.fixture = true;\n"),
  "tavern-script-assets/yuyuan/yuyuan-assets/010_fixture.webp": Buffer.from("RIFFfixtureWEBP"),
};
let controller, browser;
try {
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(join(dataDir, path, ".."), { recursive: true });
    await writeFile(join(dataDir, path), bytes);
  }
  controller = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(20_000);
  await page.goto(controller.url);
  await page.getByRole("button", { name: "打开系统设置", exact: true }).click();
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("button", { name: "数据", exact: true }).click();
  const exported = Promise.race([
    page.waitForEvent("download"),
    page.locator(".data-backup-status.error").waitFor().then(async () => {
      throw new Error(await page.locator(".data-backup-status.error").textContent());
    }),
  ]);
  await page.getByRole("button", { name: "导出完整备份", exact: true }).click();
  const download = await exported;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const archive = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(archive["backup.json"]));
  assert.equal(manifest.version, 3);
  assert.deepEqual(manifest.managedFiles.map(file => file.path).sort(), Object.keys(files).sort());
  for (const [path, expected] of Object.entries(files)) {
    assert.deepEqual(Buffer.from(archive[`files/${path}`]), expected);
  }
  // Restore the actual UI export, then verify every managed file survives.
  await browser.close();
  browser = null;
  const restored = await fetch(`${controller.url}/api/app-data/import-complete`, { method: "PUT", body: bytes });
  assert.equal(restored.status, 200, await restored.text());
  for (const [path, expected] of Object.entries(files)) {
    assert.deepEqual(await readFile(join(dataDir, path)), expected);
  }
  console.log("Complete backup browser export and restore passed, including Tavern script resources.");
} finally {
  await browser?.close();
  if (controller) await new Promise(resolve => controller.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
