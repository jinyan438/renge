import { memoryPath, normalizeRoleplayFileMemory, resolveMemoryReadTarget, type RoleplayFileMemory } from "./roleplayFileMemory.ts";

export type WorkspaceFileAccess = {
  list(path: string): Promise<{ path: string; kind: "file" | "directory" }[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string, expectedContent: string | null): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string, expectedContent: string): Promise<void>;
  removeDirectory(path: string): Promise<void>;
  removeEmptyDirectory?(path: string): Promise<void>;
};

export function roleplayMemoryRoot(sessionId: string) {
  const name = encodeURIComponent(sessionId)
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)
    .replace(/%[0-9A-Fa-f]{2}|[A-Z.]/g, token => token.length > 1 ? token : `%${token.charCodeAt(0).toString(16).toUpperCase()}`);
  if (!name || name.length > 180) throw new Error("会话 ID 无法用作记忆目录名。");
  return `角色记忆/会话-${name}`;
}

const MARKER = ".memory.json";
export async function deleteMemoryFiles(access: WorkspaceFileAccess, sessionId: string, scope: string) {
  const parent = "角色记忆";
  const root = roleplayMemoryRoot(sessionId);
  const parentEntry = (await access.list("")).find(entry => entry.path === parent);
  if (!parentEntry) return;
  if (parentEntry.kind !== "directory") throw new Error("角色记忆路径不是目录，已停止删除。");
  const entry = (await access.list(parent)).find(entry => entry.path === root);
  if (!entry) return;
  if (entry.kind !== "directory") throw new Error("会话记忆路径不是目录，已停止删除。");
  const entries = await access.list(root);
  if (entries.some(entry => entry.path === `${root}/${MARKER}`)
    && JSON.parse(await access.read(`${root}/${MARKER}`)).scope !== scope) {
    throw new Error("记忆目录属于其他工作区或会话，已停止删除。");
  }
  await access.removeDirectory(root);
  // Only adapters with an atomic empty-directory operation prune the shared root.
  await access.removeEmptyDirectory?.(parent);
}

export async function loadMemoryFiles(access: WorkspaceFileAccess, sessionId: string, cached: RoleplayFileMemory, lazy = false) {
  const root = roleplayMemoryRoot(sessionId);
  await access.mkdir(root);
  const top = await access.list(root);
  const initialized = top.some(entry => entry.path === `${root}/${MARKER}`);
  if (initialized && JSON.parse(await access.read(`${root}/${MARKER}`)).scope !== cached.scope) {
    throw new Error("记忆目录属于其他工作区或会话。");
  }
  const memory = normalizeRoleplayFileMemory(cached, cached.scope);
  memory.files = Object.create(null);
  memory.directories = [];
  const visit = async (path: string) => {
    for (const entry of await access.list(path)) {
      if (!entry.path.startsWith(`${root}/`)) throw new Error("文件列表越出记忆目录。");
      const relative = entry.path.slice(root.length + 1);
      if (entry.kind === "directory") {
        memoryPath(relative, true); memory.directories.push(relative); await visit(entry.path);
      } else if (relative.toLowerCase().endsWith(".md")) {
        memoryPath(relative);
        const previous = cached.files[relative];
        const content = lazy ? previous?.content ?? "" : await access.read(entry.path);
        memory.files[relative] = { content, updatedAt: previous?.updatedAt ?? new Date().toISOString(),
          ...(lazy ? { unloaded: true } : {}),
          ...(previous?.userEdited || (!lazy && previous && previous.content !== content) ? { userEdited: true } : {}),
        };
      }
    }
  };
  await visit(root);
  if (!initialized) {
    // One-time migration/restoration: physical files always take precedence.
    for (const path of cached.directories) await access.mkdir(`${root}/${memoryPath(path, true)}`);
    for (const [path, file] of Object.entries(cached.files)) {
      if (memory.files[path]) continue;
      await access.write(`${root}/${memoryPath(path)}`, file.content, null);
      memory.files[path] = { ...file };
    }
    await access.write(`${root}/${MARKER}`, JSON.stringify({ version: 1, scope: cached.scope }), null);
  }
  memory.filesystemReady = true;
  return normalizeRoleplayFileMemory(memory, cached.scope);
}

// Listing only discovers names. Read file contents when the model explicitly
// requests read/search; a scoped content search acts like grep over that subtree.
export async function prepareMemoryFileTool(access: WorkspaceFileAccess, sessionId: string,
  memory: RoleplayFileMemory, baseline: RoleplayFileMemory, name: string, args: Record<string, unknown>) {
  if (name !== "read" && name !== "memory_search") return;
  const target = name === "read" ? resolveMemoryReadTarget(memory, args.path) : null;
  if (target?.kind === "directory") return;
  const root = roleplayMemoryRoot(sessionId);
  const directory = name === "memory_search" ? memoryPath(args.path ?? "", true) : "";
  const paths = target ? [target.path]
    : Object.keys(memory.files).filter(path => !directory || path.startsWith(`${directory}/`));
  for (const path of paths) {
    // A staged edit must remain visible to subsequent reads in this phase.
    if (memory.files[path] && !memory.files[path].unloaded && memory.files[path].content !== baseline.files[path]?.content) continue;
    const previous = baseline.files[path];
    const content = await access.read(`${root}/${path}`);
    const file = { content, updatedAt: new Date().toISOString(),
      ...(previous?.userEdited || (previous && previous.content !== content) ? { userEdited: true } : {}),
    };
    baseline.files[path] = { ...file };
    memory.files[path] = { ...file };
  }
}

// Compare-and-swap keeps edits made in the file sidebar (or another editor)
// during generation from being overwritten. Revert partial disk writes on error.
export async function commitMemoryFiles(access: WorkspaceFileAccess, sessionId: string, before: RoleplayFileMemory, after: RoleplayFileMemory) {
  const root = roleplayMemoryRoot(sessionId);
  const changes = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
    .filter(path => before.files[path]?.content !== after.files[path]?.content);
  const applied: string[] = [];
  try {
    for (const path of after.directories) if (!before.directories.includes(path)) await access.mkdir(`${root}/${memoryPath(path, true)}`);
    for (const path of changes) {
      const target = `${root}/${memoryPath(path)}`;
      const oldContent = before.files[path]?.content ?? null;
      if (after.files[path]) await access.write(target, after.files[path].content, oldContent);
      else await access.remove(target, oldContent!);
      applied.push(path);
    }
  } catch (error) {
    for (const path of applied.reverse()) {
      const target = `${root}/${path}`;
      try {
        if (before.files[path]) await access.write(target, before.files[path].content, after.files[path]?.content ?? null);
        else await access.remove(target, after.files[path].content);
      } catch { /* A subsequent manual edit takes precedence over rollback. */ }
    }
    throw error;
  }
}

export function httpWorkspaceFileAccess(options: { scope: "temporary" | "workspace"; workspacePath?: string; baseUrl?: string }): WorkspaceFileAccess {
  const request = async (operation: string, path: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch(`${options.baseUrl ?? ""}/api/workspace-files`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...options, operation, path, ...extra }),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || `文件操作失败：${response.status}`);
    return result;
  };
  return {
    list: async path => (await request("list", path)).entries,
    read: async path => (await request("read", path)).content,
    write: async (path, content, expectedContent) => { await request("write", path, { content, expectedContent }); },
    mkdir: async path => { await request("mkdir", path); },
    remove: async (path, expectedContent) => { await request("delete", path, { expectedContent }); },
    removeDirectory: async path => { await request("deleteDirectory", path); },
    removeEmptyDirectory: async path => { await request("pruneDirectory", path); },
  };
}
