import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startRengeServer } from "../server.mjs";
import { createPiExtensionUi } from "../pi/extension-ui.mjs";
import { getPiExtensionDisplayText, normalizePiExtensionResult, normalizePiExtensionText } from "../src/piExtensionText.mjs";

test("terminal search output preserves safe links and removes terminal controls", () => {
  const osc = (url, text, end = "\x1b\\") => `\x1b]8;;${url}${end}${text}\x1b]8;;${end}`;
  assert.equal(normalizePiExtensionText(`\x1b[31mSources\x1b[0m ${osc("https://example.com/a(b)", "[1]")}`),
    "Sources [1](https://example.com/a%28b%29)");
  assert.equal(normalizePiExtensionText(osc("https://example.com", "Source", "\x07")), "[Source](https://example.com)");
  assert.equal(normalizePiExtensionText(osc("javascript:alert(1)", "unsafe")), "unsafe");
  assert.equal(normalizePiExtensionText(osc("https://example.com\nunsafe", "text")), "text");
  assert.equal(normalizePiExtensionText("a\x1b]0;title\x07b\x1b[2J\nc"), "ab\nc");
  assert.equal(getPiExtensionDisplayText({ text: "result", details: { secret: "private" } }), "result");
  assert.equal(getPiExtensionDisplayText({ type: "image", data: "private" }), "");
  const image = { type: "image", data: "image", mimeType: "image/png" };
  const details = { results: [{ url: "https://example.com" }] };
  const result = normalizePiExtensionResult({ content: [{ type: "text", text: osc("https://example.com", "source") }, image], details });
  assert.equal(result.content[0].text, "[source](https://example.com)");
  assert.equal(result.content[1], image);
  assert.equal(result.details, details);
});

test("extension dialogs validate choices and settle on timeout, cancellation and run abort", async () => {
  const controller = new AbortController();
  const events = [];
  const ui = createPiExtensionUi({ signal: controller.signal, emit: (event) => events.push(event) });
  const select = ui.context.select("Choose", ["one", "two"]);
  assert.equal(ui.respond(events.at(-1).id, { value: "unlisted" }), true);
  assert.equal(await select, undefined);
  const confirm = ui.context.confirm("Confirm", "Continue?");
  const confirmId = events.at(-1).id;
  ui.respond(confirmId, { confirmed: true });
  assert.equal(await confirm, true);
  assert.equal(ui.respond(confirmId, { confirmed: true }), false);
  assert.equal(await ui.context.input("Timeout", "", { timeout: 5 }), undefined);
  assert.equal(events.at(-1).type, "extension_ui_cancel");
  const local = new AbortController();
  const input = ui.context.input("Cancel", "", { signal: local.signal });
  local.abort();
  assert.equal(await input, undefined);
  const editor = ui.context.editor("Edit", "prefill");
  const runConfirm = ui.context.confirm("Run", "Continue?");
  controller.abort();
  assert.equal(await editor, undefined);
  assert.equal(await runConfirm, false);
  assert.equal(await ui.context.input("Aborted"), undefined);
});

const fixtureSource = `export default function (pi) {
  pi.registerEntryRenderer('search-output', (entry) => ({ render: () => [entry.data.text] }));
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI || ctx.mode !== 'rpc') throw new Error('RPC UI missing');
    ctx.ui.notify('Extension ready');
    pi.appendEntry('private-state', { text: 'INTERNAL STATE MUST NOT DISPLAY' });
  });
  pi.registerCommand('fixture-search', { handler: async (args, ctx) => {
    if (!args) { ctx.ui.notify('Search query required', 'warning'); return; }
    if (args === 'throw') throw new Error('Fixture command failed');
    if (args === 'stop') {
      ctx.ui.setStatus('search', 'Waiting for cancellation');
      await new Promise((resolve) => ctx.signal.addEventListener('abort', resolve, { once: true }));
      return;
    }
    if (args === 'dialog') {
      const value = await ctx.ui.input('Search query', 'Enter query');
      const confirmed = await ctx.ui.confirm('Run search', value || 'cancelled');
      const scope = await ctx.ui.select('Search scope', ['docs', 'web']);
      const note = await ctx.ui.editor('Search note', 'original');
      pi.appendEntry('search-output', { text: JSON.stringify({ value, confirmed, scope, note }) });
      return;
    }
    ctx.ui.setStatus('search', 'Searching ' + args);
    pi.appendEntry('search-output', { text: 'Search results: ' + args + '\\n\\x1b]8;;https://example.com\\x1b\\\\Source\\x1b]8;;\\x1b\\\\' });
    pi.sendMessage({ customType: 'notice', content: 'Visible custom message', display: true });
    pi.sendMessage({ customType: 'hidden', content: 'Hidden custom message', display: false });
    ctx.ui.notify('Search complete');
    ctx.ui.setStatus('search', undefined);
  }});
  pi.registerTool({ name: 'fixture_search', label: 'Search', description: 'Search fixture',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: async (_id, args, _signal, update) => {
      update({ content: [{ type: 'text', text: 'Searching ' + args.query }], details: { status: 'searching' } });
      return { content: [{ type: 'text', text: '\\x1b[32mSearch result\\x1b[0m' }], details: { results: [{ title: args.query, url: 'https://example.com' }] } };
    }
  });
}`;

