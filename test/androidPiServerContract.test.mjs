import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  const [serverSource, serviceSource, activitySource, manifestSource] = await Promise.all([
    readFile(serverSourceUrl, "utf8"),
    readFile(backgroundServiceSourceUrl, "utf8"),
    readFile(mainActivitySourceUrl, "utf8"),
    readFile(androidManifestUrl, "utf8"),
  ]);

  assert.match(serviceSource, /class BackgroundRuntimeService extends Service/);
  assert.match(serviceSource, /FOREGROUND_SERVICE_TYPE_DATA_SYNC/);
  assert.match(serviceSource, /PowerManager\.PARTIAL_WAKE_LOCK/);
  assert.match(serviceSource, /WIFI_MODE_FULL_HIGH_PERF/);
  assert.match(serviceSource, /activeGenerationRequests/);
  assert.match(serviceSource, /postDelayed\(leaveForegroundRunnable, FOREGROUND_RELEASE_DELAY_MS\)/);
  assert.match(activitySource, /bindService\(/);
  assert.match(activitySource, /setRendererPriorityPolicy\(WebView\.RENDERER_PRIORITY_IMPORTANT, false\)/);
  assert.doesNotMatch(activitySource, /new LocalWebServer\(/);
  assert.match(manifestSource, /android:foregroundServiceType="dataSync"/);
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
});
