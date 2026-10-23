import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const snapshots = new Map();
const digest = value => createHash("sha256").update(value).digest("hex").slice(0, 24);
export function roleplayMemoryDirectory(dataFile, workspaceKey, sessionId) {
  return join(dirname(dataFile), "roleplay-memory", digest(workspaceKey), digest(sessionId));
}
function validPath(path, directory = false) {
  return typeof path === "string" && path.length > 0 && path.length <= 240
    && (directory || /\.md$/i.test(path)) && !path.includes("\\")
    && path.split("/").every(part => part && part !== "." && part !== ".."
      && !/[\x00-\x1f<>:"|?*]/.test(part) && !/[. ]$/.test(part)
      && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
async function noLink(path) {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error("记忆目录不能使用符号链接"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
async function directory(root, parts) {
  let path = root;
  await noLink(path);
  await mkdir(path, { recursive: true });
  for (const part of parts) {
    path = join(path, part);
    await noLink(path);
    await mkdir(path, { recursive: true });
  }
  return path;
}
async function atomicWrite(path, content) {
  await noLink(path);
  const temp = `${path}.tmp-${randomUUID()}`;
  try { await writeFile(temp, content, "utf8"); await rename(temp, path); }
  finally { await unlink(temp).catch(() => undefined); }
}

// Session JSON is the portable source of truth (including complete backups).
// Materialize it as ordinary Markdown as well, without rewriting unchanged
// files during streaming saves. Only manifest-owned files may be removed.
export async function syncRoleplayMemoryFiles(dataFile, payload) {
  for (const session of payload.chatSessions ?? []) {
    const memory = session?.fileMemory;
    const scope = JSON.stringify([session?.workspaceKey, session?.id]);
    if (!memory || memory.scope !== scope || typeof session.workspaceKey !== "string" || typeof session.id !== "string") continue;
    const root = roleplayMemoryDirectory(dataFile, session.workspaceKey, session.id);
    const snapshot = digest(JSON.stringify([memory.files, memory.directories]));
    if (snapshots.get(root) === snapshot && await lstat(join(root, ".files.json")).catch(() => null)) continue;
    await directory(dirname(dataFile), ["roleplay-memory", digest(session.workspaceKey), digest(session.id)]);
    let previous = [];
    const manifest = join(root, ".files.json");
    await noLink(manifest);
    try { previous = JSON.parse(await readFile(manifest, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const current = new Set();
    for (const path of memory.directories ?? []) {
      if (validPath(path, true)) await directory(root, path.split("/"));
    }
    for (const [path, file] of Object.entries(memory.files ?? {})) {
      if (!validPath(path) || typeof file?.content !== "string") continue;
      const parts = path.split("/");
      await directory(root, parts.slice(0, -1));
      const target = join(root, ...parts);
      await noLink(target);
      let existing;
      try { existing = await readFile(target, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (existing !== file.content) await atomicWrite(target, file.content);
      current.add(path);
    }
    for (const path of Array.isArray(previous) ? previous : []) {
      if (!validPath(path) || current.has(path)) continue;
      // Validate each ancestor even when deleting an obsolete managed file.
      const parts = path.split("/");
      await directory(root, parts.slice(0, -1));
      const target = join(root, ...parts);
      await noLink(target);
      await unlink(target).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
    await atomicWrite(manifest, JSON.stringify([...current]));
    snapshots.set(root, snapshot);
  }
}
