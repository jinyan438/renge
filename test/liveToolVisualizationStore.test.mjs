import assert from "node:assert/strict";
import test from "node:test";
import { createLiveToolVisualizationStore } from "../src/liveToolVisualizationStore.ts";
import { getToolOutputPreview } from "../src/toolOutputPreviewUtils.ts";

test("tool progress notifies only its own session and card without modifying durable messages", () => {
  const store = createLiveToolVisualizationStore();
  const initial = { toolCallId: "tool", status: "running", args: {} };
  const history = [{ id: "user", content: "keep" }, { id: "anchor", toolVisualization: initial }];
  const notifications = [0, 0, 0];
  const unsubscribe = store.subscribe("a", "tool", () => notifications[0]++);
  store.subscribe("a", "other", () => notifications[1]++);
  store.subscribe("b", "tool", () => notifications[2]++);
  for (let index = 0; index < 100; index++) store.update("a", "tool", { ...initial, args: { content: `partial ${index}` } });
  assert.deepEqual(notifications, [100, 0, 0]);
  assert.equal(history[1].toolVisualization, initial);
  const snapshot = store.materialize("a", history);
  assert.equal(snapshot[0], history[0]);
  assert.equal(snapshot[1].toolVisualization.args.content, "partial 99");
  assert.equal(store.materialize("a", history), snapshot, "reads within one revision retain reference identity");
  assert.equal(store.materialize("b", history), history);
  store.update("a", "tool", snapshot[1].toolVisualization);
  assert.equal(notifications[0], 100, "identical snapshots do not redraw a card");
  unsubscribe();
  store.clearSession("a");
  assert.deepEqual(notifications, [100, 0, 0]);
});

test("materializing all sessions preserves complete raw arguments/results for saves and background runs", () => {
  const store = createLiveToolVisualizationStore();
  const sessions = ["a", "b"].map((id) => ({ id, messages: [{ id: `${id}-anchor`, toolVisualization: { toolCallId: "same-id", args: {} } }] }));
  const raw = "中文🚀\n".repeat(200_000);
  store.update("a", "same-id", { toolCallId: "same-id", partialArguments: raw, args: { content: raw } });
  store.update("b", "same-id", { toolCallId: "same-id", result: { content: raw } });
  const snapshot = sessions.map((session) => ({ ...session, messages: store.materialize(session.id, session.messages) }));
  assert.equal(snapshot[0].messages[0].toolVisualization.partialArguments, raw);
  assert.equal(snapshot[1].messages[0].toolVisualization.result.content, raw);
  store.clearSession("a");
  assert.equal(store.materialize("a", snapshot[0].messages), snapshot[0].messages, "committed progress stays durable after clearing the overlay");
  assert.equal(store.getSnapshot("b", "same-id").result.content, raw);
});

test("reset/deletion cannot resurrect an old tool anchor or leak progress into another session", () => {
  const store = createLiveToolVisualizationStore();
  let notifications = 0;
  store.subscribe("a", "call", () => notifications++);
  store.update("a", "call", { toolCallId: "call", result: "old" });
  assert.deepEqual(store.materialize("a", []), []);
  store.clearSession("a");
  assert.equal(notifications, 2);
  assert.equal(store.getSnapshot("a", "call"), undefined);
  const newHistory = [{ toolVisualization: { toolCallId: "call", result: "new" } }];
  assert.equal(store.materialize("a", newHistory), newHistory);
});

test("output previews bound both line count and characters while keeping the newest shell output", () => {
  const text = Array.from({ length: 10_000 }, (_, index) => `output ${index}`).join("\n");
  const tail = getToolOutputPreview(text);
  assert.ok(tail.truncated);
  assert.ok(tail.text.endsWith("output 9999"));
  assert.ok(tail.text.length <= 32_000);
  assert.equal(tail.text.split("\n").length, 400);
  const head = getToolOutputPreview(text, false);
  assert.equal(head.text.split("\n")[0], "output 0");
  assert.equal(head.text.split("\n").length, 400);
  assert.equal(text.split("\n").length, 10_000);
});

test("minified output and Unicode cuts stay bounded without creating broken surrogate pairs", () => {
  const text = "🚀".repeat(40_000);
  const tail = getToolOutputPreview(text, true, 31_999);
  const head = getToolOutputPreview(text, false, 31_999);
  for (const preview of [head, tail]) {
    assert.ok(preview.truncated);
    assert.ok(preview.text.length <= 31_999);
    assert.equal(preview.text.replace(/🚀/gu, ""), "");
  }
  for (const original of ["", "\n", "\ntext", "text\n", "short output"]) {
    assert.deepEqual(getToolOutputPreview(original), { text: original, truncated: false });
  }
});
