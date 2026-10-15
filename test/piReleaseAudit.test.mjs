import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const versions = ["1.2.0", "1.1.0", "1.0.4", "1.0.3", "1.0.2", "1.0.1", "1.0.0", "0.99.2", "0.99.1", "0.99.0"];

test("release audit covers every published item between 0.87.1 and the pinned 1.2.0", async () => {
  const changelog = (await readFile(new URL("../node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md", import.meta.url), "utf8"))
    .replace(/\r\n/g, "\n").split("## [0.87.1]")[0];
  const report = await readFile(new URL("../docs/pi-1.2-migration-audit.md", import.meta.url), "utf8");
  assert.ok(report.includes(`source-sha256: ${createHash("sha256").update(changelog).digest("hex")}`), "updating the SDK requires reviewing its release changes again");
  assert.deepEqual([...changelog.matchAll(/^## \[([^\]]+)\]/gm)].map((match) => match[1]), versions);
  const expected = []; let version, ordinal;
  for (const line of changelog.split("\n")) {
    if (line.startsWith("## [")) { version = line.match(/\[([^\]]+)\]/)[1]; ordinal = 0; }
    if (line.startsWith("- ")) expected.push(`${version}-${String(++ordinal).padStart(2, "0")}`);
  }
  const rows = [...report.matchAll(/^\| (\d+\.\d+\.\d+-\d+) \| .*? \| ([TSENB]) /gm)];
  assert.equal(expected.length, 259);
  assert.equal(new Set(rows.map((row) => row[1])).size, rows.length, "no duplicate decisions");
  assert.deepEqual(rows.map((row) => row[1]).sort(), expected.sort(), "no unreviewed or invented release items");
  for (const status of ["T", "S", "E", "N", "B"]) {
    const count = rows.filter((row) => row[2] === status).length;
    assert.match(report, new RegExp(`\\| ${status} \\| ${count} \\|`), "summary counts must distinguish tests from static checks and limits");
  }
});

test("all Pi runtime packages stay aligned and removed source-only APIs are not used", async () => {
  for (const name of ["pi-ai", "pi-coding-agent", "pi-agent-core", "pi-tui", "pi-mcp", "pi-codemode"]) {
    const json = JSON.parse(await readFile(new URL(`../node_modules/@earendil-works/${name}/package.json`, import.meta.url), "utf8"));
    assert.equal(json.version, "1.2.0", name);
    if (name === "pi-coding-agent") {
      assert.equal(json.exports["./client"], undefined);
      assert.equal(json.exports["./experimental/plugin"], undefined);
      assert.equal(json.dependencies["@earendil-works/chord"], undefined);
    }
  }
});
