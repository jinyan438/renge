import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadToolDefinition, createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { createResumableWriteTool } from "./resumable-write-tool.mjs";

// Execute the actual coding tools against one staged snapshot, never the live
// workspace. The caller commits the successful phase with conflict detection.
export async function executeMemoryCodingTool({ name, args, content, initialized }, signal) {
  if (!["read", "edit", "write"].includes(name)) throw new Error("不支持的文件工具。");
  const path = args?.path;
  if (typeof path !== "string" || path.length > 240 || !path.toLowerCase().endsWith(".md")
    || path.split(/[\\/]/).some(part => !part || part === "." || part === ".." || /[\x00-\x1f<>:\"|?*]/.test(part)
      || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error("请使用记忆目录内的 Markdown 相对路径。");
  }
  if (content !== null && typeof content !== "string") throw new Error("文件快照无效。");
  signal?.throwIfAborted();
  const root = await mkdtemp(join(tmpdir(), "renge-memory-tool-"));
  // Pi expands @ and ~ and normalizes Unicode spaces in paths. Never pass the
  // logical memory path to its resolver; only this fixed, private filename.
  const stagedName = "snapshot.md";
  const target = join(root, stagedName);
  try {
    if (content !== null) await writeFile(target, content, "utf8");
    if (name === "write" && initialized && args.operation === "overwrite" && content !== args.content) {
      throw new Error("本轮已经初始化过该文件，请使用 append 或 edit 继续。");
    }
    const tool = name === "read" ? createReadToolDefinition(root)
      : name === "edit" ? createEditToolDefinition(root) : createResumableWriteTool(root);
    const result = await tool.execute("memory-file", { ...args, path: stagedName }, signal);
    signal?.throwIfAborted();
    // Mutation status messages contain only a filename and execution status.
    // Keep read content untouched, including any literal "snapshot.md" text.
    if (name !== "read") result.content = result.content.map(block => block.type === "text"
      ? { ...block, text: block.text.replaceAll(stagedName, path) } : block);
    result.details = { ...result.details, path };
    return { result, ...(name !== "read" ? { content: await readFile(target, "utf8") } : {}) };
  } finally {
    // root is the directory created above, independent of all model arguments.
    await rm(root, { recursive: true, force: true });
  }
}
