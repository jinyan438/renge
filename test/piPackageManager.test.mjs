import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { startRengeServer } from "../server.mjs";
import { createHttpGitServer } from "./helpers/httpGitServer.mjs";
import { createPiRemovalFixture } from "./helpers/piRemovalFixture.mjs";
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

test("updates an installed native Pi package and preserves its enabled state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-package-update-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const packageRoot = join(root, "fixture-package");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(join(packageRoot, "src"), { recursive: true }),
  ]);
  const writeFixture = async (version) => {
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@renge-test/pi-update-fixture",
        version,
        description: "Fixture Pi extension for update",
        license: "MIT",
        pi: { extensions: ["./src/index.mjs"] },
      }),
      "utf8",
    );
  };
  await writeFixture("1.0.0");
  await writeFile(
    join(packageRoot, "src", "index.mjs"),
    [
      "export default function updateFixture(pi) {",
      "  pi.registerCommand('update_fixture', { description: 'Fixture', handler: async () => {} });",
      "}",
    ].join("\n"),
    "utf8",
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const manager = createPiPackageManager({ cwd, agentDir });
  const installed = await manager.install(`pi:${packageRoot}`);
  assert.equal(installed.version, "1.0.0");

  // The source package is bumped in place, then refreshed through update().
  await writeFixture("2.5.0");
  const updated = await manager.update(installed.piPackageSource);
  assert.equal(updated.packageName, "@renge-test/pi-update-fixture");
  assert.equal(updated.version, "2.5.0");
  assert.equal(updated.compatibility, "pi");

  // Disabling before an update must survive the refresh.
  await manager.setEnabled(installed.piPackageSource, false);
  let settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
  assert.deepEqual(settings.packages[0].extensions, []);

  await writeFixture("3.1.0");
  const updatedAgain = await manager.update(installed.piPackageSource);
  assert.equal(updatedAgain.version, "3.1.0");
  settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
  assert.deepEqual(
    settings.packages[0].extensions,
    [],
    "update() must not silently re-enable a disabled Pi package",
  );
});

test("rejects updating a Pi package that is not installed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-package-missing-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const manager = createPiPackageManager({ cwd, agentDir });
  await assert.rejects(
    () => manager.update("@renge-test/pi-never-installed"),
    /未安装/,
  );
});

test("deleting disabled npm and Git Pi packages persists before success and survives restart", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-remove-"));
  const fixture = await createPiRemovalFixture(root);
  let renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: fixture.dataDir });
  t.after(async () => {
    await new Promise((resolve) => renge.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const originalRemove = DefaultPackageManager.prototype.remove;
  let windowsFailureCount = 0;
  t.mock.method(DefaultPackageManager.prototype, "remove", async function (source, options) {
    if (source === fixture.gitSource && this.getInstalledPath(source, "user")) {
      windowsFailureCount += 1;
      throw Object.assign(new Error("Windows checkout is busy"), { code: "EPERM" });
    }
    return originalRemove.call(this, source, options);
  });
  for (const extension of fixture.targets) {
    const response = await fetch(`${renge.url}/api/extensions/${extension.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    const data = JSON.parse(await readFile(join(fixture.dataDir, "app-data.json"), "utf8"));
    assert.ok(!data.extensions.some((entry) => entry.id === extension.id));
    assert.ok(data.extensions.some((entry) => entry.id === fixture.kept.id));
    assert.equal(data.userProfile.nickname, "保留的用户资料");
    // Repeating a deletion must also clear an already absent installation.
    assert.equal((await fetch(`${renge.url}/api/extensions/${extension.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ piPackageSource: extension.sourceUrl }),
    })).status, 200);
  }
  assert.equal(windowsFailureCount, 1);
  assert.equal(await stat(fixture.npmPath).catch(() => null), null);
  assert.equal(await stat(fixture.gitPath).catch(() => null), null);
  assert.equal(await readFile(join(fixture.localPath, "keep.txt"), "utf8"), "keep local source");
  const settings = JSON.parse(await readFile(join(fixture.agentDir, "settings.json"), "utf8"));
  assert.deepEqual(settings.packages.map((entry) => entry.source), [fixture.localPath]);
  await new Promise((resolve) => renge.server.close(resolve));
  renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: fixture.dataDir });
  const restored = (await (await fetch(`${renge.url}/api/app-data`)).json()).data;
  assert.deepEqual(restored.extensions.map((entry) => entry.id), [fixture.kept.id]);
});

