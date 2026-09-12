import assert from "node:assert/strict";
import test from "node:test";
import {
  areJsonValuesEqual,
  canPreservePersistentCharacterCards,
  compactCharacterCardsForPersistentStore,
  createPersistentReferenceBaseline,
  createShallowReferencePatch,
  hasMeaningfulPatchChanges,
} from "../src/appDataPersistenceUtils.ts";

test("creates a reference-based patch without unchanged large values", () => {
  const sessions = [{ id: "session-1" }];
  const cards = [{ id: "card-1" }];
  const previous = { sessions, cards, activeId: "first", updatedAt: "old" };
  const current = { sessions, cards, activeId: "second", updatedAt: "new" };

  assert.deepEqual(createShallowReferencePatch(current, previous), {
    activeId: "second",
    updatedAt: "new",
  });
});

test("omits fields that are persisted in a separate store", () => {
  const current = {
    cards: [{ id: "card-1", avatar: "large" }],
    sessions: [{ id: "session-1" }],
  };

  assert.deepEqual(
    createShallowReferencePatch(current, null, new Set(["cards"])),
    { sessions: current.sessions },
  );
});

test("builds a loaded-data baseline while leaving migrations dirty", () => {
  const sessions = [{ id: "session-1" }];
  const settings = { theme: "dark" };
  const current = { sessions, settings, missingOnServer: true, updatedAt: "new" };
  const baseline = createPersistentReferenceBaseline(
    current,
    {
      sessions: [{ id: "session-1" }],
      settings: { theme: "dark" },
      updatedAt: "new",
    },
    new Set(["sessions"]),
  );

  assert.deepEqual(baseline, { settings, updatedAt: "new" });
  assert.deepEqual(createShallowReferencePatch(current, baseline), {
    sessions,
    missingOnServer: true,
  });
});

test("compares normalized JSON values without requiring shared references", () => {
  assert.equal(
    areJsonValuesEqual(
      { nested: [{ id: "one", enabled: true }] },
      { nested: [{ id: "one", enabled: true }] },
    ),
    true,
  );
  assert.equal(
    areJsonValuesEqual(
      { nested: [{ id: "one", enabled: true }] },
      { nested: [{ id: "one", enabled: false }] },
    ),
    false,
  );
  assert.equal(
    areJsonValuesEqual(
      { nested: { optional: undefined }, values: [undefined, Number.NaN] },
      { nested: {}, values: [null, null] },
    ),
    true,
  );
  assert.equal(areJsonValuesEqual(new Array(1), [null]), true);
});

test("ignores timestamp-only patches but keeps real changes", () => {
  const ignored = new Set(["updatedAt"]);
  assert.equal(hasMeaningfulPatchChanges({ updatedAt: "new" }, ignored), false);
  assert.equal(
    hasMeaningfulPatchChanges({ updatedAt: "new", activeId: "changed" }, ignored),
    true,
  );
});

test("only preserves character cards that are already compacted", () => {
  assert.equal(
    canPreservePersistentCharacterCards([
      { avatarDataUrl: "data:image/png;base64,AAAA" },
    ]),
    false,
  );
  assert.equal(
    canPreservePersistentCharacterCards([
      { avatarDataUrl: "" },
      { avatarDataUrl: "https://example.com/avatar.png" },
    ]),
    true,
  );
  assert.equal(canPreservePersistentCharacterCards([]), false);
});

test("compacts only embedded character covers before persistence comparison", () => {
  const current = [
    { id: "card-1", nickname: "", avatarDataUrl: "data:image/png;base64,AAAA" },
    { id: "card-2", avatarDataUrl: "https://example.com/card.png" },
  ];
  assert.deepEqual(compactCharacterCardsForPersistentStore(current), [
    { id: "card-1", nickname: "", avatarDataUrl: "" },
    current[1],
  ]);
  assert.equal(
    areJsonValuesEqual(
      compactCharacterCardsForPersistentStore(current),
      [
        { id: "card-1", avatarDataUrl: "" },
        { id: "card-2", avatarDataUrl: "https://example.com/card.png" },
      ],
    ),
    false,
  );
});
