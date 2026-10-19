import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startRengeServer } from "../server.mjs";
import { createPiRequestBodyRecoveryFetch, reducePiRequestPayload } from "../pi/request-body-recovery.mjs";

const size = (value) => Buffer.byteLength(JSON.stringify(value));
const image = "data:image/png;base64," + "AAAA".repeat(20_000);

test("byte reduction preserves current attachments, instructions and the original transcript", () => {
  const current = { role: "user", content: [{ type: "text", text: "检查当前图片" }, { type: "image_url", image_url: { url: "data:image/png;base64,YQ==" } }] };
  const payload = { model: "fixture", messages: [
    { role: "system", content: "Keep the user's files." },
    { role: "user", content: [{ type: "image_url", image_url: { url: image } }] },
    { role: "assistant", content: "已检查旧图片。" }, current,
  ] };
  const snapshot = structuredClone(payload);
  const reduced = reducePiRequestPayload(payload, 5_000);
  assert.ok(size(reduced) <= 5_000);
  assert.deepEqual(reduced.messages[0], payload.messages[0]);
  assert.deepEqual(reduced.messages.at(-1), current);
  assert.match(JSON.stringify(reduced), /较早的图片已省略/);
  assert.deepEqual(payload, snapshot);
  assert.equal(reducePiRequestPayload(payload, size(payload)), payload);
});

for (const api of ["chat-completions", "responses"]) {
  test(`${api} removes complete old tool exchanges and preserves the latest parallel calls`, () => {
    const call = (id, content) => api === "responses"
      ? { type: "function_call", call_id: id, name: "read", arguments: JSON.stringify({ path: content }) }
      : { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: "read", arguments: JSON.stringify({ path: content }) } }] };
    const result = (id, output) => api === "responses"
      ? { type: "function_call_output", call_id: id, output }
      : { role: "tool", tool_call_id: id, content: output };
    const latestCalls = api === "responses" ? [call("new-a", "a"), call("new-b", "b")]
      : [{ ...call("new-a", "a"), tool_calls: [...call("new-a", "a").tool_calls, ...call("new-b", "b").tool_calls] }];
    const latest = [
      ...(api === "responses" ? [
        { type: "reasoning", id: "new-reasoning", summary: [] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Checking two files" }] },
      ] : []),
      ...latestCalls, result("new-a", "result A"), result("new-b", "result B"),
    ];
    const field = api === "responses" ? "input" : "messages";
    const payload = { [field]: [
      { role: "user", content: "Keep this request" },
      ...(api === "responses" ? [{ type: "reasoning", id: "old-reasoning", summary: [] }] : []),
      call("old", "x".repeat(30_000)), result("old", "old result"), ...latest,
    ] };
    const reduced = reducePiRequestPayload(payload, 3_000);
    assert.ok(size(reduced) <= 3_000);
    assert.deepEqual(reduced[field][0], payload[field][0]);
    assert.deepEqual(reduced[field].slice(-latest.length), latest);
    assert.ok(!JSON.stringify(reduced).includes('"old"'));
    assert.ok(!JSON.stringify(reduced).includes("old-reasoning"));
    assert.match(JSON.stringify(reduced), /原始会话记录仍保留/);
  });
}

