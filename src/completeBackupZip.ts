import { Deflate, Zip, ZipPassThrough } from "fflate";
import {
  COMPLETE_BACKUP_MAX_ARCHIVE_BYTES,
  COMPLETE_BACKUP_MAX_EXTRACTED_BYTES,
  completeBackupSizeLimitError,
} from "./completeBackupLimits.mjs";

export type CompleteBackupZipEntry = {
  path: string;
  size?: number;
  compress: boolean;
  read: () => Promise<Uint8Array | ReadableStream<Uint8Array>>;
};

// fflate's streaming encoder can refer to its initial zero-filled window before
// any bytes have been emitted. Strict ZIP readers reject those distances. Emit
// a real 32 KiB stored prefix and seed the compressor with that exact history.
class CompatibleZipDeflate extends ZipPassThrough {
  compression = 8;
  private prefix = new Uint8Array(32 * 1024);
  private prefixLength = 0;
  private compressor?: Deflate;

  process(chunk: Uint8Array, final: boolean) {
    if (!this.compressor) {
      const count = Math.min(this.prefix.length - this.prefixLength, chunk.length);
      this.prefix.set(chunk.subarray(0, count), this.prefixLength);
      this.prefixLength += count;
      chunk = chunk.subarray(count);
      if (this.prefixLength < this.prefix.length && !final) return;
      const complete = final && chunk.length === 0;
      const block = new Uint8Array(5 + this.prefixLength);
      block[0] = complete ? 1 : 0;
      block[1] = this.prefixLength & 255;
      block[2] = this.prefixLength >>> 8;
      block[3] = ~this.prefixLength & 255;
      block[4] = ~this.prefixLength >>> 8 & 255;
      block.set(this.prefix.subarray(0, this.prefixLength), 5);
      this.ondata(null, block, complete);
      if (complete) return;
      this.compressor = new Deflate({ level: 6, dictionary: this.prefix }, (bytes, last) => {
        this.ondata(null, bytes, last);
      });
    }
    this.compressor.push(chunk, final);
  }
}

export async function createStreamingCompleteBackupZip(entries: CompleteBackupZipEntry[]) {
  // v3 exports use classic ZIP headers, which allow at most 65535 entries.
  if (entries.length > 65535) throw new Error("完整备份包含超过 65535 个文件。");
  const parts: Blob[] = [];
  let archiveBytes = 0;
  let extractedBytes = 0;
  let bytesSinceYield = 0;
  let failure: Error | undefined;
  let finished = false;
  const archive = new Zip((error, bytes, final) => {
    if (failure) return;
    if (error) { failure = error; return; }
    archiveBytes += bytes.length;
    if (archiveBytes > COMPLETE_BACKUP_MAX_ARCHIVE_BYTES) {
      failure = new Error(completeBackupSizeLimitError("压缩文件", COMPLETE_BACKUP_MAX_ARCHIVE_BYTES));
      return;
    }
    // Keep immutable Blob chunks instead of a second, archive-sized ArrayBuffer.
    parts.push(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    if (final) finished = true;
  });
  try {
    for (const entry of entries) {
      if (entry.size !== undefined && entry.size >= 2 ** 32) {
        throw new Error(`单个备份文件超过 ZIP 格式的 4 GB 限制：${entry.path}`);
      }
      if (entry.size !== undefined && extractedBytes + entry.size > COMPLETE_BACKUP_MAX_EXTRACTED_BYTES) {
        throw new Error(completeBackupSizeLimitError("解压总量", COMPLETE_BACKUP_MAX_EXTRACTED_BYTES));
      }
      const file = entry.compress ? new CompatibleZipDeflate(entry.path) : new ZipPassThrough(entry.path);
      archive.add(file);
      let fileBytes = 0;
      const push = async (chunk: Uint8Array) => {
        for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
          const bytes = chunk.subarray(offset, offset + 64 * 1024);
          fileBytes += bytes.length;
          extractedBytes += bytes.length;
          if (fileBytes >= 2 ** 32) throw new Error(`单个备份文件超过 ZIP 格式的 4 GB 限制：${entry.path}`);
          if (extractedBytes > COMPLETE_BACKUP_MAX_EXTRACTED_BYTES) {
            throw new Error(completeBackupSizeLimitError("解压总量", COMPLETE_BACKUP_MAX_EXTRACTED_BYTES));
          }
          if (entry.size !== undefined && fileBytes > entry.size) {
            throw new Error(`应用文件在备份过程中发生变化：${entry.path}`);
          }
          file.push(bytes, false);
          if (failure) throw failure;
          bytesSinceYield += bytes.length;
          if (bytesSinceYield >= 4 * 1024 * 1024) {
            bytesSinceYield = 0;
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
        }
      };
      const source = await entry.read();
      if (source instanceof Uint8Array) {
        await push(source);
      } else {
        const reader = source.getReader();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            await push(chunk.value);
          }
        } catch (error) {
          await reader.cancel().catch(() => undefined);
          throw error;
        } finally { reader.releaseLock(); }
      }
      if (entry.size !== undefined && fileBytes !== entry.size) {
        throw new Error(`应用文件在备份过程中发生变化：${entry.path}`);
      }
      file.push(new Uint8Array(), true);
      if (failure) throw failure;
    }
    archive.end();
    if (failure) throw failure;
    if (!finished) throw new Error("完整备份打包未完成。");
    return new Blob(parts, { type: "application/zip" });
  } catch (error) {
    archive.terminate();
    throw error;
  }
}
