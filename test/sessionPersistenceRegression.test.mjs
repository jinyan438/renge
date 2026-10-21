import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startRengeServer } from "../server.mjs";
import { createChatSessionPatch } from "../src/appDataPersistenceUtils.ts";
import { applyChatSessionPatch, createChatSessionVersionCache, getChatSessionVersions } from "../app-data-session-patch.mjs";

test("opaque versions hash unchanged immutable messages once and retain content/order conflict detection", () => {
  let reads = 0;
  const message = { id: "large", content: "x".repeat(100_000), toJSON() { reads++; return { id: this.id, content: this.content }; } };
  const initial = [{ id: "a", title: "before", messages: [message] }];
  const versions = createChatSessionVersionCache();
  const first = versions(initial);
  assert.equal(reads, 1);
  const current = [{ ...initial[0], title: "after", messages: [message, { id: "new", content: "new" }] }];
  const second = versions(current);
  assert.equal(reads, 1, "appending a tool result does not serialize unchanged historical output");
  assert.notEqual(first.a, second.a);
  assert.deepEqual(second, getChatSessionVersions(JSON.parse(JSON.stringify(current))));
  assert.notEqual(second.a, versions([{ ...current[0], messages: [...current[0].messages].reverse() }]).a);
  assert.notEqual(second.a, versions([{ ...current[0], messages: [{ id: "large", content: "edited" }, current[0].messages[1]] }]).a);
  assert.notEqual(versions([{ id: "a" }]).a, versions([{ id: "a", messages: null }]).a);
});

test("message deltas preserve large unchanged histories, edits, deletions and ordering", () => {
  const large = { id: "large", content: "UNCHANGED_HISTORY".repeat(100_000), toolVisualization: { result: "keep" } };
  const original = [{ id: "a", title: "before", messages: [large, { id: "edit", content: "old" }, { id: "remove", content: "delete" }] }];
  const current = [{ id: "a", title: "after", messages: [{ id: "edit", content: "new" }, large, { id: "added", content: "added" }] }];
  const patch = createChatSessionPatch(current, original, getChatSessionVersions(original), { messageDeltas: true });
  assert.ok(JSON.stringify(patch).length < 1_000, "network and worker copies contain only changed messages");
  assert.deepEqual(patch.upserts[0].session.messages, []);
  const legacy = createChatSessionPatch(current, original, getChatSessionVersions(original));
  assert.equal(legacy.upserts[0].messagesPatch, undefined, "old servers receive full sessions until message deltas are negotiated");
  assert.deepEqual(legacy.upserts[0].session.messages, current[0].messages);
  const restored = applyChatSessionPatch(original, patch);
  assert.deepEqual(restored, current);
  assert.equal(restored[0].messages[1], large, "unchanged messages retain identity in the persistence worker");
  assert.deepEqual(original[0].messages.map((message) => message.id), ["large", "edit", "remove"]);
  const stale = createChatSessionPatch([{ ...current[0], title: "stale" }], original, getChatSessionVersions(original), { messageDeltas: true });
  assert.throws(() => applyChatSessionPatch(restored, stale), /另一窗口/);
  for (const messagesPatch of [
    { order: ["missing"], upserts: [] },
    { order: ["large", "large"], upserts: [] },
    { order: ["large"], upserts: [{ id: "outside", content: "invalid" }] },
  ]) assert.throws(() => applyChatSessionPatch(original, { ...patch, upserts: [{ ...patch.upserts[0], messagesPatch }] }), /消息/);
});

test("message deltas survive a server restart and malformed patches leave the stored snapshot intact", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-message-delta-"));
  let server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  t.after(async () => { await new Promise((resolve) => server.server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const original = [{ id: "a", messages: [{ id: "keep", content: "完整历史" }, { id: "edit", content: "before" }] }];
  const write = (body, method = "PATCH") => fetch(`${server.url}/api/app-data`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await write({ data: { chatSessions: original } }, "PUT");
  const loaded = await (await fetch(`${server.url}/api/app-data`)).json();
  const current = [{ id: "a", messages: [original[0].messages[0], { id: "edit", content: "after" }, { id: "new", content: "new" }] }];
  assert.equal(loaded.messagePatches, true);
  const patch = createChatSessionPatch(current, original, loaded.sessionVersions, { messageDeltas: true });
  assert.equal((await write({ data: {}, sessionPatch: patch })).status, 200);
  await new Promise((resolve) => server.server.close(resolve));
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  const saved = await (await fetch(`${server.url}/api/app-data`)).json();
  assert.deepEqual(saved.data.chatSessions, current);
  assert.deepEqual(saved.sessionVersions, getChatSessionVersions(current));
  patch.upserts[0].expectedVersion = saved.sessionVersions.a;
  patch.upserts[0].messagesPatch.order.push("missing");
  assert.equal((await write({ data: { userProfile: "must not persist" }, sessionPatch: patch })).status, 500);
  assert.deepEqual((await (await fetch(`${server.url}/api/app-data`)).json()).data, saved.data);
});

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
