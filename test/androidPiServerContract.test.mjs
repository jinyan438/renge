import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverSourceUrl = new URL(
  "../renge_android/app/src/main/java/com/renge/agentlab/LocalWebServer.java",
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
  assert.match(source, /kernelMode", "android-compatible"/);
  assert.equal(
    source.match(/PI_KERNEL_ID = "([^"]+)"/)?.[1],
    `@earendil-works/pi-coding-agent@${packageJson.dependencies["@earendil-works/pi-coding-agent"]}`,
  );
  assert.match(source, /activePiRuns\.remove\(runId/);
  assert.match(source, /text\/event-stream;charset=utf-8/);
});
