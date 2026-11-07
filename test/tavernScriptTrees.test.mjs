import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { normalizeTavernScript, isTavernScriptEnabled } from "../src/tavernScriptUtils.ts";
import {
  createTavernScriptTreeApi, getTavernScriptTrees, replaceTavernScriptTrees,
  TAVERN_SCRIPT_TREE_API_SOURCE,
} from "../src/tavernScriptTreeUtils.ts";
import { HTML_PREVIEW_TAVERN_SCRIPTS_SOURCE } from "../src/htmlPreviewTavernScripts.ts";

const script = () => normalizeTavernScript({
  id: "internal", sourceId: "original", sourceFormat: "sillytavern", name: "Bundled script",
  content: "console.log('fixture')", data: { nested: { value: 1 } }, export_with: { data: false, button: false },
  autoRun: false, runOn: "manual", info: "Keep notes", createdAt: "2026-01-01T00:00:00Z",
  buttons: [{ id: "button", name: "Run", visible: true }],
});

test("script snapshots expose original IDs and live data regardless of export flags", () => {
  const original = script();
  const snapshot = getTavernScriptTrees([original]);
  assert.equal(snapshot[0].id, "original");
  assert.deepEqual(snapshot[0].data, { nested: { value: 1 } });
  snapshot[0].data.nested.value = 2;
  snapshot[0].button.buttons[0].name = "Changed";
  assert.equal(original.data.nested.value, 1);
  assert.equal(original.buttons[0].name, "Run");
});

test("tree updates preserve runtime identity, execution settings, notes, data and folders", () => {
  const original = script();
  const trees = getTavernScriptTrees([original]);
  const updated = replaceTavernScriptTrees([original], [{
    type: "folder", id: "folder", name: "External scripts", icon: "book", color: "gold", enabled: false,
    scripts: trees,
  }]);
  assert.equal(updated[0].id, original.id);
  assert.equal(updated[0].sourceId, original.sourceId);
  assert.equal(updated[0].autoRun, false);
  assert.equal(updated[0].runOn, "manual");
  assert.equal(updated[0].createdAt, original.createdAt);
  assert.equal(updated[0].info, original.info);
  assert.deepEqual(updated[0].data, original.data);
  assert.equal(updated[0].enabled, true);
  assert.equal(isTavernScriptEnabled(updated[0]), false);
  const read = getTavernScriptTrees(updated);
  assert.equal(read[0].icon, "book");
  read[0].enabled = true;
  const enabled = replaceTavernScriptTrees(updated, read);
  assert.equal(isTavernScriptEnabled(enabled[0]), true);
  assert.equal(enabled[0].id, original.id);
  assert.throws(() => replaceTavernScriptTrees(updated, [...trees, ...trees]), /ID 重复/);
  assert.equal(updated.length, 1, "invalid replacements do not mutate the stored library");
});

test("sync and async updaters only change their selected library", async () => {
  const libraries = { global: [], preset: [], character: getTavernScriptTrees([script()]) };
  const api = createTavernScriptTreeApi({ get: type => libraries[type], replace: (trees, type) => { libraries[type] = trees; } });
  const result = api.updateScriptTreesWith(trees => trees.map(tree => ({ ...tree, enabled: false })), { type: "character" });
  assert.equal(result instanceof Promise, false);
  assert.equal(result[0].enabled, false);
  result[0].name = "Mutated snapshot";
  assert.equal(api.getScriptTrees({ type: "character" })[0].name, "Bundled script");
  await api.updateScriptTreesWith(async trees => trees.map(tree => ({ ...tree, enabled: true })), { type: "character" });
  assert.equal(libraries.character[0].enabled, true);
  assert.deepEqual(libraries.global, []);
  assert.deepEqual(libraries.preset, []);
  assert.throws(() => api.getScriptTrees({ type: "other" }), /作用域/);
  assert.throws(() => api.updateScriptTreesWith(() => null, { type: "character" }), /数组/);
  await assert.rejects(api.updateScriptTreesWith(async () => { throw Error("aborted"); }, { type: "character" }), /aborted/);
  assert.equal(libraries.character[0].enabled, true);
});

test("serialized frontend API keeps synchronous trees, deletion and injection handles", async () => {
  const calls = [];
  const sandbox = vm.createContext({ console, crypto, snapshot: { scriptTrees: { character: getTavernScriptTrees([script()]) } },
    request: async (operation, data) => { calls.push({ operation, data }); return true; } });
  const api = vm.runInContext(`(${HTML_PREVIEW_TAVERN_SCRIPTS_SOURCE})(snapshot, request, ${TAVERN_SCRIPT_TREE_API_SOURCE})`, sandbox);
  assert.equal(api.getScriptTrees({ type: "character" })[0].id, "original");
  api.updateScriptTreesWith(trees => trees.map(tree => ({ ...tree, enabled: false })), { type: "character" });
  assert.equal(api.getScriptTrees({ type: "character" })[0].enabled, false);
  assert.equal(calls[0].operation, "replaceScriptTrees");
  const handle = api.injectPrompts([{ content: "New stock" }], { once: true });
  assert.equal(typeof handle.uninject, "function");
  handle.uninject();
  assert.equal(calls[2].data.ids[0], calls[1].data.prompts[0].id);
  await api.deleteChatMessages([2], { refresh: "all" });
  assert.equal(calls.at(-1).operation, "deleteChatMessages");
});
