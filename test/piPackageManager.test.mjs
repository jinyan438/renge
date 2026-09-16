import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startRengeServer } from "../server.mjs";
import {
  createPiPackageManager,
  isPiPackageSource,
  normalizePiPackageSource,
} from "../pi/pi-package-manager.mjs";

test("recognizes npm Pi packages without stealing Tavern Git URLs", () => {
  assert.equal(isPiPackageSource("@ff-labs/pi-fff"), true);
  assert.equal(isPiPackageSource("npm:@ff-labs/pi-fff@0.10.6"), true);
  assert.equal(isPiPackageSource("pi:https://github.com/example/pi-plugin"), true);
  assert.equal(isPiPackageSource("https://github.com/zonde306/ST-Prompt-Template"), false);
  assert.equal(normalizePiPackageSource("@ff-labs/pi-fff"), "npm:@ff-labs/pi-fff");
  assert.equal(
    normalizePiPackageSource("pi:npm:@ff-labs/pi-fff@0.10.6"),
    "npm:@ff-labs/pi-fff@0.10.6",
  );
});

test("installs, disables, enables, and removes a native Pi package", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-package-manager-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const packageRoot = join(root, "fixture-package");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(join(packageRoot, "src"), { recursive: true }),
  ]);
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@renge-test/pi-fixture",
      version: "1.2.3",
      description: "Fixture Pi extension",
      license: "MIT",
      pi: { extensions: ["./src/index.mjs"] },
    }),
    "utf8",
  );
  await writeFile(
    join(packageRoot, "src", "index.mjs"),
    [
      "export default function fixture(pi) {",
      "  pi.registerCommand('fixture', { description: 'Fixture command', handler: async () => {} });",
      "  pi.registerTool({",
      "    name: 'fixture_search', label: 'Fixture search', description: 'Search fixture data',",
      "    parameters: { type: 'object', properties: {} },",
      "    execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }),",
      "  });",
      "  pi.on('session_start', async () => {});",
      "}",
    ].join("\n"),
    "utf8",
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const manager = createPiPackageManager({ cwd, agentDir });
  const extension = await manager.install(`pi:${packageRoot}`);
  assert.equal(extension.compatibility, "pi");
  assert.equal(extension.packageName, "@renge-test/pi-fixture");
  assert.equal(extension.version, "1.2.3");
  assert.equal(extension.piResources.extensions, 1);
  assert.ok(extension.capabilities.some((entry) => entry.includes("fixture_search")));
  assert.ok(extension.capabilities.some((entry) => entry.includes("fixture")));

  await manager.setEnabled(extension.piPackageSource, false);
  let settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
  assert.deepEqual(settings.packages[0].extensions, []);

  await manager.setEnabled(extension.piPackageSource, true);
  settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
  assert.equal(settings.packages[0], packageRoot);

  await manager.remove(extension.piPackageSource);
  settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
  assert.deepEqual(settings.packages, []);
});

test("Pi packages may register model tools during session_start", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-package-runtime-"));
  const dataDir = join(root, "data");
  const workspace = join(root, "workspace");
  const packageRoot = join(root, "dynamic-package");
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(join(packageRoot, "src"), { recursive: true }),
  ]);
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@renge-test/pi-dynamic-fixture",
      version: "1.0.0",
      pi: { extensions: ["./src/index.mjs"] },
    }),
    "utf8",
  );
  await writeFile(
    join(packageRoot, "src", "index.mjs"),
    [
      "export default function dynamicFixture(pi) {",
      "  pi.on('session_start', async () => {",
      "    pi.registerTool({",
      "      name: 'dynamic_fixture_search', label: 'Dynamic fixture search',",
      "      description: 'Search dynamic fixture data',",
      "      parameters: { type: 'object', properties: {} },",
      "      execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }),",
      "    });",
      "    pi.setActiveTools([...pi.getActiveTools(), 'dynamic_fixture_search']);",
      "  });",
      "}",
    ].join("\n"),
    "utf8",
  );

  let upstreamBody;
  const upstream = createServer(async (request, response) => {
    let rawBody = "";
    for await (const chunk of request) rawBody += chunk;
    upstreamBody = JSON.parse(rawBody);
    const base = {
      id: "dynamic-pi-extension",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "test-model",
    };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== "string");
  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
  t.after(async () => {
    await Promise.all([
      new Promise((resolve, reject) => renge.server.close((error) => error ? reject(error) : resolve())),
      new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve())),
    ]);
    await rm(root, { recursive: true, force: true });
  });

  const installResponse = await fetch(`${renge.url}/api/extensions/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: `pi:${packageRoot}` }),
  });
  assert.equal(installResponse.status, 200);
  assert.equal((await installResponse.json()).extension.compatibility, "pi");

  const chatResponse = await fetch(`${renge.url}/api/pi/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: "dynamic-extension-run",
      sessionId: "dynamic-extension-session",
      enableTools: true,
      apiBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
      apiKey: "test-key",
      apiType: "chat-completions",
      workspace: { kind: "electron", cwd: workspace },
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 256,
        stream: true,
      },
    }),
  });
  assert.equal(chatResponse.status, 200);
  assert.match(await chatResponse.text(), /\[DONE\]/);
  assert.ok(
    upstreamBody.tools.some((tool) => tool.function?.name === "dynamic_fixture_search"),
  );
});
