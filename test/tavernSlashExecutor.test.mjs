import assert from "node:assert/strict";
import test from "node:test";

import {
  executeTavernSlashPipeline,
  isTavernSlashPipelineCommand,
  parseTavernSlashSegment,
  splitTavernSlashPipeline,
} from "../src/tavernSlashExecutor.ts";

function createMockHost(overrides = {}) {
  const stores = {
    chat: new Map(),
    global: new Map(),
  };
  const calls = {
    legacy: [],
    notifications: [],
    hidden: [],
    deleted: [],
    generated: [],
    injected: [],
    uninjected: [],
    events: [],
    audio: [],
    stopped: 0,
  };
  let messageCount = overrides.messageCount ?? 5;

  const host = {
    stores,
    calls,
    getVariable: (scope, key) => stores[scope].get(key),
    setVariable: (scope, key, value) => {
      stores[scope].set(key, value);
    },
    deleteVariable: (scope, key) => {
      stores[scope].delete(key);
    },
    runLegacy: async (command) => {
      calls.legacy.push(command);
      return `legacy:${command}`;
    },
    notify: (severity, message, title) => {
      calls.notifications.push({ severity, message, title });
    },
    getMessageCount: () => messageCount,
    setMessagesHidden: (indexes, hidden) => {
      calls.hidden.push({ indexes, hidden });
    },
    deleteMessages: (indexes) => {
      calls.deleted.push(indexes);
      messageCount = Math.max(0, messageCount - indexes.length);
    },
    generate: async (prompt, options) => {
      calls.generated.push({ prompt, options });
      return `AI(${options.raw ? "raw" : "normal"}):${prompt}`;
    },
    stopGeneration: () => {
      calls.stopped += 1;
    },
    injectPrompt: (prompt) => {
      calls.injected.push(prompt);
    },
    uninjectPrompts: (ids) => {
      calls.uninjected.push(ids);
    },
    emitEvent: (eventName, args) => {
      calls.events.push({ eventName, args });
    },
    audio: (action, named, text) => {
      calls.audio.push({ action, named, text });
    },
    substituteMacros: (text) => text.replace(/\{\{user\}\}/gi, "Alice").replace(/\{\{char\}\}/gi, "Renge"),
    ...overrides,
  };
  return host;
}

test("splits STscript pipelines while preserving pipes inside quotes, closures, macros, and escapes", () => {
  const segments = splitTavernSlashPipeline(
    '/setvar key=msg "A | B" | /if left=1 right=1 {: /echo one | /pass two :} | /pass {{var::a|b}} | /echo escaped\\|pipe',
  );
  assert.deepEqual(segments, [
    '/setvar key=msg "A | B"',
    "/if left=1 right=1 {: /echo one | /pass two :}",
    "/pass {{var::a|b}}",
    "/echo escaped|pipe",
  ]);
});

test("parses named options, quoted values, closures, and unnamed text", () => {
  const parsed = parseTavernSlashSegment(
    '/if left="10" right=5 rule=gt else={: /echo fallback :} {: /echo win :}',
  );
  assert.deepEqual(parsed, {
    name: "if",
    named: {
      left: "10",
      right: "5",
      rule: "gt",
      else: "{: /echo fallback :}",
    },
    text: "{: /echo win :}",
    raw: '/if left="10" right=5 rule=gt else={: /echo fallback :} {: /echo win :}',
  });
  assert.equal(isTavernSlashPipelineCommand("setvar"), true);
  assert.equal(isTavernSlashPipelineCommand("send"), false);
});

test("executes chat/global variable operations, typed casts, and indexed updates", async () => {
  const host = createMockHost();

  assert.equal(await executeTavernSlashPipeline("/setvar hp 10 | /addvar hp 5 | /incvar hp | /getvar hp", host), "16");
  assert.equal(host.stores.chat.get("hp"), 16);

  assert.equal(await executeTavernSlashPipeline("/decvar hp | /getvar hp", host), "15");
  assert.equal(
    await executeTavernSlashPipeline('/setglobalvar key=flag as=boolean true | /getglobalvar flag', host),
    "true",
  );
  assert.equal(host.stores.global.get("flag"), true);

  await executeTavernSlashPipeline('/setvar key=stats as=object {"atk":3} | /setvar key=stats index=def 7', host);
  assert.equal(await executeTavernSlashPipeline("/getvar key=stats index=def", host), "7");

  await executeTavernSlashPipeline('/setvar key=bag as=array ["sword"] | /addvar key=bag shield', host);
  assert.equal(await executeTavernSlashPipeline("/len {{getvar::bag}}", host), "2");

  await executeTavernSlashPipeline("/flushvar hp", host);
  assert.equal(host.stores.chat.has("hp"), false);
});

