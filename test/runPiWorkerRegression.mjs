import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-concurrency=2",
  "test/piWorker.test.mjs", "test/piHost.test.mjs", "test/piSafetyRegression.test.mjs",
  "test/piLiveContext.test.mjs", "test/piShellRuntime.test.mjs",
], { stdio: "inherit", windowsHide: true, env: { ...process.env, RENGE_TEST_PI_WORKER: "1" } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
