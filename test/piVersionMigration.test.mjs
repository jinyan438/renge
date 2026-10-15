import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ModelRuntime, ProjectTrustStore, serializeConversation, VERSION } from "@earendil-works/pi-coding-agent";
import { startRengeServer } from "../server.mjs";

function eventsFrom(sse) {
  return sse.split(/\r?\n/).filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)));
}

async function fixture(t, settings = {}) {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-migration-"));
  const cwd = join(root, "workspace"), agentDir = join(root, "agent"), packageDir = join(root, "extension");
  await Promise.all([cwd, agentDir, packageDir].map((path) => mkdir(path, { recursive: true })));
  await copyFile(new URL("./fixtures/pi-migration-extension.mjs", import.meta.url), join(packageDir, "index.mjs"));
  await writeFile(join(packageDir, "package.json"), JSON.stringify({ name: "migration-fixture", type: "module", pi: { extensions: ["index.mjs"] } }));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [packageDir], ...settings }));
  const requests = [];
  let plan = [], callIndex = 0;
  const upstream = createServer(async (request, response) => {
    let raw = ""; for await (const part of request) raw += part;
    const body = JSON.parse(raw); requests.push(body);
    const planned = plan[callIndex++];
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const tools = Array.isArray(planned) ? planned : [];
    const delta = tools.length ? { tool_calls: tools.map((tool, index) => ({ index, id: tool.id, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args || {}) } })) } : { content: "Audit answer" };
    response.end([
      { id: "audit", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }] },
      { id: "audit", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: tools.length ? "tool_calls" : "stop" }] },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n");
  });
  await new Promise((done) => upstream.listen(0, "127.0.0.1", done));
  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data"), piAgentDir: agentDir });
  t.after(async () => {
    // Wait for asynchronous session_shutdown and native transport teardown too.
    renge.server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise((done) => renge.server.close(done)), new Promise((done) => upstream.close(done))]);
    await renge.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const post = (path, body, method = "POST") => fetch(`${renge.url}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let sequence = 0;
  const chat = async (content, steps = [], extra = {}) => {
    plan = steps; callIndex = 0;
    const response = await post("/api/pi/chat", {
      runId: `audit-${++sequence}`, sessionId: `audit-session-${sequence}`,
      apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture-key", apiType: "chat-completions",
      workspace: { kind: "electron", cwd }, enableTools: true, piCompaction: { enabled: false },
      request: { model: "audit-model", messages: [{ role: "user", content }], stream: true }, ...extra,
    });
    assert.equal(response.status, 200);
    return response;
  };
  const completed = async (...args) => {
    const events = eventsFrom(await (await chat(...args)).text());
    assert.ok(!events.some((event) => event.error || event.pi?.type === "extension_error"), JSON.stringify(events.filter((event) => event.error || event.pi?.type === "extension_error")));
    return events;
  };
  return { root, cwd, agentDir, packageDir, requests, post, chat, completed, upstreamUrl: `http://127.0.0.1:${upstream.address().port}/v1` };
}

