import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  formatSystemPathResult,
  isPathInsideWorkspace,
  resolveSystemPath,
} from "../electron/workspace-access.mjs";

test("read paths may resolve outside the active workspace", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "renge-workspace-access-"));
  try {
    const outsidePath = resolve(workspaceRoot, "..", "reference.txt");

    assert.equal(resolveSystemPath(workspaceRoot, "src/app.ts"), join(workspaceRoot, "src", "app.ts"));
    assert.equal(resolveSystemPath(workspaceRoot, outsidePath), outsidePath);
    assert.equal(resolveSystemPath(workspaceRoot, "../reference.txt"), outsidePath);
    assert.equal(isPathInsideWorkspace(workspaceRoot, join(workspaceRoot, "src")), true);
    assert.equal(isPathInsideWorkspace(workspaceRoot, outsidePath), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("an absolute path can be read before a workspace is selected", () => {
  const absolutePath = join(resolve(tmpdir()), "reference.txt");

  assert.equal(resolveSystemPath(null, absolutePath), absolutePath);
  assert.throws(
    () => resolveSystemPath(null, "reference.txt"),
    /请提供绝对路径/,
  );
});

test("system results stay relative inside the workspace and absolute outside it", () => {
  const workspaceRoot = join(resolve(tmpdir()), "renge-workspace");
  const insidePath = join(workspaceRoot, "docs", "guide.md");
  const outsidePath = join(dirname(workspaceRoot), "shared", "guide.md");

  assert.equal(formatSystemPathResult(workspaceRoot, insidePath), "docs/guide.md");
  assert.equal(formatSystemPathResult(workspaceRoot, outsidePath), outsidePath);
});
