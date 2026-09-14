import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installAndroidBackgroundTimerShim } from "../src/androidBackgroundRuntime.ts";

const serverSourceUrl = new URL(
  "../renge_android/app/src/main/java/com/renge/agentlab/LocalWebServer.java",
  import.meta.url,
);
const backgroundServiceSourceUrl = new URL(
  "../renge_android/app/src/main/java/com/renge/agentlab/BackgroundRuntimeService.java",
  import.meta.url,
);
const mainActivitySourceUrl = new URL(
  "../renge_android/app/src/main/java/com/renge/agentlab/MainActivity.java",
  import.meta.url,
);
const androidManifestUrl = new URL(
  "../renge_android/app/src/main/AndroidManifest.xml",
  import.meta.url,
);
const backgroundRuntimeSourceUrl = new URL(
  "../src/androidBackgroundRuntime.ts",
  import.meta.url,
);

function createTimerHost() {
  let nextBrowserTimerId = 1;
  const host = {
    document: { visibilityState: "hidden" },
    performance: { now: () => 42 },
    eval: (source) => Function(source)(),
    setTimeout() { return nextBrowserTimerId++; },
    clearTimeout() {},
    setInterval() { return nextBrowserTimerId++; },
    clearInterval() {},
    requestAnimationFrame() {
      throw new Error("hidden rAF should use the native scheduler");
    },
    cancelAnimationFrame() {},
  };
  return host;
}

test("Android local server exposes the complete Pi session HTTP contract", async () => {
  const source = await readFile(serverSourceUrl, "utf8");
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  for (const endpoint of [
    "/api/pi/chat",
    "/api/pi/session",
    "/api/pi/tool-result",
    "/api/pi/abort",
    "/api/pi/compact",
    "/api/pi/set-auto-compaction",
  ]) {
    assert.match(source, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.match(source, /"DELETE"\.equals\(request\.method\)/);
  assert.match(source, /"PATCH"\.equals\(request\.method\)/);
  assert.match(source, /patchAppData\(data\)/);
  assert.match(source, /kernelMode", "android-compatible"/);
  assert.equal(
    source.match(/PI_KERNEL_ID = "([^"]+)"/)?.[1],
    `@earendil-works/pi-coding-agent@${packageJson.dependencies["@earendil-works/pi-coding-agent"]}`,
  );
  assert.match(source, /activePiRuns\.remove\(runId/);
  assert.match(source, /text\/event-stream;charset=utf-8/);
});

test("Android generation requests are owned by a foreground runtime service", async () => {
  const [serverSource, serviceSource, activitySource, manifestSource, runtimeSource] = await Promise.all([
    readFile(serverSourceUrl, "utf8"),
    readFile(backgroundServiceSourceUrl, "utf8"),
    readFile(mainActivitySourceUrl, "utf8"),
    readFile(androidManifestUrl, "utf8"),
    readFile(backgroundRuntimeSourceUrl, "utf8"),
  ]);

  assert.match(serviceSource, /class BackgroundRuntimeService extends Service/);
  assert.match(serviceSource, /FOREGROUND_SERVICE_TYPE_SPECIAL_USE/);
  assert.match(serviceSource, /PowerManager\.PARTIAL_WAKE_LOCK/);
  assert.match(serviceSource, /WIFI_MODE_FULL_HIGH_PERF/);
  assert.match(serviceSource, /activeGenerationRequests/);
  assert.match(serviceSource, /postDelayed\(leaveForegroundRunnable, FOREGROUND_RELEASE_DELAY_MS\)/);
  assert.match(activitySource, /bindService\(/);
  assert.match(activitySource, /setRendererPriorityPolicy\(WebView\.RENDERER_PRIORITY_IMPORTANT, false\)/);
  assert.match(activitySource, /onPause\(\)/);
  assert.match(activitySource, /setAppInBackground\(true\)/);
  assert.match(activitySource, /BACKGROUND_WEBVIEW_PULSE_INTERVAL_MS/);
  assert.match(activitySource, /webView\.evaluateJavascript\("void 0", null\)/);
  assert.match(activitySource, /setOffscreenPreRaster\(true\)/);
  assert.doesNotMatch(activitySource, /new LocalWebServer\(/);
  assert.match(manifestSource, /android:foregroundServiceType="specialUse"/);
  assert.match(manifestSource, /PROPERTY_SPECIAL_USE_FGS_SUBTYPE/);
  assert.match(manifestSource, /android\.permission\.WAKE_LOCK/);

  for (const endpoint of [
    "/api/chat/completions",
    "/api/pi/chat",
    "/api/backends/chat-completions/generate",
  ]) {
    assert.match(
      serverSource,
      new RegExp(`isGenerationRequest[\\s\\S]*${endpoint.replaceAll("/", "\\/")}`),
    );
  }
  assert.match(serverSource, /onGenerationRequestStarted\(\)/);
  assert.match(serverSource, /onGenerationRequestFinished\(\)/);
  assert.ok(
    serverSource.match(/setReadTimeout\(0\)/g)?.length >= 3,
    "all Android streaming proxy paths should allow long-running responses",
  );
  assert.match(runtimeSource, /installAndroidBackgroundTimerShim/);
  assert.match(runtimeSource, /scheduleBackgroundTimer/);
  assert.match(runtimeSource, /__rengeDispatchBackgroundTimer/);
});

test("Android routes hidden-page timers and animation frames through native scheduling", () => {
  const host = createTimerHost();
  const scheduled = new Map();
  const cancelled = [];
  host.RengeAndroidNative = {
    scheduleBackgroundTimer(timerId, delayMs, repeating) {
      scheduled.set(timerId, { delayMs, repeating });
    },
    cancelBackgroundTimer(timerId) {
      cancelled.push(timerId);
      scheduled.delete(timerId);
    },
  };

  assert.equal(installAndroidBackgroundTimerShim(host), true);
  let timeoutValue = "";
  const timeoutId = host.setTimeout((value) => { timeoutValue = value; }, 250, "ok");
  assert.ok(timeoutId < 0);
  assert.deepEqual(scheduled.get(timeoutId), { delayMs: 250, repeating: false });
  host.__rengeDispatchBackgroundTimer(timeoutId);
  assert.equal(timeoutValue, "ok");
  host.clearTimeout(timeoutId);
  assert.deepEqual(cancelled, []);

  let intervalCount = 0;
  const intervalId = host.setInterval(() => { intervalCount += 1; }, 10);
  host.__rengeDispatchBackgroundTimer(intervalId);
  host.__rengeDispatchBackgroundTimer(intervalId);
  assert.equal(intervalCount, 2);
  host.clearInterval(intervalId);
  assert.deepEqual(cancelled, [intervalId]);

  let frameTimestamp = 0;
  const frameId = host.requestAnimationFrame((timestamp) => { frameTimestamp = timestamp; });
  assert.ok(frameId < 0);
  host.__rengeDispatchBackgroundTimer(frameId);
  assert.equal(frameTimestamp, 42);
});

test("Android timer shim stays disabled without the native bridge", () => {
  const host = createTimerHost();
  assert.equal(installAndroidBackgroundTimerShim(host), false);
  assert.equal(host.__rengeAndroidBackgroundTimersInstalled, undefined);
});
