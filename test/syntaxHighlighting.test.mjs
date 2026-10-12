import assert from "node:assert/strict";
import test from "node:test";

import {
  getSyntaxHighlightLanguage,
  highlightSourceCode,
  highlightMarkdownCode,
  MARKDOWN_HIGHLIGHT_MAX_LENGTH,
  MARKDOWN_HIGHLIGHT_MAX_LINE_LENGTH,
  MARKDOWN_HIGHLIGHT_MAX_LINES,
} from "../src/syntaxHighlighting.ts";

test("maps common source extensions to syntax languages", () => {
  assert.equal(getSyntaxHighlightLanguage("package.json"), "json");
  assert.equal(getSyntaxHighlightLanguage("src/App.tsx"), "typescript");
  assert.equal(getSyntaxHighlightLanguage("run_server.bat"), "dos");
  assert.equal(getSyntaxHighlightLanguage("README.unknown"), "");
});

test("highlights JSON keys, strings, and literals", () => {
  const result = highlightSourceCode('{"name":"renge","private":true}', "package.json");
  assert.equal(result.language, "json");
  assert.match(result.html, /class="hljs-attr"/);
  assert.match(result.html, /class="hljs-string"/);
  assert.match(result.html, /class="hljs-literal"/);
});

test("highlights JavaScript and Batch language tokens", () => {
  const javascript = highlightSourceCode(
    'import { createServer } from "node:http";\nconst port = 5190;',
    "server.mjs",
  );
  assert.match(javascript.html, /class="hljs-keyword">import/);
  assert.match(javascript.html, /class="hljs-string"/);
  assert.match(javascript.html, /class="hljs-number">5190/);

  const batch = highlightSourceCode('if not defined PORT set "PORT=5190"', "run_server.bat");
  assert.equal(batch.language, "dos");
  assert.match(batch.html, /class="hljs-keyword">if/);
  assert.match(batch.html, /class="hljs-built_in">set/);
});

test("always escapes source HTML before rendering", () => {
  const highlighted = highlightSourceCode('<script>alert("unsafe")</script>', "page.unknown");
  assert.doesNotMatch(highlighted.html, /<script>/);
  assert.match(highlighted.html, /&lt;script&gt;/);
});

test("Markdown fences use explicit languages and common aliases", () => {
  for (const label of ["ts", "typescript", " TSX "]) {
    const result = highlightMarkdownCode('const name: string = "Renge";', label);
    assert.equal(result.language, "typescript");
    assert.match(result.html, /hljs-keyword/);
  }
  assert.equal(highlightMarkdownCode("echo hello", "shell").language, "bash");
  assert.equal(highlightMarkdownCode("Write-Host hello", "pwsh").language, "powershell");
  for (const label of ["", "text", "unknown", "__proto__", "constructor"]) {
    assert.equal(highlightMarkdownCode("const name = 'Renge'", label), null);
  }
});

test("large Markdown code skips tokenization without truncation", () => {
  const code = `${"x".repeat(99)}\n`.repeat(MARKDOWN_HIGHLIGHT_MAX_LENGTH / 100);
  assert.ok(highlightMarkdownCode(code, "js"));
  assert.equal(highlightMarkdownCode(`${code}x`, "js"), null);
});

test("minified lines and excessive line counts skip Markdown highlighting", () => {
  assert.equal(highlightMarkdownCode("x".repeat(MARKDOWN_HIGHLIGHT_MAX_LINE_LENGTH + 1), "js"), null);
  assert.equal(highlightMarkdownCode("x\n".repeat(MARKDOWN_HIGHLIGHT_MAX_LINES + 1), "js"), null);
});

test("Markdown HTML code is escaped before insertion into the DOM", () => {
  const result = highlightMarkdownCode('<script>alert("unsafe")</script>', "html");
  assert.doesNotMatch(result.html, /<script>/);
  assert.match(result.html, /&lt;/);
  assert.match(result.html, /hljs-tag/);
});
