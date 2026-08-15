import assert from "node:assert/strict";
import test from "node:test";

import {
  attachTavernSubscriptionControls,
  createTavernMacroRegistry,
  createTavernErrorCatched,
  installLegacyTavernSendControls,
  installTavernPresetManagerControls,
  proxyTavernModuleUrls,
} from "../src/tavernCompatibilityUtils.ts";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeElement extends EventTarget {
  constructor(owner, tagName = "div") {
    super();
    this.owner = owner;
    this.tagName = tagName.toUpperCase();
    this.id = "";
    this.hidden = false;
    this.type = "";
    this.value = "";
    this.min = "";
    this.max = "";
    this.step = "";
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.classList = new FakeClassList();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(...elements) {
    elements.forEach((element) => {
      element.remove();
      element.parentElement = this;
      this.children.push(element);
      this.owner.register(element);
    });
  }

  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector === "[data-pm-name]") return this.attributes.has("data-pm-name");
    if (selector === "li[data-pm-identifier]") {
      return this.tagName === "LI" && this.attributes.has("data-pm-identifier");
    }
    return false;
  }

  querySelectorAll(selector) {
    const result = [];
    const visit = (element) => {
      element.children.forEach((child) => {
        if (child.matches(selector)) result.push(child);
        visit(child);
      });
    };
    visit(this);
    return result;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  click() {
    this.dispatchEvent(new Event("click"));
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(
        (child) => child !== this,
      );
      this.parentElement = null;
    }
    this.owner.unregister(this);
  }
}

function createFakeDocument() {
  const document = {
    elements: new Map(),
    register(element) {
      if (element.id) this.elements.set(element.id, element);
      element.children.forEach((child) => this.register(child));
    },
    unregister(element) {
      if (element.id && this.elements.get(element.id) === element) {
        this.elements.delete(element.id);
      }
      element.children.forEach((child) => this.unregister(child));
    },
    getElementById(id) {
      return this.elements.get(id) ?? null;
    },
    querySelector(selector) {
      return this.body.querySelector(selector);
    },
    createElement(tagName) {
      return new FakeElement(this, tagName);
    },
  };
  document.body = new FakeElement(document, "body");
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

test("preset manager bridge mirrors active prompts and persists script controls", async () => {
  const document = createFakeDocument();
  let prompts = [
    { identifier: "main", name: "主提示词", enabled: true },
    { identifier: "action", name: "行动选项", enabled: false },
  ];
  let topP = 0.8;
  let saves = 0;
  const toggles = [];
  const controls = installTavernPresetManagerControls(document, {
    getPrompts: () => prompts,
    setPromptEnabled: (identifier, enabled) => {
      toggles.push([identifier, enabled]);
      prompts = prompts.map((prompt) =>
        prompt.identifier === identifier ? { ...prompt, enabled } : prompt,
      );
    },
    getTopP: () => topP,
    setTopP: (value) => {
      topP = value;
    },
    savePreset: () => {
      saves += 1;
    },
  });

  const list = document.getElementById("completion_prompt_manager_list");
  const items = list.querySelectorAll("li[data-pm-identifier]");
  assert.equal(list.hidden, true);
  assert.equal(items.length, 2);
  assert.equal(items[0].getAttribute("data-pm-identifier"), "main");
  assert.equal(
    items[1].querySelector("[data-pm-name]").getAttribute("data-pm-name"),
    "行动选项",
  );
  assert.equal(
    items[1].classList.contains("completion_prompt_manager_prompt_disabled"),
    true,
  );

  items[1].querySelector(".prompt-manager-toggle-action").click();
  assert.equal(
    items[1].classList.contains("completion_prompt_manager_prompt_disabled"),
    false,
  );
  assert.deepEqual(toggles, [["action", true]]);

  prompts = [{ identifier: "main", name: "更新后的主提示词", enabled: false }];
  topP = 0.55;
  controls.sync();
  const syncedItems = list.querySelectorAll("li[data-pm-identifier]");
  assert.equal(syncedItems.length, 1);
  assert.equal(
    syncedItems[0].querySelector("[data-pm-name]").getAttribute("data-pm-name"),
    "更新后的主提示词",
  );
  assert.equal(
    syncedItems[0].classList.contains("completion_prompt_manager_prompt_disabled"),
    true,
  );
  assert.equal(document.getElementById("top_p_openai").value, "0.55");
  assert.equal(document.getElementById("top_p_counter_openai").value, "0.55");

  const slider = document.getElementById("top_p_openai");
  slider.value = "0.72";
  slider.dispatchEvent(new Event("input"));
  assert.equal(topP, 0.72);
  assert.equal(document.getElementById("top_p_counter_openai").value, "0.72");

  document.getElementById("update_oai_preset").click();
  await Promise.resolve();
  assert.equal(saves, 1);

  controls.cleanup();
  assert.equal(document.getElementById("completion_prompt_manager_list"), null);
  assert.equal(document.getElementById("update_oai_preset"), null);
  assert.equal(document.getElementById("top_p_openai"), null);
  assert.equal(document.getElementById("top_p_counter_openai"), null);
});

test("preset manager cleanup preserves host-owned controls", () => {
  const document = createFakeDocument();
  const hostSaveButton = document.createElement("button");
  hostSaveButton.id = "update_oai_preset";
  document.body.append(hostSaveButton);
  let saves = 0;
  const controls = installTavernPresetManagerControls(document, {
    getPrompts: () => [],
    setPromptEnabled: () => undefined,
    getTopP: () => 1,
    setTopP: () => undefined,
    savePreset: () => {
      saves += 1;
    },
  });

  hostSaveButton.click();
  assert.equal(saves, 0);
  controls.cleanup();
  assert.equal(document.getElementById("update_oai_preset"), hostSaveButton);
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
