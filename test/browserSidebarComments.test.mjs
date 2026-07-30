import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBrowserContextTargetProbeScript,
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
