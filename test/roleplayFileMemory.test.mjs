import assert from "node:assert/strict";
import test from "node:test";
import { access as pathAccess, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemoryTools as createTools, memoryPath, memoryScope, normalizeRoleplayFileMemory,
  recentRoleplayBody, reconcileMemoryHistory, recordMemoryRevision, runMemoryAgent, writeMemoryFile } from "../src/roleplayFileMemory.ts";
import { workspaceFileOperation } from "../workspace-files-store.mjs";
import { commitMemoryFiles, deleteMemoryFiles, loadMemoryFiles, prepareMemoryFileTool, roleplayMemoryDirectory, roleplayMemoryRoot } from "../src/roleplayMemoryStorage.ts";

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

test("character memory folders use readable names and separate colliding card names", () => {
  assert.equal(roleplayMemoryDirectory({ id: "a", name: "守门人" }), "守门人-记忆");
  assert.equal(roleplayMemoryRoot("scene", "守门人-记忆"), "守门人-记忆/会话-scene");
  const cards = [{ id: "a", name: "Alice" }, { id: "b", name: "alice" }, { id: "c", name: "A/B" }, { id: "d", name: "A:B" }];
  assert.equal(new Set(cards.map(card => roleplayMemoryDirectory(card, cards).toLowerCase())).size, cards.length);
  for (const name of ["../危险:/角色*", "CON.md", "  ", "角色".repeat(200)]) {
    const directory = roleplayMemoryDirectory({ id: "a", name });
    assert.equal(memoryPath(directory, true), directory);
    assert.ok(!directory.includes("/"));
    assert.ok(directory.endsWith("-记忆"));
  }
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

test("reading a memory directory lists paths without loading or counting file bodies", async () => {
  const memory = fresh();
  writeMemoryFile(memory, "人物/队友/守门人.md", "铜钥匙只由守门人持有");
  memory.directories.push("空目录", "带扩展名.md");
  let nativeCalls = 0;
  const tools = createTools(memory, true, [], async (...args) => { nativeCalls++; return executeCodingTool(...args); }, signal);
  for (const path of ["人物/队友", "人物/队友/", "人物\\队友"]) {
    const listing = await tools.execute("read", { path });
    assert.equal(listing.kind, "directory");
    assert.equal(listing.path, "人物/队友");
    assert.deepEqual(listing.entries, [{ path: "人物/队友/守门人.md", kind: "file" }]);
    assert.doesNotMatch(JSON.stringify(listing), /铜钥匙只由守门人持有/);
  }
  assert.deepEqual((await tools.execute("read", { path: "空目录" })).entries, []);
  assert.equal((await tools.execute("read", { path: "带扩展名.md" })).kind, "directory");
  for (const path of ["", ".", "./"]) assert.equal((await tools.execute("read", { path })).kind, "directory");
  assert.equal(nativeCalls, 0);
  assert.equal(tools.context(), "", "listing paths must not count as reading facts");
  await assert.rejects(tools.execute("edit", { path: "人物/队友/守门人.md", edits: [{ oldText: "铜钥匙", newText: "银钥匙" }] }), /必须先 read/);
  await tools.execute("read", { path: "人物/队友/守门人.md" });
  assert.equal(nativeCalls, 1);
  assert.match(tools.context(), /铜钥匙只由守门人持有/);
  for (const path of ["../人物", "/人物", "C:/人物", "人物//", "人物/../队友"]) {
    await assert.rejects(tools.execute("read", { path }), /相对路径/);
  }
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

test("empty-directory reads guide retrieval toward history instead of failing the phase", async () => {
  const memory = fresh(); memory.directories = ["人物", "人物/队友"];
  const history = [message("old", "旧约定：铜钥匙由守门人持有。"), message("a"), message("b"), message("c")];
  let round = 0;
  const context = await runMemoryAgent({ memory, writable: false, reference: "查证铜钥匙持有人", history, signal,
    executeCodingTool: async () => assert.fail("directory lookup must not invoke a native file read"),
    request: async messages => {
      if (++round === 1) return reply([call("read", { path: "人物/队友" })]);
      if (round === 2) {
        const listing = JSON.parse(messages.at(-1).content);
        assert.equal(listing.kind, "directory"); assert.deepEqual(listing.entries, []);
        return reply();
      }
      if (round === 3) {
        assert.match(messages.at(-1).content, /没有 Markdown.*memory_history_search.*memory_history_read/);
        return reply([call("memory_history_search", { query: "铜钥匙" })]);
      }
      if (round === 4) return reply([call("memory_history_read", { id: JSON.parse(messages.at(-1).content).matches[0].id })]);
      return reply();
    } });
  assert.match(context, /铜钥匙由守门人持有/);
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

test("a wrong file lookup recovers after actual facts are read from another path or history", async () => {
  for (const source of ["same-batch", "next-request", "history"]) {
    const memory = fresh(); writeMemoryFile(memory, "人物/正确.md", "位置：钟楼");
    let round = 0;
    const missing = { ...call("read", { path: "人物/拼错.md" }), id: "missing-file" };
    const recovered = source === "history" ? call("memory_history_read", { id: "old" })
      : { ...call("read", { path: "人物/正确.md" }), id: "correct-file" };
    const context = await runMemoryAgent({ executeCodingTool, memory, writable: false, reference: "查证位置", signal,
      history: [message("old", "位置：钟楼")],
      request: async () => {
        round++;
        if (round === 1) return reply(source === "same-batch" ? [missing, recovered] : [missing]);
        if (round === 2 && source !== "same-batch") return reply([recovered]);
        return reply();
      } });
    assert.match(context, /位置：钟楼/);
    assert.doesNotMatch(context, /人物\/拼错.md|文件不存在/);
    assert.equal(round, source === "same-batch" ? 2 : 3, "a corrected lookup should finish without extra repair requests");
  }
});

test("directory listings and search hits do not resolve a failed fact read", async () => {
  const memory = fresh(); writeMemoryFile(memory, "人物/正确.md", "位置：钟楼");
  let round = 0;
  await assert.rejects(runMemoryAgent({ executeCodingTool, memory, writable: false, reference: "查证位置", signal,
    request: async () => ++round === 1 ? reply([
      call("read", { path: "人物/拼错.md" }), call("read", { path: "人物" }), call("memory_search", { query: "钟楼" }),
    ]) : reply(),
  }), /文件记忆工具未完成.*read（人物\/拼错.md）/);
});

test("unresolved edits retain their cause and are not hidden by another successful tool", async () => {
  const base = fresh(); writeMemoryFile(base, "人物.md", "位置：港口");
  const draft = normalizeRoleplayFileMemory(base, scope);
  let round = 0;
  await assert.rejects(runMemoryAgent({ executeCodingTool, memory: draft, writable: true, reference: "", signal,
    request: async () => ++round === 1 ? reply([
      call("read", { path: "人物.md" }),
      call("edit", { path: "人物.md", edits: [{ oldText: "并不存在的旧事实", newText: "钟楼" }] }),
      call("read", { path: "人物.md" }),
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
    removeDirectory: async path => { await operation("deleteDirectory", path); },
    removeEmptyDirectory: async path => { await operation("pruneDirectory", path); },
  };
}

test("legacy memory migrates by character, survives renames, and cleans up only its own session", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-memory-character-"));
  try {
    const access = fileAccess(root), base = fresh(); writeMemoryFile(base, "人物/状态.md", "旧缓存");
    const legacy = await loadMemoryFiles(access, "session-a", base);
    const neighbor = normalizeRoleplayFileMemory(null, memoryScope("workspace-a", "session-b"));
    writeMemoryFile(neighbor, "人物/状态.md", "其他角色的记忆");
    await loadMemoryFiles(access, "session-b", neighbor);
    await access.write(`${roleplayMemoryRoot("session-a")}/人物/状态.md`, "磁盘手动更正", "旧缓存");
    await access.mkdir(`${roleplayMemoryRoot("session-a")}/空目录/子目录`);
    const migrated = await loadMemoryFiles(access, "session-a", legacy, false, "守门人-记忆");
    assert.equal(migrated.files["人物/状态.md"].content, "磁盘手动更正");
    assert.equal(migrated.storageDirectory, "守门人-记忆");
    assert.equal(normalizeRoleplayFileMemory(JSON.parse(JSON.stringify(migrated)), scope).storageDirectory, "守门人-记忆");
    assert.equal(normalizeRoleplayFileMemory(migrated, memoryScope("other", "session-a")).storageDirectory, undefined);
    await pathAccess(join(root, roleplayMemoryRoot("session-a", "守门人-记忆"), "空目录/子目录"));
    await assert.rejects(pathAccess(join(root, roleplayMemoryRoot("session-a"))), /ENOENT/);
    assert.equal(await access.read(`${roleplayMemoryRoot("session-b")}/人物/状态.md`), "其他角色的记忆");
    const other = await loadMemoryFiles(access, "session-b", neighbor, false, "旅人-记忆");
    await assert.rejects(pathAccess(join(root, "角色记忆")), /ENOENT/);
    const renamed = await loadMemoryFiles(access, "session-a", migrated, true, "钟楼守卫-记忆");
    await assert.rejects(pathAccess(join(root, "守门人-记忆")), /ENOENT/);
    await prepareMemoryFileTool(access, "session-a", renamed, renamed, "read", { path: "人物/状态.md" });
    const draft = normalizeRoleplayFileMemory(renamed, scope); writeMemoryFile(draft, "人物/状态.md", "改名后继续更新");
    await commitMemoryFiles(access, "session-a", renamed, draft);
    assert.equal(await access.read(`${roleplayMemoryRoot("session-a", "钟楼守卫-记忆")}/人物/状态.md`), "改名后继续更新");
    await deleteMemoryFiles(access, "session-a", scope);
    await assert.rejects(pathAccess(join(root, "钟楼守卫-记忆")), /ENOENT/);
    assert.equal(await access.read(`${roleplayMemoryRoot("session-b", other.storageDirectory)}/人物/状态.md`), "其他角色的记忆");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("character-folder migration preserves conflicting copies and non-Markdown attachments", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-memory-character-conflict-"));
  try {
    const access = fileAccess(root), base = fresh(); writeMemoryFile(base, "状态.md", "原目录内容");
    const legacy = await loadMemoryFiles(access, "session-a", base);
    const target = roleplayMemoryRoot("session-a", "守门人-记忆");
    await access.mkdir(target); await access.write(`${target}/状态.md`, "目标已有的手动修改", null);
    await assert.rejects(loadMemoryFiles(access, "session-a", legacy, false, "守门人-记忆"), /迁移冲突/);
    assert.equal(await access.read(`${roleplayMemoryRoot("session-a")}/状态.md`), "原目录内容");
    assert.equal(await access.read(`${target}/状态.md`), "目标已有的手动修改");
    await access.remove(`${target}/状态.md`, "目标已有的手动修改");
    const attachment = join(root, roleplayMemoryRoot("session-a"), "附件.bin");
    await writeFile(attachment, Buffer.from([0, 255, 128, 1]));
    await loadMemoryFiles(access, "session-a", legacy, false, "守门人-记忆");
    assert.deepEqual(await readFile(attachment), Buffer.from([0, 255, 128, 1]));
    assert.equal(await access.read(`${target}/状态.md`), "原目录内容");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("case-only character renames do not copy and delete the same directory on Windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-memory-case-rename-"));
  try {
    const access = fileAccess(root), base = fresh(); writeMemoryFile(base, "状态.md", "必须保留的记忆");
    const first = await loadMemoryFiles(access, "session-a", base, false, "Alice-记忆");
    const renamed = await loadMemoryFiles(access, "session-a", first, false, "alice-记忆");
    assert.equal(renamed.files["状态.md"].content, "必须保留的记忆");
    assert.equal(renamed.storageDirectory, "Alice-记忆");
    assert.equal(await access.read(`${roleplayMemoryRoot("session-a", "Alice-记忆")}/状态.md`), "必须保留的记忆");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("interrupted character-folder migration retains source files and protects edits made during copying", async () => {
  for (const mode of ["copy-failure", "manual-edit"]) {
    const root = await mkdtemp(join(tmpdir(), "renge-memory-migrate-failure-"));
    try {
      const access = fileAccess(root), base = fresh();
      writeMemoryFile(base, "A.md", "原事实 A"); writeMemoryFile(base, "B.md", "原事实 B");
      const legacy = await loadMemoryFiles(access, "session-a", base);
      const source = roleplayMemoryRoot("session-a"), target = roleplayMemoryRoot("session-a", "守门人-记忆");
      const tracked = { ...access, write: async (path, content, expected) => {
        if (mode === "copy-failure" && path === `${target}/B.md`) throw new Error("fixture copy failure");
        await access.write(path, content, expected);
        if (mode === "manual-edit" && path === `${target}/A.md`) await access.write(`${source}/A.md`, "复制期间的手动修改", "原事实 A");
      } };
      await assert.rejects(loadMemoryFiles(tracked, "session-a", legacy, false, "守门人-记忆"), /copy failure|已被修改/);
      assert.equal(await access.read(`${source}/A.md`), mode === "manual-edit" ? "复制期间的手动修改" : "原事实 A");
      assert.equal(await access.read(`${source}/B.md`), "原事实 B");
      if (mode === "copy-failure") {
        const retried = await loadMemoryFiles(access, "session-a", legacy, false, "守门人-记忆");
        assert.equal(retried.files["A.md"].content, "原事实 A"); assert.equal(retried.files["B.md"].content, "原事实 B");
        await assert.rejects(pathAccess(join(root, source)), /ENOENT/);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

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
    await prepareMemoryFileTool(tracked, "session-a", draft, baseline, "read", { path: "人物/" });
    const listing = await createMemoryTools(draft, false).execute("read", { path: "人物/" });
    assert.deepEqual(listing.entries, [{ path: "人物/守门人.md", kind: "file" }]);
    assert.ok(reads.every(path => !path.endsWith(".md")), "directory reads do not try to load directories as files or scan their contents");
    assert.equal(draft.files["人物/守门人.md"].unloaded, true);
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
