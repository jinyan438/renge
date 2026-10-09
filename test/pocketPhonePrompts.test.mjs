import assert from "node:assert/strict";
import test from "node:test";
import { POCKET_PROMPTS, normalizePocketPromptOverrides, renderPocketPrompt } from "../src/pocketPhonePrompts.ts";
import { emptyPocketState, makePocketContact, normalizePocketState } from "../src/pocketPhoneState.ts";
import { characterPhoneGenerationPrompt, characterPhoneView, commitCharacterPhoneView } from "../src/pocketCharacterPhone.ts";
import { buildSharedPocketConversation } from "../src/pocketPhoneContext.ts";
import { pocketNotesConversation, pocketNotesGenerationPrompt } from "../src/pocketNotesState.ts";
import { pocketMomentsGenerationPrompt, pocketMomentsTask, makePocketMoment } from "../src/pocketMomentsState.ts";
import { pocketWechatTimePrompt, createPocketWechatClock } from "../src/pocketWechatClock.ts";
import { buildRedTaskContact } from "../src/pocketXiaohongshuGeneration.ts";
import { emptyRedState } from "../src/pocketXiaohongshuState.ts";
import { requestPocketWechatTurn } from "../src/pocketPhoneChat.ts";
import { fixtureWechatTurn } from "./pocketPhoneInnerFixture.mjs";
import { POCKET_PROMPTS_STORAGE_KEY, readPocketPromptSettings, writePocketPromptSettings, saveGlobalPocketPrompts, subscribeGlobalPocketPrompts } from "../src/pocketPhonePromptStorage.ts";

const user = { nickname: "小月", bio: "爱画画", avatarImage: "" };
const owner = makePocketContact({ name: "奶糖", avatar: "/touxiang/1.png", personality: "花店同事", greeting: "", sourceLabel: "自定义" });
const group = { id: "group", name: "花店群", members: [owner], messages: [], createdAt: "" };
const viewer = { id: owner.id, name: owner.name, avatar: owner.avatar, personality: owner.personality };
const friend = { ...viewer, id: "friend", name: "阿禾" };

