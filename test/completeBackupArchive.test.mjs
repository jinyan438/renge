import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync, Zip, ZipDeflate } from "fflate";
import { unzipCompleteBackup } from "../src/completeBackupArchive.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStreamingCompleteBackupZip } from "../src/completeBackupZip.ts";

const limit = 512 * 1024 * 1024;

test("native backup inflation preserves large Unicode JSON, stored assets and thousands of files", async () => {
  const manifest = strToU8(JSON.stringify({ text: '中文😀"\\\n'.repeat(180_000) }));
  const files = {
    "backup.json": manifest,
    "assets/image.png": [new Uint8Array([0, 255, 1, 128]), { level: 0 }],
    "files/skills/empty.txt": new Uint8Array(),
    "unrelated.txt": strToU8("ignored"),
  };
  for (let i = 0; i < 4000; i++) files[`files/skills/item-${i}.txt`] = strToU8(`file ${i}`);
  const restored = await unzipCompleteBackup(zipSync(files, { level: 6 }), limit);
  assert.deepEqual(Buffer.from(restored["backup.json"]), Buffer.from(manifest));
  assert.deepEqual([...restored["assets/image.png"]], [0, 255, 1, 128]);
  assert.equal(restored["files/skills/empty.txt"].length, 0);
  assert.equal(Buffer.from(restored["files/skills/item-3999.txt"]).toString(), "file 3999");
  assert.equal(Object.keys(restored).length, 4003);
});

test("streamed ZIP data descriptors are supported", async () => {
  const chunks = [];
  const archive = new Zip((error, bytes) => { if (error) throw error; chunks.push(bytes); });
  const file = new ZipDeflate("backup.json", { level: 6 });
  archive.add(file);
  file.push(strToU8('{"text":"'), false);
  file.push(strToU8('你好'.repeat(100_000) + '"}'), true);
  archive.end();
  const restored = await unzipCompleteBackup(Buffer.concat(chunks), limit);
  assert.equal(JSON.parse(Buffer.from(restored["backup.json"]).toString()).text, '你好'.repeat(100_000));
});

test("rejects oversize ZIPs before inflating, including skipped entries", async () => {
  const archive = zipSync({ "backup.json": strToU8("{}"), "unrelated.txt": new Uint8Array(2048) });
  await assert.rejects(unzipCompleteBackup(archive, 1024), /解压总量超过/);
});

test("rejects conflicting local sizes and invalid compressed data", async () => {
  const archive = Buffer.from(zipSync({ "backup.json": strToU8('x'.repeat(100_000)) }));
  const wrongSize = Buffer.from(archive);
  wrongSize.writeUInt32LE(10, 22);
  await assert.rejects(unzipCompleteBackup(wrongSize, limit), /目录与内容不一致/);
  const corrupt = Buffer.from(archive);
  const payloadStart = 30 + corrupt.readUInt16LE(26) + corrupt.readUInt16LE(28);
  corrupt.fill(255, payloadStart, payloadStart + corrupt.readUInt32LE(18));
  await assert.rejects(unzipCompleteBackup(corrupt, limit));
});

test("rejects duplicate entries and truncated archives", async () => {
  const chunks = [];
  const archive = new Zip((error, bytes) => { if (error) throw error; chunks.push(bytes); });
  for (let i = 0; i < 2; i++) {
    const file = new ZipDeflate("backup.json");
    archive.add(file);
    file.push(strToU8("{}"), true);
  }
  archive.end();
  await assert.rejects(unzipCompleteBackup(Buffer.concat(chunks), limit), /重复文件/);
  const valid = zipSync({ "backup.json": strToU8("{}") });
  await assert.rejects(unzipCompleteBackup(valid.subarray(0, valid.length - 15), limit));
});

test("staged extraction preserves streamed stored signatures and validates CRC", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "renge-zip-stage-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = new Uint8Array([80, 75, 7, 8, 80, 75, 3, 4, 0, 255]);
  const archive = new Uint8Array(await (await createStreamingCompleteBackupZip([
    { path: "backup.json", compress: true, read: async () => strToU8("{}") },
    { path: "assets/avatar.png", compress: false, read: async () => binary },
  ])).arrayBuffer());
  const restored = await unzipCompleteBackup(archive, limit, directory);
  assert.deepEqual(await readFile(restored["assets/avatar.png"]), Buffer.from(binary));
  const corrupt = Buffer.from(zipSync({ "assets/avatar.png": [binary, { level: 0 }] }));
  const start = 30 + corrupt.readUInt16LE(26) + corrupt.readUInt16LE(28);
  corrupt[start] ^= 1;
  await assert.rejects(unzipCompleteBackup(corrupt, limit), /校验失败/);
});
