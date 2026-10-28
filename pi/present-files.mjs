import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "typebox";

export function createPresentFilesTool(cwd) {
  return {
    name: "chat_present_files", label: "交付文件",
    description: "将当前工作区内已经存在的最终文件交付给用户，显示带文件图标、名称、说明和打开菜单的独立卡片。完成文档、源码或其他文件后，选择最重要的 1–4 个文件调用此工具。先创建文件再交付；不要交付所有编辑过的文件。本工具不创建或复制文件内容。",
    parameters: Type.Object({ files: Type.Array(Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }), description: Type.Optional(Type.String({ maxLength: 160 })) }), { minItems: 1, maxItems: 8 }) }),
    executionMode: "sequential",
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      if (!Array.isArray(args?.files) || !args.files.length || args.files.length > 8) throw new Error("交付文件数量必须为 1 到 8 个。");
      const root = await realpath(cwd);
      const files = new Map();
      for (const file of args.files) {
        signal?.throwIfAborted();
        if (typeof file?.path !== "string" || !file.path.trim() || /[\x00-\x1f]/.test(file.path)) throw new Error("无效的交付文件路径。");
        const absolute = resolve(cwd, file.path.trim());
        const info = await lstat(absolute);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error(`交付目标不是普通文件：${file.path}`);
        const canonical = await realpath(absolute);
        const path = relative(root, canonical);
        if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error("只能交付当前工作区内的文件。");
        const description = typeof file.description === "string" ? file.description.replace(/\s+/g, " ").trim().slice(0, 160) : "";
        files.set(process.platform === "win32" ? path.toLowerCase() : path, { path: path.replace(/\\/g, "/"), ...(description ? { description } : {}) });
      }
      signal?.throwIfAborted();
      const presentedFiles = { cwd: root, files: [...files.values()] };
      return { content: [{ type: "text", text: presentedFiles.files.map(file => `已交付 ${file.path}${file.description ? `：${file.description}` : ""}`).join("\n") }], details: { presentedFiles } };
    },
  };
}
