import assert from "node:assert/strict";
import test from "node:test";

import {
  getCharacterRegexTemplateConfig,
  injectCharacterRegexTemplateVariables,
  isCharacterRegexTemplateMessageEligible,
  parseCharacterRegexTemplateVariables,
  renderCharacterRegexTemplate,
} from "../src/characterTemplateUtils.ts";

const customRegex = String.raw`\[([^\]]+)\]([\s\S]*?)(?:\[\/\1\]|(?=\[(?!\/\1\])[^\]]+\])|$)`;

test("discovers XiaobaiX and structurally compatible character templates", () => {
  const known = getCharacterRegexTemplateConfig({
    "xiaobaix-template": {
      enabled: true,
      template: "<html><body></body></html>",
      customRegex,
      limitToRecentMessages: true,
      recentMessageCount: 3,
    },
  });
  assert.equal(known?.sourceKey, "xiaobaix-template");
  assert.equal(known?.recentMessageCount, 3);

  const compatible = getCharacterRegexTemplateConfig({
    "another-renderer": {
      template: "<main></main>",
      customRegex: String.raw`<([a-z]+)>([\s\S]*?)<\/\1>`,
    },
  });
  assert.equal(compatible?.sourceKey, "another-renderer");
  assert.equal(
    getCharacterRegexTemplateConfig({
      "xiaobaix-template": { enabled: false, template: "<main></main>" },
    }),
    null,
  );
});

test("parses tagged roleplay output with custom and fallback regexes", () => {
  const source = [
    "[status]四年前|林间小径|黄昏[/status]",
    "[story]雪见: 爸爸回来了！[/story]",
    "[choices]1. 回应她。[/choices]",
    "[xuejian]5|0|100|0|3|浅色汉服|喜悦[/xuejian]",
    "[player]100|100|无[/player]",
  ].join("\n");
  const values = parseCharacterRegexTemplateVariables(source, customRegex);
  assert.equal(values.status, "四年前|林间小径|黄昏");
  assert.equal(values.story, "雪见: 爸爸回来了！");
  assert.equal(values.choices, "1. 回应她。");
  assert.equal(values.player, "100|100|无");

  const repeatedValues = parseCharacterRegexTemplateVariables(
    "[Story]第一段[/Story]\n[Story]第二段[/Story]",
    customRegex,
  );
  assert.equal(repeatedValues.Story, "第一段\n第二段");
  assert.equal(repeatedValues.story, "第一段\n第二段");

  assert.deepEqual(
    parseCharacterRegexTemplateVariables("[story]fallback[/story]", "[invalid"),
    { story: "fallback" },
  );
});

test("injects parsed values into the card template without closing the bootstrap script", () => {
  const template = "<!doctype html><html><body><main></main></body></html>";
  const injected = injectCharacterRegexTemplateVariables(template, {
    story: "safe </script><script>alert(1)</script>",
  });
  assert.match(injected, /data-renge-character-regex-template/);
  assert.match(injected, /updateTemplateVariables/);
  const serializedValues = /const values=([^;]+);/.exec(injected)?.[1] ?? "";
  assert.doesNotMatch(serializedValues, /<\/script>/i);
  assert.match(serializedValues, /\\u003c\/script>/);
  assert.ok(
    injected.indexOf("data-renge-character-regex-template") < injected.lastIndexOf("</body>"),
  );

  const config = getCharacterRegexTemplateConfig({
    "xiaobaix-template": { template, customRegex },
  });
  assert.ok(config);
  assert.equal(renderCharacterRegexTemplate("ordinary prose", config), null);
  assert.match(renderCharacterRegexTemplate("[story]render me[/story]", config), /render me/);
});

test("honors first-message and recent-message template limits", () => {
  const config = getCharacterRegexTemplateConfig({
    "xiaobaix-template": {
      template: "<main></main>",
      customRegex,
      skipFirstMessage: true,
      limitToRecentMessages: true,
      recentMessageCount: 2,
    },
  });
  assert.ok(config);
  assert.equal(isCharacterRegexTemplateMessageEligible(config, 0, 5, 0), false);
  assert.equal(isCharacterRegexTemplateMessageEligible(config, 2, 5, 0), false);
  assert.equal(isCharacterRegexTemplateMessageEligible(config, 3, 5, 0), true);
});
