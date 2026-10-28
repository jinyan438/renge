import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startRengeServer } from "./piTestServer.mjs";
import { deleteMemoryFiles, httpWorkspaceFileAccess, loadMemoryFiles, roleplayMemoryRoot } from "../src/roleplayMemoryStorage.ts";
import { memoryScope, normalizeRoleplayFileMemory, writeMemoryFile } from "../src/roleplayFileMemory.ts";

test("workspace and temporary storage isolate writes and scoped directory cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-memory-http-"));
  const workspace = join(root, "project"), temporary = join(root, "temporary"), dataDir = join(root, "data");
  await mkdir(workspace);
  const server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir, temporaryFilesRoot: temporary });
  try {
    const projectAccess = httpWorkspaceFileAccess({ baseUrl: server.url, scope: "workspace", workspacePath: workspace });
    const temporaryAccess = httpWorkspaceFileAccess({ baseUrl: server.url, scope: "temporary" });
    const makeMemory = (key, content, id = "scene") => {
      const memory = normalizeRoleplayFileMemory(null, memoryScope(key, id));
      writeMemoryFile(memory, "人物/角色.md", content); return memory;
    };
    await loadMemoryFiles(projectAccess, "scene", makeMemory(workspace, "项目人物"), false, "守门人-记忆");
    await loadMemoryFiles(temporaryAccess, "scene", makeMemory("default", "临时人物"), false, "守门人-记忆");
    const path = `${roleplayMemoryRoot("scene", "守门人-记忆")}/人物/角色.md`;
    assert.equal(await readFile(join(workspace, path), "utf8"), "项目人物");
    assert.equal(await readFile(join(temporary, path), "utf8"), "临时人物");
    await projectAccess.write(path, "右侧栏的手动修改", "项目人物");
    await assert.rejects(projectAccess.write(path, "旧缓存覆盖", "项目人物"), /已被修改/);
    assert.equal(await projectAccess.read(path), "右侧栏的手动修改");
    assert.equal(await temporaryAccess.read(path), "临时人物");
    await assert.rejects(projectAccess.write("../escape.md", "bad", null), /越出/);
    const preflight = await fetch(`${server.url}/api/workspace-files`, { method: "OPTIONS" });
    assert.ok(preflight.ok, "remote workspaces can perform CORS preflight");
    await assert.rejects(readFile(join(dataDir, "roleplay-memory", path)), /ENOENT/);
    await writeFile(join(workspace, "keep.txt"), "工作区文件");
    await loadMemoryFiles(projectAccess, "neighbor", makeMemory(workspace, "其他会话", "neighbor"));
    const neighbor = `${roleplayMemoryRoot("neighbor")}/人物/角色.md`;
    await projectAccess.mkdir(`${roleplayMemoryRoot("scene")}/空目录/子目录`);
    await projectAccess.write(`${roleplayMemoryRoot("scene")}/附件.bin`, "一并清理", null);
    await assert.rejects(deleteMemoryFiles(projectAccess, "scene", memoryScope("other-workspace", "scene")), /属于其他/);
    assert.equal(await projectAccess.read(path), "右侧栏的手动修改");
    await deleteMemoryFiles(projectAccess, "scene", memoryScope(workspace, "scene"));
    await assert.rejects(access(join(workspace, roleplayMemoryRoot("scene"))), /ENOENT/);
    await assert.rejects(access(join(workspace, "守门人-记忆")), /ENOENT/);
    assert.equal(await projectAccess.read(neighbor), "其他会话");
    assert.equal(await temporaryAccess.read(path), "临时人物", "matching session IDs in another workspace are untouched");
    assert.equal(await readFile(join(workspace, "keep.txt"), "utf8"), "工作区文件");
    await deleteMemoryFiles(projectAccess, "scene", memoryScope(workspace, "scene"));
    await deleteMemoryFiles(projectAccess, "neighbor", memoryScope(workspace, "neighbor"));
    await assert.rejects(access(join(workspace, "角色记忆")), /ENOENT/, "the shared parent is removed only when empty");
    await assert.rejects(projectAccess.removeDirectory(""), /子目录/);
    await assert.rejects(projectAccess.removeDirectory("../outside"), /越出/);
    await assert.rejects(projectAccess.removeDirectory("keep.txt"), /必须是目录/);
    const outside = join(root, "outside"); await mkdir(outside); await writeFile(join(outside, "keep.txt"), "outside");
    await symlink(outside, join(workspace, "linked"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(projectAccess.removeDirectory("linked"), /符号链接/);
    assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "outside");
  } finally {
    server.server.closeAllConnections();
    await new Promise(resolve => server.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
