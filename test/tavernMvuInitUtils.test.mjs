import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";

import {
  extractTavernMvuInitVariables,
  initializeTavernMvuMessages,
} from "../src/tavernMvuInitUtils.ts";

test("parses fenced YAML from an initvar block", () => {
  const result = extractTavernMvuInitVariables(
    "<UpdateVariable><initvar>```yaml\nworld:\n  day: 1\n```</initvar></UpdateVariable>",
    parse,
  );

  assert.deepEqual(result.variables, { world: { day: 1 } });
  assert.deepEqual(result.errors, []);
});

test("deeply merges multiple initvar blocks", () => {
  const result = extractTavernMvuInitVariables(
    [
      "<initvar>player:\n  name: A\n  level: 1</initvar>",
      "<initvar>player:\n  level: 2\nscene: train</initvar>",
    ].join("\n"),
    parse,
  );

  assert.deepEqual(result.variables, {
    player: { name: "A", level: 2 },
    scene: "train",
  });
});

test("keeps valid initvar blocks when another block is invalid", () => {
  const result = extractTavernMvuInitVariables(
    "<initvar>valid: true</initvar><initvar>broken: [</initvar>",
    parse,
  );

  assert.deepEqual(result.variables, { valid: true });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].blockIndex, 2);
});

test("initializes empty message variables without overwriting existing data", () => {
  const existing = { stat_data: { preserved: true } };
  const result = initializeTavernMvuMessages(
    [
      { content: "<initvar>ready: true</initvar>" },
      { content: "<initvar>preserved: false</initvar>", variables: existing },
    ],
    parse,
  );

  assert.equal(result.initializations.length, 1);
  assert.deepEqual(result.messages[0].variables?.stat_data, { ready: true });
  assert.equal(result.messages[1].variables, existing);
});
