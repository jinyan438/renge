import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startRengeServer } from "./piTestServer.mjs";
import { httpWorkspaceFileAccess, loadMemoryFiles, roleplayMemoryRoot } from "../src/roleplayMemoryStorage.ts";
import { memoryScope, normalizeRoleplayFileMemory, writeMemoryFile } from "../src/roleplayFileMemory.ts";

test("workspace and temporary HTTP storage use distinct real roots and reject stale saves", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-memory-http-"));
  const workspace = join(root, "project"), temporary = join(root, "temporary"), dataDir = join(root, "data");
  await mkdir(workspace);
  const server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir, temporaryFilesRoot: temporary });
  try {
    const projectAccess = httpWorkspaceFileAccess({ baseUrl: server.url, scope: "workspace", workspacePath: workspace });
    const temporaryAccess = httpWorkspaceFileAccess({ baseUrl: server.url, scope: "temporary" });
    const makeMemory = (key, content) => {
      const memory = normalizeRoleplayFileMemory(null, memoryScope(key, "scene"));
      writeMemoryFile(memory, "人物/角色.md", content); return memory;
    };
    await loadMemoryFiles(projectAccess, "scene", makeMemory(workspace, "项目人物"));
    await loadMemoryFiles(temporaryAccess, "scene", makeMemory("default", "临时人物"));
    const path = `${roleplayMemoryRoot("scene")}/人物/角色.md`;
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
  } finally {
    server.server.closeAllConnections();
    await new Promise(resolve => server.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
