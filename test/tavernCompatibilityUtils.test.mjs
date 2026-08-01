import assert from "node:assert/strict";
import test from "node:test";

import {
  attachTavernSubscriptionControls,
  createTavernMacroRegistry,
  createTavernErrorCatched,
  installLegacyTavernSendControls,
  proxyTavernModuleUrls,
} from "../src/tavernCompatibilityUtils.ts";

class FakeElement extends EventTarget {
  constructor(owner) {
    super();
    this.owner = owner;
    this.id = "";
    this.hidden = false;
    this.type = "";
    this.value = "";
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  remove() {
    this.owner.elements.delete(this.id);
  }
}

function createFakeDocument() {
  const document = {
    elements: new Map(),
    getElementById(id) {
      return this.elements.get(id) ?? null;
    },
    createElement() {
      return new FakeElement(this);
    },
  };
  document.body = {
    append(...elements) {
      elements.forEach((element) => document.elements.set(element.id, element));
    },
  };
  document.documentElement = document.body;
  return document;
}

test("legacy parent composer sends card choices directly and cleans up", async () => {
  const document = createFakeDocument();
  const sent = [];
  const cleanup = installLegacyTavernSendControls(
    document,
    async (value) => sent.push(value),
  );
  const textarea = document.getElementById("send_textarea");
  const sendButton = document.getElementById("send_but");

  assert.equal(textarea.hidden, true);
  assert.equal(sendButton.hidden, true);
  textarea.value = "继续调查走廊";
  sendButton.dispatchEvent(new Event("click"));
  await Promise.resolve();
  assert.deepEqual(sent, ["继续调查走廊"]);

  textarea.value = "   ";
  sendButton.dispatchEvent(new Event("click"));
  await Promise.resolve();
  assert.deepEqual(sent, ["继续调查走廊"]);

  cleanup();
  assert.equal(document.getElementById("send_textarea"), null);
  assert.equal(document.getElementById("send_but"), null);
});

test("macro-like registrations substitute regex values and unregister cleanly", () => {
  const registry = createTavernMacroRegistry(() => ({ message_id: 7 }));
  const registration = registry.registerMacroLike(
    /\{\{card_state\}\}/giu,
    (context) => JSON.stringify({ message: context.message_id }),
  );

  assert.equal(
    registry.substitute("state={{card_state}}"),
    'state={"message":7}',
  );
  assert.equal(registration.unregister(), true);
  assert.equal(registry.substitute("state={{card_state}}"), "state={{card_state}}");
});

test("jsDelivr module graphs use the local Tavern module proxy", () => {
  const source = `
import 'https://testingcf.jsdelivr.net/gh/example/card@123/bundle.js';
import { helper } from "https://cdn.jsdelivr.net/npm/example/+esm";
const image = "https://files.example.test/card.png";
`;

  const transformed = proxyTavernModuleUrls(source, "http://127.0.0.1:5190/");

  assert.match(
    transformed,
    /http:\/\/127\.0\.0\.1:5190\/api\/tavern-module-proxy\?url=https%3A%2F%2Ftestingcf\.jsdelivr\.net/,
  );
  assert.match(
    transformed,
    /http:\/\/127\.0\.0\.1:5190\/api\/tavern-module-proxy\?url=https%3A%2F%2Fcdn\.jsdelivr\.net/,
  );
  assert.match(transformed, /https:\/\/files\.example\.test\/card\.png/);
});

test("event subscriptions expose TavernHelper stop controls", () => {
  const calls = [];
  const callback = (value) => calls.push(value);
  let active = true;
  const subscription = attachTavernSubscriptionControls(callback, () => {
    if (!active) return false;
    active = false;
    return true;
  });

  subscription("event");
  assert.equal(subscription, callback);
  assert.deepEqual(calls, ["event"]);
  assert.equal(subscription.stop(), true);
  assert.equal(subscription.unsubscribe(), false);
});

test("errorCatched preserves callback results, arguments, and this", async () => {
  const errors = [];
  const errorCatched = createTavernErrorCatched((error) => errors.push(error));
  const receiver = { prefix: "kosame" };
  const guarded = errorCatched(function (suffix) {
    return `${this.prefix}-${suffix}`;
  });

  assert.equal(await guarded.call(receiver, "ready"), "kosame-ready");
  assert.deepEqual(errors, []);
});

test("errorCatched reports synchronous and asynchronous callback failures", async () => {
  const errors = [];
  const errorCatched = createTavernErrorCatched((error) => errors.push(error));
  const synchronousError = new Error("sync failure");
  const asynchronousError = new Error("async failure");

  assert.equal(
    await errorCatched(() => {
      throw synchronousError;
    })(),
    null,
  );
  assert.equal(
    await errorCatched(async () => {
      throw asynchronousError;
    })(),
    null,
  );
  assert.deepEqual(errors, [synchronousError, asynchronousError]);
});

test("errorCatched tolerates a failing reporter and leaves non-functions unchanged", async () => {
  const errorCatched = createTavernErrorCatched(() => {
    throw new Error("reporter failure");
  });
  const guarded = errorCatched(() => {
    throw new Error("callback failure");
  });

  assert.equal(await guarded(), null);
  assert.equal(errorCatched(null), null);
});
