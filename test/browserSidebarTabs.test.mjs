import assert from "node:assert/strict";
import test from "node:test";
import {
  getBrowserTabAfterClose,
  MAX_BROWSER_TABS,
  parseBrowserOpenTabRequest,
} from "../src/browserSidebarTabs.ts";

test("accepts safe Electron new-tab messages", () => {
  assert.deepEqual(
    parseBrowserOpenTabRequest({
      sourceWebContentsId: 42,
      url: "https://www.bilibili.com/video/BV1?from=search",
    }),
    {
      sourceWebContentsId: 42,
      url: "https://www.bilibili.com/video/BV1?from=search",
    },
  );
  assert.deepEqual(
    parseBrowserOpenTabRequest({ sourceWebContentsId: 42, url: "about:blank" }),
    { sourceWebContentsId: 42, url: "about:blank" },
  );
  assert.equal(MAX_BROWSER_TABS, 12);
});

test("rejects malformed or unsafe new-tab messages", () => {
  assert.equal(parseBrowserOpenTabRequest(null), null);
  assert.equal(
    parseBrowserOpenTabRequest({ sourceWebContentsId: 0, url: "https://example.com" }),
    null,
  );
  assert.equal(
    parseBrowserOpenTabRequest({ sourceWebContentsId: 2, url: "file:///C:/secret.txt" }),
    null,
  );
  assert.equal(
    parseBrowserOpenTabRequest({ sourceWebContentsId: 2, url: "javascript:alert(1)" }),
    null,
  );
});

test("selects the neighboring tab only when the active tab closes", () => {
  const tabIds = ["first", "second", "third"];
  assert.equal(getBrowserTabAfterClose(tabIds, "second", "second"), "third");
  assert.equal(getBrowserTabAfterClose(tabIds, "third", "third"), "second");
  assert.equal(getBrowserTabAfterClose(tabIds, "first", "third"), "first");
  assert.equal(getBrowserTabAfterClose(["only"], "only", "only"), "");
});
