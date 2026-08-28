import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverSourceUrl = new URL(
  "../renge_android/app/src/main/java/com/renge/agentlab/LocalWebServer.java",
  import.meta.url,
);

test("Android local server exposes the complete Pi session HTTP contract", async () => {
  const source = await readFile(serverSourceUrl, "utf8");
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
  assert.match(source, /kernelMode", "android-compatible"/);
  assert.match(source, /activePiRuns\.remove\(runId/);
  assert.match(source, /text\/event-stream;charset=utf-8/);
});
