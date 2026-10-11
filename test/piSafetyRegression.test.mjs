import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRengePiHost } from "../pi/renge-pi-host.mjs";
import { createPermissionCheckedPiTools } from "../pi/permission-tools.mjs";
import { startRengeServer } from "../server.mjs";

class Response extends EventEmitter {
  destroyed = false; writableEnded = false; headersSent = false; chunks = [];
  constructor(onStart) { super(); this.onStart = onStart; }
  writeHead() { this.headersSent = true; }
  write(chunk) { this.chunks.push(chunk); if (chunk.includes('"run_start"')) this.onStart?.(this); return true; }
  end() { this.writableEnded = true; }
}

test("Pi checks native mutations, symlinks and Shell approval, including cancellation during approval", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-permissions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const outside = join(root, "outside.txt"); await writeFile(outside, "old");
  await symlink(root, join(cwd, "linked"), process.platform === "win32" ? "junction" : "dir");
  const tools = createPermissionCheckedPiTools({ cwd, nativeTools: ["write", "edit", "powershell"] });
  const edit = tools.find(t => t.name === "edit"), write = tools.find(t => t.name === "write");
  const signal = new AbortController().signal;
  await assert.rejects(edit.execute("one", { path: outside, edits: [{ oldText: "old", newText: "bad" }] }, signal), /未授权/);
  await assert.rejects(write.execute("two", { path: "linked/outside.txt", operation: "overwrite", expected_bytes: 0, content: "bad" }, signal), /未授权/);
  await assert.rejects(tools.find(t => t.name === "powershell").execute("three", { command: "Write-Output never" }, signal), /审批/);
  assert.equal(await readFile(outside, "utf8"), "old");
  const approvals = [];
  const approved = createPermissionCheckedPiTools({ cwd, nativeTools: ["edit", "write"], authorizeTool: async (request) => approvals.push(request) });
  await approved.find(t => t.name === "edit").execute("four", { path: outside, edits: [{ oldText: "old", newText: "allowed" }] }, signal);
  await approved.find(t => t.name === "write").execute("five", { path: outside, operation: "overwrite", expected_bytes: 0, content: "approved write" }, signal);
  assert.deepEqual(approvals.map(a => a.toolName), ["edit", "write"]);
  assert.equal(await readFile(outside, "utf8"), "approved write");
  const controller = new AbortController();
  const cancelled = createPermissionCheckedPiTools({ cwd, nativeTools: ["edit"], authorizeTool: async () => controller.abort() });
  await assert.rejects(cancelled[0].execute("six", { path: outside, edits: [{ oldText: "approved write", newText: "bad" }] }, controller.signal), /aborted/);
  assert.equal(await readFile(outside, "utf8"), "approved write");
});

test("disconnect and explicit abort before AgentSession creation prevent provider requests", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-early-abort-"));
  const host = createRengePiHost({ defaultCwd: root, dataDir: root, agentDir: join(root, "agent") });
  t.after(async () => { await host.dispose(); await rm(root, { recursive: true, force: true }); });
  const body = { apiBaseUrl: "http://127.0.0.1:1/v1", enableTools: false, request: { model: "fake", messages: [{ role: "user", content: "must not run" }] } };
  const disconnected = new Response(response => { response.destroyed = true; response.emit("close"); });
  await host.handleChat({ ...body, runId: "disconnect" }, {}, disconnected);
  assert.equal(disconnected.chunks.length, 1);
  let abortResult;
  const aborted = new Response(() => { abortResult = host.handleAbort({ runId: "explicit" }); });
  await host.handleChat({ ...body, runId: "explicit" }, {}, aborted);
  assert.equal((await abortResult).aborted, true);
  assert.match(aborted.chunks.join(""), /会话已中止/);
});

test("live Pi sessions route native writes through the server permission callback", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-native-approval-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const outside = join(root, "outside.txt"); await writeFile(outside, "original");
  const upstream = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const hasResult = body.messages.some(message => message.role === "tool");
    const delta = hasResult ? { role: "assistant", content: "finished" } : {
      role: "assistant", tool_calls: [{ index: 0, id: "permission-write", type: "function", function: {
        name: "write", arguments: JSON.stringify({ path: outside, content: "approved", operation: "overwrite", expected_bytes: 0 }),
      } }],
    };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = choices => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fake", created: 0, choices })}\n\n`;
    response.write(chunk([{ index: 0, delta, finish_reason: null }]));
    response.write(chunk([{ index: 0, delta: {}, finish_reason: hasResult ? "stop" : "tool_calls" }]));
    response.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  let allowed = false;
  const approvals = [];
  const controller = await startRengeServer({
    host: "127.0.0.1", port: 0, dataDir: join(root, "data"),
    authorizePiTool: async request => { approvals.push(request); if (!allowed) throw new Error("approval refused"); },
  });
  t.after(async () => {
    await new Promise(resolve => controller.server.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const chat = async sessionId => {
    const response = await fetch(`${controller.url}/api/pi/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        sessionId, workspace: { kind: "electron", cwd }, enableTools: true, piCompaction: { enabled: false },
        apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, request: { model: "fake", messages: [{ role: "user", content: "write the file" }] },
      }),
    });
    assert.match(await response.text(), /finished/);
  };
  await chat("denied");
  assert.equal(await readFile(outside, "utf8"), "original");
  allowed = true;
  await chat("approved");
  assert.equal(await readFile(outside, "utf8"), "approved");
  assert.deepEqual(approvals.map(request => request.toolName), ["write", "write"]);
  assert.ok(approvals.every(request => request.cwd === cwd));
});

test("authoritative rewrite history excludes later turns, applies target labels and preserves the main tree", async (t) => {
  const requests = [];
  const upstream = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = { id: "test", object: "chat.completion.chunk", model: "fake", created: 0 };
    for (const choice of [{ index: 0, delta: { role: "assistant", content: `reply-${requests.length}` }, finish_reason: null }, { index: 0, delta: {}, finish_reason: "stop" }]) {
      response.write(`data: ${JSON.stringify({ ...base, choices: [choice] })}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const root = await mkdtemp(join(tmpdir(), "renge-pi-rewrite-"));
  const controller = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  t.after(async () => { await new Promise(resolve => controller.server.close(resolve)); await new Promise(resolve => upstream.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const chat = async (messages, extra = {}) => {
    const response = await fetch(`${controller.url}/api/pi/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      sessionId: "history", apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, enableTools: false, piCompaction: { enabled: false }, ...extra, request: { model: "fake", messages, stream: true },
    }) });
    assert.doesNotMatch(await response.text(), /"error"/);
  };
  await chat([{ role: "user", content: "first" }]);
  await chat([{ role: "user", content: "future turn" }]);
  await chat([{ role: "user", content: "first" }, { role: "assistant", content: "target labels" }, { role: "user", content: "rewrite this reply" }], { piHistoryMode: "replace" });
  assert.doesNotMatch(JSON.stringify(requests[2].messages), /future turn|reply-2/);
  assert.match(JSON.stringify(requests[2].messages), /target labels/);
  await chat([{ role: "user", content: "normal next" }]);
  assert.match(JSON.stringify(requests[3].messages), /future turn/);
  assert.doesNotMatch(JSON.stringify(requests[3].messages), /target labels|rewrite this reply/);
});
