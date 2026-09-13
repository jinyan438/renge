import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import {
  CHAT_SCROLL_ACTIVITY_MESSAGE,
  CHAT_SCROLL_SETTLE_MS,
  centerChatBubble,
  chatScrollScheduler,
  createChatPreviewMountQueue,
  createChatScrollScheduler,
  createChatStreamUpdateBatcher,
  observeChatScrollActivity,
  scrollChatToLatest,
} from "../src/chatPerformanceUtils.ts";
import { getHtmlPreviewLayoutSettleDelays } from "../src/htmlPreviewUtils.ts";

function mockReducedMotion(context, matches) {
  const previousWindow = globalThis.window;
  const previousResizeObserver = globalThis.ResizeObserver;
  const previousMutationObserver = globalThis.MutationObserver;
  const timers = new Set();
  const frames = new Set();
  const observers = [];
  globalThis.window = {
    matchMedia: () => ({ matches }),
    setTimeout(callback) { timers.add(callback); return callback; },
    clearTimeout(callback) { timers.delete(callback); },
    requestAnimationFrame(callback) { frames.add(callback); return callback; },
    cancelAnimationFrame(callback) { frames.delete(callback); },
  };
  class Observer {
    constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  }
  globalThis.ResizeObserver = Observer;
  globalThis.MutationObserver = Observer;
  context.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousResizeObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previousResizeObserver;
    if (previousMutationObserver === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = previousMutationObserver;
  });
  return {
    settle() { const pending = [...timers]; timers.clear(); pending.forEach((callback) => callback()); },
    resize() { observers.filter((observer) => observer.active).forEach((observer) => observer.callback()); },
    paint() { const pending = [...frames]; frames.clear(); pending.forEach((callback) => callback()); },
    observers,
  };
}

test("bubble navigation aligns the selected bubble top to the chat viewport center regardless of height", (context) => {
  mockReducedMotion(context, false);
  let focused = false;
  let scrollOptions;
  const bubble = {
    getBoundingClientRect: () => ({ top: 400, height: 100 }),
    focus: (options) => { focused = options.preventScroll; },
  };
  const thread = Object.assign(new EventTarget(), {
    children: [], contains: (element) => element === bubble,
    scrollTop: 700, clientTop: 2, clientHeight: 600, scrollHeight: 3000,
    getBoundingClientRect: () => ({ top: 180 }),
    scrollTo: (options) => { scrollOptions = options; },
  });
  const dot = { closest: (selector) => selector === ".chat-thread"
    ? thread : { querySelector: () => bubble } };
  assert.equal(centerChatBubble(dot), true);
  assert.equal(focused, true);
  // The bubble top starts 82 px above the reading viewport's center.
  assert.deepEqual(scrollOptions, { top: 618, behavior: "smooth" });

  bubble.getBoundingClientRect = () => ({ top: 400, height: 1000 });
  centerChatBubble(dot);
  assert.equal(scrollOptions.top, 618, "expanding a tool card does not move the reading target");
  thread.dispatchEvent(new Event("wheel"));
});

test("bubble navigation handles scroll boundaries, reduced motion and missing targets", (context) => {
  mockReducedMotion(context, true);
  let top = 0;
  let scrollOptions;
  const bubble = {
    getBoundingClientRect: () => ({ top, height: 100 }), focus() {},
  };
  const thread = Object.assign(new EventTarget(), {
    children: [], contains: (element) => element === bubble,
    scrollTop: 0, clientTop: 0, clientHeight: 600, scrollHeight: 2000,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: (options) => { scrollOptions = options; },
  });
  const dot = { closest: (selector) => selector === ".chat-thread"
    ? thread : { querySelector: () => bubble } };
  centerChatBubble(dot);
  assert.equal(scrollOptions, undefined, "a bubble already at the scroll boundary does not scroll");
  top = 1900;
  centerChatBubble(dot);
  assert.deepEqual(scrollOptions, { top: 1400, behavior: "instant" });
  assert.equal(centerChatBubble({ closest: () => null }), false);
  thread.dispatchEvent(new Event("wheel"));
});

