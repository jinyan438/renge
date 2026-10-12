import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { getCodeReviewFile, getCodeReviewSnapshot } from "../code-review.mjs";
import { buildReviewReport, buildSplitReviewRows, normalizeReviewFindings, parseReviewDiff } from "../src/codeReviewUtils.ts";
import { startRengeServer } from "../server.mjs";

const run = promisify(execFile);
async function repo(t) {
  const root = await mkdtemp(join(tmpdir(), "renge-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => run("git", args, { cwd: root, windowsHide: true });
  await git("init", "-b", "main");
  await git("config", "user.email", "fixture@example.invalid"); await git("config", "user.name", "Fixture");
  await writeFile(join(root, "app.ts"), "export function safe(value: string) {\n  return value.trim();\n}\n");
  await writeFile(join(root, "old name.txt"), "rename this\n");
  await writeFile(join(root, "deleted.txt"), "removed\n");
  await git("add", "."); await git("commit", "-m", "seed");
  return { root, git };
}

test("real Git scopes include tracked, untracked, staged rename, deletion and committed branch changes", async (t) => {
  const { root, git } = await repo(t);
  const initialCommit = await getCodeReviewSnapshot({ workspacePath: root, mode: "commit" });
  assert.equal(initialCommit.files.length, 3, "first commit compares against the empty tree");
  assert.equal((await getCodeReviewFile({ workspacePath: root, mode: "commit", path: "app.ts" })).additions, 3);
  await git("switch", "-c", "feature");
  await writeFile(join(root, "committed.ts"), "export const feature = true;\n");
  await git("add", "committed.ts"); await git("commit", "-m", "feature");
  await writeFile(join(root, "app.ts"), "export function safe(value: string) {\n  return value.toUpperCase();\n}\n");
  await rm(join(root, "deleted.txt"));
  await writeFile(join(root, "中文 file[1].ts"), "const one = 1;\nconst two = 2;");
  await writeFile(join(root, "empty.txt"), "");
  await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2]));
  await git("mv", "old name.txt", "new name.txt");
  await writeFile(join(root, "staged.ts"), "export const staged = 1;\n");
  await git("add", "staged.ts");
  const working = await getCodeReviewSnapshot({ workspacePath: root });
  assert.deepEqual(working.files.map((file) => file.path).sort(), ["app.ts", "binary.bin", "deleted.txt", "empty.txt", "中文 file[1].ts"].sort());
  assert.equal(working.files.find((file) => file.path === "中文 file[1].ts").additions, 2);
  assert.equal(working.files.find((file) => file.path === "binary.bin").binary, true);
  const detail = await getCodeReviewFile({ workspacePath: root, path: "中文 file[1].ts" });
  assert.match(detail.diff, /\+const two = 2;/);
  assert.equal(detail.additions, 2);
  const empty = await getCodeReviewFile({ workspacePath: root, path: "empty.txt" });
  assert.equal(empty.additions, 0);
  assert.equal(parseReviewDiff(empty.diff).filter((line) => line.kind === "addition").length, 0);
  const staged = await getCodeReviewSnapshot({ workspacePath: root, mode: "staged" });
  assert.equal(staged.files.find((file) => file.path === "new name.txt").oldPath, "old name.txt");
  assert.equal(staged.files.find((file) => file.path === "staged.ts").additions, 1);
  const renamed = await getCodeReviewFile({ workspacePath: root, mode: "staged", path: "new name.txt" });
  assert.match(renamed.diff, /rename from old name.txt/);
  await writeFile(join(root, "staged.ts"), "worktree edit must not change staged review\n");
  assert.equal((await getCodeReviewSnapshot({ workspacePath: root, mode: "staged" })).version, staged.version, "staged review ignores unstaged edits");
  const branch = await getCodeReviewSnapshot({ workspacePath: root, mode: "branch", base: "main" });
  assert.deepEqual(branch.files.map((file) => file.path), ["committed.ts"]);
  assert.deepEqual((await getCodeReviewSnapshot({ workspacePath: root, mode: "commit" })).files.map((file) => file.path), ["committed.ts"]);
  await git("branch", "中文分支", "main");
  assert.deepEqual((await getCodeReviewSnapshot({ workspacePath: root, mode: "branch", base: "中文分支" })).files.map((file) => file.path), ["committed.ts"]);
  const originalVersion = working.version;
  await writeFile(join(root, "app.ts"), "export const changed = true;\n");
  assert.notEqual((await getCodeReviewSnapshot({ workspacePath: root })).version, originalVersion);
  assert.equal((await getCodeReviewFile({ workspacePath: root, path: "deleted.txt" })).deletions, 1);
});

