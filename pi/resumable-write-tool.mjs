import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Type } from "typebox";

export const RESUMABLE_WRITE_MAX_CHARS = 8_000;
const writeQueues = new Map();

async function withWriteQueue(path, operation) {
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  writeQueues.set(path, current);
  try {
    return await current;
  } finally {
    if (writeQueues.get(path) === current) writeQueues.delete(path);
  }
}

function resolveWorkspaceWritePath(cwd, requestedPath) {
  const workspaceRoot = resolve(cwd);
  const rawPath = String(requestedPath ?? "").trim();
  if (!rawPath) throw new Error("write.path 不能为空");
  const absolutePath = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(workspaceRoot, rawPath);
  const workspaceRelative = relative(workspaceRoot, absolutePath);
  if (
    workspaceRelative === ".." ||
    workspaceRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(workspaceRelative)
  ) {
    throw new Error(`write 只能写入当前工作区：${workspaceRoot}`);
  }
  return { absolutePath, workspaceRelative: workspaceRelative || rawPath };
}

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function fileEquals(path, expected) {
  try {
    return (await readFile(path)).equals(expected);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function fileEndsWith(path, expected) {
  const handle = await open(path, "r");
  try {
    const currentSize = (await handle.stat()).size;
    if (currentSize < expected.length) return false;
    const actual = Buffer.alloc(expected.length);
    const { bytesRead } = await handle.read(
      actual,
      0,
      actual.length,
      currentSize - actual.length,
    );
    return bytesRead === expected.length && actual.equals(expected);
  } finally {
    await handle.close();
  }
}

function writeResult(path, operation, bytesWritten, totalBytes, alreadyApplied = false) {
  const status = alreadyApplied ? "already_applied" : "written";
  return {
    content: [{
      type: "text",
      text: [
        `${status}: ${operation} ${bytesWritten} UTF-8 bytes to ${path}.`,
        `next expected_bytes: ${totalBytes}.`,
        "For more content, call write again with operation=append and copy that exact expected_bytes value.",
      ].join(" "),
    }],
    details: {
      status,
      operation,
      path,
      bytesWritten,
      totalBytes,
      nextExpectedBytes: totalBytes,
    },
  };
}

/**
 * A bounded, offset-checked replacement for Pi's whole-file write tool.
 * Small files still fit in one overwrite call. Large files are written as one
 * overwrite chunk followed by append chunks. Append calls are idempotent so a
 * response loss cannot duplicate a chunk on disk.
 */
export function createResumableWriteTool(cwd) {
  const initializedPaths = new Set();
  return {
    name: "write",
    label: "write",
    description: [
      "Write one bounded chunk to a file inside the current workspace.",
      `content MUST be at most ${RESUMABLE_WRITE_MAX_CHARS} characters.`,
      "For a new or replaced file, first call operation=overwrite with expected_bytes=0.",
      "For remaining content, call operation=append and copy next expected_bytes from the previous tool result.",
      "Never regenerate or overwrite earlier chunks after the first successful call; append the next chunk instead.",
    ].join(" "),
    promptSnippet: "Write files in bounded, resumable, offset-checked chunks",
    promptGuidelines: [
      `Never send more than ${RESUMABLE_WRITE_MAX_CHARS} characters in one write call.`,
      "For large files, call write once with operation=overwrite and expected_bytes=0, then repeatedly with operation=append and the exact next expected_bytes returned by the tool.",
      "A streamed tool-call preview is not proof of a write. Before claiming completion, wait for the write tool result and use read or ls to verify the file in the current workspace.",
    ],
    parameters: Type.Object({
      path: Type.String({
        description: "Workspace-relative or in-workspace absolute path. Emit this field before content.",
        minLength: 1,
      }),
      operation: Type.Union([
        Type.Literal("overwrite"),
        Type.Literal("append"),
      ], {
        description: "overwrite only for the first chunk; append for every later chunk.",
      }),
      expected_bytes: Type.Integer({
        description: "0 for overwrite; for append copy next expected_bytes from the previous write result.",
        minimum: 0,
      }),
      content: Type.String({
        description: `The next file chunk only, at most ${RESUMABLE_WRITE_MAX_CHARS} characters.`,
        minLength: 1,
        maxLength: RESUMABLE_WRITE_MAX_CHARS,
      }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, args, signal) {
      if (signal?.aborted) throw new Error("Operation aborted");
      const path = String(args?.path ?? "").trim();
      const operation = args?.operation;
      const expectedBytes = Number(args?.expected_bytes);
      const content = typeof args?.content === "string" ? args.content : "";
      if (operation !== "overwrite" && operation !== "append") {
        throw new Error("write.operation 必须是 overwrite 或 append");
      }
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
        throw new Error("write.expected_bytes 必须是非负整数");
      }
      if (!content) throw new Error("write.content 不能为空");
      if (content.length > RESUMABLE_WRITE_MAX_CHARS) {
        throw new Error(
          `write.content 有 ${content.length} 个字符，单次最多 ${RESUMABLE_WRITE_MAX_CHARS}；请拆成多个顺序块。`,
        );
      }

      const { absolutePath, workspaceRelative } = resolveWorkspaceWritePath(cwd, path);
      const contentBuffer = Buffer.from(content, "utf8");
      return withWriteQueue(absolutePath, async () => {
        const existingSize = await fileSize(absolutePath);

        if (operation === "overwrite") {
          if (expectedBytes !== 0) {
            throw new Error("overwrite 的 expected_bytes 必须为 0");
          }
          if (existingSize !== null && await fileEquals(absolutePath, contentBuffer)) {
            initializedPaths.add(absolutePath);
            return writeResult(
              workspaceRelative,
              operation,
              contentBuffer.length,
              contentBuffer.length,
              true,
            );
          }
          if (initializedPaths.has(absolutePath)) {
            throw new Error(
              "本轮已经初始化过该文件。不要重新 overwrite；请使用 append 和上次返回的 next expected_bytes 继续。",
            );
          }
          await mkdir(dirname(absolutePath), { recursive: true });
          if (signal?.aborted) throw new Error("Operation aborted");
          await writeFile(absolutePath, contentBuffer);
          if (signal?.aborted) throw new Error("Operation aborted");
          initializedPaths.add(absolutePath);
          return writeResult(
            workspaceRelative,
            operation,
            contentBuffer.length,
            contentBuffer.length,
          );
        }

        if (existingSize === null) {
          throw new Error("append 目标不存在；请先使用 operation=overwrite、expected_bytes=0 写入第一块。");
        }
        if (existingSize === expectedBytes + contentBuffer.length) {
          if (await fileEndsWith(absolutePath, contentBuffer)) {
            initializedPaths.add(absolutePath);
            return writeResult(
              workspaceRelative,
              operation,
              contentBuffer.length,
              existingSize,
              true,
            );
          }
        }
        if (existingSize !== expectedBytes) {
          throw new Error(
            `append 偏移不匹配：expected_bytes=${expectedBytes}，实际文件为 ${existingSize} 字节。请先 read 检查，不要盲目重复写入。`,
          );
        }
        if (signal?.aborted) throw new Error("Operation aborted");
        const handle = await open(absolutePath, "a");
        try {
          await handle.writeFile(contentBuffer);
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (signal?.aborted) throw new Error("Operation aborted");
        initializedPaths.add(absolutePath);
        return writeResult(
          workspaceRelative,
          operation,
          contentBuffer.length,
          expectedBytes + contentBuffer.length,
        );
      });
    },
  };
}
