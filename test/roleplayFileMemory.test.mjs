import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { archiveRoleplayMessages, createMemoryTools, memoryPath, memoryScope, normalizeRoleplayFileMemory,
  recentRoleplayBody, reconcileMemoryHistory, recordMemoryRevision, runMemoryAgent, writeMemoryFile } from "../src/roleplayFileMemory.ts";
import { workspaceFileOperation } from "../workspace-files-store.mjs";
import { commitMemoryFiles, loadMemoryFiles, prepareMemoryFileTool, roleplayMemoryRoot } from "../src/roleplayMemoryStorage.ts";

const scope = memoryScope("workspace-a", "session-a");
const fresh = () => normalizeRoleplayFileMemory(null, scope);
const message = (id, content = id, role = "assistant") => ({ id, role, content });
const call = (name, args) => ({ id: `call-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (calls = [], content = "READY") => ({ content, toolCalls: calls, finishReason: "stop" });

test("session folder names remain distinct on case-insensitive filesystems", () => {
  assert.notEqual(roleplayMemoryRoot("A").toLowerCase(), roleplayMemoryRoot("a").toLowerCase());
  assert.notEqual(roleplayMemoryRoot("scene.").toLowerCase(), roleplayMemoryRoot("scene").toLowerCase());
  assert.ok(!roleplayMemoryRoot("../outside").split("/").includes(".."));
});

test("session/workspace scopes survive persistence and reject copied memory", () => {
  const memory = fresh();
  writeMemoryFile(memory, "人物/旅人/关系.md", "旅人欠用户一枚金币。");
  assert.equal(normalizeRoleplayFileMemory(JSON.parse(JSON.stringify(memory)), scope).files["人物/旅人/关系.md"].content, "旅人欠用户一枚金币。");
  for (const other of [memoryScope("workspace-b", "session-a"), memoryScope("workspace-a", "session-b")]) {
    assert.equal(Object.keys(normalizeRoleplayFileMemory(memory, other).files).length, 0);
  }
  assert.deepEqual(memory.directories, ["人物", "人物/旅人"]);
});

test("only three body messages count, with tools and hidden turns excluded", () => {
  const turns = [message("old"), message("u", "行动", "user"), { ...message("tool"), toolVisualization: {} },
    message("a"), { ...message("hidden"), hidden: true }, message("new", "最新行动", "user")];
  assert.deepEqual(recentRoleplayBody(turns).map(turn => turn.id), ["u", "a", "new"]);
});

test("archives are searchable on demand and remove discarded history", () => {
  const memory = archiveRoleplayMessages(fresh(), [message("old", "旧港口的钥匙在阿莉娅手中"), message("new")]);
  const tools = createMemoryTools(memory, false);
  assert.deepEqual(tools.execute("memory_list", {}).entries.map(entry => entry.path), ["剧情原文"]);
  const hit = tools.execute("memory_search", { query: "钥匙" }).matches[0];
  assert.ok(hit.path.endsWith("old.md"));
  assert.equal(tools.context(), "", "search snippets are not automatically injected into prose");
  tools.execute("memory_read", { path: hit.path });
  assert.match(tools.context(), /旧港口/);
  assert.throws(() => tools.execute("memory_write", { path: "人物/a.md", content: "x" }), /只允许检索/);
  archiveRoleplayMessages(memory, [message("new")]);
  assert.equal(Object.values(memory.files).some(file => file.content.includes("钥匙")), false);
});

test("file-sidebar edits to an archive are kept when history is archived again", () => {
  const memory = archiveRoleplayMessages(fresh(), [message("scene", "旧港口")]);
  const path = Object.keys(memory.files)[0];
  memory.files[path] = { ...memory.files[path], content: "用户更正：钟楼", userEdited: true };
  archiveRoleplayMessages(memory, [message("scene", "旧港口")]);
  assert.equal(memory.files[path].content, "用户更正：钟楼");
});

test("nested Markdown edits require reading and preserve unrelated facts", () => {
  const memory = fresh();
  writeMemoryFile(memory, "财产/用户/金钱.md", "金币：10\n装备：银剑");
  const tools = createMemoryTools(memory, true);
  assert.throws(() => tools.execute("memory_write", { path: "财产/用户/金钱.md", content: "金币：9" }), /完整读取/);
  tools.execute("memory_read", { path: "财产/用户/金钱.md", startLine: 1, lineCount: 1 });
  assert.throws(() => tools.execute("memory_write", { path: "财产/用户/金钱.md", content: "金币：9" }), /完整读取/);
  tools.execute("memory_edit", { path: "财产/用户/金钱.md", oldText: "金币：10", newText: "金币：9" });
  assert.equal(memory.files["财产/用户/金钱.md"].content, "金币：9\n装备：银剑");
  tools.execute("memory_move", { from: "财产/用户/金钱.md", to: "物品/钱包/金币.md" });
  assert.equal(memory.files["财产/用户/金钱.md"], undefined);
  assert.match(memory.files["物品/钱包/金币.md"].content, /装备/);
});

test("paths are sandboxed and raw archives cannot be overwritten", () => {
  for (const path of ["../secret.md", "/root.md", "C:/secret.md", "a//b.md", "a/../b.md", "a.txt", "CON.md", "a./b.md", "a\u0000.md"]) assert.throws(() => memoryPath(path));
  const memory = fresh();
  assert.throws(() => writeMemoryFile(memory, "剧情原文/x.md", "fake"), /应用维护/);
  assert.throws(() => writeMemoryFile(memory, "a.md", "x".repeat(80_001)), /拆分/);
  writeMemoryFile(memory, "a.md", "file");
  assert.throws(() => writeMemoryFile(memory, "a.md/b.md", "bad"), /冲突/);
});

test("reads are bounded even for large files", () => {
  const memory = fresh();
  writeMemoryFile(memory, "长篇.md", "x".repeat(70_000));
  const tools = createMemoryTools(memory, false);
  assert.equal(tools.execute("memory_read", { path: "长篇.md" }).content.length, 12_000);
  for (let i = 0; i < 3; i++) tools.execute("memory_read", { path: "长篇.md" });
  assert.throws(() => tools.execute("memory_read", { path: "长篇.md" }), /预算/);
});

test("regeneration rolls back AI facts while protecting manual file edits", () => {
  const base = fresh();
  writeMemoryFile(base, "钱.md", "10金币");
  const changed = normalizeRoleplayFileMemory(base, scope);
  writeMemoryFile(changed, "钱.md", "9金币");
  writeMemoryFile(changed, "地点.md", "酒馆");
  recordMemoryRevision(base, changed, [message("story", "买酒")]);
  const normal = normalizeRoleplayFileMemory(changed, scope);
  reconcileMemoryHistory(normal, [message("story", "买酒")]);
  assert.equal(normal.files["钱.md"].content, "9金币");
  writeMemoryFile(changed, "地点.md", "手动设定：花园");
  reconcileMemoryHistory(changed, [message("story", "没有买酒")]);
  assert.equal(changed.files["钱.md"].content, "10金币");
  assert.equal(changed.files["地点.md"].content, "手动设定：花园");
  assert.equal(changed.revisions.length, 0);
});

test("continuation amends the source turn and remains reversible as one branch", () => {
  const base = fresh(); writeMemoryFile(base, "钱.md", "10金币");
  const first = normalizeRoleplayFileMemory(base, scope); writeMemoryFile(first, "钱.md", "9金币");
  recordMemoryRevision(base, first, [message("turn", "买了一杯酒。")]);
  const continued = normalizeRoleplayFileMemory(first, scope); writeMemoryFile(continued, "地点.md", "钟楼");
  recordMemoryRevision(first, continued, [message("turn", "买了一杯酒。然后来到钟楼。")]);
  reconcileMemoryHistory(continued, [message("turn", "买了一杯酒。然后来到钟楼。")]);
  assert.equal(continued.files["钱.md"].content, "9金币");
  assert.equal(continued.files["地点.md"].content, "钟楼");
  reconcileMemoryHistory(continued, []);
  assert.equal(continued.files["钱.md"].content, "10金币");
  assert.equal(continued.files["地点.md"], undefined);
});

test("agent loop retrieves only tool-read data and uses a separate write phase", async () => {
  const memory = fresh(); writeMemoryFile(memory, "人物/阿莉娅.md", "她有钥匙"); writeMemoryFile(memory, "世界/秘密.md", "不相关秘密");
  const requests = [];
  const result = await runMemoryAgent({ memory, writable: false, reference: "去开门", signal: new AbortController().signal,
    request: async (messages, tools) => {
      requests.push(structuredClone(messages));
      assert.ok(tools.every(tool => !/write|edit|move|mkdir/.test(tool.function.name)));
      return requests.length === 1 ? reply([call("memory_read", { path: "人物/阿莉娅.md" })]) : reply();
    } });
  assert.match(result, /她有钥匙/); assert.doesNotMatch(result, /不相关秘密/);
  assert.ok(!JSON.stringify(requests[0]).includes("她有钥匙"));
  assert.match(JSON.stringify(requests[1]), /她有钥匙/);
});

test("failed or cancelled write drafts can be discarded atomically", async () => {
  const memory = fresh(); const draft = normalizeRoleplayFileMemory(memory, scope);
  let round = 0;
  await assert.rejects(runMemoryAgent({ memory: draft, writable: true, reference: "新的剧情", signal: new AbortController().signal,
    request: async () => ++round === 1 ? reply([call("memory_write", { path: "人物/新角色.md", content: "新角色" })]) : { ...reply(), finishReason: "length" },
  }), /截断/);
  assert.equal(Object.keys(memory.files).length, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runMemoryAgent({ memory, writable: true, reference: "", signal: controller.signal, request: async () => reply() }), /abort/i);
});

test("ignoring tools is reported and explicit no-change is accepted", async () => {
  const memory = fresh(); writeMemoryFile(memory, "人物.md", "事实");
  await assert.rejects(runMemoryAgent({ memory, writable: false, reference: "", signal: new AbortController().signal, request: async () => reply() }), /未读取/);
  await assert.rejects(runMemoryAgent({ memory, writable: true, reference: "", signal: new AbortController().signal, request: async () => reply() }), /未保存/);
  await runMemoryAgent({ memory, writable: true, reference: "", signal: new AbortController().signal, request: async () => reply([], "NO_CHANGES") });
});

function fileAccess(root) {
  const operation = (operation, path, extra = {}) => workspaceFileOperation(root, { operation, path, ...extra });
  return {
    list: async path => (await operation("list", path)).entries,
    read: async path => (await operation("read", path)).content,
    mkdir: async path => { await operation("mkdir", path); },
    write: async (path, content, expectedContent) => { await operation("write", path, { content, expectedContent }); },
    remove: async (path, expectedContent) => { await operation("delete", path, { expectedContent }); },
  };
}

test("memory migrates into session workspace folders and uses physical edits as truth", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-memory-workspace-"));
  try {
    const access = fileAccess(root), memory = fresh();
    writeMemoryFile(memory, "人物/阿莉娅/身份.md", "守门人");
    const directory = join(root, roleplayMemoryRoot("session-a"));
    const loaded = await loadMemoryFiles(access, "session-a", memory);
    assert.equal(await readFile(join(directory, "人物/阿莉娅/身份.md"), "utf8"), "守门人");
    await writeFile(join(directory, "人物/阿莉娅/身份.md"), "用户通过文件模块改为骑士");
    const reloaded = await loadMemoryFiles(access, "session-a", loaded);
    assert.equal(reloaded.files["人物/阿莉娅/身份.md"].content, "用户通过文件模块改为骑士");
    await access.remove(`${roleplayMemoryRoot("session-a")}/人物/阿莉娅/身份.md`, "用户通过文件模块改为骑士");
    assert.equal((await loadMemoryFiles(access, "session-a", reloaded)).files["人物/阿莉娅/身份.md"], undefined, "deleted files must not be resurrected from session JSON");
    const b = normalizeRoleplayFileMemory(null, memoryScope("workspace-a", "session-b"));
    const other = await loadMemoryFiles(access, "session-b", b);
    assert.equal(Object.keys(other.files).length, 0);
    const second = join(root, "second-workspace"); await access.mkdir("second-workspace");
    assert.equal(Object.keys((await loadMemoryFiles(fileAccess(second), "session-a", fresh())).files).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("migration preserves existing Markdown and staged commits preserve concurrent edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-memory-conflict-"));
  try {
    const access = fileAccess(root), base = fresh(); writeMemoryFile(base, "前置.md", "原值"); writeMemoryFile(base, "人物.md", "旧缓存");
    await access.mkdir(roleplayMemoryRoot("session-a"));
    await access.write(`${roleplayMemoryRoot("session-a")}/人物.md`, "已有磁盘内容", null);
    const loaded = await loadMemoryFiles(access, "session-a", base);
    assert.equal(loaded.files["人物.md"].content, "已有磁盘内容");
    const draft = normalizeRoleplayFileMemory(loaded, scope);
    writeMemoryFile(draft, "前置.md", "写入一半的内容");
    writeMemoryFile(draft, "新文件.md", "本轮新事实"); writeMemoryFile(draft, "人物.md", "AI更新");
    await access.write(`${roleplayMemoryRoot("session-a")}/人物.md`, "生成期间的手动编辑", "已有磁盘内容");
    await assert.rejects(commitMemoryFiles(access, "session-a", loaded, draft), /已被修改/);
    assert.equal(await access.read(`${roleplayMemoryRoot("session-a")}/人物.md`), "生成期间的手动编辑");
    assert.equal(await access.read(`${roleplayMemoryRoot("session-a")}/前置.md`), "原值", "partial writes roll back without touching the concurrent edit");
    await assert.rejects(access.read(`${roleplayMemoryRoot("session-a")}/新文件.md`), /不存在/);
    await assert.rejects(access.write("../escape.md", "bad", null), /越出/);
    const outside = await mkdtemp(join(tmpdir(), "renge-memory-outside-"));
    try {
      await symlink(outside, join(root, "链接"), process.platform === "win32" ? "junction" : "dir");
      await assert.rejects(access.write("链接/escape.md", "bad", null), /符号链接/);
      await assert.rejects(readFile(join(outside, "escape.md")), /ENOENT/);
    } finally { await rm(outside, { recursive: true, force: true }); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("filesystem initialization lists names and tool reads load only requested Markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-memory-lazy-"));
  try {
    const access = fileAccess(root), memory = fresh();
    writeMemoryFile(memory, "人物/守门人.md", "旧人物内容"); writeMemoryFile(memory, "世界/秘密.md", "不相关世界内容");
    const first = await loadMemoryFiles(access, "session-a", memory);
    await access.write(`${roleplayMemoryRoot("session-a")}/人物/守门人.md`, "磁盘修改后的内容", "旧人物内容");
    const reads = [];
    const tracked = { ...access, read: async path => { reads.push(path); return access.read(path); } };
    const baseline = await loadMemoryFiles(tracked, "session-a", first, true);
    assert.ok(reads.every(path => !path.endsWith(".md")), "initial discovery never reads all Markdown contents");
    const draft = normalizeRoleplayFileMemory(baseline, scope);
    await prepareMemoryFileTool(tracked, "session-a", draft, baseline, "memory_read", { path: "人物/守门人.md" });
    assert.equal(draft.files["人物/守门人.md"].content, "磁盘修改后的内容");
    assert.equal(baseline.files["人物/守门人.md"].content, "磁盘修改后的内容");
    assert.equal(draft.files["世界/秘密.md"].unloaded, true);
    assert.equal(reads.filter(path => path.endsWith(".md")).length, 1);
    writeMemoryFile(draft, "人物/守门人.md", "本轮修改");
    await prepareMemoryFileTool(tracked, "session-a", draft, baseline, "memory_read", { path: "人物/守门人.md" });
    assert.equal(draft.files["人物/守门人.md"].content, "本轮修改", "subsequent tool reads see staged edits");
    await commitMemoryFiles(access, "session-a", baseline, draft);
    assert.equal(await access.read(`${roleplayMemoryRoot("session-a")}/人物/守门人.md`), "本轮修改");
  } finally { await rm(root, { recursive: true, force: true }); }
});