test("large tool outputs keep readable UTF-8 head and tail and the latest tool image", () => {
  const payload = { messages: [
    { role: "user", content: "执行" },
    { role: "assistant", tool_calls: [{ id: "read", function: { name: "read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "read", content: [
      { type: "text", text: "开头" + "中文😀".repeat(20_000) + "结尾" },
      { type: "image_url", image_url: { url: "data:image/png;base64,YQ==" } },
    ] },
  ] };
  const reduced = reducePiRequestPayload(payload, 6_000);
  const result = reduced.messages.at(-1);
  assert.ok(size(reduced) <= 6_000);
  assert.match(result.content[0].text, /^开头/);
  assert.match(result.content[0].text, /结尾$/);
  assert.match(result.content[0].text, /工具输出中间部分已省略/);
  assert.ok(!result.content[0].text.includes("\ufffd"));
  assert.deepEqual(result.content[1], payload.messages.at(-1).content[1]);
});

test("SDK tool image messages do not replace the protected user request", () => {
  const payload = { messages: [
    { role: "user", content: "CURRENT_REQUEST" },
    { role: "assistant", tool_calls: [{ id: "old", function: { name: "write", arguments: "x".repeat(30_000) } }] },
    { role: "tool", tool_call_id: "old", content: "written" },
    { role: "assistant", tool_calls: [{ id: "new", function: { name: "read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "new", content: "new result" },
    { role: "user", content: [{ type: "text", text: "Attached image(s) from tool result:" }, { type: "image_url", image_url: { url: "data:image/png;base64,YQ==" } }] },
  ] };
  const reduced = reducePiRequestPayload(payload, 3_000);
  assert.ok(size(reduced) <= 3_000);
  assert.deepEqual(reduced.messages[0], payload.messages[0]);
  assert.deepEqual(reduced.messages.slice(-3), payload.messages.slice(-3));
});

test("Responses multimodal tool outputs are reduced using the SDK's output array format", () => {
  const payload = { input: [
    { role: "user", content: "CURRENT_REQUEST" },
    { type: "function_call", call_id: "old", name: "read", arguments: "{}" },
    { type: "function_call_output", call_id: "old", output: [{ type: "input_text", text: "old result" }, { type: "input_image", image_url: image }] },
    { type: "function_call", call_id: "new", name: "read", arguments: "{}" },
    { type: "function_call_output", call_id: "new", output: [{ type: "input_text", text: "头" + "中".repeat(30_000) + "尾" }, { type: "input_image", image_url: "data:image/png;base64,YQ==" }] },
  ] };
  const reduced = reducePiRequestPayload(payload, 5_000);
  assert.ok(size(reduced) <= 5_000);
  assert.match(reduced.input[2].output[1].text, /较早的图片已省略/);
  assert.equal(reduced.input.at(-1).output[1].image_url, "data:image/png;base64,YQ==");
  assert.match(reduced.input.at(-1).output[0].text, /^头.*尾$/s);
});

test("recovery retries only HTTP 413, learns per-provider byte limits and fixes content-length", async () => {
  const requests = [];
  const limits = new Map();
  const fetchImpl = async (_url, init) => {
    requests.push(init);
    return new Response("", { status: Buffer.byteLength(init.body) > 5_000 ? 413 : 200 });
  };
  const payload = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: image } }] }, { role: "user", content: "继续" }] };
  const body = JSON.stringify(payload);
  const request = { method: "POST", headers: { "content-length": String(Buffer.byteLength(body)), authorization: "Bearer fixture" }, body };
  const recoveringFetch = createPiRequestBodyRecoveryFetch({ fetchImpl, limits, providerKey: "one" });
  assert.equal((await recoveringFetch("http://fixture", request)).status, 200);
  assert.equal(requests.length, 2);
  assert.ok(limits.get("one") < Buffer.byteLength(body));
  assert.equal(requests[1].headers.get("content-length"), null);
  assert.equal(requests[1].headers.get("authorization"), "Bearer fixture");
  assert.equal((await recoveringFetch("http://fixture", request)).status, 200);
  assert.equal(requests.length, 3);
  await createPiRequestBodyRecoveryFetch({ fetchImpl, limits, providerKey: "two" })("http://fixture", request);
  assert.equal(requests.length, 5);
  const failure = new Response("server failed", { status: 500 });
  let calls = 0;
  assert.equal(await createPiRequestBodyRecoveryFetch({ fetchImpl: async () => { calls += 1; return failure; } })("http://fixture", request), failure);
  assert.equal(calls, 1);
});

test("an oversized current prompt stops with actionable advice; cancellation prevents another request", async () => {
  const controller = new AbortController();
  const init = { method: "POST", signal: controller.signal, body: JSON.stringify({ messages: [{ role: "user", content: image }] }) };
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response("length limit exceeded", { status: 413 }); };
  const response = await createPiRequestBodyRecoveryFetch({ fetchImpl })("http://fixture", init);
  assert.equal(response.status, 413);
  assert.match((await response.json()).error.message, /缩小当前图片\/附件/);
  assert.equal(calls, 1);
  controller.abort();
  await assert.rejects(createPiRequestBodyRecoveryFetch({ fetchImpl })("http://fixture", init), { name: "AbortError" });
  assert.equal(calls, 1);
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}
const close = (server) => new Promise((resolve) => server.close(resolve));
const send = (response, payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);

