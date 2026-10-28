import { memoryPath, memoryStorageDirectory, normalizeRoleplayFileMemory, resolveMemoryReadTarget, type RoleplayFileMemory } from "./roleplayFileMemory.ts";

export type WorkspaceFileAccess = {
  list(path: string): Promise<{ path: string; kind: "file" | "directory" }[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string, expectedContent: string | null): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string, expectedContent: string): Promise<void>;
  removeDirectory(path: string): Promise<void>;
  removeEmptyDirectory?(path: string): Promise<void>;
};

function characterDirectoryName(name: string) {
  let value = Array.from(name.normalize("NFC").replace(/[\x00-\x1f<>:"/\\|?*]/g, "_").trim()).slice(0, 80).join("").replace(/[. ]+$/, "");
  if (!value) value = "未命名角色";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = `_${value}`;
  return value;
}

export function roleplayMemoryDirectory(character: { id: string; name: string }, characters: { id: string; name: string }[] = [character]) {
  const name = characterDirectoryName(character.name);
  const duplicate = characters.some(other => other.id !== character.id && characterDirectoryName(other.name).toLowerCase() === name.toLowerCase());
  let suffix = "";
  if (duplicate) {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < character.id.length; i++) { a = Math.imul(a ^ character.id.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ character.id.charCodeAt(i); }
    suffix = `-${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
  }
  return memoryStorageDirectory(`${name}${suffix}-记忆`);
}

export function roleplayMemoryRoot(sessionId: string, directory = "角色记忆") {
  const name = encodeURIComponent(sessionId)
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)
    .replace(/%[0-9A-Fa-f]{2}|[A-Z.]/g, token => token.length > 1 ? token : `%${token.charCodeAt(0).toString(16).toUpperCase()}`);
  if (!name || name.length > 180) throw new Error("会话 ID 无法用作记忆目录名。");
  return `${memoryStorageDirectory(directory)}/会话-${name}`;
}

const MARKER = ".memory.json";
async function findSessionRoots(access: WorkspaceFileAccess, sessionId: string, scope: string) {
  const roots: { root: string; parent: string; initialized: boolean }[] = [];
  for (const entry of await access.list("")) {
    if (entry.path !== "角色记忆" && !entry.path.endsWith("-记忆")) continue;
    const parent = memoryStorageDirectory(entry.path);
    if (entry.kind !== "directory") {
      if (parent === "角色记忆") throw new Error("角色记忆路径不是目录，已停止操作。");
      continue;
    }
    const root = roleplayMemoryRoot(sessionId, parent);
    const children = await access.list(parent).catch(async error => {
      // Another session may have just pruned a shared empty parent.
      if (!(await access.list("")).some(entry => entry.path === parent)) return [];
      throw error;
    });
    const child = children.find(child => child.path === root);
    if (!child) continue;
    if (child.kind !== "directory") throw new Error("会话记忆路径不是目录，已停止操作。");
    const initialized = (await access.list(root)).some(child => child.path === `${root}/${MARKER}`);
    if (initialized && JSON.parse(await access.read(`${root}/${MARKER}`)).scope !== scope) {
      throw new Error("记忆目录属于其他工作区或会话，已停止操作。");
    }
    roots.push({ root, parent, initialized });
  }
  return roots;
}

export async function deleteMemoryFiles(access: WorkspaceFileAccess, sessionId: string, scope: string) {
  // Locate by session identity, including legacy paths and renamed characters.
  // Validate every marker before deleting any of the matching session folders.
  for (const { root, parent } of await findSessionRoots(access, sessionId, scope)) {
    await access.removeDirectory(root);
    await access.removeEmptyDirectory?.(parent);
  }
}

async function migrateMemoryDirectory(access: WorkspaceFileAccess, from: string, to: string, scope: string) {
  const directories: string[] = [];
  const files: { path: string; content: string }[] = [];
  const visit = async (path: string) => {
    for (const entry of await access.list(path)) {
      if (!entry.path.startsWith(`${from}/`)) throw new Error("文件列表越出记忆目录。");
      const relative = entry.path.slice(from.length + 1);
      if (entry.kind === "directory") { memoryPath(relative, true); directories.push(relative); await visit(entry.path); }
      else if (relative.toLowerCase().endsWith(".md")) files.push({ path: memoryPath(relative), content: await access.read(entry.path) });
    }
  };
  await visit(from);
  await access.mkdir(to);
  const destinations = new Map<string, { path: string; kind: string }[]>();
  for (const directory of directories) await access.mkdir(`${to}/${directory}`);
  for (const file of files) {
    const parent = file.path.split("/").slice(0, -1).join("/");
    if (!destinations.has(parent)) destinations.set(parent, await access.list(parent ? `${to}/${parent}` : to));
    const target = `${to}/${file.path}`;
    const existing = destinations.get(parent)!.some(entry => entry.path === target);
    if (existing) {
      if (await access.read(target) !== file.content) throw new Error(`记忆迁移冲突，两个目录中的 ${file.path} 内容不同，已保留双方文件。`);
    } else await access.write(target, file.content, null);
  }
  // Catch manual edits before removing old copies. Each removal also compares
  // contents, so edits made during cleanup remain in the original directory.
  for (const file of files) if (await access.read(`${from}/${file.path}`) !== file.content) throw new Error("记忆迁移期间文件已被修改，请重试。");
  const marker = `${to}/${MARKER}`;
  if (!(await access.list(to)).some(entry => entry.path === marker)) await access.write(marker, JSON.stringify({ version: 1, scope }), null);
  for (const file of files) await access.remove(`${from}/${file.path}`, file.content);
  const oldMarker = `${from}/${MARKER}`;
  if ((await access.list(from)).some(entry => entry.path === oldMarker)) {
    const content = await access.read(oldMarker);
    if (JSON.parse(content).scope !== scope) throw new Error("记忆目录归属已改变，已停止迁移。");
    await access.remove(oldMarker, content);
  }
  // Only prune empty directories. Non-Markdown attachments remain untouched.
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) await access.removeEmptyDirectory?.(`${from}/${directory}`);
  await access.removeEmptyDirectory?.(from);
  await access.removeEmptyDirectory?.(from.split("/")[0]);
}

export async function loadMemoryFiles(access: WorkspaceFileAccess, sessionId: string, cached: RoleplayFileMemory, lazy = false,
  directory = cached.storageDirectory ?? "角色记忆") {
  let root = roleplayMemoryRoot(sessionId, directory);
  const roots = await findSessionRoots(access, sessionId, cached.scope);
  const aliases = roots.filter(entry => entry.parent.toLowerCase() === directory.toLowerCase());
  if (aliases.length > 1) throw new Error("记忆目录存在仅大小写不同的重复目录，已保留双方文件，请先合并目录。");
  if (aliases.length === 1) {
    // A case-only rename aliases the same directory on Windows. Keep its
    // physical spelling instead of copying onto itself and removing the source.
    directory = aliases[0].parent;
    root = aliases[0].root;
  }
  const initialized = roots.some(entry => entry.initialized);
  for (const source of roots) if (source.root !== root) await migrateMemoryDirectory(access, source.root, root, cached.scope);
  await access.mkdir(root);
  const memory = normalizeRoleplayFileMemory(cached, cached.scope);
  memory.storageDirectory = directory;
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
    if (!(await access.list(root)).some(entry => entry.path === `${root}/${MARKER}`)) await access.write(`${root}/${MARKER}`, JSON.stringify({ version: 1, scope: cached.scope }), null);
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
  const root = roleplayMemoryRoot(sessionId, memory.storageDirectory);
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
  const root = roleplayMemoryRoot(sessionId, after.storageDirectory ?? before.storageDirectory);
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
