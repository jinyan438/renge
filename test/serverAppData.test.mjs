import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRengeServer } from "../server.mjs";

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
