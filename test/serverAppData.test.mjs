import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeUpstreamErrorMessage,
  parsePiSkillMetadata,
  rewriteTavernModuleImports,
  startRengeServer,
} from "../server.mjs";

test("reduces HTML upstream failures to a readable error message", () => {
  assert.equal(
    normalizeUpstreamErrorMessage(
      '<!DOCTYPE html><html><head><title>Error</title></head><body><pre>Internal Server Error</pre></body></html>',
      "Internal Server Error",
    ),
    "Internal Server Error",
  );
});

test("parses Pi native Skill frontmatter and rejects legacy Markdown metadata", () => {
  assert.deepEqual(
    parsePiSkillMetadata([
      "---",
      "name: video-prompts",
      "description: Writes production-ready video prompts when users request video generation.",
      "---",
      "",
      "# Video prompts",
    ].join("\n")),
    {
      name: "video-prompts",
      description: "Writes production-ready video prompts when users request video generation.",
      frontmatter: {
        name: "video-prompts",
        description: "Writes production-ready video prompts when users request video generation.",
      },
      body: "\n# Video prompts",
    },
  );
  assert.throws(
    () => parsePiSkillMetadata("# Legacy Skill\n\nThis is not Pi frontmatter."),
    /Pi 原生 YAML frontmatter/,
  );
  assert.equal(parsePiSkillMetadata([
    "---",
    "name: 中文 Skill 名称",
    "description: Pi reports a validation warning but still loads this Skill.",
    "---",
  ].join("\n")).name, "中文 Skill 名称");
});

