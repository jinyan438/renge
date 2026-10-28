import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectTurnPresentedFiles, getPresentedFiles, normalizePresentedFileArguments, validatePresentedFiles } from "../src/chatPresentedFileUtils.ts";
import { createPresentFilesTool } from "../pi/present-files.mjs";
import { createServer } from "node:http";
import { startRengeServer } from "./piTestServer.mjs";

test("deliveries validate local paths and metadata, deduplicate and reject malformed declarations", () => {
  assert.deepEqual(normalizePresentedFileArguments({ files: [{ path: "README.md", description: " 项目说明\n与用法 " }, { path: "README.md", description: "项目说明" }] }), [{ path: "README.md", description: "项目说明" }]);
  for (const files of [[], Array(9).fill({ path: "a.md" }), [{ path: "https://example.com/a.md" }], [{ path: "javascript:alert(1)" }], [{ path: "foo.ts:12" }]]) assert.throws(() => normalizePresentedFileArguments({ files }));
  assert.equal(getPresentedFiles({ presentedFiles: { files: [{ path: "data:text/html,evil" }] } }), undefined);
});

test("frontend deliveries check file existence within the owning workspace without reading file content", async () => {
  const calls = [];
  const list = async path => { calls.push(path); return [{ path: "docs/README.md", kind: "file" }, { path: "docs/folder", kind: "directory" }]; };
  const result = await validatePresentedFiles({ files: [{ path: "E:/project/docs/README.md", description: "说明" }] }, "E:/project", list);
  assert.equal(result.files[0].path, "docs/README.md"); assert.deepEqual(calls, ["docs"]);
  await assert.rejects(validatePresentedFiles({ files: [{ path: "../outside.md" }] }, "E:/project", list), /工作区之外/);
  await assert.rejects(validatePresentedFiles({ files: [{ path: "docs/missing.md" }] }, "E:/project", list), /不存在/);
  await assert.rejects(validatePresentedFiles({ files: [{ path: "docs/folder" }] }, "E:/project", list), /普通文件/);
});

test("successful deliveries move to the final reply, remain per turn, and survive reload metadata", () => {
  const delivery = { cwd: "E:/project", files: [{ path: "README.md", description: "用法" }] };
  const first = { id: "deliver", role: "assistant", content: "已交付", toolVisualization: { name: "chat_present_files", status: "done", result: { details: { presentedFiles: delivery } } } };
  const messages = [{ id: "user", role: "user", content: "创建文件" }, first, { id: "final", role: "assistant", content: "任务完成", outputStatus: "complete" }];
  const cards = collectTurnPresentedFiles(JSON.parse(JSON.stringify(messages)));
  assert.deepEqual([...cards.keys()], ["final"]);
  assert.equal(cards.get("final").files[0].path, "E:/project/README.md");
  assert.equal(collectTurnPresentedFiles([...messages, { id: "next-user", role: "user", content: "下一轮" }, { id: "next-final", role: "assistant", content: "其他回复" }]).has("next-final"), false);
  assert.equal(collectTurnPresentedFiles([{ ...first, toolVisualization: { ...first.toolVisualization, status: "error" } }]).size, 0);
  assert.equal(collectTurnPresentedFiles([first, { id: "streaming", role: "assistant", content: "正在生成", outputStatus: "running" }]).size, 0);
  assert.equal(collectTurnPresentedFiles([first, { id: "buffered", role: "assistant", content: "", renderAsPlainText: true }]).size, 0);
  assert.equal(collectTurnPresentedFiles([first]).has("deliver"), true, "tools-only completion still displays cards");
});

test("native delivery tool validates actual regular files and reports metadata to the renderer", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-present-tool-"));
  try {
    const cwd = join(root, "workspace"); await mkdir(cwd);
    await writeFile(join(cwd, "README.md"), "# Hello\n"); await writeFile(join(root, "outside.md"), "outside");
    const tool = createPresentFilesTool(cwd);
    const result = await tool.execute("present", { files: [{ path: "README.md", description: "项目说明" }] });
    assert.deepEqual(result.details.presentedFiles.files, [{ path: "README.md", description: "项目说明" }]);
    await assert.rejects(tool.execute("missing", { files: [{ path: "missing.txt" }] }), /ENOENT/);
    await assert.rejects(tool.execute("outside", { files: [{ path: "../outside.md" }] }), /当前工作区/);
    await assert.rejects(tool.execute("directory", { files: [{ path: "." }] }), /普通文件/);
    await assert.rejects(tool.execute("cancelled", { files: [{ path: "README.md" }] }, AbortSignal.abort()), /abort/i);
    await symlink(join(root, "outside.md"), join(cwd, "link.md"), "file").then(async () => {
      await assert.rejects(tool.execute("symlink", { files: [{ path: "link.md" }] }), /普通文件/);
    }).catch(error => { if (error.code !== "EPERM") throw error; });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native Pi tasks expose the delivery tool and stream durable file metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-native-delivery-"));
  const requests = [];
  const upstream = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const complete = body.messages.some(message => message.role === "tool");
    const delta = complete ? { role: "assistant", content: "交付完成" } : { role: "assistant", tool_calls: [{ index: 0, id: "native-present", type: "function", function: { name: "chat_present_files", arguments: JSON.stringify({ files: [{ path: "README.md", description: "原生交付说明" }] }) } }] };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: complete ? "stop" : "tool_calls" }]) response.write(`data: ${JSON.stringify({ id: "native", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [choice] })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  let server;
  try {
    const cwd = join(root, "workspace"); await mkdir(cwd); await writeFile(join(cwd, "README.md"), "# Native\n");
    await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
    server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
    const response = await fetch(`${server.url}/api/pi/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      sessionId: "native-delivery", workspace: { kind: "electron", cwd }, enableTools: true, apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
      piCompaction: { enabled: false }, request: { model: "fixture", messages: [{ role: "user", content: "交付说明文件" }] },
    }) });
    const stream = await response.text();
    assert.match(stream, /交付完成/); assert.doesNotMatch(stream, /"type":"tool_request"/);
    assert.ok(requests[0].tools.some(tool => tool.function.name === "chat_present_files"));
    const result = stream.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6))).find(frame => frame.pi?.type === "tool_end" && frame.pi.toolName === "chat_present_files");
    assert.deepEqual(getPresentedFiles(result.pi.result).files, [{ path: "README.md", description: "原生交付说明" }]);
  } finally {
    server?.server.closeAllConnections(); if (server) await new Promise(resolve => server.server.close(resolve));
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); await rm(root, { recursive: true, force: true });
  }
});
