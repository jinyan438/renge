import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { VERSION, getAgentDir } from "@earendil-works/pi-coding-agent";
import { startRengeServer } from "../server.mjs";
import { configurePiAgentEnvironment } from "../pi/agent-environment.mjs";
import { createPiPackageManager } from "../pi/pi-package-manager.mjs";

test("Pi extension helpers use the application's agent directory and honor an explicit override", () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    delete process.env.PI_CODING_AGENT_DIR;
    const dataDir = resolve(".runtime", "taste-environment-fixture");
    assert.equal(configurePiAgentEnvironment(dataDir), join(dataDir, ".pi", "agent"));
    assert.equal(getAgentDir(), join(dataDir, ".pi", "agent"));
    process.env.PI_CODING_AGENT_DIR = join(dataDir, "custom");
    assert.equal(configurePiAgentEnvironment(dataDir), join(dataDir, "custom"));
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

const plugin = process.env.PI_GPT_WITH_TASTE_PACKAGE || join(process.env.APPDATA || tmpdir(), "Renge Agent Lab", ".pi", "agent", "git", "github.com", "SpadeLushen", "pi-gpt-with-taste");
test("real GPT with Taste installs and projects instructions without polluting sessions", {
  skip: !existsSync(join(plugin, "package.json")), timeout: 30_000,
}, async (t) => {
  assert.equal(VERSION, "1.2.0");
  const previous = process.env.PI_CODING_AGENT_DIR;
  const root = await mkdtemp(join(tmpdir(), "renge-taste-contract-"));
  const dataDir = join(root, "data");
  delete process.env.PI_CODING_AGENT_DIR;
  const agentDir = configurePiAgentEnvironment(dataDir);
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const forcedPackage = join(root, "forced-prompt");
  await mkdir(forcedPackage, { recursive: true });
  await writeFile(join(forcedPackage, "package.json"), JSON.stringify({ name: "forced-prompt-fixture", type: "module", pi: { extensions: ["./index.mjs"] } }));
  await writeFile(join(forcedPackage, "index.mjs"), `export default function(pi) {
    pi.on('before_agent_start', () => ({ systemPrompt: 'Forced project rules: preserve permissions and tools.' }));
  }`);
  const manager = createPiPackageManager({ cwd: workspace, agentDir });
  const installed = await manager.install(`pi:${resolve(plugin)}`);
  assert.equal(installed.packageName, "pi-gpt-with-taste");
  assert.equal(installed.piResources.extensions, 1);
  assert.ok(installed.capabilities.includes("命令：taste"));
  const loaded = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ ...loaded, packages: [...loaded.packages, forcedPackage] }));
  const requests = [];
  const upstream = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const message = { id: "msg-taste", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Taste fixture answer", annotations: [] }] };
    const events = request.url.endsWith("/responses") ? [
      { type: "response.created", response: { id: "resp-taste", object: "response", status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
      { type: "response.output_text.delta", output_index: 0, item_id: message.id, content_index: 0, delta: "Taste fixture answer" },
      { type: "response.output_item.done", output_index: 0, item: message },
      { type: "response.completed", response: { id: "resp-taste", object: "response", status: "completed", output: [message], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } },
    ] : [
      { id: "taste", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "Taste fixture answer" }, finish_reason: null }] },
      { id: "taste", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n");
  });
  let renge;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    upstream.closeAllConnections(); renge?.server.closeAllConnections();
    await Promise.all([new Promise((resolve) => upstream.close(resolve)), renge ? new Promise((resolve) => renge.server.close(resolve)) : Promise.resolve()]);
    await rm(root, { recursive: true, force: true });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir, piAgentDir: agentDir });
  const chat = async (content, apiType = "chat-completions", model = "gpt-taste-fixture") => {
    const response = await fetch(`${renge.url}/api/pi/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      sessionId: `taste-${apiType}`, apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture-key", apiType,
      enableTools: true, workspace: { kind: "electron", cwd: workspace }, piCompaction: { enabled: false },
      request: { model, messages: [{ role: "system", content: "Existing application instructions" }, { role: "user", content }], stream: true },
    }) });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.doesNotMatch(text, /"type":"extension_error"|"error":\{"message"/);
    return text;
  };
  const configDir = join(agentDir, "extensions", "pi-gpt-with-taste");
  await mkdir(configDir, { recursive: true });
  const providerIds = [];
  for (const apiType of ["chat-completions", "responses"]) {
    const status = await chat("/taste status", apiType);
    assert.match(status, /Active: no/);
    providerIds.push(status.match(/Selected model: ([^/]+)\/gpt-taste-fixture/)[1]);
  }
  assert.equal(requests.length, 0, "commands do not start model calls");
  await writeFile(join(configDir, "config.json"), JSON.stringify({ providers: providerIds }));
  const main = (await readFile(join(plugin, "resources", "instructions", "main.md"), "utf8")).trim();
  for (const apiType of ["chat-completions", "responses"]) {
    assert.match(await chat("/taste reload", apiType), /Active: yes/);
    const output = await chat("First matching input", apiType);
    assert.doesNotMatch(output, /<gpt-with-taste>/, "hidden request projection stays out of the rendered stream");
    const serialized = JSON.stringify(requests.at(-1));
    assert.ok(serialized.includes(JSON.stringify(main).slice(1, -1)), "the complete Main block reaches the wire");
    assert.match(serialized, /Forced project rules/);
    assert.equal((serialized.match(/<gpt-with-taste>/g) || []).length, 1, "the final-request guard does not duplicate the block");
    assert.match(serialized, /<gpt-with-taste-user-steer>/);
    assert.match(await chat("/taste off", apiType), /Active: no/);
    await chat("Disabled input", apiType);
    assert.doesNotMatch(JSON.stringify(requests.at(-1)), /<gpt-with-taste/);
    assert.match(await chat("/taste status", apiType), /disabled/, "branch overrides survive host session reconstruction");
    await chat("/taste on", apiType);
    await chat("/taste steer off", apiType);
    await chat("No steering input", apiType);
    assert.match(JSON.stringify(requests.at(-1)), /<gpt-with-taste>/);
    assert.doesNotMatch(JSON.stringify(requests.at(-1)), /<gpt-with-taste-user-steer>/);
    await chat("/taste reset", apiType);
    await chat("Reset input", apiType);
    assert.match(JSON.stringify(requests.at(-1)), /<gpt-with-taste-user-steer>/);
  }
  await chat("Different model", "chat-completions", "other-model");
  assert.doesNotMatch(JSON.stringify(requests.at(-1)), /<gpt-with-taste/);
  await writeFile(join(configDir, "config.json"), "{invalid json");
  assert.match(await chat("/taste on"), /Injection paused/);
  await chat("Invalid config input");
  assert.doesNotMatch(JSON.stringify(requests.at(-1)), /<gpt-with-taste/);
  const sessionRoot = join(dataDir, ".pi", "sessions");
  const files = await readdir(sessionRoot, { recursive: true });
  const stored = (await Promise.all(files.filter((file) => file.endsWith(".jsonl")).map((file) => readFile(join(sessionRoot, file), "utf8")))).join("\n");
  assert.match(stored, /gpt-with-taste:state/);
  assert.doesNotMatch(stored, /<gpt-with-taste>|gpt-with-taste:steer/);
  console.log("Real pi-gpt-with-taste passed: installation, scope, both API formats, forced prompts, commands, branch state and request-only projection.");
});
