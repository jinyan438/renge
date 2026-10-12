import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const gitExecutable = (async () => {
  for (const directory of String(process.env.PATH ?? "").split(delimiter).filter(isAbsolute)) {
    const candidate = join(directory, process.platform === "win32" ? "git.exe" : "git");
    if ((await stat(candidate).catch(() => null))?.isFile()) return realpath(candidate);
  }
  return "";
})();
const MAX_FILES = 1000;
const MAX_DIFF_BYTES = 512 * 1024;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const inside = (root, path) => {
  const rest = relative(root, path);
  return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
};
function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }

async function git(root, args, optional = false, signal) {
  try {
    signal?.throwIfAborted();
    const filterOverrides = args[0] === "diff"
      ? (await git(root, ["config", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"], true, signal)).trim().split("\n").filter(Boolean).flatMap((key) => ["-c", `${key}=${key.endsWith(".required") ? "false" : ""}`]) : [];
    const executable = await gitExecutable;
    if (!executable) throw Object.assign(new Error("Git executable unavailable"), { code: "ENOENT" });
    const result = await execute(executable, ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "core.quotePath=false", ...filterOverrides, ...args], {
      cwd: root, encoding: "utf8", windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024, signal,
      env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_COMMON_DIR: undefined, GIT_EXTERNAL_DIFF: "", GIT_PAGER: "cat" },
    });
    return result.stdout;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (optional) return "";
    if (error.code === "ENOENT") throw failure("未找到 Git，请在电脑上安装 Git 后重启应用。", 503);
    if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw failure("变更过大，请缩小审阅范围。", 413);
    throw failure(String(error.stderr || error.message || "读取 Git 变更失败").slice(0, 1600), 422);
  }
}

async function context(body, signal) {
  if (typeof body?.workspacePath !== "string" || !isAbsolute(body.workspacePath) || body.workspacePath.includes("\0")) {
    throw failure("请先选择电脑上的 Git 工作区。");
  }
  const workspace = await realpath(body.workspacePath).catch(() => { throw failure("工作区不存在。", 404); });
  if (!(await stat(workspace)).isDirectory()) throw failure("工作区必须是文件夹。");
  const root = await realpath((await git(workspace, ["rev-parse", "--show-toplevel"], false, signal)).trim());
  if (!inside(workspace, root)) throw failure("请选择仓库根目录，当前文件夹不足以覆盖整个仓库。", 403);
  const mode = body.mode ?? "working";
  if (!["working", "staged", "branch", "commit"].includes(mode)) throw failure("审阅范围无效。");
  const head = (await git(root, ["rev-parse", "--verify", "HEAD"], true, signal)).trim();
  let baseCommit = "", base = String(body.base ?? "HEAD");
  if (mode === "branch") {
    if (!base || base.length > 200 || base.startsWith("-") || /[\s\x00-\x1f\x7f:\\]/u.test(base)) throw failure("比较分支或提交无效。");
    const commit = (await git(root, ["rev-parse", "--verify", `${base}^{commit}`], false, signal)).trim();
    if (!head) throw failure("仓库还没有提交，暂时无法比较分支。", 422);
    baseCommit = (await git(root, ["merge-base", commit, head], false, signal)).trim();
  }
  if (mode === "commit") {
    if (!head) throw failure("仓库还没有提交，请先查看未暂存或已暂存变更。", 422);
    baseCommit = (await git(root, ["rev-parse", "--verify", "HEAD~1"], true, signal)).trim();
    base = baseCommit ? "HEAD~1" : "空树";
    baseCommit ||= createHash(head.length === 64 ? "sha256" : "sha1").update("tree 0\0").digest("hex");
  }
  const range = mode === "staged" ? ["--cached", ...(head ? [head] : [])] : mode === "branch" || mode === "commit" ? [baseCommit, head] : [];
  return { root, mode, head, base, baseCommit, range };
}

function parseNames(output) {
  const tokens = output.split("\0"), files = [];
  for (let index = 0; index < tokens.length && tokens[index];) {
    const status = tokens[index++];
    const first = tokens[index++];
    if (/^[RC]/.test(status)) files.push({ path: tokens[index++], oldPath: first, status: status[0] });
    else files.push({ path: first, status: status[0] });
  }
  return files.filter((file) => file.path);
}
function parseStats(output) {
  const tokens = output.split("\0"), stats = new Map();
  for (let index = 0; index < tokens.length && tokens[index];) {
    const record = tokens[index++];
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(record);
    if (!match) continue;
    let path = match[3];
    if (!path) { index++; path = tokens[index++]; }
    stats.set(path, { additions: Number(match[1]) || 0, deletions: Number(match[2]) || 0, binary: match[1] === "-" });
  }
  return stats;
}
function validateFilePath(root, path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\0") || path.split(/[\\/]/).some((part) => part === "." || part === "..")) throw failure("变更文件路径无效。");
  const target = resolve(root, path);
  if (!inside(root, target)) throw failure("变更文件超出仓库。", 403);
  return target;
}
async function safeFile(root, path) {
  const target = validateFilePath(root, path);
  let ancestor = target;
  while (true) {
    const info = await lstat(ancestor).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (info) {
      if (info.isSymbolicLink() || !inside(root, await realpath(ancestor))) throw failure("审阅不读取符号链接指向的文件。", 403);
      if (ancestor === target) return { target, info };
      return { target, info: null };
    }
    const parent = resolve(ancestor, "..");
    if (parent === ancestor || !inside(root, parent)) throw failure("变更文件路径无效。");
    ancestor = parent;
  }
}

export async function getCodeReviewSnapshot(body, signal) {
  const ctx = await context(body, signal);
  const [names, numbers, untracked, branch, refs, upstream, indexPath] = await Promise.all([
    git(ctx.root, ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames", ...ctx.range, "--"], false, signal),
    git(ctx.root, ["diff", "--no-ext-diff", "--no-textconv", "--numstat", "-z", "--find-renames", ...ctx.range, "--"], false, signal),
    ctx.mode === "working" ? git(ctx.root, ["ls-files", "--others", "--exclude-standard", "-z"], false, signal) : "",
    git(ctx.root, ["symbolic-ref", "--short", "HEAD"], true, signal),
    git(ctx.root, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"], false, signal),
    git(ctx.root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], true, signal),
    git(ctx.root, ["rev-parse", "--git-path", "index"], false, signal),
  ]);
  const stats = parseStats(numbers);
  const all = [...parseNames(names), ...untracked.split("\0").filter(Boolean).map((path) => ({ path, status: "?" }))];
  const indexInfo = await stat(resolve(ctx.root, indexPath.trim())).catch(() => null);
  const files = await Promise.all(all.slice(0, MAX_FILES).map(async (file) => {
    let info;
    if (ctx.mode === "working") {
      try { info = (await safeFile(ctx.root, file.path)).info; } catch { info = null; }
    }
    let fileStats = stats.get(file.path);
    if (file.status === "?" && info?.isFile() && info.size <= 64 * 1024) {
      const bytes = await readFile(resolve(ctx.root, file.path), { signal }).catch((error) => signal?.aborted ? Promise.reject(error) : null);
      if (bytes) {
        const content = bytes.toString("utf8");
        fileStats = { additions: bytes.includes(0) || !content ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0), deletions: 0, binary: bytes.includes(0) };
      }
    }
    return { ...file, additions: fileStats?.additions ?? 0, deletions: fileStats?.deletions ?? 0, binary: fileStats?.binary ?? false, statsUnknown: file.status === "?" && !fileStats,
      size: info?.size ?? 0, version: hash(`${ctx.head}\0${ctx.baseCommit}\0${ctx.mode}\0${file.path}\0${info?.mtimeMs}\0${info?.ctimeMs}\0${info?.size}\0${ctx.mode === "working" || ctx.mode === "staged" ? indexInfo?.mtimeMs : ""}`) };
  }));
  const branches = refs.trim().split("\n").filter(Boolean).slice(0, 1000);
  const defaultBase = upstream.trim() || branches.find((ref) => /^(origin\/)?(main|master)$/.test(ref)) || (ctx.head ? "HEAD~1" : "HEAD");
  return { root: ctx.root, branch: branch.trim() || ctx.head.slice(0, 8) || "尚无提交", head: ctx.head, mode: ctx.mode, base: ctx.base, baseCommit: ctx.baseCommit,
    branches: [...new Set(["HEAD", "HEAD~1", ...branches])], defaultBase, files, truncated: all.length > MAX_FILES, totalFiles: all.length,
    version: hash(JSON.stringify([ctx.head, ctx.baseCommit, ctx.mode, files.map((file) => [file.path, file.oldPath, file.status, file.version, file.additions, file.deletions, file.binary])])), createdAt: new Date().toISOString() };
}

export async function getCodeReviewFile(body, signal) {
  const ctx = await context(body, signal);
  const snapshot = await getCodeReviewSnapshot(body, signal);
  const file = snapshot.files.find((candidate) => candidate.path === body.path);
  if (!file) throw failure("文件不在当前审阅范围内，请刷新变更列表。", 404);
  const { target, info } = ctx.mode === "working" ? await safeFile(ctx.root, file.path) : { target: validateFilePath(ctx.root, file.path), info: null };
  let diff = "", binary = file.binary, truncated = false;
  if (file.status === "?") {
    if (!info?.isFile()) throw failure("此文件类型无法预览。", 422);
    if (info.size > MAX_DIFF_BYTES) return { ...file, diff: "", binary: false, truncated: true, fingerprint: file.version };
    const bytes = await readFile(target, { signal });
    binary = bytes.includes(0);
    if (!binary) {
      const content = bytes.toString("utf8"), lines = content ? content.replace(/\r\n/g, "\n").split("\n") : [];
      if (content.endsWith("\n")) lines.pop();
      file.additions = lines.length;
      diff = `diff --git a/${file.path} b/${file.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${file.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n${content.endsWith("\n") ? "" : "\\ No newline at end of file\n"}`;
    }
  } else {
    diff = await git(ctx.root, ["diff", "--no-ext-diff", "--no-textconv", "--find-renames", "--unified=5", ...ctx.range, "--", ...(file.oldPath ? [file.oldPath] : []), file.path], false, signal);
    binary ||= /^(Binary files .* differ|GIT binary patch)$/m.test(diff);
    if (Buffer.byteLength(diff) > MAX_DIFF_BYTES) { diff = Buffer.from(diff).subarray(0, MAX_DIFF_BYTES).toString("utf8"); truncated = true; }
  }
  return { ...file, diff, binary, truncated, fingerprint: hash(diff || `${binary}:${file.version}`) };
}