test("0.99.0/1.1.0: nested tools retain identity, structured errors, timings and settlement", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const events = await f.completed("nested operations", [[
    { id: "parent", name: "audit_parent" }, { id: "direct-leaf", name: "audit_leaf", args: { text: "direct leaf" } },
  ]]);
  const ends = events.filter((event) => event.pi?.type === "tool_end").map((event) => event.pi);
  const child = ends.find((event) => event.parentToolCallId);
  assert.equal(child.parentToolCallId, "parent");
  assert.equal(child.toolCallId, "parent/1");
  assert.equal(child.isError, true);
  assert.deepEqual(child.result.structuredContent, ["nested failure"]);
  assert.ok(ends.some((event) => event.toolCallId === "direct-leaf" && !event.parentToolCallId && !event.isError));
  assert.ok(ends.every((event) => Number.isFinite(event.durationMs) && event.durationMs >= 0));
  assert.ok(events.some((event) => event.pi?.type === "tool_update" && event.pi.parentToolCallId === "parent"));
  assert.ok(events.some((event) => event.pi?.type === "agent_settled" && event.pi.aborted === false));
  assert.ok(events.some((event) => event.pi?.message?.match(/^audit-settled:false:[1-9]/)), "parsed provider events reach extensions");
  assert.ok(!f.requests[0].tools.some((tool) => ["audit_hidden", "codemode", "tool_search"].includes(tool.function.name)), "inactive and hidden tools stay out of the wire catalog");
  const files = await readdir(join(f.root, "data", ".pi", "sessions"), { recursive: true });
  const saved = await readFile(join(f.root, "data", ".pi", "sessions", files.find((file) => file.endsWith(".jsonl"))), "utf8");
  assert.match(saved, /"nestedCalls"/);
  assert.match(saved, /"status":"error"/);
  const parentResult = saved.split("\n").filter(Boolean).map(JSON.parse).find((entry) => entry.message?.role === "toolResult" && entry.message.toolName === "audit_parent").message;
  assert.equal(parentResult.usage.totalTokens, 10, "nested usage is added to the parent result");
});

test("1.2.0: a command-triggered custom run retains setup through its tool round", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const events = await f.completed("/audit-trigger", [[{ id: "custom-leaf", name: "audit_leaf" }]]);
  assert.equal(f.requests.length, 2, "the host waits for the asynchronous custom turn");
  for (const request of f.requests) assert.match(JSON.stringify(request.messages), /AUDIT_SETUP/);
  assert.match(JSON.stringify(f.requests[0]), /NEXT_TURN_CONTEXT/);
  assert.ok(events.some((event) => event.pi?.message === "audit-start:custom:busy"));
  assert.ok(events.some((event) => event.choices?.[0]?.delta?.content === "Audit answer"));
  assert.ok(events.some((event) => event.pi?.type === "agent_settled" && event.pi.aborted === false));
});

test("1.2.0: cancelling during before_agent_start prevents the provider request", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const response = await f.chat("hold-start");
  const reader = response.body.getReader(); let output = "";
  while (!output.includes("audit-start-blocked")) {
    const { done, value } = await reader.read(); assert.equal(done, false);
    output += new TextDecoder().decode(value);
  }
  assert.equal((await f.post("/api/pi/abort", { runId: "audit-1" })).status, 200);
  while (true) { const { done, value } = await reader.read(); if (done) break; output += new TextDecoder().decode(value); }
  assert.equal(f.requests.length, 0);
  const events = eventsFrom(output);
  assert.ok(events.some((event) => event.pi?.message === "audit-start:user:busy"));
  assert.ok(events.some((event) => event.pi?.type === "agent_settled" && event.pi.aborted === true));
});

test("0.99.0: extension virtual models route to physical models and persist router state", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  await f.completed("/audit-virtual");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].model, "audit-model");
  const files = await readdir(join(f.root, "data", ".pi", "sessions"), { recursive: true });
  const saved = await readFile(join(f.root, "data", ".pi", "sessions", files.find((file) => file.endsWith(".jsonl"))), "utf8");
  assert.match(saved, /pi.virtual-model-state/);
  assert.match(saved, /"routed":true/);
});

