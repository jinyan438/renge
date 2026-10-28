import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function countLineChanges(before, after) {
  const lines = bytes => bytes?.length ? bytes.toString("utf8").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n") : [];
  const oldLines = lines(before), newLines = lines(after);
  let head = 0, tail = 0;
  while (head < Math.min(oldLines.length, newLines.length) && oldLines[head] === newLines[head]) head++;
  while (tail < Math.min(oldLines.length, newLines.length) - head && oldLines.at(-tail - 1) === newLines.at(-tail - 1)) tail++;
  const oldCount = oldLines.length - head - tail, newCount = newLines.length - head - tail;
  // Bound the fallback comparison so a large generated file cannot stall chat.
  if (oldCount * newCount > 2_000_000) return { added: newCount, deleted: oldCount, coarse: true };
  const row = new Uint32Array(newCount + 1);
  for (let i = head; i < oldLines.length - tail; i++) {
    let diagonal = 0;
    for (let j = 1; j <= newCount; j++) {
      const previous = row[j];
      row[j] = oldLines[i] === newLines[head + j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = previous;
    }
  }
  return { added: newCount - row[newCount], deleted: oldCount - row[newCount] };
}

async function capture(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    if (info.size > MAX_FILE_BYTES) return { fingerprint: `${info.size}:${info.mtimeMs}`, oversized: true };
    const bytes = await readFile(path);
    return { fingerprint: createHash("sha256").update(bytes).digest("hex"), bytes };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** One run owns its private index/objects. User index, refs and commits are untouched. */
export function createWorkspaceChangeRecorder(cwd, { maxFiles = 500, warn = console.warn } = {}) {
  cwd = resolve(cwd);
  let scratch, repo, env, beforeTree, baseline;
  let touched = false, finished = false;
  const captures = new Map();
  const pathKey = path => process.platform === "win32" ? path.toLowerCase() : path;
  let queue = Promise.resolve();
  const git = async (args, directory = repo || cwd, isolated = true) => {
    const result = await execute("git", ["-c", "core.splitIndex=false", "-c", "core.fsmonitor=false", ...args], {
      cwd: directory, env: isolated && env ? env : process.env, windowsHide: true,
      timeout: 30_000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8",
    });
    return result.stdout;
  };
  const snapshot = async () => {
    await git(["add", "--all", "--", "."]);
    return (await git(["write-tree"])).trim();
  };
  const start = async () => {
    // No repository is a supported mode: capture explicit file-tool edits.
    try { repo = (await git(["rev-parse", "--show-toplevel"], cwd, false)).trim(); }
    catch { return; }
    try {
      scratch = await mkdtemp(join(tmpdir(), "renge-turn-changes-"));
      const objects = (await git(["rev-parse", "--path-format=absolute", "--git-path", "objects"], repo, false)).trim();
      const index = (await git(["rev-parse", "--path-format=absolute", "--git-path", "index"], repo, false)).trim();
      await mkdir(join(scratch, "objects"));
      env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index"), GIT_OBJECT_DIRECTORY: join(scratch, "objects"),
        GIT_ALTERNATE_OBJECT_DIRECTORIES: objects, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "0" };
      try { await copyFile(index, env.GIT_INDEX_FILE); } catch (error) { if (error.code !== "ENOENT") throw error; }
      beforeTree = await snapshot();
    } catch (error) {
      beforeTree = undefined;
      warn(`[workspace-changes] 无法创建任务快照：${error.message}`);
    }
  };
  const displayPath = path => {
    const rel = relative(cwd, path);
    return (isAbsolute(rel) ? path : rel).replace(/\\/g, "/");
  };
  return {
    beforeMutation(path) {
      if (finished) return Promise.resolve();
      touched = true;
      queue = queue.then(async () => {
        baseline ??= start();
        await baseline;
        if (!path) return;
        const absolute = resolve(cwd, path);
        const key = pathKey(absolute);
        if (!captures.has(key)) {
          try { captures.set(key, { path: absolute, before: await capture(absolute) }); }
          catch (error) { warn(`[workspace-changes] 无法读取编辑前的文件：${error.message}`); }
        }
      });
      // Recording is observational and must never break an authorized edit.
      queue = queue.catch(error => warn(`[workspace-changes] ${error.message}`));
      return queue;
    },
    async finish() {
      if (finished || !touched) return;
      finished = true;
      await queue;
      const files = new Map();
      try {
        if (beforeTree) {
          const afterTree = await snapshot();
          const baseArgs = ["diff-tree", "-r", "--no-commit-id", "--no-renames"];
          const statuses = (await git([...baseArgs, "--name-status", "-z", beforeTree, afterTree])).split("\0");
          const statusByPath = new Map();
          for (let i = 0; i + 1 < statuses.length; i += 2) statusByPath.set(statuses[i + 1], statuses[i]);
          const stats = (await git([...baseArgs, "--numstat", "-z", beforeTree, afterTree])).split("\0").filter(Boolean);
          for (const row of stats) {
            const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(row);
            if (!match) continue;
            const [, added, deleted, repoPath] = match;
            const absolute = resolve(repo, repoPath);
            files.set(pathKey(absolute), { path: displayPath(absolute), status: statusByPath.get(repoPath) === "A" ? "added" : statusByPath.get(repoPath) === "D" ? "deleted" : "modified",
              ...(added === "-" ? { binary: true } : { added: Number(added), deleted: Number(deleted) }) });
          }
        }
      } catch (error) { warn(`[workspace-changes] 无法读取任务快照差异：${error.message}`); }
      for (const [key, { path, before }] of captures) {
        if (files.has(key)) continue;
        try {
          const after = await capture(path);
          if (before?.fingerprint === after?.fingerprint || (!before && !after)) continue;
          const oversized = before?.oversized || after?.oversized;
          const binary = before?.bytes?.includes(0) || after?.bytes?.includes(0);
          files.set(key, { path: displayPath(path), status: !before ? "added" : !after ? "deleted" : "modified",
            ...(oversized ? { oversized: true } : binary ? { binary: true } : countLineChanges(before?.bytes, after?.bytes)) });
        } catch (error) { warn(`[workspace-changes] 无法读取编辑后的文件：${error.message}`); }
      }
      const all = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
      if (!all.length) return;
      return { cwd, files: all.slice(0, maxFiles), total: all.length,
        added: all.reduce((sum, file) => sum + (file.added || 0), 0), deleted: all.reduce((sum, file) => sum + (file.deleted || 0), 0),
        ...(all.length > maxFiles ? { truncated: true } : {}) };
    },
    async dispose() {
      await queue;
      // scratch is always the absolute directory returned by our own mkdtemp.
      if (scratch) await rm(scratch, { recursive: true, force: true });
    },
  };
}
