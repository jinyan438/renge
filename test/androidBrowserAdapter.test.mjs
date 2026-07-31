import assert from "node:assert/strict";
import test from "node:test";

import {
  ANDROID_BROWSER_EVENT_NAME,
  AndroidBrowserAdapter,
} from "../src/androidBrowserAdapter.ts";

test("maps Android browser commands, requests, and native events to the desktop webview contract", async () => {
  const previousWindow = globalThis.window;
  const host = new EventTarget();
  const commands = [];
  host.RengeAndroidNative = {
    browserCommand(optionsJson) {
      const options = JSON.parse(optionsJson);
      commands.push(options);
      return JSON.stringify({ ok: true, command: options.command });
    },
    browserRequest(requestId, optionsJson) {
      const options = JSON.parse(optionsJson);
      host.__rengeAndroidResolve(requestId, {
        value: { operation: options.operation, tabId: options.tabId },
      });
    },
  };
  globalThis.window = host;

  try {
    const adapter = new AndroidBrowserAdapter({
      tabId: "android-tab-1",
      getBounds: () => ({ left: 20, top: 40, width: 600, height: 800 }),
      getClientRect: () => ({ left: 10, top: 20, width: 300, height: 400 }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const loadPromise = adapter.loadURL("https://www.bilibili.com/");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(adapter.getURL(), "https://www.bilibili.com/");

    let stopped = false;
    adapter.addEventListener("did-stop-loading", () => {
      stopped = true;
    });
    const nativeEvent = new Event(ANDROID_BROWSER_EVENT_NAME);
    nativeEvent.detail = {
      type: "state",
      tabId: "android-tab-1",
      url: "https://www.bilibili.com/video/1",
      title: "视频",
      canGoBack: true,
      canGoForward: false,
      loading: false,
      visible: true,
      zoomFactor: 0.8,
    };
    host.dispatchEvent(nativeEvent);
    const stopEvent = new Event(ANDROID_BROWSER_EVENT_NAME);
    stopEvent.detail = { type: "did-stop-loading", tabId: "android-tab-1" };
    host.dispatchEvent(stopEvent);
    await loadPromise;

    assert.equal(stopped, true);
    assert.equal(adapter.getURL(), "https://www.bilibili.com/video/1");
    assert.equal(adapter.getTitle(), "视频");
    assert.equal(adapter.canGoBack(), true);
    assert.equal(adapter.getZoomFactor(), 0.8);
    assert.deepEqual(await adapter.executeJavaScript("location.href"), {
      operation: "execute",
      tabId: "android-tab-1",
    });

    adapter.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(commands.map((item) => item.command), ["create", "open", "close_tab"]);
    assert.deepEqual(commands[1], {
      command: "open",
      tabId: "android-tab-1",
      left: 20,
      top: 40,
      width: 600,
      height: 800,
      url: "https://www.bilibili.com/",
    });
  } finally {
    globalThis.window = previousWindow;
  }
});
