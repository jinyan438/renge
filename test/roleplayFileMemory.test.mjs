import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemoryTools as createTools, memoryPath, memoryScope, normalizeRoleplayFileMemory,
  recentRoleplayBody, reconcileMemoryHistory, recordMemoryRevision, runMemoryAgent, writeMemoryFile } from "../src/roleplayFileMemory.ts";
import { workspaceFileOperation } from "../workspace-files-store.mjs";
import { commitMemoryFiles, loadMemoryFiles, prepareMemoryFileTool, roleplayMemoryRoot } from "../src/roleplayMemoryStorage.ts";

import { executeMemoryCodingTool } from "../pi/memory-file-tools.mjs";
import { CODING_FILE_TOOL_DEFINITIONS } from "../src/codingFileTools.ts";
import { createReadToolDefinition, createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { createResumableWriteTool } from "../pi/resumable-write-tool.mjs";
const signal = new AbortController().signal;
const executeCodingTool = (name, args, content, initialized, signal) => executeMemoryCodingTool({ name, args, content, initialized }, signal);
const createMemoryTools = (memory, writable, history = []) => createTools(memory, writable, history, executeCodingTool, signal);

const scope = memoryScope("workspace-a", "session-a");
const fresh = () => normalizeRoleplayFileMemory(null, scope);
const message = (id, content = id, role = "assistant") => ({ id, role, content });
const call = (name, args) => ({ id: `call-${name}`, type: "function", function: { name, arguments: JSON.stringify(name === "write" ? { operation: "overwrite", expected_bytes: 0, ...args } : args) } });
const reply = (calls = [], content = "READY") => ({ content, toolCalls: calls, finishReason: "stop" });

test("memory file calls use the application's coding tool argument contracts", () => {
  const stripDescriptions = value => JSON.parse(JSON.stringify(value, (key, value) => key === "description" ? undefined : value));
  const native = [createReadToolDefinition(process.cwd()), createEditToolDefinition(process.cwd()), createResumableWriteTool(process.cwd())];
  for (const tool of native) {
    const definition = CODING_FILE_TOOL_DEFINITIONS.find(definition => definition.function.name === tool.name);
    assert.deepEqual(stripDescriptions(definition.function.parameters), stripDescriptions(tool.parameters));
  }
  const definitions = createMemoryTools(fresh(), true).definitions.map(tool => tool.function.name);
  assert.ok(["read", "edit", "write"].every(name => definitions.includes(name)));
  assert.ok(!definitions.some(name => /^memory_(read|write|edit)$/.test(name)));
});

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

test("history is searched and read on demand without creating transcript files", async () => {
  const memory = fresh();
  const tools = createMemoryTools(memory, false, [message("old", "旧港口的钥匙在阿莉娅手中", "user"), message("new")]);
  assert.deepEqual((await tools.execute("memory_list", {})).entries, []);
  const hit = (await tools.execute("memory_history_search", { query: "钥匙" })).matches[0];
  assert.equal(hit.id, "old");
  assert.equal(hit.turn, 1);
  assert.equal(hit.role, "user");
  assert.equal(tools.context(), "", "search snippets are not automatically injected into prose");
  await tools.execute("memory_history_read", { id: hit.id });
  assert.match(tools.context(), /旧港口/);
  assert.match(tools.context(), /第 1 条 · 用户/);
  await assert.rejects(async () => await tools.execute("write", { path: "人物/a.md", content: "x" }), /只允许检索/);
  assert.equal(Object.keys(memory.files).length, 0);
  assert.deepEqual(memory.directories, []);
  const regenerated = createMemoryTools(memory, false, [message("new")]);
  assert.equal((await regenerated.execute("memory_history_search", { query: "钥匙" })).total, 0);
  await assert.rejects(async () => await regenerated.execute("memory_history_read", { id: "old" }), /不存在/);
});

test("history lookup excludes hidden, tool, failed and other-session turns", async () => {
  const tools = createMemoryTools(fresh(), false, [message("visible", "钥匙在铜门边"),
    { ...message("hidden", "钥匙秘密"), hidden: true }, { ...message("tool", "钥匙工具"), toolVisualization: {} },
    { ...message("failed", "钥匙错误"), outputStatus: "error" }, message("system", "钥匙规则", "system"),
    { ...message("partial", "尚未确认的钥匙去向"), outputStatus: "incomplete" }]);
  assert.deepEqual((await tools.execute("memory_history_search", { query: "钥匙" })).matches.map(hit => hit.id), ["visible", "partial"]);
  for (const id of ["hidden", "tool", "failed", "system", "other-session"]) {
    await assert.rejects(async () => await tools.execute("memory_history_read", { id }), /不存在/);
  }
  assert.match((await tools.execute("memory_history_read", { id: "partial" })).content, /未完成.*不能当作已确认剧情/);
});

test("legacy transcript files stay readable and are preserved without new copies", async () => {
  const path = "剧情原文/000001-scene.md";
  const memory = normalizeRoleplayFileMemory({ ...fresh(), files: {
    [path]: { content: "用户更正：钟楼", updatedAt: "old", userEdited: true },
  } }, scope);
  const tools = createMemoryTools(memory, true);
  assert.equal((await tools.execute("memory_list", {})).entries[0].readOnly, true);
  assert.equal((await tools.execute("read", { path })).content, "用户更正：钟楼");
  await assert.rejects(async () => await tools.execute("edit", { path, edits: [{ oldText: "钟楼", newText: "港口" }] }), /只读/);
  await runMemoryAgent({ executeCodingTool, memory, writable: true, history: [message("new", "新正文")], reference: "新正文",
    signal: new AbortController().signal, request: async () => reply([], "NO_CHANGES") });
  assert.deepEqual(Object.keys(memory.files), [path]);
  assert.equal(memory.files[path].content, "用户更正：钟楼");
});

test("nested Markdown edits require reading and preserve unrelated facts", async () => {
  const memory = fresh();
  writeMemoryFile(memory, "财产/用户/金钱.md", "金币：10\n装备：银剑");
  const tools = createMemoryTools(memory, true);
  await assert.rejects(async () => await tools.execute("write", { path: "财产/用户/金钱.md", content: "金币：9" }), /完整读取/);
  await tools.execute("read", { path: "财产/用户/金钱.md", offset: 1, limit: 1 });
  await assert.rejects(async () => await tools.execute("write", { path: "财产/用户/金钱.md", content: "金币：9" }), /完整读取/);
  await tools.execute("edit", { path: "财产/用户/金钱.md", edits: [{ oldText: "金币：10", newText: "金币：9" }] });
  assert.equal(memory.files["财产/用户/金钱.md"].content, "金币：9\n装备：银剑");
  await tools.execute("memory_move", { from: "财产/用户/金钱.md", to: "物品/钱包/金币.md" });
  assert.equal(memory.files["财产/用户/金钱.md"], undefined);
  assert.match(memory.files["物品/钱包/金币.md"].content, /装备/);
});

test("paths are sandboxed and legacy archives cannot be overwritten", () => {
  for (const path of ["../secret.md", "/root.md", "C:/secret.md", "a//b.md", "a/../b.md", "a.txt", "CON.md", "a./b.md", "a\u0000.md"]) assert.throws(() => memoryPath(path));
  const memory = fresh();
  assert.throws(() => writeMemoryFile(memory, "剧情原文/x.md", "fake"), /只读/);
  assert.throws(() => writeMemoryFile(memory, "a.md", "x".repeat(80_001)), /拆分/);
  writeMemoryFile(memory, "a.md", "file");
  assert.throws(() => writeMemoryFile(memory, "a.md/b.md", "bad"), /冲突/);
});

test("native edits apply disjoint replacements atomically and preserve line endings", async () => {
  const memory = fresh();
  const path = "人物/状态.md", original = "\ufeff金币：10\r\n装备：银剑\r\n位置：港口";
  writeMemoryFile(memory, path, original);
  const tools = createMemoryTools(memory, true);
  await tools.execute("read", { path });
  await assert.rejects(tools.execute("edit", { path, edits: [
    { oldText: "金币：10", newText: "金币：9" }, { oldText: "金币：1", newText: "坏的重叠替换" },
  ] }));
  assert.equal(memory.files[path].content, original);
  const edited = await tools.execute("edit", { path, edits: [
    { oldText: "金币：10", newText: "金币：9" }, { oldText: "位置：港口", newText: "位置：钟楼" },
  ] });
  assert.match(edited.details.patch, /金币：9/);
  assert.equal(memory.files[path].content, "\ufeff金币：9\r\n装备：银剑\r\n位置：钟楼");
});

test("later memory rounds apply the same edit argument preparation as the coding agent", async () => {
  const path = "人物/状态.md";
  for (const args of [
    { path, oldText: "金币：10", newText: "金币：9" },
    { path, edits: { oldText: "金币：10", newText: "金币：9" } },
    { path, edits: JSON.stringify([{ oldText: "金币：10", newText: "金币：9" }]) },
    { path, edits: JSON.stringify({ oldText: "金币：10", newText: "金币：9" }) },
  ]) {
    const memory = fresh();
    const first = createMemoryTools(memory, true);
    await first.execute("write", { path, content: "金币：10\n装备：银剑", operation: "overwrite", expected_bytes: 0 });
    const next = createMemoryTools(normalizeRoleplayFileMemory(memory, scope), true);
    await next.execute("read", { path });
    await next.execute("edit", args);
    await next.execute("read", { path });
    assert.match(next.context(), /金币：9\n装备：银剑/);
  }
});

test("native chunked writes check UTF-8 offsets and retries do not duplicate facts", async () => {
  const memory = fresh(), tools = createMemoryTools(memory, true), path = "约定/铜门.md";
  const first = await tools.execute("write", { path, content: "铜门", operation: "overwrite", expected_bytes: 0 });
  assert.equal(first.details.nextExpectedBytes, 6);
  await assert.rejects(tools.execute("write", { path, content: "坏的覆盖", operation: "overwrite", expected_bytes: 0 }), /已经初始化/);
  await assert.rejects(tools.execute("write", { path, content: "：黎明开启", operation: "append", expected_bytes: 2 }), /偏移/);
  assert.equal(memory.files[path].content, "铜门");
  const append = { path, content: "：黎明开启", operation: "append", expected_bytes: 6 };
  const written = await tools.execute("write", append);
  assert.equal(written.details.nextExpectedBytes, Buffer.byteLength("铜门：黎明开启"));
  const retry = await tools.execute("write", append);
  assert.equal(retry.details.status, "already_applied");
  assert.equal(memory.files[path].content, "铜门：黎明开启");
  await tools.execute("read", { path });
  assert.match(tools.context(), /铜门：黎明开启/);
  await tools.execute("memory_move", { from: path, to: "通行/铜门.md" });
  await tools.execute("write", { path, content: "原路径用于新约定", operation: "overwrite", expected_bytes: 0 });
  assert.equal(memory.files[path].content, "原路径用于新约定");
  await assert.rejects(tools.execute("write", { path: "通行/铜门.md", content: "重写首块", operation: "overwrite", expected_bytes: 0 }), /已经初始化/);
});

test("coding tools reject traversal, unknown operations and aborted snapshots", async () => {
  for (const path of ["../secret.md", "C:/secret.md", "a//b.md", "a.txt", "CON.md"]) {
    await assert.rejects(executeMemoryCodingTool({ name: "read", args: { path }, content: "x" }, signal));
  }
  await assert.rejects(executeMemoryCodingTool({ name: "powershell", args: { path: "a.md" }, content: "x" }, signal), /不支持/);
  for (const path of ["~/事实.md", "@/事实.md", "目录/含\u202f空格.md"]) {
    const snapshot = "仅从快照读取；snapshot.md 是正文中的普通文本。";
    const read = await executeMemoryCodingTool({ name: "read", args: { path }, content: snapshot }, signal);
    assert.equal(read.result.content[0].text, snapshot, "Pi aliases must never resolve outside the staged snapshot");
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(executeMemoryCodingTool({ name: "read", args: { path: "a.md" }, content: "x" }, controller.signal), /abort/i);
});

test("reads are bounded even for large files", async () => {
  const memory = fresh();
  writeMemoryFile(memory, "长篇.md", Array(700).fill("x".repeat(99)).join("\n"));
  const tools = createMemoryTools(memory, false);
  assert.equal((await tools.execute("read", { path: "长篇.md" })).content.length, 12_000);
  for (let i = 0; i < 3; i++) await tools.execute("read", { path: "长篇.md" });
  await assert.rejects(async () => await tools.execute("read", { path: "长篇.md" }), /预算/);
});

test("history and file reads share the same bounded retrieval budget", async () => {
  const memory = fresh(); writeMemoryFile(memory, "参考.md", "f".repeat(20_000));
  const tools = createMemoryTools(memory, false, [message("long", "h".repeat(70_000))]);
  assert.equal((await tools.execute("memory_history_read", { id: "long" })).content.length, 12_000);
  assert.equal((await tools.execute("read", { path: "参考.md" })).content.length, 12_000);
  await tools.execute("memory_history_read", { id: "long" });
  assert.equal((await tools.execute("memory_history_read", { id: "long" })).content.length, 4_000);
  await assert.rejects(async () => await tools.execute("read", { path: "参考.md" }), /预算/);
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
  const result = await runMemoryAgent({ executeCodingTool, memory, writable: false, reference: "去开门", signal: new AbortController().signal,
    request: async (messages, tools) => {
      requests.push(structuredClone(messages));
      assert.ok(tools.every(tool => !/write|edit|move|mkdir/.test(tool.function.name)));
      return requests.length === 1 ? reply([call("read", { path: "人物/阿莉娅.md" })]) : reply();
    } });
  assert.match(result, /她有钥匙/); assert.doesNotMatch(result, /不相关秘密/);
  assert.ok(!JSON.stringify(requests[0]).includes("她有钥匙"));
  assert.match(JSON.stringify(requests[1]), /她有钥匙/);
});

test("older conversations are available to the agent only through explicit history tools", async () => {
  const memory = fresh();
  const history = [message("old", "旧约定：铜门只能在黎明开启。"), message("unrelated", "不相关的漫长正文"), message("a"), message("b")];
  let round = 0;
  const context = await runMemoryAgent({ executeCodingTool, memory, writable: false, history, reference: "尝试打开铜门", signal: new AbortController().signal,
    request: async messages => {
      round++;
      assert.doesNotMatch(JSON.stringify(messages), /不相关的漫长正文/);
      if (round === 1) {
        assert.doesNotMatch(JSON.stringify(messages), /铜门只能在黎明开启/);
        return reply([call("memory_history_search", { query: "铜门" })]);
      }
      if (round === 2) {
        const result = JSON.parse(messages.at(-1).content);
        return reply([call("memory_history_read", { id: result.matches[0].id })]);
      }
      return reply();
    } });
  assert.match(context, /铜门只能在黎明开启/);
  assert.equal(Object.keys(memory.files).length, 0);
});

test("failed or cancelled write drafts can be discarded atomically", async () => {
  const memory = fresh(); const draft = normalizeRoleplayFileMemory(memory, scope);
  let round = 0;
  await assert.rejects(runMemoryAgent({ executeCodingTool, memory: draft, writable: true, reference: "新的剧情", signal: new AbortController().signal,
    request: async () => ++round === 1 ? reply([call("write", { path: "人物/新角色.md", content: "新角色" })]) : { ...reply(), finishReason: "length" },
  }), /截断/);
  assert.equal(Object.keys(memory.files).length, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runMemoryAgent({ executeCodingTool, memory, writable: true, reference: "", signal: controller.signal, request: async () => reply() }), /abort/i);
});

test("ignoring tools is reported and explicit no-change is accepted", async () => {
  const memory = fresh(); writeMemoryFile(memory, "人物.md", "事实");
  await assert.rejects(runMemoryAgent({ executeCodingTool, memory, writable: false, reference: "", signal: new AbortController().signal, request: async () => reply() }), /未读取/);
  await assert.rejects(runMemoryAgent({ executeCodingTool, memory, writable: true, reference: "", signal: new AbortController().signal, request: async () => reply() }), /未保存/);
  await runMemoryAgent({ executeCodingTool, memory, writable: true, reference: "", signal: new AbortController().signal, request: async () => reply([], "NO_CHANGES") });
});

test("a later edit can recover by rereading and retrying after a premature confirmation", async () => {
  const memory = fresh(); writeMemoryFile(memory, "人物.md", "位置：港口");
  let round = 0;
  await runMemoryAgent({ executeCodingTool, memory, writable: true, reference: "位置改为钟楼", signal,
    request: async messages => {
      if (++round === 1) return reply([call("edit", { path: "人物.md", edits: [{ oldText: "港口", newText: "钟楼" }] })]);
      if (round === 2) return reply([], "NO_CHANGES");
      if (round === 3) {
        assert.match(messages.at(-1).content, /edit（人物.md）.*必须先 read/);
        return reply([call("read", { path: "人物.md" }), call("edit", { path: "人物.md", oldText: "港口", newText: "钟楼" })]);
      }
      return reply();
    } });
  assert.equal(memory.files["人物.md"].content, "位置：钟楼");
});

test("unresolved edits retain their cause and are not hidden by another successful tool", async () => {
  const base = fresh(); writeMemoryFile(base, "人物.md", "位置：港口");
  const draft = normalizeRoleplayFileMemory(base, scope);
  let round = 0;
  await assert.rejects(runMemoryAgent({ executeCodingTool, memory: draft, writable: true, reference: "", signal,
    request: async () => ++round === 1 ? reply([
      call("read", { path: "人物.md" }),
      call("edit", { path: "人物.md", edits: [{ oldText: "并不存在的旧事实", newText: "钟楼" }] }),
      call("memory_list", {}),
    ]) : reply([], "NO_CHANGES"),
  }), error => {
    assert.match(error.message, /文件记忆工具未完成.*edit（人物.md）/);
    assert.match(error.message, /Could not find|exact text|匹配/);
    assert.match(error.message, /原有文件已保留/);
    return true;
  });
  assert.equal(round, 4, "two bounded correction opportunities follow the failed tool call");
  assert.equal(base.files["人物.md"].content, "位置：港口");
  assert.equal(draft.files["人物.md"].content, "位置：港口");
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
    await prepareMemoryFileTool(tracked, "session-a", draft, baseline, "read", { path: "人物/守门人.md" });
    assert.equal(draft.files["人物/守门人.md"].content, "磁盘修改后的内容");
    assert.equal(baseline.files["人物/守门人.md"].content, "磁盘修改后的内容");
    assert.equal(draft.files["世界/秘密.md"].unloaded, true);
    assert.equal(reads.filter(path => path.endsWith(".md")).length, 1);
    writeMemoryFile(draft, "人物/守门人.md", "本轮修改");
    await prepareMemoryFileTool(tracked, "session-a", draft, baseline, "read", { path: "人物/守门人.md" });
    assert.equal(draft.files["人物/守门人.md"].content, "本轮修改", "subsequent tool reads see staged edits");
    await commitMemoryFiles(access, "session-a", baseline, draft);
    assert.equal(await access.read(`${roleplayMemoryRoot("session-a")}/人物/守门人.md`), "本轮修改");
  } finally { await rm(root, { recursive: true, force: true }); }
});
