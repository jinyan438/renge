import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getMatchedWorldBookEntries,
  normalizeWorldBook,
  normalizeWorldBookEntry,
} from "../src/worldbookUtils.ts";
import {
  exportCharacterCardJson,
  normalizeCharacterCard,
} from "../src/characterCardUtils.ts";

function createBook(entries) {
  return normalizeWorldBook({
    id: "book",
    name: "测试世界书",
    entries,
  });
}

function matched(entry, messages, options = {}) {
  const book = createBook([entry]);
  return getMatchedWorldBookEntries([book], [book.id], messages, options).length > 0;
}

test("secondary keyword logic implements any/all/not-any/not-all", () => {
  const messages = [{ role: "user", content: "dragon blue" }];
  const base = {
    uid: "selective",
    keys: ["dragon"],
    secondaryKeys: ["blue", "ancient"],
    selective: true,
    content: "lore",
  };

  assert.equal(matched({ ...base, selectiveLogic: 0 }, messages), true);
  assert.equal(matched({ ...base, selectiveLogic: 3 }, messages), false);
  assert.equal(matched({ ...base, selectiveLogic: 2 }, messages), false);
  assert.equal(matched({ ...base, selectiveLogic: 1 }, messages), true);
  assert.equal(
    matched({ ...base, selectiveLogic: 3 }, [{ content: "dragon blue ancient" }]),
    true,
  );
  assert.equal(
    matched({ ...base, selectiveLogic: 2 }, [{ content: "dragon" }]),
    true,
  );
});

test("entry scan depth limits scanned messages and zero disables keyword scans", () => {
  const entry = {
    uid: "scan",
    keys: ["dragon"],
    content: "lore",
  };
  const messages = [
    { role: "user", content: "dragon appeared earlier" },
    { role: "assistant", content: "no keyword here" },
  ];

  assert.equal(matched({ ...entry, scanDepth: 1 }, messages), false);
  assert.equal(matched({ ...entry, scanDepth: 2 }, messages), true);
  assert.equal(matched({ ...entry, scanDepth: 0 }, messages), false);
  assert.equal(
    matched({ ...entry, constant: true, scanDepth: 0 }, messages),
    true,
    "constant entries remain active at zero scan depth",
  );
  assert.equal(matched(entry, messages, { defaultScanDepth: 0 }), false);

  assert.equal(normalizeWorldBookEntry({ scan_depth: 0 }).scanDepth, 0);
});

test("SillyTavern slash-delimited regex keys match with their own flags", () => {
  const entry = {
    uid: "regex",
    keys: ["/drag(on)?/i"],
    content: "lore",
  };
  assert.equal(matched(entry, [{ content: "A DRAGON crossed the valley." }]), true);
  assert.equal(matched(entry, [{ content: "A wolf crossed the valley." }]), false);
});

test("an imported trigger probability is enabled unless explicitly disabled", () => {
  const imported = normalizeWorldBook({
    id: "imported",
    name: "导入",
    entries: [{ uid: "chance", keys: ["dragon"], content: "lore", probability: 50 }],
  });
  assert.equal(imported.entries[0].useProbability, true);

  const explicitlyDisabled = normalizeWorldBookEntry({
    uid: "off",
    keys: ["dragon"],
    content: "lore",
    probability: 50,
    useProbability: false,
  });
  assert.equal(explicitlyDisabled.useProbability, false);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.49;
    assert.equal(
      getMatchedWorldBookEntries(
        [imported],
        [imported.id],
        [{ content: "dragon" }],
      ).length,
      1,
    );
    Math.random = () => 0.5;
    assert.equal(
      getMatchedWorldBookEntries(
        [imported],
        [imported.id],
        [{ content: "dragon" }],
      ).length,
      0,
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("character card export and import preserve editable worldbook entry settings", () => {
  const card = normalizeCharacterCard({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "测试角色",
      character_book: {
        name: "角色设定",
        entries: [{
          uid: "entry-1",
          keys: ["dragon"],
          secondary_keys: ["blue", "ancient"],
          comment: "蓝龙",
          content: "A {{char}} fact for {{user}}.",
          enabled: true,
          constant: false,
          selective: true,
          selectiveLogic: 3,
          position: "at_depth",
          depth: 2,
          scanDepth: 0,
          order: 250,
          probability: 65,
          useProbability: true,
          caseSensitive: true,
          matchWholeWords: true,
          useRegex: true,
        }],
      },
    },
  });

  const exported = JSON.parse(exportCharacterCardJson(card));
  const roundTrip = normalizeCharacterCard(exported);
  const originalEntry = card.characterBook.entries[0];
  const restoredEntry = roundTrip.characterBook.entries[0];
  for (const key of [
    "keys",
    "secondaryKeys",
    "comment",
    "content",
    "enabled",
    "constant",
    "selective",
    "selectiveLogic",
    "position",
    "depth",
    "scanDepth",
    "order",
    "probability",
    "useProbability",
    "caseSensitive",
    "matchWholeWords",
    "useRegex",
  ]) {
    assert.deepEqual(restoredEntry[key], originalEntry[key], `${key} should survive export/import`);
  }
});