test("bubble navigation corrects late layout shifts and stops holding position after manual scrolling", (context) => {
  const scheduler = mockReducedMotion(context, false);
  let contentTop = 1100;
  const calls = [];
  const bubble = {
    getBoundingClientRect: () => ({ top: 182 + contentTop - thread.scrollTop, height: 100 }),
    focus() {},
  };
  const thread = Object.assign(new EventTarget(), {
    children: [{}], contains: (element) => element === bubble,
    scrollTop: 700, clientTop: 2, clientHeight: 600, scrollHeight: 4000,
    getBoundingClientRect: () => ({ top: 180 }),
    scrollTo(options) { calls.push(options); this.scrollTop = options.top; },
  });
  const dot = { closest: (selector) => selector === ".chat-thread"
    ? thread : { querySelector: () => bubble } };
  centerChatBubble(dot);
  assert.equal(thread.scrollTop, 800);
  contentTop += 150;
  scheduler.resize();
  scheduler.paint();
  assert.equal(calls.length, 1, "layout changes do not interrupt the initial smooth scroll");
  scheduler.settle();
  assert.deepEqual(calls.at(-1), { top: 950, behavior: "instant" });
  contentTop += 120;
  scheduler.resize();
  scheduler.paint();
  assert.equal(thread.scrollTop, 1070, "late preview loading keeps the target top centered");
  thread.dispatchEvent(new Event("wheel"));
  const count = calls.length;
  contentTop += 200;
  scheduler.resize();
  scheduler.paint();
  assert.equal(calls.length, count);
  assert.ok(scheduler.observers.every((observer) => !observer.active));
});

test("bubble navigation accounts for a scaled chat window and cancels when following new output", (context) => {
  const scheduler = mockReducedMotion(context, false);
  let scrollOptions;
  const bubble = { getBoundingClientRect: () => ({ top: 620 }), focus() {} };
  const thread = Object.assign(new EventTarget(), {
    children: [], contains: (element) => element === bubble,
    scrollTop: 700, clientTop: 2, clientHeight: 600, offsetHeight: 604, scrollHeight: 3000,
    getBoundingClientRect: () => ({ top: 180, height: 1208 }),
    scrollTo(options) { scrollOptions = options; },
  });
  const dot = { closest: (selector) => selector === ".chat-thread"
    ? thread : { querySelector: () => bubble } };
  centerChatBubble(dot);
  assert.equal(scrollOptions.top, 618);
  scrollChatToLatest(thread);
  assert.ok(scheduler.observers.every((observer) => !observer.active));
});

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

test("defers background work until scrolling and momentum settle", () => {
  let now = 0;
  let calls = 0;
  const scheduler = createFakeScheduler();
  const scrolling = createChatScrollScheduler({ now: () => now });
  scrolling.schedule(() => calls += 1, scheduler.schedule);
  scrolling.markScrolling();
  scheduler.runNext();
  assert.equal(calls, 0);
  assert.equal(scheduler.tasks.at(-1).delayMs, CHAT_SCROLL_SETTLE_MS);

  now = 100;
  scrolling.markScrolling();
  now = CHAT_SCROLL_SETTLE_MS;
  scheduler.runNext();
  assert.equal(calls, 0);
  now = 100 + CHAT_SCROLL_SETTLE_MS;
  scheduler.runNext();
  assert.equal(calls, 1);
  assert.equal(scrolling.isScrolling(), false);
});

test("extends a pending activity window without shortening it", () => {
  let now = 0;
  const scheduler = createFakeScheduler();
  const activity = createChatScrollScheduler({ now: () => now, settleMs: 100 });
  let calls = 0;

  activity.markScrolling(500);
  activity.schedule(() => calls += 1, scheduler.schedule);
  now = 100;
  activity.markScrolling(50);
  scheduler.runNext();
  assert.equal(calls, 0);
  assert.equal(scheduler.tasks.at(-1).delayMs, 400);

  now = 500;
  scheduler.runNext();
  assert.equal(calls, 1);
});