for (const apiType of ["chat-completions", "responses"]) {
  test(`Pi Host recovers ${apiType} 413 below the token limit and keeps persisted history`, { timeout: 30_000 }, async (t) => {
    const requests = [];
    const upstream = createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const status = Buffer.byteLength(raw) > 20_000 ? 413 : 200;
      requests.push({ body, status });
      if (status === 413) {
        response.writeHead(413, { "Content-Type": "text/plain" });
        response.end("413 Failed to buffer the request body: length limit exceeded");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      if (apiType === "responses") {
        const message = { type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: "RECOVERED_413", annotations: [] }] };
        send(response, { type: "response.created", response: { id: "resp_fixture", status: "in_progress", output: [] } });
        send(response, { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } });
        send(response, { type: "response.output_text.delta", output_index: 0, item_id: message.id, content_index: 0, delta: "RECOVERED_413" });
        send(response, { type: "response.output_item.done", output_index: 0, item: message });
        send(response, { type: "response.completed", response: { id: "resp_fixture", status: "completed", output: [message], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
      } else {
        const base = { id: "fixture", object: "chat.completion.chunk", model: "fixture" };
        send(response, { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "RECOVERED_413" }, finish_reason: null }] });
        send(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      }
      response.end("data: [DONE]\n\n");
    });
    const dataDir = await mkdtemp(join(tmpdir(), "renge-pi-body-recovery-"));
    const upstreamPort = await listen(upstream);
    const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
    t.after(async () => {
      await close(renge.server);
      await close(upstream);
      await rm(dataDir, { recursive: true, force: true });
    });
    for (const sessionId of ["body-first", "body-cached"]) {
      const response = await fetch(`${renge.url}/api/pi/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId, apiType, apiBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`, apiKey: "test-key",
          enableTools: false, allowImageInputs: true, contextWindow: 1_000_000, piCompaction: { enabled: false },
          request: { model: "fixture", stream: true, messages: [
            { role: "user", content: [{ type: "text", text: "旧截图" }, { type: "image_url", image_url: { url: image } }] },
            { role: "assistant", content: "已检查旧截图。" }, { role: "user", content: "继续修复唯一当前请求" },
          ] },
        }),
      });
      const text = await response.text();
      assert.match(text, /RECOVERED_413/);
      assert.ok(!text.includes('"error":'));
    }
    assert.deepEqual(requests.map(({ status }) => status), [413, 200, 200]);
    const messages = requests[1].body.messages ?? requests[1].body.input;
    assert.equal(messages.filter((message) => JSON.stringify(message).includes("继续修复唯一当前请求")).length, 1);
    assert.match(JSON.stringify(messages), /较早的图片已省略/);
    const files = await readdir(join(dataDir, ".pi", "sessions"), { recursive: true });
    const transcripts = await Promise.all(files.filter((file) => file.endsWith(".jsonl")).map((file) => readFile(join(dataDir, ".pi", "sessions", file), "utf8")));
    assert.ok(transcripts.some((text) => text.includes(image.slice("data:image/png;base64,".length))));
  });
}

test("413 after tool execution resumes the same turn without executing a write twice", { timeout: 30_000 }, async (t) => {
  const requests = [];
  let writes = 0;
  const dataDir = await mkdtemp(join(tmpdir(), "renge-pi-body-tools-"));
  await writeFile(join(dataDir, "large.txt"), "tool output line\n".repeat(10_000));
  const upstream = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const status = Buffer.byteLength(raw) > 45_000 ? 413 : 200;
    requests.push({ body, status });
    if (status === 413) { response.writeHead(413); response.end("length limit exceeded"); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const hasResults = body.messages.some((message) => message.role === "tool");
    const delta = hasResults ? { role: "assistant", content: "TOOLS_RECOVERED" } : {
      role: "assistant", tool_calls: [
        { index: 0, id: "write-once", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "once.txt", content: "one execution", operation: "overwrite", expected_bytes: 0 }) } },
        { index: 1, id: "large-read", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "large.txt" }) } },
      ],
    };
    const base = { id: "fixture", object: "chat.completion.chunk", model: "fixture" };
    send(response, { ...base, choices: [{ index: 0, delta, finish_reason: null }] });
    send(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: hasResults ? "stop" : "tool_calls" }] });
    response.end("data: [DONE]\n\n");
  });
  const upstreamPort = await listen(upstream);
  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir, authorizePiTool: async ({ toolName }) => { if (toolName === "write") writes += 1; } });
  t.after(async () => {
    await close(renge.server);
    await close(upstream);
    await rm(dataDir, { recursive: true, force: true });
  });
  const response = await fetch(`${renge.url}/api/pi/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "body-tools", apiBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`, apiKey: "test-key",
      workspace: { kind: "electron", cwd: dataDir }, contextWindow: 1_000_000, piCompaction: { enabled: false },
      request: { model: "fixture", stream: true, messages: [{ role: "user", content: "Write once and inspect the large file" }] },
    }),
  });
  const text = await response.text();
  assert.match(text, /TOOLS_RECOVERED/);
  assert.deepEqual(requests.map(({ status }) => status), [200, 413, 200]);
  assert.equal(writes, 1);
  assert.equal(await readFile(join(dataDir, "once.txt"), "utf8"), "one execution");
  assert.match(JSON.stringify(requests[2].body), /工具输出中间部分已省略/);
  assert.deepEqual(requests[2].body.messages.filter((message) => message.role === "tool").map((message) => message.tool_call_id), ["write-once", "large-read"]);
});
