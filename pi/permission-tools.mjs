import { constants } from "node:fs";
import { access, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createPowerShellToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createResumableWriteTool } from "./resumable-write-tool.mjs";
import { createShellSessionManager } from "./shell-sessions.mjs";

async function canonicalPath(path) {
  const missing = [];
  let ancestor = resolve(path);
  for (;;) {
    try {
      return resolve(await realpath(ancestor), ...missing);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(ancestor.slice(parent.length).replace(/^[\\/]/, ""));
      ancestor = parent;
    }
  }
}

export function createPermissionCheckedPiTools({ cwd, nativeTools, sessionId, authorizeTool, checkCancelled, beforeMutation, shellSessions = createShellSessionManager() }) {
  const authorize = async (toolName, args, signal) => {
    checkCancelled?.();
    if (signal?.aborted) throw new Error("Operation aborted");
    if (authorizeTool) {
      await authorizeTool({ toolName, args, cwd, sessionId, signal });
    } else if (toolName === "edit" || toolName === "write") {
      const root = await canonicalPath(cwd);
      const target = await canonicalPath(args.path);
      const fromRoot = relative(root, target);
      if (fromRoot === ".." || fromRoot.startsWith("..\\") || fromRoot.startsWith("../") || isAbsolute(fromRoot)) {
        throw new Error("未授权修改工作区外文件，请使用桌面端审批。");
      }
    } else {
      throw new Error("Shell 命令需要桌面端权限审批。");
    }
    checkCancelled?.();
    if (signal?.aborted) throw new Error("Operation aborted");
    await beforeMutation?.(toolName === "write" || toolName === "edit" ? args.path : undefined);
    checkCancelled?.();
    if (signal?.aborted) throw new Error("Operation aborted");
  };
  const tools = [];
  if (nativeTools.includes("write")) {
    tools.push(createResumableWriteTool(cwd, {
      authorizePath: (path, signal) => authorize("write", { path }, signal),
    }));
  }
  if (nativeTools.includes("edit")) {
    const tool = createEditToolDefinition(cwd);
    tools.push({
      ...tool,
      execute: (id, args, signal, onUpdate, ctx) => createEditToolDefinition(cwd, {
        operations: {
          access: (path) => access(path, constants.R_OK | constants.W_OK),
          readFile,
          writeFile: async (path, content) => {
            await authorize("edit", { path }, signal);
            await writeFile(path, content, "utf8");
          },
        },
      }).execute(id, args, signal, onUpdate, ctx),
    });
  }
  for (const name of ["bash", "powershell"]) {
    if (!nativeTools.includes(name)) continue;
    const tool = name === "powershell" ? createPowerShellToolDefinition(cwd) : createBashToolDefinition(cwd);
    tools.push(shellSessions.wrap(tool, (args, signal) => authorize(name, args, signal)));
  }
  if (nativeTools.some((name) => name === "bash" || name === "powershell")) tools.push(...shellSessions.tools);
  return tools;
}
