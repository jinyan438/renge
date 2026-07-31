import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRengeServer } from "../server.mjs";

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
