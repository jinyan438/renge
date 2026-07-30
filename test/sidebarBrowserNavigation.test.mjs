import assert from "node:assert/strict";
import test from "node:test";
import {
  createSidebarBrowserWindowOpenHandler,
  isAllowedSidebarBrowserUrl,
  SIDEBAR_BROWSER_PARTITION,
} from "../electron/sidebar-browser-navigation.mjs";

test("uses a persistent Electron partition for sidebar browser storage", () => {
  assert.equal(SIDEBAR_BROWSER_PARTITION, "persist:renge-sidebar-browser");
});

test("routes safe webview popup requests into an application tab", () => {
  const requests = [];
  const handleWindowOpen = createSidebarBrowserWindowOpenHandler(27, (request) => {
    requests.push(request);
  });

  assert.deepEqual(handleWindowOpen({ url: "https://www.bilibili.com/" }), {
    action: "deny",
  });
  assert.deepEqual(requests, [
    { sourceWebContentsId: 27, url: "https://www.bilibili.com/" },
  ]);
});

test("denies unsafe popup protocols without creating a tab", () => {
  const requests = [];
  const handleWindowOpen = createSidebarBrowserWindowOpenHandler(27, (request) => {
    requests.push(request);
  });

  assert.deepEqual(handleWindowOpen({ url: "file:///C:/secret.txt" }), { action: "deny" });
  assert.deepEqual(handleWindowOpen({ url: "javascript:alert(1)" }), { action: "deny" });
  assert.deepEqual(requests, []);
  assert.equal(isAllowedSidebarBrowserUrl("about:blank"), true);
});