test("cancels work that has been rescheduled during scrolling", () => {
  const scheduler = createFakeScheduler();
  const scrolling = createChatScrollScheduler({ now: () => 0 });
  let calls = 0;
  scrolling.markScrolling();
  const cancel = scrolling.schedule(() => calls += 1, scheduler.schedule);
  scheduler.runNext();
  cancel();
  assert.ok(scheduler.tasks.every((task) => task.cancelled));
  assert.equal(calls, 0);
});

test("buffers streamed text during scrolling but flushes final text immediately", () => {
  const scheduler = createFakeScheduler();
  const scrolling = createChatScrollScheduler({ now: () => 0 });
  const updates = [];
  const batcher = createChatStreamUpdateBatcher({
    apply: (update) => updates.push(update),
    now: () => 0,
    schedule: (callback, delayMs) => scrolling.schedule(callback, scheduler.schedule, delayMs),
  });
  scrolling.markScrolling();
  batcher.pushContent("first");
  scheduler.runNext();
  batcher.pushContent(" second");
  batcher.pushReasoning("reasoning");
  assert.deepEqual(updates, []);
  batcher.flush();
  assert.deepEqual(updates, [{ content: "first second", reasoning: "reasoning" }]);
  assert.ok(scheduler.tasks.every((task) => task.cancelled));
});

test("serializes normal and heavy previews with a mount gap", () => {
  const scheduler = createFakeScheduler();
  const queue = createChatPreviewMountQueue(scheduler.schedule);
  const mounted = [];
  queue.enqueue(() => mounted.push("normal"));
  queue.enqueue(() => mounted.push("heavy"), 900);
  assert.equal(scheduler.tasks.length, 1);
  scheduler.runNext();
  assert.deepEqual(mounted, ["normal"]);
  assert.equal(scheduler.tasks.at(-1).delayMs, 120);
  scheduler.runNext();
  assert.deepEqual(mounted, ["normal"]);
  scheduler.runNext();
  assert.deepEqual(mounted, ["normal", "heavy"]);
  assert.equal(scheduler.tasks.at(-1).delayMs, 900);
});

test("skips canceled previews without blocking previews still in view", () => {
  const scheduler = createFakeScheduler();
  const queue = createChatPreviewMountQueue(scheduler.schedule);
  const mounted = [];
  const cancelFirst = queue.enqueue(() => mounted.push("first"));
  const cancelSecond = queue.enqueue(() => mounted.push("second"));
  queue.enqueue(() => mounted.push("visible"));
  cancelSecond();
  cancelFirst();
  scheduler.runNext();
  assert.deepEqual(mounted, ["visible"]);
});

