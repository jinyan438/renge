import assert from "node:assert/strict";
import test from "node:test";

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
