import assert from "node:assert/strict";
import test from "node:test";
import {
  getWindowSnapCandidate,
  WINDOW_SNAP_COMPACT_BREAKPOINT,
  WINDOW_SNAP_EDGE_THRESHOLD,
} from "../src/windowSnapUtils.ts";

test("detects the left and right snap zones at desktop widths", () => {
  const viewportWidth = 1440;

  assert.equal(getWindowSnapCandidate(0, viewportWidth), "left");
  assert.equal(
    getWindowSnapCandidate(WINDOW_SNAP_EDGE_THRESHOLD, viewportWidth),
    "left",
  );
  assert.equal(getWindowSnapCandidate(viewportWidth / 2, viewportWidth), null);
  assert.equal(
    getWindowSnapCandidate(
      viewportWidth - WINDOW_SNAP_EDGE_THRESHOLD,
      viewportWidth,
    ),
    "right",
  );
  assert.equal(getWindowSnapCandidate(viewportWidth, viewportWidth), "right");
});

test("does not enable half-screen snapping on compact viewports", () => {
  assert.equal(getWindowSnapCandidate(0, WINDOW_SNAP_COMPACT_BREAKPOINT), null);
  assert.equal(getWindowSnapCandidate(0, 480), null);
});

test("ignores invalid geometry and supports a custom edge threshold", () => {
  assert.equal(getWindowSnapCandidate(Number.NaN, 1440), null);
  assert.equal(getWindowSnapCandidate(12, Number.POSITIVE_INFINITY), null);
  assert.equal(getWindowSnapCandidate(40, 1200, 48), "left");
  assert.equal(getWindowSnapCandidate(49, 1200, 48), null);
  assert.equal(getWindowSnapCandidate(1160, 1200, 48), "right");
});