function eventsFrom(text) {
  return text.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
}
async function readEvent(reader, type, method) {
  let text = "";
  while (true) {
    const next = await reader.read();
    assert.equal(next.done, false, `stream ended before ${type}/${method}`);
    text += new TextDecoder().decode(next.value);
    const event = eventsFrom(text).find((event) => event.pi?.type === type && (!method || event.pi.method === method));
    if (event) return event.pi;
  }
}

test("Pi host bridges search commands, lifecycle output, custom entries/messages, tool updates and dialogs", { timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-extension-ui-"));
  const agentDir = join(root, "agent");
  const packageRoot = join(root, "plugin");
  await mkdir(agentDir, { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "pi-search-fixture", version: "1.0.0", type: "module", pi: { extensions: ["./index.mjs"] } }));
  await writeFile(join(packageRoot, "index.mjs"), fixtureSource);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [packageRoot] }));
  const upstreamRequests = [];
  const upstream = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); upstreamRequests.push(body);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = upstreamRequests.length === 1
      ? { tool_calls: [{ index: 0, id: "search-1", type: "function", function: { name: "fixture_search", arguments: '{"query":"SDK compatibility"}' } }] }
      : { content: "Search answer" };
    for (const choice of [ { delta: { role: "assistant", ...delta }, finish_reason: null }, { delta: {}, finish_reason: upstreamRequests.length === 1 ? "tool_calls" : "stop" } ]) {
      response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture-model", choices: [{ index: 0, ...choice }] })}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data"), piAgentDir: agentDir });
  t.after(async () => {
    upstream.closeAllConnections(); renge.server.closeAllConnections();
    await Promise.all([new Promise((resolve) => upstream.close(resolve)), new Promise((resolve) => renge.server.close(resolve))]);
    await rm(root, { recursive: true, force: true });
  });
  let index = 0;
  const post = (path, body) => fetch(`${renge.url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const chat = (content) => post("/api/pi/chat", {
    runId: `extension-run-${++index}`, sessionId: "extension-session", enableTools: true,
    apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture-key", apiType: "chat-completions",
    piCompaction: { enabled: false }, request: { model: "fixture-model", messages: [{ role: "user", content }], stream: true },
  });
  const direct = eventsFrom(await (await chat("/fixture-search Renge")).text());
  assert.equal(upstreamRequests.length, 0, "direct search commands do not invoke the model");
  assert.ok(direct.some((event) => event.pi?.method === "notify" && event.pi.message === "Extension ready"), "session_start output arrives before run_ready");
  assert.ok(direct.some((event) => event.pi?.method === "setStatus" && event.pi.statusText === "Searching Renge"));
  assert.equal(direct.filter((event) => event.pi?.type === "extension_entry").length, 1, "only entries with registered renderers are displayed");
  assert.match(getPiExtensionDisplayText(direct.find((event) => event.pi?.type === "extension_entry").pi.entry.data), /\[Source\]\(https:\/\/example.com\)/);
  assert.equal(direct.filter((event) => event.pi?.type === "extension_message").length, 1, "display:false messages stay hidden");
  const empty = await (await chat("/fixture-search")).text();
  assert.match(empty, /Search query required/);
  assert.equal(upstreamRequests.length, 0);
  const failed = eventsFrom(await (await chat("/fixture-search throw")).text());
  assert.ok(failed.some((event) => event.pi?.type === "extension_error" && event.pi.error.includes("Fixture command failed")));

  const tools = eventsFrom(await (await chat("Search using a tool")).text());
  assert.equal(upstreamRequests.length, 2);
  assert.ok(upstreamRequests[0].tools.some((tool) => tool.function.name === "fixture_search"));
  assert.ok(tools.some((event) => event.pi?.type === "tool_update" && event.pi.result.details.status === "searching"));
  const end = tools.find((event) => event.pi?.type === "tool_end").pi;
  assert.equal(end.result.content[0].text, "Search result");
  assert.equal(end.result.details.results[0].url, "https://example.com");
  assert.doesNotMatch(JSON.stringify(upstreamRequests), /Search results: Renge|INTERNAL STATE MUST NOT DISPLAY/, "custom entries are persisted outside model context");

  const dialogResponse = await chat("/fixture-search dialog");
  const reader = dialogResponse.body.getReader();
  for (const [method, answer] of [["input", { value: "Renge docs" }], ["confirm", { confirmed: true }], ["select", { value: "docs" }], ["editor", { value: "edited note" }]]) {
    const event = await readEvent(reader, "extension_ui_request", method);
    const response = await post("/api/pi/extension-ui-response", { runId: event.runId, id: event.id, ...answer });
    assert.equal(response.status, 200);
  }
  let tail = ""; while (true) { const { done, value } = await reader.read(); if (done) break; tail += new TextDecoder().decode(value); }
  assert.match(tail, /edited note/);
  assert.equal((await post("/api/pi/extension-ui-response", { runId: "missing", id: "missing" })).status, 404);
  const stoppedResponse = await chat("/fixture-search stop");
  const stoppedReader = stoppedResponse.body.getReader();
  const waiting = await readEvent(stoppedReader, "extension_ui_request", "setStatus");
  assert.equal((await post("/api/pi/abort", { runId: waiting.runId })).status, 200);
  while (!(await stoppedReader.read()).done) {}
  const files = await readdir(join(root, "data", ".pi", "sessions"), { recursive: true });
  const sessionText = (await Promise.all(files.filter((file) => file.endsWith(".jsonl")).map((file) => readFile(join(root, "data", ".pi", "sessions", file), "utf8")))).join("\n");
  assert.match(sessionText, /search-output/);
});
