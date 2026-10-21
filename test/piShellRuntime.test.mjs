import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { startRengeServer } from "./piTestServer.mjs";

const shell = process.platform === "win32" ? "powershell" : "bash";
const quote = (value) => `'${value.replaceAll("'", process.platform === "win32" ? "''" : "'\\''")}'`;
const command = (path) => `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} ${quote(path)}`;
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

function reply(response, tool, args) {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const chunk = (delta, finish_reason) => response.write(`data: ${JSON.stringify({ id: "shell-fixture", object: "chat.completion.chunk", model: "fake", created: 0, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  chunk(tool ? { role: "assistant", tool_calls: [{ index: 0, id: `call-${tool}`, type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] } : { role: "assistant", content: "verified shell completion" }, null);
  chunk({}, tool ? "tool_calls" : "stop");
  response.end("data: [DONE]\n\n");
}

async function fixture(t, respond) {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-shell-"));
  const requests = [];
  const upstream = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    await respond({ body, response, count: requests.length, root });
  });
  await listen(upstream);
  const server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data"), authorizePiTool: async () => {} });
  t.after(async () => {
    server.server.closeAllConnections();
    await new Promise((resolve) => server.server.close(resolve));
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const chat = (runId) => fetch(`${server.url}/api/pi/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      runId, sessionId: runId, apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
      workspace: { kind: "electron", cwd: root }, enableTools: true, piCompaction: { enabled: false },
      request: { model: "fake", messages: [{ role: "user", content: "run and verify the command" }] },
    }),
  });
  return { root, requests, server, chat };
}

test("Pi returns a live command to the model at the default yield, then resumes it and streams to the original bubble", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, async ({ body, response, count, root }) => {
    if (count === 1) return reply(response, shell, { command: command(join(root, "command.mjs")), timeout: 25 });
    const results = body.messages.filter((message) => message.role === "tool");
    if (count === 2) {
      const current = String(results.at(-1).content);
      assert.match(current, /first live output/);
      assert.match(current, /Command still running/);
      assert.match(current, /has NOT timed out/);
      const id = /session_id: ([\da-f-]+)/i.exec(current)?.[1];
      assert.ok(id);
      await writeFile(join(root, "release"), "go");
      return reply(response, "shell_status", { session_id: id });
    }
    assert.equal(count, 3);
    assert.match(String(results.at(-1).content), /final output[\s\S]*Command completed/);
    reply(response);
  });
  await writeFile(join(f.root, "command.mjs"), `import { appendFileSync, existsSync } from 'node:fs';
appendFileSync('starts.txt', 'one\\n'); console.log('first live output');
const timer = setInterval(() => { if (!existsSync('release')) return; clearInterval(timer); console.log('final output'); }, 30);`);
  const response = await f.chat("shell-yield");
  const frames = [];
  for await (const chunk of response.body) frames.push(Buffer.from(chunk));
  const events = Buffer.concat(frames).toString().split("\n\n").filter((frame) => frame.startsWith("data: {")).map((frame) => JSON.parse(frame.slice(6))).flatMap((frame) => frame.pi ? [frame.pi] : []);
  assert.equal(f.requests.length, 3);
  const names = f.requests[0].tools.map((tool) => tool.function.name);
  assert.ok(names.includes("shell_status") && names.includes("shell_stop"));
  const shellStart = events.find((event) => event.type === "tool_start" && event.toolName === shell);
  const shellUpdates = events.filter((event) => event.type === "tool_update" && event.toolName === shell);
  assert.ok(shellUpdates.some((event) => JSON.stringify(event.result).includes("first live output")), "live output traverses the host SSE stream");
  const ends = events.filter((event) => event.type === "tool_end" && event.toolName === shell);
  assert.equal(ends[0].result.details.shellSession.status, "running");
  assert.equal(ends.at(-1).result.details.shellSession.status, "completed");
  assert.ok([...shellUpdates, ...ends].every((event) => event.toolCallId === shellStart.toolCallId), "all updates stay attached to the original streamed call");
  assert.equal(await readFile(join(f.root, "starts.txt"), "utf8"), "one\n");
});

for (const mode of ["abort", "disconnect"]) {
  test(`Pi ${mode} stops a yielded process while the model is still thinking`, { timeout: 20_000 }, async (t) => {
    const f = await fixture(t, ({ response, count, root }) => {
      if (count === 1) return reply(response, shell, { command: command(join(root, "alive.mjs")), yield_time_ms: 0 });
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.flushHeaders();
    });
    await writeFile(join(f.root, "alive.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync('pid.txt', String(process.pid)); console.log('waiting indefinitely'); setInterval(() => {}, 1000);");
    const response = await f.chat(`shell-${mode}`);
    const reader = response.body.getReader();
    const deadline = Date.now() + 10_000;
    let pid;
    while (!pid) {
      try { pid = Number(await readFile(join(f.root, "pid.txt"), "utf8")); } catch {}
      assert.ok(Date.now() < deadline);
      if (!pid) await delay(30);
    }
    if (mode === "abort") {
      const result = await fetch(`${f.server.url}/api/pi/abort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: `shell-${mode}` }) });
      assert.equal((await result.json()).aborted, true);
      while (!(await reader.read()).done) {}
    } else {
      await reader.cancel();
    }
    let alive = true;
    while (alive && Date.now() < deadline) {
      try { process.kill(pid, 0); await delay(30); } catch { alive = false; }
    }
    assert.equal(alive, false, "yielded process was reaped independently of the active model request");
  });
}
