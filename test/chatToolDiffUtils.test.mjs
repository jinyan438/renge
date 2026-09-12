import assert from "node:assert/strict";
import test from "node:test";
import { parseToolDiffLines } from "../src/chatToolDiffUtils.ts";

test("keeps Pi line numbers and code indentation separate", () => {
  assert.deepEqual(parseToolDiffLines(" 10 function draw(){\n+11   return;\n-12   draw();", true), [
    { kind: "context", number: 10, marker: " ", content: "function draw(){" },
    { kind: "addition", number: 11, marker: "+", content: "  return;" },
    { kind: "deletion", number: 12, marker: "-", content: "  draw();" },
  ]);
});

test("resolves unified diff offsets across edits and hunks", () => {
  const lines = parseToolDiffLines("--- a/test.ts\n+++ b/test.ts\n@@ -8,2 +8,3 @@\n same\n-old\n+new\n+extra\n@@ -30 +31 @@\n end");
  assert.deepEqual(lines.map(({ kind, number }) => [kind, number]), [
    ["meta", null], ["meta", null], ["meta", null], ["context", 8],
    ["deletion", 9], ["addition", 9], ["addition", 10], ["meta", null], ["context", 31],
  ]);
});

test("does not invent file offsets or strip numbers from argument previews", () => {
  assert.deepEqual(parseToolDiffLines("+123 value\r\n-456"), [
    { kind: "addition", number: null, marker: "+", content: "123 value" },
    { kind: "deletion", number: null, marker: "-", content: "456" },
  ]);
});