test("executes math, string helpers, scoped /let variables, and macro expansion", async () => {
  const host = createMockHost();
  const result = await executeTavernSlashPipeline(
    "/let greeting hello | /pass \"  {{var::greeting}} {{user}}  \" | /trimstart | /trimend | /upper",
    host,
  );
  assert.equal(result, "HELLO ALICE");

  assert.equal(await executeTavernSlashPipeline("/add 10 20 5 | /sub {{pipe}} 7 | /mul {{pipe}} 2 | /div {{pipe}} 4", host), "14");
  assert.equal(await executeTavernSlashPipeline("/max 3 19 7 | /min {{pipe}} 12", host), "12");
});

test("executes /if branches, /run closures, and /abort early exit", async () => {
  const host = createMockHost();

  const branchWin = await executeTavernSlashPipeline(
    "/setvar score 80 | /if left={{getvar::score}} right=60 rule=gte else={: /pass fail :} {: /pass pass-{{char}} :}",
    host,
  );
  assert.equal(branchWin, "pass-Renge");

  const branchElse = await executeTavernSlashPipeline(
    "/if left=apple right=pear rule=eq else={: /run {: /pass fallback-ok :} :} {: /pass wrong :}",
    host,
  );
  assert.equal(branchElse, "fallback-ok");

  const aborted = await executeTavernSlashPipeline("/pass before-abort | /abort | /pass unreachable", host);
  assert.equal(aborted, "before-abort");
});

test("delegates composer/message runs, bare /gen, prompted /gen, visibility, prompts, events, and audio", async () => {
  const host = createMockHost({ messageCount: 6 });

  // Message command combined with /trigger stays grouped for runLegacy
  await executeTavernSlashPipeline("/let target 二楼走廊 | /send 调查{{var::target}} | /trigger", host);
  assert.deepEqual(host.calls.legacy, ["/send 调查二楼走廊 | /trigger"]);

  // Bare /gen delegates to runLegacy, whereas prompted /gen and /genraw call host.generate
  await executeTavernSlashPipeline("/gen", host);
  assert.deepEqual(host.calls.legacy, ["/send 调查二楼走廊 | /trigger", "/gen"]);

  const generated = await executeTavernSlashPipeline('/genraw system="旁白" 描述当前场景', host);
  assert.equal(generated, "AI(raw):描述当前场景");
  assert.deepEqual(host.calls.generated, [{ prompt: "描述当前场景", options: { raw: true, system: "旁白" } }]);

  await executeTavernSlashPipeline("/hide 1-2 | /unhide -1 | /cut 0 | /del 2", host);
  assert.deepEqual(host.calls.hidden, [
    { indexes: [1, 2], hidden: true },
    { indexes: [5], hidden: false },
  ]);
  assert.deepEqual(host.calls.deleted, [[0], [3, 4]]);

  await executeTavernSlashPipeline(
    '/inject id=hint position=chat depth=2 role=system scan=true 保持悬疑氛围 | /flushinjects | /event-emit event=card_ping data={"ok":1} | /audioplay type=bgm track.mp3',
    host,
  );
  assert.deepEqual(host.calls.injected, [
    {
      id: "hint",
      position: "in_chat",
      depth: 2,
      role: "system",
      content: "保持悬疑氛围",
      should_scan: true,
    },
  ]);
  assert.deepEqual(host.calls.uninjected, [null]);
  assert.deepEqual(host.calls.events, [{ eventName: "card_ping", args: [{ ok: 1 }] }]);
  assert.deepEqual(host.calls.audio, [{ action: "play", named: { type: "bgm" }, text: "track.mp3" }]);
});
