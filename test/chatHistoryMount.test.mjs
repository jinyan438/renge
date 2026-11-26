import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_HISTORY_INITIAL_MOUNT_COUNT,
  getChatHistoryMountStart,
  getNextChatHistoryMountStart,
} from "../src/chatHistoryMount.ts";

test("a newly opened conversation mounts its newest items first", () => {
  const fresh = { sessionId: "", start: 0 };
  assert.equal(getChatHistoryMountStart(fresh, "long", 0), 0);
  assert.equal(getChatHistoryMountStart(fresh, "long", 12), 0);
  assert.equal(getChatHistoryMountStart(fresh, "long", 10_000), 10_000 - CHAT_HISTORY_INITIAL_MOUNT_COUNT);
  assert.equal(getChatHistoryMountStart({ sessionId: "other", start: 0 }, "long", 500), 500 - CHAT_HISTORY_INITIAL_MOUNT_COUNT);
});

test("older batches are prepended until the whole history is mounted", () => {
  let state = { sessionId: "long", start: getChatHistoryMountStart({ sessionId: "", start: 0 }, "long", 1000) };
  let batches = 0;
  while (state.start > 0) {
    const next = getNextChatHistoryMountStart(state.start);
    assert.ok(next < state.start);
    state = { sessionId: "long", start: next };
    batches += 1;
  }
  assert.equal(getChatHistoryMountStart(state, "long", 1000), 0);
  assert.ok(batches < 40, "the full history mounts in a bounded number of batches");
});

test("streamed messages never unmount earlier history", () => {
  const state = { sessionId: "long", start: 0 };
  for (const count of [1000, 1001, 1200]) assert.equal(getChatHistoryMountStart(state, "long", count), 0);
  assert.equal(getChatHistoryMountStart({ sessionId: "long", start: 900 }, "long", 12), 12, "deletions clamp safely");
});
