import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { listSidebarFiles, readSidebarBinaryFile, resolveSidebarFilePath } from "./electron/sidebar-files.mjs";

const queues = new Map();
export async function workspaceFileOperation(rootPath, body) {
  const root = resolve(rootPath);
  const path = String(body.path ?? "");
  if (/^[\\/]|^[a-z]:/i.test(path) || path.split(/[\\/]/).some(part => part === "..")) throw new Error("路径不能越出工作区。");
  const target = resolveSidebarFilePath(root, path);
  // Do not follow links in memory or editor operations, including ancestors.
  const check = async () => {
    let current = root;
    for (const part of ["", ...path.replace(/\\/g, "/").split("/").filter(Boolean)]) {
      if (part) current = join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error("文件路径不能使用符号链接。"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  };
  const read = async () => {
    try { return await readFile(target, "utf8"); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  const operation = async () => {
    await check();
    if (body.operation === "list") return listSidebarFiles(root, path, { recursive: false, limit: 10_000 });
    if (body.operation === "read") {
      const content = await read();
      if (content === null) throw Object.assign(new Error("文件不存在。"), { code: "ENOENT" });
      return { path, content };
    }
    if (body.operation === "readBinary") return readSidebarBinaryFile(root, path);
    if (!path || target === root) throw new Error("操作必须指向工作区内的文件或子目录。");
    if (body.operation === "mkdir") { await mkdir(target, { recursive: true }); return { ok: true }; }
    if (body.operation !== "write" && body.operation !== "delete") throw new Error("未知文件操作。");
    if (Object.hasOwn(body, "expectedContent") && await read() !== body.expectedContent) {
      throw Object.assign(new Error("文件已被修改，请刷新后重试。"), { code: "CONFLICT" });
    }
    if (body.operation === "delete") { await unlink(target); return { ok: true }; }
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${randomUUID()}`;
    try { await writeFile(temporary, String(body.content ?? ""), "utf8"); await rename(temporary, target); }
    finally { await unlink(temporary).catch(() => undefined); }
    return { ok: true, path };
  };
  if (["list", "read", "readBinary"].includes(body.operation)) return operation();
  const previous = queues.get(root) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  queues.set(root, pending);
  try { return await pending; } finally { if (queues.get(root) === pending) queues.delete(root); }
}