test("failed Pi uninstall keeps the installed card and configuration for a retry", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-remove-error-"));
  const fixture = await createPiRemovalFixture(root);
  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: fixture.dataDir });
  t.after(async () => {
    await new Promise((resolve) => renge.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  t.mock.method(DefaultPackageManager.prototype, "remove", async () => {
    throw Object.assign(new Error("Uninstall permission denied"), { code: "EACCES" });
  });
  const response = await fetch(`${renge.url}/api/extensions/${fixture.targets[1].id}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /permission denied/);
  assert.ok((await stat(fixture.gitPath)).isDirectory());
  const data = (await (await fetch(`${renge.url}/api/app-data`)).json()).data;
  assert.deepEqual(data.extensions.map((entry) => entry.id), [...fixture.targets, fixture.kept].map((entry) => entry.id));
  const settings = JSON.parse(await readFile(join(fixture.agentDir, "settings.json"), "utf8"));
  assert.ok(settings.packages.some((entry) => entry.source === fixture.gitSource));
});

test("updates an installed Tavern Git extension through the HTTP API", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-extension-update-api-"));
  const dataDir = join(root, "data");
  // The installer only accepts https:/http:/git: URLs, so the fixture lives in a
  // bare repository served over local HTTP via `git http-backend`.
  const repo = join(root, "owner", "repo");
  const work = join(root, "work");
  await mkdir(repo, { recursive: true });
  await mkdir(work, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const git = async (cwd, args) => {
    const { execFile } = await import("node:child_process");
    await new Promise((resolvePromise, rejectPromise) => {
      execFile("git", args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
        if (error) rejectPromise(new Error(String(stderr || stdout || error.message)));
        else resolvePromise();
      });
    });
  };
  const commitVersion = async (version) => {
    await writeFile(
      join(work, "manifest.json"),
      JSON.stringify({ display_name: "Update Fixture", version, js: ["index.js"] }),
      "utf8",
    );
    await writeFile(join(work, "index.js"), `window.fixtureVersion = ${JSON.stringify(version)};\n`, "utf8");
    await git(work, ["add", "-A"]);
    await git(work, ["-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-m", `v${version}`]);
    await git(work, ["push", "origin", "HEAD"]);
  };

  await git(root, ["init", "--bare", "-b", "main", repo]);
  await git(work, ["init", "-b", "main"]);
  await git(work, ["remote", "add", "origin", repo]);
  await commitVersion("1.0.0");

  const gitServer = await createHttpGitServer(root);
  t.after(() => gitServer.close());

  // The server spawns `git clone` with an inherited environment, so a machine-wide
  // http.proxy would otherwise hijack these loopback requests.
  const isolatedGitConfig = join(root, "gitconfig");
  await writeFile(isolatedGitConfig, "[http]\n\tproxy =\n[https]\n\tproxy =\n", "utf8");
  const previousGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = isolatedGitConfig;
  t.after(() => {
    if (previousGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousGitConfigGlobal;
  });

  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
  t.after(async () => {
    await new Promise((resolve, reject) => renge.server.close((error) => error ? reject(error) : resolve()));
  });

  const sourceUrl = `${gitServer.url}/owner/repo`;
  const installResponse = await fetch(`${renge.url}/api/extensions/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: sourceUrl }),
  });
  assert.equal(installResponse.status, 200);
  const installed = (await installResponse.json()).extension;
  assert.equal(installed.version, "1.0.0");

  await commitVersion("2.0.0");
  const updateResponse = await fetch(`${renge.url}/api/extensions/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: installed.id, sourceUrl: installed.sourceUrl }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = (await updateResponse.json()).extension;
  assert.equal(updated.id, installed.id);
  assert.equal(updated.version, "2.0.0");

  // The updated assets must be what the app now serves to the runtime.
  const served = await fetch(`${renge.url}/scripts/extensions/third-party/${installed.id}/index.js`);
  assert.equal(served.status, 200);
  assert.match(await served.text(), /2\.0\.0/);
});

test("rejects an extension update with neither a Pi package nor a source URL", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-extension-update-bad-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  t.after(async () => {
    await new Promise((resolve, reject) => renge.server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await fetch(`${renge.url}/api/extensions/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "some-extension" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /缺少扩展来源/);
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
