import { createInflateRaw, crc32, inflateRaw, inflateRawSync } from "node:zlib";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { strFromU8, unzipSync } from "fflate";
import { completeBackupSizeLimitError } from "./completeBackupLimits.mjs";

const inflate = promisify(inflateRaw);

function readZipUint64(data, offset) {
  const value = data.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("ZIP 备份的文件位置无效。");
  return Number(value);
}

function locateEntries(data, index) {
  let footer = data.length - 22;
  for (; footer >= Math.max(0, data.length - 65557); footer--) {
    if (data.readUInt32LE(footer) === 0x06054b50 &&
        footer + 22 + data.readUInt16LE(footer + 20) === data.length) break;
  }
  if (footer < Math.max(0, data.length - 65557)) throw new Error("ZIP 备份的文件目录无效。");
  let cursor = data.readUInt32LE(footer + 16);
  if (cursor === 0xffffffff) {
    const locator = footer - 20;
    if (locator < 0 || data.readUInt32LE(locator) !== 0x07064b50) throw new Error("ZIP64 备份的文件目录无效。");
    const record = readZipUint64(data, locator + 8);
    if (data.readUInt32LE(record) !== 0x06064b50) throw new Error("ZIP64 备份的文件目录无效。");
    cursor = readZipUint64(data, record + 48);
  }
  const centralStart = cursor;
  const records = [];
  for (const expected of index.values()) {
    if (data.readUInt32LE(cursor) !== 0x02014b50) throw new Error("ZIP 备份的文件目录无效。");
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    let offset = data.readUInt32LE(cursor + 42);
    if (offset === 0xffffffff) {
      const extraEnd = cursor + 46 + nameLength + extraLength;
      for (let extra = cursor + 46 + nameLength; extra + 4 <= extraEnd;) {
        const size = data.readUInt16LE(extra + 2);
        if (data.readUInt16LE(extra) === 1) {
          let field = extra + 4;
          if (data.readUInt32LE(cursor + 24) === 0xffffffff) field += 8;
          if (data.readUInt32LE(cursor + 20) === 0xffffffff) field += 8;
          if (field + 8 > extra + 4 + size) throw new Error("ZIP64 备份的文件位置无效。");
          offset = readZipUint64(data, field);
          break;
        }
        extra += 4 + size;
      }
    }
    if (offset + 30 > centralStart || data.readUInt32LE(offset) !== 0x04034b50) {
      throw new Error("ZIP 备份的文件目录与内容不一致。");
    }
    const flags = data.readUInt16LE(offset + 6);
    if (flags & 1) throw new Error("不支持加密的 ZIP 完整备份。");
    const localNameLength = data.readUInt16LE(offset + 26);
    const start = offset + 30 + localNameLength + data.readUInt16LE(offset + 28);
    const name = strFromU8(data.subarray(offset + 30, offset + 30 + localNameLength), !(flags & 2048));
    const checksum = data.readUInt32LE(cursor + 16);
    if (name !== expected.name || data.readUInt16LE(offset + 8) !== expected.compression ||
        start + expected.size > centralStart ||
        (!(flags & 8) && (
          (data.readUInt32LE(offset + 18) !== 0xffffffff && data.readUInt32LE(offset + 18) !== expected.size) ||
          (data.readUInt32LE(offset + 22) !== 0xffffffff && data.readUInt32LE(offset + 22) !== expected.originalSize) ||
          data.readUInt32LE(offset + 14) !== checksum))) {
      throw new Error("ZIP 备份的文件目录与内容不一致。");
    }
    records.push({ ...expected, checksum, bytes: data.subarray(start, start + expected.size) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return records;
}

export async function unzipCompleteBackup(data, maxBytes, stagingDirectory) {
  const index = new Map();
  let totalBytes = 0;
  // Use the ZIP directory to bound output before decompressing any entry.
  unzipSync(data, { filter(entry) {
    if (index.has(entry.name)) throw new Error(`ZIP 备份包含重复文件：${entry.name}`);
    totalBytes += entry.originalSize;
    if (totalBytes > maxBytes) throw new Error(completeBackupSizeLimitError("解压总量", maxBytes));
    if (entry.compression !== 0 && entry.compression !== 8) throw new Error("ZIP 备份使用了不支持的压缩方式。");
    index.set(entry.name, entry);
    return false;
  } });
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const records = locateEntries(buffer, index).filter(entry => !entry.name.endsWith("/") &&
    (entry.name === "backup.json" || entry.name.startsWith("assets/") || entry.name.startsWith("files/")));
  const entries = Object.create(null);
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(4, records.length) }, async () => {
    while (!failure && next < records.length) {
      const id = next++;
      const entry = records[id];
      try {
        if (stagingDirectory) {
          const target = join(stagingDirectory, `entry-${id}.data`);
          let bytesRead = 0;
          let checksum = 0;
          const verify = new Transform({ transform(chunk, _encoding, callback) {
            bytesRead += chunk.length;
            checksum = crc32(chunk, checksum);
            callback(bytesRead > entry.originalSize ? new Error("ZIP 备份的文件大小不一致。") : null, chunk);
          } });
          const streams = [Readable.from((function* () {
            for (let offset = 0; offset < entry.bytes.length; offset += 64 * 1024) {
              yield entry.bytes.subarray(offset, offset + 64 * 1024);
            }
          })())];
          if (entry.compression === 8) streams.push(createInflateRaw({ chunkSize: 64 * 1024 }));
          streams.push(verify, createWriteStream(target, { flags: "wx" }));
          await pipeline(streams);
          if (bytesRead !== entry.originalSize || checksum !== entry.checksum) throw new Error("ZIP 备份的文件不完整或校验失败。");
          entries[entry.name] = target;
        } else {
          const options = { maxOutputLength: Math.max(1, entry.originalSize), chunkSize: Math.max(64, Math.min(entry.originalSize, 256 * 1024)) };
          const bytes = entry.compression === 0 ? entry.bytes : entry.originalSize <= 256 * 1024
            ? inflateRawSync(entry.bytes, options) : await inflate(entry.bytes, options);
          if (bytes.length !== entry.originalSize || crc32(bytes) !== entry.checksum) throw new Error("ZIP 备份的文件不完整或校验失败。");
          entries[entry.name] = bytes;
        }
      } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
  return entries;
}