test("0.99.0–1.2.0: native MCP and codemode run in the embedded Windows host", { timeout: 40_000 }, async (t) => {
  const f = await fixture(t, { defaultTools: ["+codemode"] });
  const server = { command: process.execPath, args: [resolve("test/fixtures/mcp-stdio-server.mjs")], exposure: "direct" };
  await writeFile(join(f.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { "audit-server": server } }));
  const events = await f.completed("native MCP operation", [[{ id: "native", name: "mcp__audit_server__echo", args: { text: "native MCP answer" } }]]);
  assert.ok(f.requests[0].tools.some((tool) => tool.function.name === "mcp__audit_server__echo"));
  assert.ok(events.some((event) => event.pi?.type === "tool_end" && JSON.stringify(event.pi.result).includes("native MCP answer") && !event.pi.isError));
  const coded = await f.completed("codemode operation", [[{ id: "code", name: "codemode", args: { code: 'text(await describeNamespace("audit-alias")); text(await describeTool("audit_leaf")); text(await tools.audit_leaf({text:"script answer"}));' } }]]);
  const codeEnd = coded.find((event) => event.pi?.type === "tool_end" && event.pi.toolName === "codemode")?.pi;
  assert.equal(codeEnd?.isError, false, JSON.stringify(codeEnd));
  assert.match(JSON.stringify(codeEnd.result), /script answer/);
  assert.match(JSON.stringify(codeEnd.result), /@minimum 1/);
  assert.ok(coded.some((event) => event.pi?.parentToolCallId === "code"));
  const invalid = await f.completed("invalid pragma", [[{ id: "bad-code", name: "codemode", args: { code: 'text("before");\n// @options: {"timeout_ms":100}\ntext("after");' } }]]);
  assert.equal(invalid.find((event) => event.pi?.toolName === "codemode" && event.pi?.type === "tool_end")?.pi.isError, true);
});

test("1.2.0: compaction serialization excludes thinking while preserving ordinary content", () => {
  assert.equal(VERSION, "1.2.0");
  const serialized = serializeConversation([{ role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE_THOUGHT" }, { type: "text", text: "Visible response" }], timestamp: Date.now() }]);
  assert.match(serialized, /Visible response/);
  assert.doesNotMatch(serialized, /PRIVATE_THOUGHT/);
});

test("0.99.0/1.0.0/1.1.0: extension model APIs resolve credentials for images and classification", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, { defaultTools: ["+codemode"] });
  const events = await f.completed("/audit-model-operations");
  assert.ok(events.some((event) => event.pi?.message === "audit-operations:stop:stop"), JSON.stringify(events));
  assert.equal(f.requests.length, 0);
  const scripted = await f.completed("Model operations in codemode", [[{ id: "models", name: "codemode", args: {
    code: `const painter = await models.getModelOfType("image", "audit-operations", "image");
      const judge = await models.getModelOfType("classifier", "audit-operations", "classifier");
      text((await models.generateImages(painter, {input:[{type:"text",text:"fixture"}]})).stopReason);
      text((await models.classify(judge, {
        state: {}, questions: { ok: { type: "bool", instructions: "Fixture decision", criteria: {true:"Accept",false:"Reject"} } },
        images: [{type:"image",data:"aW1hZ2U=",mimeType:"image/png"}],
      })).stopReason);`,
  } }]]);
  const result = scripted.find((event) => event.pi?.toolName === "codemode" && event.pi?.type === "tool_end").pi;
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.match(JSON.stringify(result.result), /stop/);
});

test("1.0.2: thinking-level sampling overrides survive runtime provider registration", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const runtime = await ModelRuntime.create({ authPath: join(f.agentDir, "sample-auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("audit-sampling", {
    baseUrl: f.upstreamUrl, apiKey: "fixture-sampling", api: "openai-completions",
    models: [{ id: "sample", name: "Sample", reasoning: true, contextWindow: 8192, maxTokens: 1024,
      input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      samplingParams: { temperature: 0.7, top_p: 0.9 }, samplingParamsByThinkingLevel: { high: { temperature: 0.2 } } }],
  });
  const reply = await runtime.completeSimple(runtime.getModel("audit-sampling", "sample"), { messages: [{ role: "user", content: "Sampling fixture", timestamp: Date.now() }] }, { reasoning: "high" });
  assert.equal(reply.stopReason, "stop");
  assert.equal(f.requests.at(-1).temperature, 0.2);
  assert.equal(f.requests.at(-1).top_p, 0.9);
});

test("0.99.2/1.0.1/1.2.0: MCP registration, project overrides, name collisions and non-object results", { timeout: 40_000 }, async (t) => {
  const f = await fixture(t);
  const log = join(f.root, "mcp-requests.txt");
  const config = { command: process.execPath, args: [resolve("test/fixtures/mcp-migration-server.mjs"), log], exposure: "direct" };
  await writeFile(join(f.packageDir, "migration-mcp.json"), JSON.stringify(config));
  await f.completed("List registered tools");
  const names = f.requests.at(-1).tools.map((tool) => tool.function.name).filter((name) => name.startsWith("mcp__registered_server__read_file"));
  assert.equal(names.length, 2);
  assert.equal(new Set(names).size, 2);
  const events = await f.completed("Call colliding tools", [names.map((name, index) => ({ id: `collision-${index}`, name }))]);
  const results = events.filter((event) => event.pi?.type === "tool_end" && names.includes(event.pi.toolName)).map((event) => event.pi);
  assert.equal(results.length, 2);
  assert.ok(results.every((event) => event.isError === false));
  assert.ok(results.some((event) => event.result.structuredContent.structuredContent === null));
  assert.ok(results.some((event) => Array.isArray(event.result.structuredContent.structuredContent)));
  assert.doesNotMatch(await readFile(log, "utf8"), /resources\/list/);

  // Test trusted project-only disabling separately from extension registrations.
  await rm(join(f.packageDir, "migration-mcp.json"));
  await writeFile(join(f.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { project: config } }));
  await mkdir(join(f.cwd, ".pi"));
  await writeFile(join(f.cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { project: { enabled: false } } }));
  new ProjectTrustStore(f.agentDir).set(f.cwd, true);
  await f.completed("Disabled for this project");
  assert.ok(!f.requests.at(-1).tools.some((tool) => tool.function.name.startsWith("mcp__project__")));
  const countBefore = (await readFile(log, "utf8")).split("initialize").length;
  await f.completed("Tools explicitly disabled", [], { enableTools: false });
  assert.equal(f.requests.at(-1).tools, undefined);
  assert.equal((await readFile(log, "utf8")).split("initialize").length, countBefore);
});

