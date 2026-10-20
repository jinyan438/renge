import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createToolDiffPreviewCache, getToolDiffViewportRange, parseToolDiffLines } from "../src/chatToolDiffUtils.ts";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const partialArgumentsSource = appSource.slice(appSource.indexOf("function decodePartialJsonString("), appSource.indexOf("function isObjectRecord("));
const parsePartial = vm.runInNewContext(`${ts.transpileModule(partialArgumentsSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText}\nparsePartialToolCallArguments`, {
  isObjectRecord: (value) => Boolean(value && typeof value === "object" && !Array.isArray(value)),
});

test("keeps Pi line numbers and code indentation separate", () => {
  assert.deepEqual(parseToolDiffLines(" 10 function draw(){\n+11   return;\n-12   draw();", true), [
    { kind: "context", number: 10, marker: " ", content: "function draw(){" },
    { kind: "addition", number: 11, marker: "+", content: "  return;" },
    { kind: "deletion", number: 12, marker: "-", content: "  draw();" },
  ]);
});

test("bounds mounted diff rows while preserving the full scrollable height", () => {
  const top = getToolDiffViewportRange(600, 0, 300, 18);
  assert.deepEqual(top, { start: 0, end: 25, before: 0, after: 575 * 18 });
  const middle = getToolDiffViewportRange(600, 1_800, 300, 18);
  assert.deepEqual(middle, { start: 92, end: 125, before: 92 * 18, after: 475 * 18 });
  const bottom = getToolDiffViewportRange(600, 10_500, 300, 18);
  assert.equal(bottom.end, 600);
  assert.ok(bottom.end - bottom.start < 40);
  for (const range of [top, middle, bottom]) {
    assert.equal(range.before + (range.end - range.start) * 18 + range.after, 600 * 18);
  }
  assert.equal(getToolDiffViewportRange(3, 0, 300, 17.25).end, 3);
  assert.deepEqual(getToolDiffViewportRange(0, 0, 300, 18), { start: 0, end: 0, before: 0, after: 0 });
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

test("streaming a large write reuses visible code and only highlights changed lines", () => {
  const highlighted = [];
  const preview = createToolDiffPreviewCache((content, path) => {
    highlighted.push({ content, path });
    return `<code>${content}</code>`;
  });
  const prefix = Array.from({ length: 599 }, (_, index) => `+const value_${index} = ${index};`).join("\n");
  const first = preview(`${prefix}\n+part`, false, "file.js");
  assert.equal(highlighted.length, 600);
  const second = preview(`${prefix}\n+partial`, false, "file.js");
  assert.equal(highlighted.length, 601);
  assert.equal(second.lines[0], first.lines[0]);
  assert.notEqual(second.lines[599], first.lines[599]);
  const large = preview(`${prefix}\n+partial${"\n+more".repeat(10_000)}`, false, "file.js");
  assert.equal(highlighted.length, 601);
  assert.equal(large.lines, second.lines);
  assert.equal(large.additions, 10_600);
  assert.equal(large.truncated, true);
  assert.equal(large.lines.length, 600);
  const changedLanguage = preview("+partial", false, "file.py");
  assert.equal(highlighted.at(-1).path, "file.py");
  assert.equal(changedLanguage.lines.length, 1);
});

test("diff line numbering and markers update without rehighlighting identical source", () => {
  let calls = 0;
  const preview = createToolDiffPreviewCache((content) => { calls += 1; return content; });
  const first = preview("+1   same", true, "file.ts");
  const moved = preview("-20   same", true, "file.ts");
  assert.equal(calls, 1);
  assert.equal(moved.lines[0].number, 20);
  assert.equal(moved.lines[0].kind, "deletion");
  assert.notEqual(moved.lines[0], first.lines[0]);
});

test("streamed JSON preserves newlines, quotes, literal escapes and Windows paths", () => {
  const source = 'const path = "C:\\new\\test.txt";\nconst literal = "\\n";\n// 中文🚀\n';
  const args = JSON.stringify({ path: "C:\\new\\test.js", content: source });
  const partial = parsePartial(args.slice(0, -2)); // before the final string quote
  assert.equal(partial.path, "C:\\new\\test.js");
  assert.equal(partial.content, source);
  assert.equal(parseToolDiffLines(partial.content.split("\n").map((line) => `+${line}`).join("\n")).length, 4);
});

test("partial escape sequences keep the complete prefix and recover on the next fragment", () => {
  for (const [tail, expected] of [
    ["\\", "prefix"], ["\\u", "prefix"], ["\\u4", "prefix"], ["\\u4f6", "prefix"],
    ["\\u4f60", "prefix你"], ["\\\\", "prefix\\"], ["\\\\n", "prefix\\n"],
    ['\\"quoted\\"', 'prefix"quoted"'], ["\\\\\\", "prefix\\"],
  ]) assert.equal(parsePartial(`{"content":"prefix${tail}`).content, expected, tail);
});

test("a large unfinished write stays multiline so the preview's line budget applies while generating", () => {
  const content = "const value = 1; // source\n".repeat(10_000);
  const args = JSON.stringify({ path: "large.js", content });
  const parsed = parsePartial(args.slice(0, -2));
  assert.equal(parsed.content, content);
  let highlighted = 0;
  const preview = createToolDiffPreviewCache((source) => { highlighted += 1; return source; });
  const result = preview(parsed.content.split("\n").map((line) => `+${line}`).join("\n"), false, "large.js");
  assert.equal(result.lines.length, 600);
  assert.equal(result.truncated, true);
  assert.equal(highlighted, 600);
});
