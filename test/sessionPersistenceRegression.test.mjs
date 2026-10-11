import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startRengeServer } from "../server.mjs";
import { createChatSessionPatch } from "../src/appDataPersistenceUtils.ts";

test("two clients save different sessions, reject conflicting edits and preserve concurrent additions/deletions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-session-conflict-"));
  const server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  t.after(async () => { await new Promise(resolve => server.server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const write = (data, sessionPatch, method = "PATCH") => fetch(`${server.url}/api/app-data`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data, ...(sessionPatch ? { sessionPatch } : {}) }),
  });
  const read = async () => (await fetch(`${server.url}/api/app-data`)).json();
  const sessions = [{ id: "a", messages: [] }, { id: "b", messages: [] }];
  await write({ chatSessions: sessions, characterCards: [{ id: "keep" }] }, null, "PUT");
  const baseline = await read();
  const clientA = structuredClone(sessions), clientB = structuredClone(sessions);
  clientA[0].messages.push({ content: "A" }); clientB[1].messages.push({ content: "B" });
  const responses = await Promise.all([
    write({}, createChatSessionPatch(clientA, sessions, baseline.sessionVersions)),
    write({}, createChatSessionPatch(clientB, sessions, baseline.sessionVersions)),
  ]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const saved = await read();
  assert.equal(saved.data.chatSessions[0].messages[0].content, "A");
  assert.equal(saved.data.chatSessions[1].messages[0].content, "B");
  assert.deepEqual(saved.data.characterCards, [{ id: "keep" }]);

  // B still holds A's old version; changing A must not silently adopt a newer
  // version returned by an unrelated save and overwrite the remote message.
  clientB[0].messages.push({ content: "STALE_A" });
  const conflict = await write({ userProfile: { nickname: "must not commit" } }, createChatSessionPatch(clientB, sessions, baseline.sessionVersions));
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json()).error, /另一窗口/);
  assert.equal((await read()).data.userProfile, undefined);

  const added = [...saved.data.chatSessions, { id: "c", messages: [] }];
  assert.equal((await write({}, createChatSessionPatch(added, saved.data.chatSessions, saved.sessionVersions))).status, 200);
  // A stale client deleting B must retain a concurrently created C.
  const deleting = [saved.data.chatSessions[0]];
  assert.equal((await write({}, createChatSessionPatch(deleting, saved.data.chatSessions, saved.sessionVersions))).status, 200);
  assert.deepEqual((await read()).data.chatSessions.map(s => s.id), ["a", "c"]);
  assert.equal((await write({}, { upserts: [{ session: { id: "b", messages: ["resurrect"] }, expectedVersion: saved.sessionVersions.b }], deletes: [] })).status, 409);
  assert.equal((await write({ chatSessions: [] })).status, 409);
});
