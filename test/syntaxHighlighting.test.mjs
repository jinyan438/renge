import assert from "node:assert/strict";
import test from "node:test";

import {
  getSyntaxHighlightLanguage,
  highlightSourceCode,
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