test("0.99.2/1.0.4: reload and host replacement emit session_shutdown before disposal", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  await f.completed("First run", [], { sessionId: "lifecycle" });
  await f.completed("/audit-reload", [], { sessionId: "lifecycle" });
  const shutdowns = (await readFile(join(f.cwd, "shutdown-events.txt"), "utf8")).trim().split("\n");
  assert.deepEqual(shutdowns, ["resume", "reload"]);
  assert.equal((await f.post("/api/pi/session", { sessionId: "lifecycle" }, "DELETE")).status, 200);
  assert.match(await readFile(join(f.cwd, "shutdown-events.txt"), "utf8"), /quit\n$/);
});

test("0.99.2–1.2.0: codemode validates images and separates output; read images survive script calls", { timeout: 40_000 }, async (t) => {
  const f = await fixture(t, { defaultTools: ["+codemode"] });
  const run = async (code, extra) => {
    const events = await f.completed("Script regression", [[{ id: "script", name: "codemode", args: { code } }]], extra);
    return events.find((event) => event.pi?.toolName === "codemode" && event.pi?.type === "tool_end").pi;
  };
  const output = await run('text("first-output"); text("second-output"); console.log("console-output");');
  assert.equal(output.isError, false);
  assert.match(JSON.stringify(output.result), /==> text 1\/2 <==/);
  assert.match(JSON.stringify(output.result), /console_output/);
  const invalidImage = await run('image({data:"not-base64!",mimeType:"image/png"});');
  assert.equal(invalidImage.isError, true);
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
  await writeFile(join(f.cwd, "pixel.png"), Buffer.from(png, "base64"));
  const image = await run('image(await tools.read({path:"pixel.png"}));', { allowImageInputs: true });
  assert.equal(image.isError, false, JSON.stringify(image));
  assert.ok(image.result.content.some((block) => block.type === "image"));
  assert.match(JSON.stringify(image.result), /saved|\.png/i);
  const patch = await run('Array.prototype.toJSON = () => "patched"; text([1,2]);');
  assert.ok(!JSON.stringify(patch.result).includes('"text":"patched"'));
  const outsidePath = join(f.root, "outside.txt");
  const denied = await run(`await tools.write({path:${JSON.stringify(outsidePath)},content:"must not write"});`);
  assert.equal(denied.isError, true, "nested calls retain the host's workspace authorization");
  await assert.rejects(access(outsidePath));
  assert.equal((await run('text("still healthy");')).isError, false);
});

