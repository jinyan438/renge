import assert from "node:assert/strict";
import test from "node:test";

import {
  attachTavernSubscriptionControls,
  createTavernMacroRegistry,
  createTavernErrorCatched,
  getTavernCallerScriptSource,
  installLegacyTavernSendControls,
  installTavernPresetManagerControls,
  parseTavernSlashCommand,
  proxyTavernModuleUrls,
  resolveTavernButtonOwnerId,
  resolveTavernCallerScriptId,
  splitTavernContextHeaders,
} from "../src/tavernCompatibilityUtils.ts";

test("parses system narrator commands with Markdown payloads and options", () => {
  assert.deepEqual(
    parseTavernSlashCommand(
      '/sys name="心海校规系统" compact=true [校园档案建立] **姓名**: 萧宸 **性别**: 男',
    ),
    {
      type: "message",
      text: "[校园档案建立] **姓名**: 萧宸 **性别**: 男",
      role: "assistant",
      name: "心海校规系统",
      system: true,
      hidden: false,
      compact: true,
      generate: true,
    },
  );
});

test("parses comments as hidden system messages", () => {
  assert.deepEqual(parseTavernSlashCommand("/comment 仅供作者查看"), {
    type: "message",
    text: "仅供作者查看",
    role: "assistant",
    name: "Comment",
    system: true,
    hidden: true,
    compact: true,
    generate: false,
  });
});

test("keeps the supported composer and trigger command behavior", () => {
  assert.deepEqual(parseTavernSlashCommand("/setinput 继续调查 | /trigger"), {
    type: "set-input",
    text: "继续调查",
    append: false,
    submit: true,
  });
  assert.deepEqual(parseTavernSlashCommand('/sendas name="旁白角色" 内容'), {
    type: "message",
    text: "内容",
    role: "assistant",
    name: "旁白角色",
    system: false,
    hidden: false,
    compact: false,
    generate: false,
  });
  assert.equal(
    parseTavernSlashCommand('/sendas name="旁白角色" 内容 | /trigger')?.generate,
    true,
  );
});

test("extracts Tavern context headers from same-line code fences", () => {
  const segments = splitTavernContextHeaders(
    "<基础确认>\n```金陵高中图书馆二楼·2010年09月01日·星期三·14:20```\n\n<quzhong>正文</quzhong>",
  );

  assert.deepEqual(segments, [
    {
      type: "context",
      content: "金陵高中图书馆二楼·2010年09月01日·星期三·14:20",
      label: "基础确认",
      items: ["金陵高中图书馆二楼", "2010年09月01日", "星期三", "14:20"],
    },
    { type: "text", content: "\n\n<quzhong>正文</quzhong>" },
  ]);
});

test("leaves ordinary custom tags and inline code untouched", () => {
  const content = "<角色旁白>\n```这不是场景时间```\n\n正文";
  assert.deepEqual(splitTavernContextHeaders(content), [{ type: "text", content }]);
});

test("keeps TavernHelper module ownership across asynchronous callbacks", () => {
  const sourceOwners = new Map();
  const moduleStack = [
    "Error",
    "    at getScriptId (http://127.0.0.1:5191/src/tavernScriptRuntime.ts:2100:10)",
    "    at initialize (http://127.0.0.1:5191/api/tavern-module-proxy?url=https%3A%2F%2Ftestingcf.jsdelivr.net%2Fgh%2FMagicalAstrogy%2FMagVarUpdate%40beta%2Fartifact%2Fbundle.js:1:9234)",
  ].join("\n");

  assert.equal(
    getTavernCallerScriptSource(moduleStack),
    "http://127.0.0.1:5191/api/tavern-module-proxy?url=https%3A%2F%2Ftestingcf.jsdelivr.net%2Fgh%2FMagicalAstrogy%2FMagVarUpdate%40beta%2Fartifact%2Fbundle.js",
  );
  assert.equal(
    resolveTavernCallerScriptId(moduleStack, "mvu-script", "other-script", sourceOwners),
    "mvu-script",
  );
  assert.equal(
    resolveTavernCallerScriptId(moduleStack, "", "later-script", sourceOwners),
    "mvu-script",
  );
});

test("falls back when a TavernHelper call has no character-card module source", () => {
  assert.equal(
    resolveTavernCallerScriptId(
      "Error\n    at getScriptId (http://127.0.0.1:5191/assets/index.js:1:20)",
      "",
      "latest-script",
      new Map(),
    ),
    "latest-script",
  );
});

test("resolves an asynchronous button API call to its unique owning script", () => {
  const candidates = [
    { id: "preset-script", buttonNames: [] },
    {
      id: "mvu-script",
      buttonNames: ["重新处理变量", "重新读取初始变量", "清除旧楼层变量"],
    },
    { id: "other-script", buttonNames: ["打开设置"] },
  ];

  assert.equal(
    resolveTavernButtonOwnerId(
      ["重新处理变量", "重新读取初始变量"],
      "preset-script",
      candidates,
    ),
    "mvu-script",
  );
  assert.equal(
    resolveTavernButtonOwnerId(["重复按钮"], "preset-script", [
      { id: "first", buttonNames: ["重复按钮"] },
      { id: "second", buttonNames: ["重复按钮"] },
    ]),
    "preset-script",
  );
});

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
  assert.equal((transformed.match(/&v=2/g) ?? []).length, 2);
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