function storageFixture(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("prompt migration gathers saved sessions once, prioritizes the current session and never changes phone histories", () => {
  const one = "renge_pocket_phone_v1:one"; const two = "renge_pocket_phone_v1:two";
  const first = JSON.stringify({ version: 1, settings: { promptOverrides: { "wechat.style": "当前会话风格" } }, contacts: [{ messages: ["保留聊天"] }] });
  const second = JSON.stringify({ version: 1, settings: { promptOverrides: { "wechat.style": "其他会话风格", "notes.task": "其他会话便签" } } });
  const storage = storageFixture({ [one]: first, [two]: second, "renge_pocket_phone_v1:broken": "invalid JSON" });
  const migrated = readPocketPromptSettings(storage, one);
  assert.deepEqual(migrated, { prompts: { "wechat.style": "当前会话风格", "notes.task": "其他会话便签" }, storageWarning: "" });
  assert.deepEqual(readPocketPromptSettings(storage, two), migrated);
  assert.equal(storage.getItem(one), first); assert.equal(storage.getItem(two), second);
  assert.deepEqual(readPocketPromptSettings(storage, "renge_pocket_phone_v1:new"), migrated);
});

test("global single/all resets persist across sessions and never resurrect stale session overrides", () => {
  const one = "renge_pocket_phone_v1:one";
  const storage = storageFixture({ [one]: JSON.stringify({ version: 1, settings: { promptOverrides: { "wechat.style": "旧自定义" } } }) });
  writePocketPromptSettings(storage, { "notes.task": "新的全局便签" });
  assert.deepEqual(readPocketPromptSettings(storage, one).prompts, { "notes.task": "新的全局便签" });
  writePocketPromptSettings(storage, {});
  assert.deepEqual(readPocketPromptSettings(storage, one).prompts, {});
  assert.deepEqual(readPocketPromptSettings(storage, "renge_pocket_phone_v1:new").prompts, {});
  assert.deepEqual(JSON.parse(storage.getItem(POCKET_PROMPTS_STORAGE_KEY)), { version: 1, prompts: {} });
});

test("failed global migration preserves the old edits for a later retry; malformed global data is not overwritten", () => {
  const key = "renge_pocket_phone_v1:one"; const legacy = JSON.stringify({ version: 1, settings: { promptOverrides: { "notes.task": "原来的便签" } } });
  const storage = storageFixture({ [key]: legacy }); const setItem = storage.setItem;
  storage.setItem = () => { throw new Error("quota"); };
  const failed = readPocketPromptSettings(storage, key);
  assert.deepEqual(failed.prompts, { "notes.task": "原来的便签" }); assert.ok(failed.storageWarning); assert.equal(storage.getItem(key), legacy); assert.equal(storage.getItem(POCKET_PROMPTS_STORAGE_KEY), null);
  storage.setItem = setItem;
  assert.deepEqual(readPocketPromptSettings(storage, key).prompts, failed.prompts);
  storage.setItem(POCKET_PROMPTS_STORAGE_KEY, "invalid global JSON");
  assert.ok(readPocketPromptSettings(storage, key).storageWarning); assert.equal(storage.getItem(POCKET_PROMPTS_STORAGE_KEY), "invalid global JSON");
});

test("global changes notify mounted phones and other windows, including resetting defaults and ignoring unrelated storage", () => {
  const originalWindow = globalThis.window; const originalStorage = globalThis.localStorage;
  const storage = storageFixture(); const changes = []; globalThis.window = new EventTarget(); globalThis.localStorage = storage;
  const unsubscribe = subscribeGlobalPocketPrompts(settings => changes.push(settings));
  const emit = (key, newValue) => { const event = new Event("storage"); Object.assign(event, { key, newValue, storageArea: storage }); window.dispatchEvent(event); };
  try {
    saveGlobalPocketPrompts({ "wechat.style": "共用设置" });
    assert.deepEqual(changes.at(-1).prompts, { "wechat.style": "共用设置" });
    emit("renge_pocket_phone_v1:other", "{}"); assert.equal(changes.length, 1);
    emit(POCKET_PROMPTS_STORAGE_KEY, JSON.stringify({ version: 1, prompts: { "notes.task": "另一窗口修改" } }));
    assert.deepEqual(changes.at(-1).prompts, { "notes.task": "另一窗口修改" });
    emit(POCKET_PROMPTS_STORAGE_KEY, "invalid JSON"); assert.equal(changes.length, 2);
    saveGlobalPocketPrompts({}); assert.deepEqual(changes.at(-1).prompts, {});
    unsubscribe(); saveGlobalPocketPrompts({}); assert.equal(changes.length, 3);
  } finally { unsubscribe(); globalThis.window = originalWindow; globalThis.localStorage = originalStorage; }
});

test("legacy phone overrides remain readable for migration in both owner views without changing records", () => {
  const old = { ...emptyPocketState(), contacts: [owner] };
  assert.equal(normalizePocketState(old).settings.promptOverrides, undefined);
  const normalized = normalizePocketPromptOverrides({ "notes.task": "新的便签规则", "wechat.style": " ", "red.rules": 123, "unknown": "ignored", "phone.time": "x".repeat(50001), "wechat.role": POCKET_PROMPTS.find(p => p.id === "wechat.role").defaultText });
  assert.deepEqual(normalized, { "notes.task": "新的便签规则" });
  const saved = normalizePocketState({ ...old, settings: { ...old.settings, promptOverrides: normalized } });
  const view = characterPhoneView(saved, owner.id, user);
  assert.deepEqual(view.settings.promptOverrides, normalized);
  const reset = normalizePocketState(commitCharacterPhoneView(saved, owner.id, { ...view, settings: { ...view.settings, promptOverrides: {} } }));
  assert.equal(reset.settings.promptOverrides, undefined); assert.deepEqual(reset.contacts, saved.contacts);
  assert.equal(characterPhoneGenerationPrompt(owner, view, user), characterPhoneGenerationPrompt(owner, view, user, false, {}));
});

test("prompt variables resolve once so quoted records and user content never become templates", () => {
  const raw = '包含 {{char}} 和 $& 的便签';
  assert.equal(renderPocketPrompt("notes.task", { "notes.task": "{{char}}：{{notes}}；{{missing}}" }, { char: "奶糖", notes: raw }), `奶糖：${raw}；{{missing}}`);
  assert.equal(renderPocketPrompt("notes.task", { "notes.task": "  " }, {}), POCKET_PROMPTS.find(p => p.id === "notes.task").defaultText);
});

test("every editable application template reaches the matching generation context or task", () => {
  const post = makePocketMoment(viewer, { text: "下班啦", pic: "", location: "", images: [], visibility: "public", visibleTo: [] }, [friend], new Date().toISOString());
  const state = { ...emptyPocketState(), contacts: [owner] };
  const red = { ...emptyRedState(), notes: [{ id: "note", author: owner.name, title: "花店", content: "今日花束", tags: [], authorId: owner.id }], comments: [{ id: "comment", noteId: "note", author: user.nickname, content: "几点关门" }] };
  const roles = [{ id: owner.id, name: owner.name, personality: owner.personality, avatar: owner.avatar }];
  const calls = prompts => [
    ...buildSharedPocketConversation(owner, user, [], [], [], "reply", undefined, prompts),
    ...buildSharedPocketConversation({ ...owner, phoneOwner: { ...owner, userName: user.nickname } }, user, [], [], [], "proactive", undefined, prompts),
    ...buildSharedPocketConversation(group, user, [], [], [], "proactive", owner, prompts),
    ...buildSharedPocketConversation(pocketNotesConversation(owner, []), user, [], [], [], "reply", undefined, prompts),
    ...buildSharedPocketConversation(pocketMomentsTask(viewer, [friend], [viewer.id]), user, [], [], [], "reply", undefined, prompts),
    ...[false, true].map(only => ({ content: characterPhoneGenerationPrompt(owner, state, user, only, prompts) })),
    { content: pocketNotesGenerationPrompt(owner, [], user, prompts) },
    ...[false, true].flatMap(self => [undefined, post].flatMap(target => [false, true].map(reply => ({ content: pocketMomentsGenerationPrompt(viewer, [friend], [], self, target, reply, prompts) })))),
    { content: pocketWechatTimePrompt(createPocketWechatClock(), Date.now(), prompts) },
    ...[{ kind: "feed" }, { kind: "reply", noteId: "note", commentId: "comment" }].flatMap(task => buildSharedPocketConversation(buildRedTaskContact(red, user.nickname, roles, task, roles, prompts), user, [], [], [], "proactive", undefined, prompts)),
  ];
  for (const prompt of POCKET_PROMPTS.filter(p => !["wechat.task", "wechat.repair"].includes(p.id))) {
    const marker = `edited:${prompt.id}`;
    assert.ok(calls({ [prompt.id]: marker }).some(message => message.content.includes(marker)), `${prompt.id} is not connected to its request`);
  }
  assert.equal(new Set(POCKET_PROMPTS.map(p => p.id)).size, POCKET_PROMPTS.length);
});

test("WeChat's final request and format completion use edited templates and restore the original defaults", async () => {
  const originalFetch = globalThis.fetch; const requests = []; let count = 0;
  globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(init.body).request.messages); return Response.json({ choices: [{ message: { content: ++count % 2 ? "纯文字回复" : fixtureWechatTurn("完整回复", count) } }] }); };
  try {
    await requestPocketWechatTurn({ id: "fixture", name: "测试", apiBaseUrl: "http://fixture", apiType: "chat-completions", models: [] }, "fixture", [{ role: "system", content: "context" }], new AbortController().signal, undefined, false, { "wechat.task": "修改过的生成任务 {{output}}", "wechat.repair": "修改过的补全任务 {{raw}} {{output}}" });
    assert.match(requests[0].at(-1).content, /修改过的生成任务/); assert.match(requests[1].at(-1).content, /修改过的补全任务/);
  } finally { globalThis.fetch = originalFetch; }
});
