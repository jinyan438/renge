import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCharacterGreetingGenerationPrompt,
  normalizeGeneratedCharacterGreeting,
} from "../src/characterGreetingUtils.ts";
import { sortCharacterCardsByImportTime } from "../src/characterCardOrderUtils.ts";

test("sorts character cards from newest import to oldest without mutating input", () => {
  const oldest = { name: "旧卡", importedAt: "2026-01-01T00:00:00.000Z" };
  const newest = { name: "新卡", importedAt: "2026-03-01T00:00:00.000Z" };
  const middle = { name: "中间卡", importedAt: "2026-02-01T00:00:00.000Z" };
  const cards = [oldest, newest, middle];

  assert.deepEqual(
    sortCharacterCardsByImportTime(cards).map((card) => card.name),
    ["新卡", "中间卡", "旧卡"],
  );
  assert.deepEqual(cards.map((card) => card.name), ["旧卡", "新卡", "中间卡"]);
});

test("builds alternate greeting context from basic fields, greetings, and enabled worldbook entries", () => {
  const card = {
    name: "林澈",
    nickname: "阿澈",
    tags: ["侦探", "雨夜"],
    description: "谨慎的私人侦探。",
    personality: "冷静，但会暗中照顾 {{user}}。",
    scenario: "故事发生在港城。",
    messageExample: "{{char}}：别离我太远。",
    firstMessage: "雨落在事务所的窗上。",
    alternateGreetings: ["码头的雾漫过路灯。"],
    characterBook: {
      id: "book-1",
      name: "港城设定",
      description: "近未来海港城市。",
      sourceFormat: "renge",
      sourceFileName: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      entries: [
        {
          id: "entry-enabled",
          uid: "0",
          comment: "旧码头",
          keys: ["码头"],
          secondaryKeys: [],
          content: "旧码头夜间禁止通行。",
          enabled: true,
          constant: false,
          selective: false,
          selectiveLogic: 0,
          position: "after_char",
          depth: 4,
          scanDepth: null,
          order: 100,
          probability: 100,
          useProbability: false,
          caseSensitive: false,
          matchWholeWords: false,
          useRegex: false,
        },
        {
          id: "entry-disabled",
          uid: "1",
          comment: "废案",
          keys: [],
          secondaryKeys: [],
          content: "不应发送的内容。",
          enabled: false,
          constant: true,
          selective: false,
          selectiveLogic: 0,
          position: "after_char",
          depth: 4,
          scanDepth: null,
          order: 100,
          probability: 100,
          useProbability: false,
          caseSensitive: false,
          matchWholeWords: false,
          useRegex: false,
        },
      ],
    },
  };

  const prompt = buildCharacterGreetingGenerationPrompt(card, "写一个清晨重逢的开场");

  assert.match(prompt.systemPrompt, /只输出一段完整/);
  assert.match(prompt.userPrompt, /写一个清晨重逢的开场/);
  assert.match(prompt.userPrompt, /谨慎的私人侦探/);
  assert.match(prompt.userPrompt, /雨落在事务所的窗上/);
  assert.match(prompt.userPrompt, /码头的雾漫过路灯/);
  assert.match(prompt.userPrompt, /旧码头夜间禁止通行/);
  assert.doesNotMatch(prompt.userPrompt, /不应发送的内容/);
});

test("normalizes fenced alternate greeting output", () => {
  assert.equal(
    normalizeGeneratedCharacterGreeting("```markdown\n雨声里，{{char}}推开了门。\n```"),
    "雨声里，{{char}}推开了门。",
  );
});