test("review is bounded, read-only, rejects invalid ranges, traversal and workspace escapes", async (t) => {
  const { root, git } = await repo(t);
  await mkdir(join(root, "subfolder"));
  await assert.rejects(() => getCodeReviewSnapshot({ workspacePath: join(root, "subfolder") }), /请选择仓库根目录/);
  await assert.rejects(() => getCodeReviewSnapshot({ workspacePath: root, mode: "other" }), /审阅范围无效/);
  await assert.rejects(() => getCodeReviewSnapshot({ workspacePath: root, mode: "branch", base: "--output=outside" }), /比较分支或提交无效/);
  await assert.rejects(() => getCodeReviewFile({ workspacePath: root, path: "../outside" }), /不在当前审阅范围/);
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(() => getCodeReviewSnapshot({ workspacePath: root }, canceled.signal), (error) => error.name === "AbortError");
  const interrupted = new AbortController();
  const reading = getCodeReviewSnapshot({ workspacePath: root }, interrupted.signal);
  interrupted.abort();
  await assert.rejects(() => reading, (error) => error.name === "AbortError");
  await writeFile(join(root, "huge.txt"), "x".repeat(600_000));
  assert.equal((await getCodeReviewFile({ workspacePath: root, path: "huge.txt" })).truncated, true);
  await git("config", "diff.external", "this-command-must-never-run");
  await git("config", "core.fsmonitor", "this-command-must-never-run");
  await git("config", "filter.forbidden.clean", "this-command-must-never-run");
  await git("config", "filter.forbidden.process", "this-command-must-never-run");
  await git("config", "filter.forbidden.required", "true");
  await writeFile(join(root, ".gitattributes"), "app.ts filter=forbidden\n");
  await writeFile(join(root, process.platform === "win32" ? "git.exe" : "git"), "not a Git executable");
  await writeFile(join(root, "app.ts"), "export const readonly = true;\n");
  const before = await readFile(join(root, "app.ts"), "utf8");
  assert.match((await getCodeReviewFile({ workspacePath: root, path: "app.ts" })).diff, /readonly/);
  assert.equal(await readFile(join(root, "app.ts"), "utf8"), before);
  const outside = join(root, "..", `outside-${Date.now()}.txt`);
  await writeFile(outside, "private"); t.after(() => rm(outside, { force: true }));
  try { await symlink(outside, join(root, "linked.txt")); }
  catch (error) { if (error.code === "EPERM") return; throw error; }
  await assert.rejects(() => getCodeReviewFile({ workspacePath: root, path: "linked.txt" }), /不读取符号链接/);
});

test("unborn repositories, literal filenames, binary and HTTP endpoint errors are handled", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-review-unborn-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await run("git", ["init", "-b", "main"], { cwd: root, windowsHide: true });
  await writeFile(join(root, "first.txt"), "first\n");
  await run("git", ["add", "first.txt"], { cwd: root, windowsHide: true });
  assert.equal((await getCodeReviewSnapshot({ workspacePath: root, mode: "staged" })).files[0].path, "first.txt");
  const server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  t.after(async () => { server.server.closeAllConnections(); await new Promise((done) => server.server.close(done)); });
  const response = await fetch(`${server.url}/api/review/snapshot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspacePath: root, mode: "staged" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).files[0].path, "first.txt");
  assert.equal((await fetch(`${server.url}/api/review/snapshot`)).status, 405);
  assert.equal((await fetch(`${server.url}/api/review/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspacePath: root, path: "../../outside", mode: "staged" }) })).status, 404);
});

test("diff coordinates and split rows retain exact source anchors, including code that looks like headers", () => {
  const lines = parseReviewDiff("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -4,3 +4,3 @@\n context\n---old code\n+++new code\n last\n");
  const changed = lines.filter((line) => line.kind !== "meta");
  assert.deepEqual(changed.map(({ kind, oldLine, newLine }) => ({ kind, oldLine, newLine })), [
    { kind: "context", oldLine: 4, newLine: 4 }, { kind: "deletion", oldLine: 5, newLine: null },
    { kind: "addition", oldLine: null, newLine: 5 }, { kind: "context", oldLine: 6, newLine: 6 },
  ]);
  assert.ok(buildSplitReviewRows(lines).some((row) => row.left?.oldLine === 5 && row.right?.newLine === 5));
  const file = { path: "a.ts", diff: "@@ -1 +1 @@\n-old\n+new\n", fingerprint: "fingerprint" };
  const findings = normalizeReviewFindings([
    { path: "a.ts", side: "right", line: 1, priority: 1, title: "Bug", body: "Details" },
    { path: "a.ts", line: 500, title: "invented line", body: "invalid" },
    { path: "../other.ts", line: 1, title: "other file", body: "invalid" },
  ], [file], "working:");
  assert.equal(findings.length, 1);
  assert.match(buildReviewReport(findings, "Summary"), /\[P1\] Bug\na.ts:1/);
  assert.equal(normalizeReviewFindings([{ path: "a.ts", line: 1, priority: null, title: "Unspecified severity", body: "Details" }], [file], "working:")[0].priority, 2);
});