test("0.99.0: queued input runs extension handlers and returns handled or queued disposition", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const response = await f.chat("queue test", [[{ id: "wait", name: "audit_wait" }]]);
  const reader = response.body.getReader(); let output = "";
  while (!output.includes("audit-queue-wait")) {
    const { done, value } = await reader.read(); assert.equal(done, false);
    output += new TextDecoder().decode(value);
  }
  for (const [id, content, disposition] of [["transformed", "transform-queued original", "queued"], ["handled", "handle-queued original", "handled"]]) {
    const result = await (await f.post("/api/pi/input", { runId: "audit-1", sessionId: "audit-session-1", inputId: id, content, mode: "steer" })).json();
    assert.equal(result.disposition, disposition);
  }
  const dialog = eventsFrom(output).find((event) => event.pi?.title === "audit-queue-wait").pi;
  assert.equal((await f.post("/api/pi/extension-ui-response", { runId: "audit-1", id: dialog.id, confirmed: true })).status, 200);
  while (true) { const { done, value } = await reader.read(); if (done) break; output += new TextDecoder().decode(value); }
  const serialized = JSON.stringify(f.requests.at(-1));
  assert.match(serialized, /transformed queued input/);
  assert.doesNotMatch(serialized, /transform-queued original|handle-queued original|rengeInputId/);
  const delivered = eventsFrom(output).filter((event) => event.pi?.type === "input_delivered");
  assert.deepEqual(delivered.map((event) => event.pi.inputId).sort(), ["handled", "transformed"]);
});

test("0.99.0/0.99.2/1.0.4/1.1.0: default tool modifiers, reload and codemode-only loadout", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, { defaultTools: ["+codemode", "-write"] });
  await f.completed("Tool defaults");
  const names = f.requests.at(-1).tools.map((tool) => tool.function.name);
  assert.ok(names.includes("codemode"));
  assert.ok(!names.includes("write"));
  await writeFile(join(f.agentDir, "settings.json"), JSON.stringify({ packages: [f.packageDir], defaultTools: ["+codemode"], codemode: { mode: "only" } }));
  await f.completed("Codemode-only loadout");
  assert.deepEqual(f.requests.at(-1).tools.map((tool) => tool.function.name), ["codemode"]);
  await writeFile(join(f.agentDir, "settings.json"), JSON.stringify({ packages: [f.packageDir] }));
  const events = await f.completed("/audit-enable-codemode");
  assert.ok(events.some((event) => event.pi?.message?.startsWith("audit-reloaded:") && event.pi.message.split(":")[1].split(",").includes("codemode")));
});

test("0.99.1/1.0.3: SDK catalog contains GPT-6.1 and the renamed Azure provider", async () => {
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  for (const provider of ["openai", "azure", "openai-codex"]) assert.ok(runtime.getModel(provider, "gpt-6.1-sol"));
  assert.equal(runtime.getProvider("azure-openai-responses"), undefined);
});

test("1.2.0: messages submitted during setup join the starting run without parallel-start errors", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  await f.completed("startup-messages");
  assert.equal(f.requests.length, 2);
  assert.match(JSON.stringify(f.requests), /CUSTOM_DURING_START/);
  assert.match(JSON.stringify(f.requests.at(-1)), /USER_DURING_START/);
});

test("0.99.2: invalid command registration reports a load error without crashing the host", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.packageDir, "index.mjs"), 'export default function(pi) { pi.registerCommand(undefined, {description:"invalid",handler(){}}); }');
  const events = eventsFrom(await (await f.chat("Still usable")).text());
  assert.ok(events.some((event) => event.pi?.type === "extension_error" && event.pi.event === "load"));
  assert.ok(events.some((event) => event.choices?.[0]?.delta?.content === "Audit answer"));
});
