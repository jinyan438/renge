import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createWorkspaceChangeRecorder } from "../pi/workspace-changes.mjs";
import { createPermissionCheckedPiTools } from "../pi/permission-tools.mjs";

const execute = promisify(execFile);
test("cancellation during a snapshot still prevents the authorized mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-cancelled-capture-"));
  try {
    const controller = new AbortController();
    const [write] = createPermissionCheckedPiTools({ cwd: root, nativeTools: ["write"], beforeMutation: async () => controller.abort() });
    await assert.rejects(write.execute("cancelled", { path: "new.txt", content: "must not be written", operation: "overwrite", expected_bytes: 0 }, controller.signal), /aborted/i);
    await assert.rejects(readFile(join(root, "new.txt")), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("task snapshots include shell add/edit/delete while excluding earlier dirty changes and preserving the index", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-changes-test-"));
  const git = async (...args) => (await execute("git", args, { cwd: root, windowsHide: true })).stdout;
  const warnings = [];
  const recorder = createWorkspaceChangeRecorder(root, { warn: message => warnings.push(message) });
  try {
    await git("init"); await git("config", "user.email", "fixture@example.invalid"); await git("config", "user.name", "Fixture");
    await writeFile(join(root, "edit.txt"), "one\ntwo\n");
    await writeFile(join(root, "delete.txt"), "delete\n");
    await writeFile(join(root, "prior.txt"), "committed\n");
    await git("add", "."); await git("commit", "-m", "fixture");
    await writeFile(join(root, "prior.txt"), "earlier staged change\n"); await git("add", "prior.txt");
    await writeFile(join(root, "edit.txt"), "earlier dirty line\ntwo\n");
    await writeFile(join(root, "untracked.txt"), "existing untracked\n");
    const indexBefore = await readFile(join(root, ".git", "index"));
    const headBefore = await git("rev-parse", "HEAD");
    await recorder.beforeMutation();
    await writeFile(join(root, "edit.txt"), "earlier dirty line\nchanged\n");
    await writeFile(join(root, "new 空格.md"), "# New\nhello\n");
    await rm(join(root, "delete.txt"));
    const changes = await recorder.finish();
    assert.equal(changes.total, 3);
    assert.deepEqual(changes.files.map(file => [file.path, file.status, file.added, file.deleted]), [
      ["delete.txt", "deleted", 0, 1], ["edit.txt", "modified", 1, 1], ["new 空格.md", "added", 2, 0],
    ]);
    assert.equal(changes.added, 3); assert.equal(changes.deleted, 2);
    assert.deepEqual(await readFile(join(root, ".git", "index")), indexBefore);
    assert.equal(await git("rev-parse", "HEAD"), headBefore);
    assert.deepEqual(warnings, []);
    assert.equal(await recorder.finish(), undefined, "each run publishes once");
  } finally { await recorder.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("file-tool captures work without git, consolidate repeated edits, and omit reverted writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-file-captures-"));
  const recorder = createWorkspaceChangeRecorder(root);
  try {
    await writeFile(join(root, "keep.txt"), "same\n");
    await writeFile(join(root, "modify.txt"), "before\nunchanged middle\nbefore end\n");
    await recorder.beforeMutation("keep.txt"); await writeFile(join(root, "keep.txt"), "different\n"); await writeFile(join(root, "keep.txt"), "same\n");
    const tools = createPermissionCheckedPiTools({ cwd: root, nativeTools: ["write", "edit"], beforeMutation: path => recorder.beforeMutation(path) });
    const write = tools.find(tool => tool.name === "write");
    await write.execute("new", { path: "new.txt", content: "one\n", operation: "overwrite", expected_bytes: 0 });
    await write.execute("new-again", { path: "new.txt", content: "two\n", operation: "append", expected_bytes: 4 });
    const edit = tools.find(tool => tool.name === "edit");
    await edit.execute("modify", { path: "modify.txt", edits: [{ oldText: "before\n", newText: "after\n" }, { oldText: "before end", newText: "after end" }] });
    const changes = await recorder.finish();
    assert.deepEqual(changes.files.map(file => [file.path, file.status, file.added, file.deleted]), [
      ["modify.txt", "modified", 2, 2], ["new.txt", "added", 2, 0],
    ]);
  } finally { await recorder.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("ignored files and binary files are summarized without fake line counts", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-ignored-changes-"));
  const git = (...args) => execute("git", args, { cwd: root, windowsHide: true });
  const recorder = createWorkspaceChangeRecorder(root);
  try {
    await git("init");
    await writeFile(join(root, ".gitignore"), "ignored.txt\n");
    await recorder.beforeMutation("ignored.txt"); await writeFile(join(root, "ignored.txt"), "ignored but edited\n");
    await recorder.beforeMutation("image.bin"); await writeFile(join(root, "image.bin"), Buffer.from([0, 1, 2]));
    const changes = await recorder.finish();
    assert.equal(changes.total, 2);
    assert.equal(changes.files.find(file => file.path === "ignored.txt").added, 1);
    assert.equal(changes.files.find(file => file.path === "image.bin").binary, true);
  } finally { await recorder.dispose(); await rm(root, { recursive: true, force: true }); }
});
