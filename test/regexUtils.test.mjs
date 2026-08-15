import assert from "node:assert/strict";
import test from "node:test";

import { applyRegexScripts, createRegexScript } from "../src/regexUtils.ts";

function createTestScript(overrides) {
  return {
    ...createRegexScript("测试正则"),
    ...overrides,
  };
}

test("does not apply trim strings when a Tavern regex does not match", () => {
  const source =
    "正文<w2g>A：继续前进</w2g><details><summary>摘要</summary>内容</details>";
  const scripts = [
    createTestScript({
      findRegex: "/([\\s\\S]*?)</draft_notes>/g",
      replaceString: "<div>$1</div>",
      trimStrings: ["<", "draft_notes>"],
    }),
    createTestScript({
      findRegex: "/<w2g>([\\s\\S]*?)<\\/w2g>/g",
      replaceString: "<section class=\"choices\">$1</section>",
    }),
  ];

  assert.equal(
    applyRegexScripts(source, scripts, { destination: "display" }),
    "正文<section class=\"choices\">A：继续前进</section>" +
      "<details><summary>摘要</summary>内容</details>",
  );
});

test("applies Tavern trim strings only to replacement capture values", () => {
  const script = createTestScript({
    findRegex: "/([\\s\\S]*?)</draft_notes>/g",
    replaceString: "<details><summary>思维</summary>$1</details>",
    trimStrings: ["<", "draft_notes>", "{{char}}："],
  });
  const source =
    "<draft_notes>助手：分析内容</draft_notes><w2g>A：继续前进</w2g>";

  assert.equal(
    applyRegexScripts(source, [script], {
      destination: "display",
      characterName: "助手",
    }),
    "<details><summary>思维</summary>分析内容</details>" +
      "<w2g>A：继续前进</w2g>",
  );
});
