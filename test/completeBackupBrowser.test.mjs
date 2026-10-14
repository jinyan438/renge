import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { strFromU8, unzipSync } from "fflate";
import { startRengeServer } from "../server.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-backup-browser-"));
const dataDir = join(root, "data");
const large = process.argv.includes("--large");
const largePath = "tavern-script-assets/yuyuan/large-fixture.txt";
const largeSize = 520 * 1024 * 1024;
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAE/wJ/l4eKXwAAAABJRU5ErkJggg==", "base64");
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
  if (large) {
    const file = await open(join(dataDir, largePath), "w");
    try {
      await file.truncate(largeSize);
      await file.write(Buffer.from("BEGIN"), 0, 5, 0);
      await file.write(Buffer.from("END"), 0, 3, largeSize - 3);
    } finally { await file.close(); }
  }
  await writeFile(join(dataDir, "app-data.json"), JSON.stringify({
    version: 1,
    characterCards: [{ id: "backup-card", name: "备份图片测试", avatarDataUrl: `data:image/png;base64,${image.toString("base64")}` }],
  }));
  controller = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(large ? 120_000 : 20_000);
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
  // The large regression must never materialize the 520 MiB file in memory.
  const archive = unzipSync(bytes, { filter: entry => entry.name !== `files/${largePath}` });
  const manifest = JSON.parse(strFromU8(archive["backup.json"]));
  assert.equal(manifest.version, 3);
  assert.ok(Object.keys(manifest.assets).some(path => Buffer.from(archive[path]).equals(image)), "embedded card images survive Blob streaming");
  assert.deepEqual(manifest.managedFiles.map(file => file.path).sort(), [...Object.keys(files), ...(large ? [largePath] : [])].sort());
  if (large) assert.equal(manifest.managedFiles.find(file => file.path === largePath).size, largeSize);
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
  if (large) {
    assert.equal((await stat(join(dataDir, largePath))).size, largeSize);
    const file = await open(join(dataDir, largePath), "r");
    try {
      const start = Buffer.alloc(5), end = Buffer.alloc(3), middle = Buffer.alloc(32);
      await file.read(start, 0, 5, 0);
      await file.read(end, 0, 3, largeSize - 3);
      await file.read(middle, 0, 32, Math.floor(largeSize / 2));
      assert.equal(start.toString(), "BEGIN");
      assert.equal(end.toString(), "END");
      assert.deepEqual(middle, Buffer.alloc(32));
    } finally { await file.close(); }
  }
  console.log(`Complete backup browser export and restore passed${large ? " with a 520 MiB file" : ""}, including Tavern script resources.`);
} finally {
  await browser?.close();
  if (controller) await new Promise(resolve => controller.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
