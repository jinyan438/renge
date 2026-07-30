import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  importTemporaryFiles,
  listSidebarFiles,
  readSidebarBinaryFile,
  readSidebarTextFile,
  resolveSidebarFilePath,
} from "../electron/sidebar-files.mjs";

test("lists one directory level with workspace-relative paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-sidebar-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "README.md"), "# Renge", "utf8");
  await writeFile(join(root, "src", "app.ts"), "export {};", "utf8");

  const rootResult = await listSidebarFiles(root);
  assert.deepEqual(rootResult.entries.map(({ path, kind }) => ({ path, kind })), [
    { path: "src", kind: "directory" },
    { path: "README.md", kind: "file" },
  ]);

  const childResult = await listSidebarFiles(root, "src");
  assert.deepEqual(childResult.entries.map(({ path, kind }) => ({ path, kind })), [
    { path: "src/app.ts", kind: "file" },
  ]);
});

test("keeps sidebar paths inside the selected root", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-sidebar-root-"));
  try {
    assert.equal(resolveSidebarFilePath(root, "src/app.ts"), join(root, "src", "app.ts"));
    assert.throws(() => resolveSidebarFilePath(root, "../outside.txt"), /超出文件浏览范围/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads bounded text previews and binary image data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-sidebar-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "large.txt"), "abcdefghij", "utf8");
  await writeFile(join(root, "pixel.bin"), Buffer.from([0, 1, 2, 255]));

  const textResult = await readSidebarTextFile(root, "large.txt", 5);
  assert.equal(textResult.content, "abcde");
  assert.equal(textResult.truncated, true);
  assert.equal(textResult.size, 10);

  const binaryResult = await readSidebarBinaryFile(root, "pixel.bin");
  assert.equal(binaryResult.base64, Buffer.from([0, 1, 2, 255]).toString("base64"));
});

test("imports duplicate temporary files without overwriting", async (t) => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "renge-sidebar-source-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "renge-sidebar-target-"));
  t.after(async () => {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(targetRoot, { recursive: true, force: true });
  });
  const sourcePath = join(sourceRoot, "notes.md");
  await writeFile(sourcePath, "temporary", "utf8");

  const first = await importTemporaryFiles(targetRoot, [sourcePath]);
  const second = await importTemporaryFiles(targetRoot, [sourcePath]);
  assert.equal(first[0].path, "notes.md");
  assert.equal(second[0].path, "notes (2).md");
});
