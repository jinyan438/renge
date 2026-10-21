import assert from "node:assert/strict";
import test from "node:test";
import { animateChatStatusIcon } from "../src/chatStatusAnimation.ts";

function fixture() {
  const timers = new Map(), documentListeners = new Map(), motionListeners = new Map();
  let time = 0, sequence = 0;
  const media = { matches: false, addEventListener: (event, callback) => motionListeners.set(event, callback), removeEventListener: (event) => motionListeners.delete(event) };
  const document = { hidden: false, addEventListener: (event, callback) => documentListeners.set(event, callback), removeEventListener: (event) => documentListeners.delete(event) };
  const view = { document, performance: { now: () => time }, matchMedia: () => media,
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  document.defaultView = view;
  const icon = () => new Proxy({ ownerDocument: document, isConnected: true, style: { transform: "" } }, {
    get(target, key) {
      if (["offsetWidth", "offsetHeight", "getBoundingClientRect"].includes(key)) throw new Error("animation must not read layout");
      return target[key];
    },
  });
  return { timers, documentListeners, motionListeners, media, document, icon,
    tick: (now) => { time = now; const pending = [...timers.values()]; timers.clear(); pending.forEach(({ callback }) => callback()); },
  };
}

test("all progress icons in one native window share a bounded clock without reading layout", () => {
  const f = fixture(), first = f.icon(), second = f.icon();
  const stopFirst = animateChatStatusIcon(first), stopSecond = animateChatStatusIcon(second);
  assert.equal(f.timers.size, 1);
  assert.ok([...f.timers.values()][0].delay >= 1_000 / 30);
  f.tick(700);
  assert.equal(first.style.transform, "rotate(180deg)");
  assert.equal(second.style.transform, first.style.transform);
  assert.equal(f.timers.size, 1);
  stopFirst();
  assert.equal(f.timers.size, 1, "other running tools keep animating");
  assert.equal(first.style.transform, "");
  stopSecond();
  assert.equal(f.timers.size, 0, "completed tasks leave no animation work");
  assert.equal(f.documentListeners.size + f.motionListeners.size, 0);
});

test("hidden native windows and reduced-motion preference pause and resume progress animation", () => {
  const f = fixture(), icon = f.icon();
  const stop = animateChatStatusIcon(icon);
  f.tick(700);
  f.document.hidden = true;
  f.documentListeners.get("visibilitychange")();
  assert.equal(f.timers.size, 0);
  f.document.hidden = false;
  f.documentListeners.get("visibilitychange")();
  assert.equal(f.timers.size, 1);
  f.media.matches = true;
  f.motionListeners.get("change")();
  assert.equal(f.timers.size, 0);
  assert.equal(icon.style.transform, "");
  f.media.matches = false;
  f.motionListeners.get("change")();
  assert.equal(f.timers.size, 1);
  stop();
});
