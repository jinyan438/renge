import { inflateRaw, inflateRawSync } from "node:zlib";
import { promisify } from "node:util";
import { Unzip, unzipSync } from "fflate";

const inflate = promisify(inflateRaw);

export async function unzipCompleteBackup(data, maxBytes) {
  const index = new Map();
  let totalBytes = 0;
  // Inspect the central directory before allocating any decompressed buffers.
  unzipSync(data, { filter(entry) {
    if (index.has(entry.name)) throw new Error(`ZIP 备份包含重复文件：${entry.name}`);
    totalBytes += entry.originalSize;
    if (totalBytes > maxBytes) throw new Error("备份文件解压后超过 512MB，无法导入。");
    if (entry.compression !== 0 && entry.compression !== 8) {
      throw new Error("ZIP 备份使用了不支持的压缩方式。");
    }
    index.set(entry.name, entry);
    return false;
  } });

  const entries = Object.create(null);
  const jobs = [];
  const discovered = new Set();
  class NativeInflate {
    static compression = 8;
    chunks = [];
    constructor(name) { this.name = name; }
    push(chunk, final) {
      if (chunk.length) this.chunks.push(chunk);
      if (!final) return;
      const chunks = this.chunks;
      this.chunks = [];
      const compressed = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      const size = index.get(this.name).originalSize;
      const options = {
        maxOutputLength: Math.max(1, size),
        chunkSize: Math.max(64, Math.min(size, 256 * 1024)),
      };
      // Tiny files finish faster inline than as hundreds of thread-pool jobs.
      if (size <= 256 * 1024) {
        this.ondata(null, inflateRawSync(compressed, options), true);
        return;
      }
      jobs.push(async () => {
        const bytes = await inflate(compressed, options);
        this.ondata(null, bytes, true);
      });
    }
  }

  const archive = new Unzip(file => {
    const expected = index.get(file.name);
    if (!expected || discovered.has(file.name) || file.compression !== expected.compression ||
        (file.size !== undefined && file.size !== expected.size) ||
        (file.originalSize !== undefined && file.originalSize !== expected.originalSize)) {
      throw new Error("ZIP 备份的文件目录与内容不一致。");
    }
    discovered.add(file.name);
    // Unrelated entries still count toward the size limit, but need no inflation.
    if (file.name.endsWith("/") || !(file.name === "backup.json" ||
        file.name.startsWith("assets/") || file.name.startsWith("files/"))) return;
    const chunks = [];
    let bytesRead = 0;
    file.ondata = (error, bytes, final) => {
      if (error) throw error;
      bytesRead += bytes.length;
      if (bytesRead > expected.originalSize) throw new Error("ZIP 备份的文件大小不一致。");
      chunks.push(bytes);
      if (final) {
        if (bytesRead !== expected.originalSize) throw new Error("ZIP 备份的文件不完整。");
        entries[file.name] = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      }
    };
    file.start();
  });
  archive.register(NativeInflate);
  // Avoid recursive parsing of thousands of small entries in a single push.
  for (let offset = 0; offset < data.length; offset += 64 * 1024) {
    archive.push(data.subarray(offset, offset + 64 * 1024), offset + 64 * 1024 >= data.length);
  }
  if (discovered.size !== index.size) throw new Error("ZIP 备份的文件不完整。");
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (!failure && next < jobs.length) {
      const job = jobs[next++];
      try { await job(); } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
  return entries;
}
