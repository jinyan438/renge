import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

test("Pi 1.2 migration contracts pass in the Windows Electron runtime", { skip: process.platform !== "win32", timeout: 60_000 }, async () => {
  const { default: electronPath } = await import("electron");
  const { stdout } = await promisify(execFile)(electronPath, [
    resolve("test/fixtures/pi-migration-electron.mjs"),
  ], { cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 50_000, windowsHide: true });
  const report = JSON.parse(stdout);
  assert.ok(report.electronVersion);
  assert.equal(report.passed, 16);
  assert.equal(report.failed, 0);
});