test("imports and updates Pi native Skills through the Renge management API", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-pi-skill-test-"));
  const dataDir = join(root, "data");
  const sourceDir = join(root, "source-skill");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, "SKILL.md"), [
    "---",
    "name: original-skill",
    "description: Original Pi skill description.",
    "license: MIT",
    "---",
    "",
    "# Original instructions",
  ].join("\n"), "utf8");

  const controller = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
  t.after(async () => {
    await new Promise((resolve, reject) => {
      controller.server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(root, { recursive: true, force: true });
  });

  const importResponse = await fetch(`${controller.url}/api/skills/import-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: sourceDir }),
  });
  assert.equal(importResponse.status, 200);
  const imported = (await importResponse.json()).skill;
  assert.equal(imported.name, "original-skill");
  assert.equal(imported.description, "Original Pi skill description.");
  assert.equal(imported.entryFile, "SKILL.md");

  const updateResponse = await fetch(`${controller.url}/api/skills/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      skill: {
        ...imported,
        name: "updated-skill",
        description: "Updated natively from the Renge management UI.",
      },
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = (await updateResponse.json()).skill;
  assert.equal(updated.name, "updated-skill");

  const metadataResponse = await fetch(`${controller.url}/api/skills/metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills: [imported] }),
  });
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.errors.length, 0);
  assert.equal(metadata.skills[0].name, "updated-skill");
  assert.equal(metadata.skills[0].description, "Updated natively from the Renge management UI.");

  const saved = parsePiSkillMetadata(await readFile(join(imported.path, "SKILL.md"), "utf8"));
  assert.equal(saved.frontmatter.license, "MIT");
  assert.match(saved.body, /Original instructions/);

  const legacyDir = join(dataDir, "skills", "legacy-skill");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, "SKILL.md"), "# Legacy instructions\n", "utf8");
  const legacySkill = {
    ...imported,
    id: "legacy-skill",
    name: "legacy-skill",
    description: "Converted from the old Renge format.",
    path: legacyDir,
  };
  const invalidMetadataResponse = await fetch(`${controller.url}/api/skills/metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills: [legacySkill] }),
  });
  const invalidMetadata = await invalidMetadataResponse.json();
  assert.equal(invalidMetadata.skills[0].enabled, false);
  assert.equal(invalidMetadata.skills[0].piNativeValid, false);

  const migrateResponse = await fetch(`${controller.url}/api/skills/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skill: legacySkill }),
  });
  assert.equal(migrateResponse.status, 200);
  const migrated = (await migrateResponse.json()).skill;
  assert.equal(migrated.piNativeValid, true);
  assert.match(await readFile(join(legacyDir, "SKILL.md"), "utf8"), /^---\nname: legacy-skill\n/);
});

function requestLocalServer(controller, path, host = "preview.localhost", method = "GET") {
  const serverUrl = new URL(controller.url);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: serverUrl.hostname,
      port: serverUrl.port,
      path,
      method,
      headers: { Host: `${host}:${serverUrl.port}` },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("PATCH app-data preserves stored character cards", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "renge-app-data-test-"));
  const controller = await startRengeServer({
    host: "127.0.0.1",
    port: 0,
    dataDir,
  });
  t.after(async () => {
    await new Promise((resolve, reject) => {
      controller.server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  const characterCards = [
    {
      id: "card-1",
      name: "测试角色",
      avatarDataUrl: "data:image/png;base64,AAAA",
    },
  ];
  const initialResponse = await fetch(`${controller.url}/api/app-data`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: { version: 1, characterCards, chatSessions: [] },
    }),
  });
  assert.equal(initialResponse.status, 200);

  const patchResponse = await fetch(`${controller.url}/api/app-data`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: { version: 1, chatSessions: [{ id: "session-1" }] },
    }),
  });
  assert.equal(patchResponse.status, 200);

  const storedResponse = await fetch(`${controller.url}/api/app-data`);
  assert.equal(storedResponse.status, 200);
  const storedPayload = await storedResponse.json();
  assert.deepEqual(storedPayload.data.characterCards, characterCards);
  assert.deepEqual(storedPayload.data.chatSessions, [{ id: "session-1" }]);
});

test("serves temporary files on the isolated preview origin", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-temp-preview-test-"));
  const dataDir = join(root, "data");
  const temporaryFilesRoot = join(root, "temporary");
  await mkdir(join(temporaryFilesRoot, "demo"), { recursive: true });
  await writeFile(
    join(temporaryFilesRoot, "demo", "index.html"),
    '<!doctype html><link rel="stylesheet" href="theme.css"><h1>临时预览</h1>',
    "utf8",
  );
  await writeFile(join(temporaryFilesRoot, "demo", "theme.css"), "h1 { color: green; }", "utf8");

  const controller = await startRengeServer({
    host: "127.0.0.1",
    port: 0,
    dataDir,
    temporaryFilesRoot,
  });
  t.after(async () => {
    await new Promise((resolve, reject) => {
      controller.server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(root, { recursive: true, force: true });
  });

  const htmlResponse = await requestLocalServer(
    controller,
    "/temporary-files/demo/index.html",
  );
  assert.equal(htmlResponse.status, 200);
  assert.equal(htmlResponse.headers["content-type"], "text/html;charset=utf-8");
  assert.equal(htmlResponse.headers["cache-control"], "no-store");
  assert.match(htmlResponse.body, /临时预览/);

  const assetResponse = await requestLocalServer(
    controller,
    "/temporary-files/demo/theme.css",
  );
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers["content-type"], "text/css;charset=utf-8");
  assert.equal(assetResponse.body, "h1 { color: green; }");

  const headResponse = await requestLocalServer(
    controller,
    "/temporary-files/demo/index.html",
    "preview.localhost",
    "HEAD",
  );
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.body, "");

  const missingResponse = await requestLocalServer(
    controller,
    "/temporary-files/demo/missing.html",
  );
  assert.equal(missingResponse.status, 404);

  const apiResponse = await requestLocalServer(controller, "/api/app-data");
  assert.equal(apiResponse.status, 404);
});

test("Tavern module proxy rejects non-jsDelivr module origins", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "renge-tavern-proxy-test-"));
  const controller = await startRengeServer({
    host: "127.0.0.1",
    port: 0,
    dataDir,
  });
  t.after(async () => {
    await new Promise((resolve, reject) => {
      controller.server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  const response = await fetch(
    `${controller.url}/api/tavern-module-proxy?url=${encodeURIComponent("https://example.test/card.js")}`,
  );

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /jsDelivr/);
});

test("Tavern module proxy rewrites nested jsDelivr dependency paths", () => {
  const source = [
    "import value from '/npm/example@1.0.0/+esm';",
    "export { helper } from './helper.js';",
    "const lazy = import('../shared/lazy.js');",
  ].join("\n");
  const rewritten = rewriteTavernModuleImports(
    source,
    "http://127.0.0.1:5191",
    "https://testingcf.jsdelivr.net/npm/example@1.0.0/dist/index.js",
  );

  assert.match(
    rewritten,
    /url=https%3A%2F%2Ftestingcf\.jsdelivr\.net%2Fnpm%2Fexample%401\.0\.0%2F%2Besm/,
  );
  assert.match(
    rewritten,
    /url=https%3A%2F%2Ftestingcf\.jsdelivr\.net%2Fnpm%2Fexample%401\.0\.0%2Fdist%2Fhelper\.js/,
  );
  assert.match(
    rewritten,
    /url=https%3A%2F%2Ftestingcf\.jsdelivr\.net%2Fnpm%2Fexample%401\.0\.0%2Fshared%2Flazy\.js/,
  );
  assert.equal((rewritten.match(/&v=2/g) ?? []).length, 3);
});

test("routes Responses providers to /responses with a converted request", async (t) => {
  const capturedRequests = [];
  const upstreamServer = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const capturedRequest = {
        path: request.url,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      };
      capturedRequests.push(capturedRequest);
      if (capturedRequest.body.stream === true) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end([
          "event: response.output_text.delta",
          "data: {\"type\":\"response.output_text.delta\",\"delta\":\"streamed\"}",
          "",
          "event: response.completed",
          "data: {\"type\":\"response.completed\",\"response\":{\"object\":\"response\",\"status\":\"completed\",\"output\":[]}}",
          "",
        ].join("\n"));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        id: "resp_test",
        object: "response",
        status: "completed",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "ok" }],
        }],
      }));
    });
  });
  await new Promise((resolve, reject) => {
    upstreamServer.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve());
  });

  const dataDir = await mkdtemp(join(tmpdir(), "renge-responses-proxy-test-"));
  const controller = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
  t.after(async () => {
    await Promise.all([
      new Promise((resolve, reject) => {
        controller.server.close((error) => (error ? reject(error) : resolve()));
      }),
      new Promise((resolve, reject) => {
        upstreamServer.close((error) => (error ? reject(error) : resolve()));
      }),
    ]);
    await rm(dataDir, { recursive: true, force: true });
  });

  const upstreamAddress = upstreamServer.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== "string");
  const response = await fetch(`${controller.url}/api/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
      apiType: "responses",
      request: {
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 300,
        stream: false,
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).object, "response");
  assert.equal(capturedRequests[0].path, "/v1/responses");
  assert.deepEqual(capturedRequests[0].body.input, [{ role: "user", content: "hello" }]);
  assert.equal(capturedRequests[0].body.max_output_tokens, 300);
  assert.equal(capturedRequests[0].body.messages, undefined);
  assert.equal(capturedRequests[0].body.max_tokens, undefined);

  const streamResponse = await fetch(`${controller.url}/api/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
      apiType: "responses",
      request: {
        model: "gpt-test",
        messages: [{ role: "user", content: "stream" }],
        stream: true,
      },
    }),
  });
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers.get("content-type"), /text\/event-stream/);
  assert.match(await streamResponse.text(), /response\.output_text\.delta/);
  assert.equal(capturedRequests[1].path, "/v1/responses");
  assert.equal(capturedRequests[1].body.stream, true);
});
