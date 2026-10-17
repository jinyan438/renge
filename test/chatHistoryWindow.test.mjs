import assert from "node:assert/strict";
import test from "node:test";
import { getChatHistoryWindow } from "../src/chatHistoryWindow.ts";

test("growing history keeps the latest page bounded without discarding source messages", () => {
  for (const length of [0, 12, 80, 81, 10_000]) {
    const window = getChatHistoryWindow(length, null);
    assert.equal(window.end, length);
    assert.ok(window.end - window.start <= 80);
  }
});

test("reading an earlier page stays anchored while new messages arrive", () => {
  for (const length of [1000, 1001]) {
    const window = getChatHistoryWindow(length, 80);
    assert.equal(window.start, 80);
    assert.equal(window.end, 160);
  }
  assert.equal(getChatHistoryWindow(12, 800).start, 0, "deletions clamp a stale page safely");
  assert.equal(getChatHistoryWindow(1000, null).start, 920);
});
