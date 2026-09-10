import assert from "node:assert/strict";
import test from "node:test";
import { createChatStreamUpdateBatcher } from "../src/chatPerformanceUtils.ts";

function createFakeScheduler() {
  const tasks = [];
  return {
    schedule(callback, delayMs) {
      const task = { callback, delayMs, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    runNext() {
      const task = tasks.find((candidate) => !candidate.cancelled);
      assert.ok(task, "expected a scheduled task");
      task.cancelled = true;
      task.callback();
      return task;
    },
    tasks,
  };
}

test("coalesces content and reasoning fragments into one UI update", () => {
  const scheduler = createFakeScheduler();
  const updates = [];
  let now = 100;
  const batcher = createChatStreamUpdateBatcher({
    apply: (update) => updates.push(update),
    intervalMs: 32,
    now: () => now,
    schedule: scheduler.schedule,
  });

  batcher.pushContent("你");
  batcher.pushContent("好");
  batcher.pushReasoning("想");

  assert.equal(scheduler.tasks.length, 1);
  scheduler.runNext();
  assert.deepEqual(updates, [{ content: "你好", reasoning: "想" }]);

  now = 110;
  batcher.pushContent("！");
  assert.equal(scheduler.tasks.at(-1).delayMs, 22);
  scheduler.runNext();
  assert.deepEqual(updates.at(-1), { content: "！", reasoning: "" });
});

test("flush applies pending text immediately and cancels scheduled work", () => {
  const scheduler = createFakeScheduler();
  const updates = [];
  const batcher = createChatStreamUpdateBatcher({
    apply: (update) => updates.push(update),
    now: () => 100,
    schedule: scheduler.schedule,
  });

  batcher.pushContent("final");
  batcher.flush();

  assert.deepEqual(updates, [{ content: "final", reasoning: "" }]);
  assert.equal(scheduler.tasks[0].cancelled, true);
});

test("abort discards pending fragments", () => {
  const scheduler = createFakeScheduler();
  const updates = [];
  const controller = new AbortController();
  const batcher = createChatStreamUpdateBatcher({
    apply: (update) => updates.push(update),
    now: () => 100,
    schedule: scheduler.schedule,
    signal: controller.signal,
  });

  batcher.pushContent("discarded");
  controller.abort();
  batcher.flush();

  assert.deepEqual(updates, []);
  assert.equal(scheduler.tasks[0].cancelled, true);
});
