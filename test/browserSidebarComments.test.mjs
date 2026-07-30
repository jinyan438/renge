import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBrowserContextTargetProbeScript,
  calculateBrowserContextMenuPlacement,
  calculateBrowserOverlayAnchor,
  parseBrowserPageComment,
  serializeBrowserPageComment,
} from "../src/browserSidebarComments.ts";

test("builds a syntactically valid browser target probe", () => {
  const script = buildBrowserContextTargetProbeScript(385.4, 441.2);
  assert.doesNotThrow(() => new Function(`return ${script};`));
  assert.match(script, /elementFromPoint\(385, 441\)/);
  assert.match(script, /data-testid/);
});
test("round-trips structured browser comments without embedding screenshot data", () => {
  const comment = {
    id: "comment-1",
    comment: "调整这张图片",
    createdAt: "2026-07-30T00:00:00.000Z",
    pageUrl: "https://example.com/",
    pageTitle: "Example",
    tagName: "img",
    selector: "main > img",
    path: "html > body > main > img",
    text: "hero",
    ariaLabel: "",
    nearbyText: "Nearby copy",
    outerHtml: '<img src="hero.png">',
    imageUrl: "https://example.com/hero.png",
    linkUrl: "",
    rect: { x: 10, y: 20, width: 300, height: 180 },
    screenshotDataUrl: "data:image/png;base64,abc",
  };
  const serialized = serializeBrowserPageComment(comment);
  assert.doesNotMatch(serialized, /base64,abc/);
  assert.equal(JSON.parse(serialized).screenshotAttached, true);
  assert.deepEqual(
    parseBrowserPageComment(serialized, comment.screenshotDataUrl),
    comment,
  );
});

test("anchors the browser context menu at the click and flips at viewport edges", () => {
  assert.deepEqual(
    calculateBrowserContextMenuPlacement({
      anchorX: 120,
      anchorY: 100,
      menuWidth: 280,
      menuHeight: 300,
      viewportWidth: 600,
      viewportHeight: 600,
    }),
    { left: 120, top: 100, maxWidth: 472, maxHeight: 492 },
  );
  assert.deepEqual(
    calculateBrowserContextMenuPlacement({
      anchorX: 560,
      anchorY: 560,
      menuWidth: 280,
      menuHeight: 300,
      viewportWidth: 600,
      viewportHeight: 600,
    }),
    { left: 280, top: 260, maxWidth: 552, maxHeight: 552 },
  );
});

test("maps zoomed web content coordinates into the browser sidebar overlay", () => {
  const scaled = calculateBrowserOverlayAnchor({
    contentX: 1_050,
    contentY: 326,
    zoomFactor: 0.16,
    webviewLeft: 1_200,
    webviewTop: 90,
    containerLeft: 1_200,
    containerTop: 90,
  });
  assert.equal(scaled.left, 168);
  assert.ok(Math.abs(scaled.top - 52.16) < Number.EPSILON * 52.16);
  assert.deepEqual(
    calculateBrowserOverlayAnchor({
      contentX: 120,
      contentY: 80,
      zoomFactor: 1,
      webviewLeft: 520,
      webviewTop: 140,
      containerLeft: 500,
      containerTop: 100,
    }),
    { left: 140, top: 120 },
  );
});
