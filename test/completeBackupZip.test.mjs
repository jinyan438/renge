import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import { createStreamingCompleteBackupZip } from "../src/completeBackupZip.ts";
import { COMPLETE_BACKUP_MAX_EXTRACTED_BYTES } from "../src/completeBackupLimits.mjs";
import { unzipCompleteBackup } from "../src/completeBackupArchive.mjs";

test("streaming export preserves text, stored binary signatures and empty files", async () => {
  const text = new TextEncoder().encode('中文😀"\\\n'.repeat(80_000));
  const binary = new Uint8Array([80, 75, 7, 8, 80, 75, 3, 4, 0, 255]);
  const blob = await createStreamingCompleteBackupZip([
    { path: "backup.json", compress: true, size: text.length, read: async () => new ReadableStream({ start(controller) {
      controller.enqueue(text.subarray(0, 1500)); controller.enqueue(text.subarray(1500)); controller.close();
    } }) },
    { path: "assets/avatar.png", compress: false, size: binary.length, read: async () => binary },
    { path: "files/skills/empty.txt", compress: true, size: 0, read: async () => new Uint8Array() },
  ]);
  const restored = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(restored["backup.json"], text);
  assert.deepEqual(restored["assets/avatar.png"], binary);
  assert.equal(restored["files/skills/empty.txt"].length, 0);
});

test("streaming export refuses changed files and propagates reader failures", async () => {
  for (const size of [1, 10]) {
    await assert.rejects(createStreamingCompleteBackupZip([
      { path: "files/skills/file.txt", compress: true, size, read: async () => new Uint8Array(5) },
    ]), /发生变化/);
  }
  await assert.rejects(createStreamingCompleteBackupZip([
    { path: "files/skills/file.txt", compress: true, read: async () => new ReadableStream({ pull(controller) {
      controller.error(new Error("fixture read failure"));
    } }) },
  ]), /fixture read failure/);
});

test("rejects oversized declared inputs without downloading them", async () => {
  let reads = 0;
  const read = async () => { reads++; return new Uint8Array(); };
  await assert.rejects(createStreamingCompleteBackupZip([
    { path: "files/skills/oversized.txt", compress: true, size: COMPLETE_BACKUP_MAX_EXTRACTED_BYTES + 1, read },
  ]), /限制|上限/);
  assert.equal(reads, 0);
});

test("strict native ZIP readers accept zero-prefixed databases across chunk boundaries", async () => {
  for (const size of [0, 1, 28_672, 32_768, 32_769, 65_536, 2_002_944]) {
    const bytes = new Uint8Array(size);
    if (size > 128) bytes.set(new TextEncoder().encode("fixture database"), 96);
    const archive = await createStreamingCompleteBackupZip([{
      path: "files/.pi/agent/fixture/data.mdb", compress: true, size,
      read: async () => new ReadableStream({ start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 7001) controller.enqueue(bytes.subarray(offset, offset + 7001));
        controller.close();
      } }),
    }]);
    const restored = await unzipCompleteBackup(new Uint8Array(await archive.arrayBuffer()), 8 * 1024 ** 3);
    assert.deepEqual(Buffer.from(restored["files/.pi/agent/fixture/data.mdb"]), Buffer.from(bytes), `size=${size}`);
  }
});
