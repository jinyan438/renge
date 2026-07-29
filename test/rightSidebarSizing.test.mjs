import test from "node:test";
import assert from "node:assert/strict";
import {
  clampRightSidebarWidth,
  getRightSidebarMaxWidth,
  RIGHT_SIDEBAR_MIN_WIDTH,
} from "../src/rightSidebarSizing.ts";

test("uses the full workspace width while preserving the chat area", () => {
  assert.equal(getRightSidebarMaxWidth(2048, 0), 1688);
  assert.equal(getRightSidebarMaxWidth(2048, 280), 1408);
});

test("clamps the sidebar to the dynamic workspace limit", () => {
  assert.equal(clampRightSidebarWidth(1600, 1728), 1600);
  assert.equal(clampRightSidebarWidth(2000, 1728), 1728);
  assert.equal(clampRightSidebarWidth(100, 1728), RIGHT_SIDEBAR_MIN_WIDTH);
});

test("keeps the sidebar usable in a constrained workspace", () => {
  assert.equal(getRightSidebarMaxWidth(800, 280), RIGHT_SIDEBAR_MIN_WIDTH);
});
