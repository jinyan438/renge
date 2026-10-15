import { resolve } from "node:path";
import { run } from "node:test";

const report = { electronVersion: process.versions.electron, passed: 0, failed: 0 };
const stream = run({
  files: [resolve("test/piVersionMigration.test.mjs")], isolation: "none",
});
for await (const event of stream) {
  if (event.type === "test:pass" && !event.data.skip) report.passed++;
  if (event.type === "test:fail") { report.failed++; report.error = String(event.data.details?.error?.stack || event.data.name); }
}
process.stdout.write(JSON.stringify(report));
process.exitCode = report.failed ? 1 : 0;