test("scroll events distinguish automatic following from iframe-originated scrolling", (context) => {
  const timers = createFakeScheduler();
  const previews = [];
  const thread = new EventTarget();
  Object.assign(thread, {
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 500,
    querySelectorAll: () => [{ contentWindow: { postMessage: (payload) => previews.push(payload) } }],
  });
  context.mock.method(globalThis, "setTimeout", timers.schedule);
  const previousWindow = globalThis.window;
  globalThis.window = {
    setTimeout: timers.schedule,
    clearTimeout: (cancel) => cancel(),
  };
  try {
    const dispose = observeChatScrollActivity(thread);
    scrollChatToLatest(thread);
    thread.dispatchEvent(new Event("scroll"));
    assert.equal(thread.scrollTop, 1500);
    assert.equal(chatScrollScheduler.isScrolling(), false);
    assert.deepEqual(previews, []);
    thread.scrollTop = 900;
    thread.dispatchEvent(new Event("scroll"));
    assert.equal(chatScrollScheduler.isScrolling(), true);
    assert.deepEqual(previews, [{ type: CHAT_SCROLL_ACTIVITY_MESSAGE, scrolling: true }]);
    scrollChatToLatest(thread);
    assert.equal(thread.scrollTop, 900);
    dispose();
    assert.deepEqual(previews.at(-1), { type: CHAT_SCROLL_ACTIVITY_MESSAGE, scrolling: false });
    assert.ok(timers.tasks.every((task) => task.cancelled));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("keeps every asynchronously growing chat message in normal layout", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const stylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.doesNotMatch(appSource, /createChatMessageVirtualizer/);
  assert.doesNotMatch(stylesSource, /\.chat-message[^{}]*\{[^}]*content-visibility/s);
  assert.doesNotMatch(stylesSource, /--chat-message-intrinsic-height/);
});

test("preview startup reports reuse layout and measurements pause during scrolling", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const start = appSource.indexOf("function buildHtmlPreviewScript(");
  const end = appSource.indexOf("\nfunction injectHtmlPreviewHead(", start);
  assert.ok(start >= 0 && end > start);
  const builder = ts.transpileModule(appSource.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const markup = vm.runInNewContext(`${builder}; buildHtmlPreviewScript('preview', false)`, {
    HTML_PREVIEW_RESIZE_MESSAGE: "resize",
    HTML_PREVIEW_REMEASURE_MESSAGE: "remeasure",
    CHAT_SCROLL_ACTIVITY_MESSAGE,
    HTML_PREVIEW_MAX_HEIGHT: 12000,
    HTML_PREVIEW_MEASURED_MIN_HEIGHT: 64,
    getHtmlPreviewLayoutSettleDelays,
  });
  const script = markup.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
  const frames = [];
  const timers = [];
  const listeners = new Map();
  let measurements = 0;
  let scans = 0;
  const body = {
    style: {},
    scrollWidth: 400,
    scrollHeight: 300,
    offsetHeight: 300,
    getBoundingClientRect: () => { measurements += 1; return { width: 400, height: 300 }; },
  };
  const document = {
    body,
    documentElement: { scrollWidth: 400, clientHeight: 420 },
    querySelector: () => null,
    querySelectorAll: (selector) => { if (selector === "body *") scans += 1; return []; },
    addEventListener() {},
  };
  const parent = { postMessage() {} };
  const window = {
    innerWidth: 400,
    innerHeight: 420,
    getComputedStyle: () => ({ getPropertyValue: () => "0" }),
    setTimeout: (callback, delayMs) => { timers.push({ callback, delayMs }); return timers.length; },
    clearTimeout() {},
    addEventListener: (name, callback) => {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
  };
  vm.runInNewContext(script, {
    document, window, parent, performance,
    setTimeout: window.setTimeout,
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
  });
  const send = (data, source = parent) => {
    listeners.get("message").forEach((listener) => listener({ data, source }));
  };
  const runFrame = () => {
    const callback = frames.shift();
    assert.ok(callback);
    callback();
  };
  runFrame();
  assert.equal(measurements, 1);
  assert.equal(scans, 1);
  [80, 240, 600].forEach((delay) => {
    timers.find((timer) => timer.delayMs === delay).callback();
    runFrame();
  });
  assert.equal(measurements, 1);
  assert.equal(scans, 1);
  send({ type: CHAT_SCROLL_ACTIVITY_MESSAGE, scrolling: true });
  send({ type: "remeasure", id: "preview" });
  assert.equal(frames.length, 0);
  send({ type: CHAT_SCROLL_ACTIVITY_MESSAGE, scrolling: false }, {});
  assert.equal(frames.length, 0);
  send({ type: CHAT_SCROLL_ACTIVITY_MESSAGE, scrolling: false });
  runFrame();
  assert.equal(scans, 1);
  window.innerWidth = 360;
  send({ type: "remeasure", id: "preview" });
  runFrame();
  assert.equal(scans, 2);
});
