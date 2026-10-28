import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. No live provider, credentials or personal data.
const root = await mkdtemp(join(tmpdir(), "renge-file-memory-browser-"));
let server, browser, page;
let failWrite = false;
const memoryRequests = [], storyRequests = [], order = [], errors = [];
const initialMemoryPath = "钟楼通行/当前状态.md";
const now = new Date().toISOString();
const file = content => ({ content, updatedAt: now });
const memory = (workspace, id, content) => ({ version: 1, scope: JSON.stringify([workspace, id]),
  directories: ["人物"], files: { "人物/守门人.md": file(content) }, updatedAt: now });
const call = (name, args) => ({ id: `memory-call-${name}`, type: "function", function: { name, arguments: JSON.stringify(name === "write" ? { operation: "overwrite", expected_bytes: 0, ...args } : args) } });
const readData = async () => (await (await fetch(`${server.url}/api/app-data`)).json()).data;
async function saved(predicate) {
  for (let i = 0; i < 100; i++) { const data = await readData(); if (predicate(data)) return data; await delay(100); }
  assert.fail("session memory was not persisted");
}
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root, temporaryFilesRoot: join(root, "temporary-files") });
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture", models: ["fixture"], updatedAt: now };
  const sessions = ["A", "B"].map(id => ({ id, title: `会话${id}`, mode: "roleplay", roleplayCharacterCardId: "card", workspaceKey: "default", workspaceName: "默认工作区",
    fileMemory: memory("default", id, id === "A" ? "守门人持有铜钥匙，当前在旧港口。" : "B_ONLY_SECRET"),
    messages: Array.from({ length: 6 }, (_, i) => ({ id: `${id}-${i}`, role: i % 2 ? "assistant" : "user", content: `${id}_BODY_${i}`, createdAt: now })),
    createdAt: now, updatedAt: now }));
  sessions.push({ ...sessions[1], id: "C", title: "普通会话C", mode: "ai", roleplayCharacterCardId: undefined, fileMemory: undefined });
  await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: {
    version: 1, chatMode: "roleplay", providers: [provider], activeProviderId: provider.id, chatSessions: sessions,
    characterCards: [{ id: "card", name: "守门人", description: "CHARACTER_CARD_KEPT", firstMessage: "欢迎。", createdAt: now, updatedAt: now }],
    llmContextSettings: { roleplay: { fileMemory: true } },
    systemPrompts: [{ id: "sys", name: "保留的系统提示词", content: "SYSTEM_PROMPT_KEPT", updatedAt: now }], activeSystemPromptIds: ["sys"],
    worldBooks: [{ id: "world", name: "世界", enabled: true, entries: [{ id: "lore", name: "法则", enabled: true, constant: true, content: "WORLDBOOK_KEPT" }], updatedAt: now }], activeWorldBookIds: ["world"],
  } }) });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/chat/completions", async route => {
    const body = route.request().postDataJSON();
    memoryRequests.push(body);
    assert.match(body.request.messages[0].content, /文件记忆管理员/);
    assert.doesNotMatch(JSON.stringify(body.request.messages), /B_ONLY_SECRET/);
    const writable = body.request.tools.some(tool => tool.function.name === "write");
    const names = body.request.tools.map(tool => tool.function.name);
    assert.ok(names.includes("read"));
    assert.equal(names.includes("edit"), writable);
    assert.ok(!names.some(name => /^memory_(read|write|edit)$/.test(name)));
    const reference = JSON.parse(body.request.messages[1].content).reference;
    assert.equal(reference.messages.length, 3, "memory extraction receives only the latest canonical dialogue");
    assert.ok(reference.messages.every(message => message.role === "user" || message.role === "assistant"));
    assert.equal(reference.messages.at(-1).role, writable ? "assistant" : "user");
    assert.doesNotMatch(JSON.stringify(reference), /SYSTEM_PROMPT_KEPT|WORLDBOOK_KEPT|CHARACTER_CARD_KEPT/,
      "story presets and roleplay writing instructions must not steer memory extraction");
    const previousTools = body.request.messages.filter(message => message.role === "tool");
    const phase = writable ? "write" : "read";
    order.push(phase);
    if (writable && failWrite) {
      if (previousTools.length) {
        await route.fulfill({ status: 500, json: { error: { message: "fixture memory update failure" } } });
      } else {
        await route.fulfill({ json: { choices: [{ message: { role: "assistant", content: "", tool_calls: [call("write", { path: "测试/未提交.md", content: "不能留下半轮修改" })] }, finish_reason: "tool_calls" }] } });
      }
      return;
    }
    const writeCalls = storyRequests.length === 1 ? [
      call("read", { path: "人物" }),
      call("read", { path: "人物/守门人.md" }),
      call("edit", { path: "人物/守门人.md", edits: [{ oldText: "当前在旧港口", newText: "当前在钟楼" }] }),
      call("write", { path: initialMemoryPath, content: "- 当前位置：钟楼。\n- 铜钥匙持有人：守门人。" }),
    ] : [
      call("read", { path: "人物/" }),
      call("read", { path: "人物/守门人.md" }),
      call("edit", { path: "人物/守门人.md", oldText: "当前在钟楼", newText: "当前在钟楼，确认通行约定仅在黎明生效" }),
      call("read", { path: initialMemoryPath }),
      call("write", { path: initialMemoryPath, content: "- 当前位置：钟楼。\n- 铜钥匙持有人：守门人。\n- 通行时间：黎明。" }),
      call("memory_mkdir", { path: "钟楼之约/生效条件" }),
      call("write", { path: "钟楼之约/生效条件/开门时刻.md", content: "通行约定仅在黎明生效。" }),
      call("write", { path: "人物/守门人/私下约定/通行.md", content: "守门人承诺代为开启铜门。" }),
    ];
    const calls = previousTools.length ? (!writable && previousTools.length === 2
      ? (() => {
        const listing = JSON.parse(previousTools[0].content);
        assert.equal(listing.kind, "directory");
        assert.doesNotMatch(JSON.stringify(listing), /守门人持有铜钥匙|手动设定/);
        return [call("read", { path: listing.entries.find(entry => entry.kind === "file").path }),
          call("memory_history_read", { id: JSON.parse(previousTools[1].content).matches[0].id })];
      })() : []) : writable
      ? writeCalls : [call("read", { path: "人物/" }), call("memory_history_search", { query: "A_BODY_0" })];
    await route.fulfill({ json: { choices: [{ message: { role: "assistant", content: calls.length ? "" : "READY", ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: calls.length ? "tool_calls" : "stop" }] } });
  });
  await page.route("**/api/pi/chat", async route => {
    const body = route.request().postDataJSON(); storyRequests.push(body); order.push("story");
    const content = storyRequests.length === 2 ? "守门人表示：通行约定仅在黎明生效，他承诺代为开启铜门。" : "守门人转动铜钥匙，带你走进钟楼。";
    const response = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
    await route.fulfill({ contentType: "text/event-stream", body: response });
  });
  async function enter() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  }
  const selectSession = id => page.locator(".chat-session-item").filter({ hasText: id === "C" ? "普通会话C" : `会话${id}` }).locator("button").first().click();
  async function send(text) {
    await page.getByPlaceholder("输入消息，可粘贴图片").fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
  }
  async function openSettings() {
    const chat = page.getByRole("region", { name: "Renge 对话工作区", exact: true });
    if (await chat.isVisible()) await chat.getByRole("button", { name: "最小化窗口", exact: true }).click();
    await page.getByRole("button", { name: "打开系统设置", exact: true }).click();
    await page.getByRole("button", { name: "打开设置", exact: true }).click();
    await page.locator(".settings-nav").getByRole("button", { name: "LLM", exact: true }).click();
  }
  await page.goto(server.url); await enter(); await selectSession("A");
  await send("请带我进入钟楼");
  const persisted = await saved(data => data.chatSessions.find(session => session.id === "A")?.fileMemory?.files[initialMemoryPath]);
  assert.deepEqual(order, ["read", "read", "read", "story", "write", "write"]);
  assert.equal(storyRequests[0].piHistoryMode, "replace", "persistent Pi history cannot bypass the three-turn window");
  const actual = storyRequests[0].request.messages;
  const bodies = actual.filter(message => message.role === "user" || message.role === "assistant");
  assert.equal(bodies.length, 3);
  assert.match(JSON.stringify(actual), /A_BODY_4/); assert.match(JSON.stringify(actual), /A_BODY_5/);
  assert.doesNotMatch(JSON.stringify(bodies), /A_BODY_[0-3]/);
  assert.match(JSON.stringify(actual), /按需查证的会话记录.*A-0/);
  assert.doesNotMatch(JSON.stringify(actual), /A_BODY_[1-3]|B_ONLY_SECRET/);
  assert.match(JSON.stringify(actual), /守门人持有铜钥匙/);
  assert.match(JSON.stringify(actual), /SYSTEM_PROMPT_KEPT/); assert.match(JSON.stringify(actual), /WORLDBOOK_KEPT/);
  assert.match(JSON.stringify(actual), /CHARACTER_CARD_KEPT/);
  assert.equal(persisted.chatSessions.find(session => session.id === "B").fileMemory.files["人物/守门人.md"].content, "B_ONLY_SECRET");
  const mirror = join(root, "temporary-files", "角色记忆", "会话-%41");
  assert.equal(await readFile(join(mirror, initialMemoryPath), "utf8"), "- 当前位置：钟楼。\n- 铜钥匙持有人：守门人。");
  assert.equal((await readdir(mirror)).includes("剧情原文"), false, "generation never creates transcript folders");
  assert.equal(Object.keys(persisted.chatSessions.find(session => session.id === "A").fileMemory.files).some(path => path.startsWith("剧情原文/")), false);
  // The existing file module is the only memory editor, and its writes go
  // straight to the physical temporary folder used by generation.
  await selectSession("B");
  await saved(data => data.chatSessions.find(session => session.id === "B")?.fileMemory?.filesystemReady);
  await selectSession("A");
  const expand = page.getByRole("button", { name: "展开右侧栏", exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole("button", { name: /文件.*浏览工作区/ }).click();
  const files = page.locator(".files-sidebar-panel");
  for (const path of ["角色记忆", "角色记忆/会话-%41", "角色记忆/会话-%41/人物", "角色记忆/会话-%41/人物/守门人.md"]) {
    await files.locator(`.files-tree-row[title="${path}"]`).click();
  }
  await files.getByRole("button", { name: "编辑文件", exact: true }).click();
  await files.getByLabel("文件编辑内容").fill("手动设定：守门人携带铜钥匙，当前在钟楼。");
  await files.getByRole("button", { name: "保存文件", exact: true }).click();
  await files.getByText("文件已保存，下次生成将读取最新内容", { exact: true }).waitFor();
  assert.match(await readFile(join(mirror, "人物/守门人.md"), "utf8"), /手动设定/);
  await saved(data => data.chatSessions.find(session => session.id === "A")?.fileMemory?.files["人物/守门人.md"].content.startsWith("手动设定"));
  await files.screenshot({ path: ".runtime/roleplay-file-memory-sidebar.png" });
  // A later turn can add a root branch and deeper descendants of an existing
  // branch. The sidebar refreshes the evolving tree without closing the tool.
  await page.getByRole("button", { name: "发送", exact: true }).waitFor();
  await send("继续剧情，确认守门人的通行约定");
  const expanded = await saved(data => data.chatSessions.find(session => session.id === "A")?.fileMemory?.files["人物/守门人/私下约定/通行.md"]);
  assert.match(await readFile(join(mirror, "钟楼之约/生效条件/开门时刻.md"), "utf8"), /黎明/);
  assert.match(await readFile(join(mirror, "人物/守门人/私下约定/通行.md"), "utf8"), /开启铜门/);
  assert.match(await readFile(join(mirror, "人物/守门人.md"), "utf8"), /手动设定.*确认通行约定仅在黎明生效/);
  assert.match(await readFile(join(mirror, initialMemoryPath), "utf8"), /通行时间：黎明/);
  const expandedMemory = expanded.chatSessions.find(session => session.id === "A").fileMemory;
  assert.ok(expandedMemory.directories.includes("钟楼之约/生效条件"));
  assert.ok(expandedMemory.directories.includes("人物/守门人/私下约定"));
  for (const path of ["钟楼之约", "钟楼之约/生效条件", "钟楼之约/生效条件/开门时刻.md"]) {
    await files.locator(`.files-tree-row[title="角色记忆/会话-%41/${path}"]`).click();
  }
  await files.getByText("通行约定仅在黎明生效。", { exact: true }).waitFor();
  for (const path of ["人物/守门人", "人物/守门人/私下约定", "人物/守门人/私下约定/通行.md"]) {
    await files.locator(`.files-tree-row[title="角色记忆/会话-%41/${path}"]`).click();
  }
  await files.getByText("守门人承诺代为开启铜门。", { exact: true }).waitFor();
  assert.match(await readFile(join(mirror, "人物/守门人.md"), "utf8"), /手动设定/);
  // Fail after a successful staged mutation: prose and earlier memories survive, while
  // the half-written category file never reaches session storage or disk.
  failWrite = true;
  await page.getByRole("button", { name: "发送", exact: true }).waitFor();
  await send("测试记忆更新失败");
  const failed = await saved(data => data.chatSessions.find(session => session.id === "A")?.fileMemory?.lastError);
  const failedSession = failed.chatSessions.find(session => session.id === "A");
  assert.equal(failedSession.fileMemory.files["测试/未提交.md"], undefined);
  assert.ok(failedSession.messages.some(message => message.content === "测试记忆更新失败"));
  assert.equal(Object.values(failedSession.fileMemory.files).some(file => file.content.includes("测试记忆更新失败")), false, "failed memory updates do not fall back to copying prose");
  assert.equal((await readdir(mirror)).includes("剧情原文"), false);
  assert.match(failedSession.messages.at(-1).content, /走进钟楼/);
  assert.match(failedSession.fileMemory.lastError, /fixture memory update failure/);
  assert.match(JSON.stringify(storyRequests.at(-1).request.messages), /手动设定：守门人携带铜钥匙/);
  assert.match(await readFile(join(mirror, "人物/守门人.md"), "utf8"), /手动设定/);
  failWrite = false;
  await page.getByRole("button", { name: "发送", exact: true }).waitFor();
  await openSettings();
  assert.equal(await page.getByRole("checkbox", { name: "角色扮演文件记忆", exact: true }).isChecked(), true);
  const panel = page.locator(".rp-memory-card");
  assert.equal(await panel.locator("textarea, .rp-memory-manager").count(), 0, "LLM settings only contain the toggle and explanation");
  assert.equal(await panel.getByRole("button").count(), 0);
  await panel.screenshot({ path: ".runtime/roleplay-file-memory-settings.png" });
  await page.getByRole("checkbox", { name: "角色扮演文件记忆", exact: true }).uncheck();
  await saved(data => data.llmContextSettings.roleplay.fileMemory === false);
  await page.getByLabel("关闭设置窗口", { exact: true }).click();
  await enter();
  const memoryCount = memoryRequests.length;
  await send("关闭记忆后的行动");
  await saved(data => data.chatSessions.find(session => session.id === "A")?.messages.some(message => message.content === "关闭记忆后的行动"));
  await page.getByRole("button", { name: "发送", exact: true }).waitFor();
  assert.equal(memoryRequests.length, memoryCount);
  assert.ok(storyRequests.at(-1).request.messages.filter(message => /user|assistant/.test(message.role)).length > 3);
  await page.reload(); await enter(); await selectSession("A"); await openSettings();
  assert.equal(await page.getByRole("checkbox", { name: "角色扮演文件记忆", exact: true }).isChecked(), false);
  await page.getByRole("checkbox", { name: "角色扮演文件记忆", exact: true }).check();
  await page.getByLabel("关闭设置窗口", { exact: true }).click();
  await enter();
  await selectSession("C"); await send("普通模式不启用文件记忆");
  await page.getByRole("button", { name: "发送", exact: true }).waitFor();
  assert.equal(memoryRequests.length, memoryCount, "global switch cannot enable memory in AI mode");
  assert.deepEqual(errors, []);
  console.log("Roleplay file memory browser integration passed");
} catch (error) {
  console.error({ order, errors, settings: (await readData()).llmContextSettings,
    main: storyRequests[0] && { scope: storyRequests[0].piSessionScope, count: storyRequests[0].request.messages.length },
    local: await page?.evaluate(() => localStorage.getItem("renge_llm_context_settings")) });
  await page?.screenshot({ path: ".runtime/roleplay-file-memory-failure.png" });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
