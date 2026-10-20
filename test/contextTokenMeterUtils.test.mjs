import assert from "node:assert/strict";
import test from "node:test";
import { createPiContextUsageStore, createNativeContextTokenMeter, hasUsablePiContextUsage } from "../src/contextTokenMeterUtils.ts";

test("live usage notifies only the selected session/model, and identical snapshots stay stable", () => {
  const store = createPiContextUsageStore();
  const updates = [];
  const unsubscribe = store.subscribe("one\u0000model", () => updates.push("one"));
  store.subscribe("two\u0000model", () => updates.push("two"));
  const usage = { tokens: 10_000, contextWindow: 100_000, percent: 10, breakdown: [{ label: "助手消息", tokens: 10_000 }] };
  store.update("one\u0000model", usage);
  store.update("one\u0000model", structuredClone(usage));
  assert.deepEqual(updates, ["one"]);
  assert.equal(store.getSnapshot("one\u0000model"), usage);
  store.update("two\u0000model", { ...usage, tokens: 20_000 });
  assert.deepEqual(updates, ["one", "two"]);
  unsubscribe();
  store.update("one\u0000model", { ...usage, tokens: 30_000 });
  assert.deepEqual(updates, ["one", "two"]);
});

test("compaction may decrease live counts; resetting one session preserves other models and sessions", () => {
  const store = createPiContextUsageStore();
  const usage = { tokens: 80_000, contextWindow: 100_000, percent: 80 };
  store.update("one\u0000model-a", usage);
  store.update("one\u0000model-b", usage);
  store.update("two\u0000model-a", usage);
  store.update("one\u0000model-a", { ...usage, tokens: 20_000, percent: 20 });
  assert.equal(store.getSnapshot("one\u0000model-a").tokens, 20_000);
  const notifications = [];
  store.subscribe("one\u0000model-a", () => notifications.push("a"));
  store.subscribe("one\u0000model-b", () => notifications.push("b"));
  store.subscribe("two\u0000model-a", () => notifications.push("other"));
  store.clearSession("one");
  assert.equal(store.getSnapshot("one\u0000model-a"), undefined);
  assert.equal(store.getSnapshot("one\u0000model-b"), undefined);
  assert.equal(store.getSnapshot("two\u0000model-a"), usage);
  assert.deepEqual(notifications, ["a", "b"]);
});

test("invalid reports do not replace a valid count; native breakdowns need no history reconstruction", () => {
  const store = createPiContextUsageStore();
  const usage = { tokens: 1_000, contextWindow: 10_000, percent: 10, breakdown: [{ label: "工具结果", tokens: 1_000 }] };
  store.update("key", usage);
  for (const invalid of [null, { ...usage, tokens: 0 }, { ...usage, tokens: NaN }, { ...usage, contextWindow: 0 }]) store.update("key", invalid);
  assert.equal(store.getSnapshot("key"), usage);
  assert.equal(hasUsablePiContextUsage(usage), true);
  assert.equal(hasUsablePiContextUsage(undefined), false);
  const meter = createNativeContextTokenMeter("key", "fixture", usage);
  assert.equal(meter.usageRatio, 0.1);
  assert.equal(meter.nativePiContext, true);
  assert.equal(meter.contextBreakdown, usage.breakdown);
  assert.equal(meter.usageKey, "key");
});
