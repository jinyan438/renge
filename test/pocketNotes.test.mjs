import assert from "node:assert/strict";
import test from "node:test";
import { emptyPocketState, getPocketConversations, makePocketContact, normalizePocketState } from "../src/pocketPhoneState.ts";
import { characterPhoneView, commitCharacterPhoneView } from "../src/pocketCharacterPhone.ts";
import { applyPocketNotesGeneration, makePocketNote, normalizePocketNotes, pocketNoteContent, pocketNotesContextId, pocketNotesConversation, pocketNotesGenerationPrompt } from "../src/pocketNotesState.ts";
import { buildPocketHistoryMessage, buildSharedPocketConversation, formatPocketContextMessage, getPocketMessageIdentity, pocketContextRevision, syncPocketContext } from "../src/pocketPhoneContext.ts";
import { applyPocketContextChanges, getPocketContextChanges, recordPocketContextDeletions, syncPocketPhoneFromContext } from "../src/pocketPhoneSync.ts";
import { normalizeWorldBook } from "../src/worldbookUtils.ts";
import { updatePocketStoryClock } from "../src/pocketWechatClock.ts";

const user = { nickname: "小月", bio: "用户喜欢画画", avatarImage: "/touxiang/20.png" };
const time = "2031-02-28T15:45:00Z";
const actor = name => makePocketContact({ name, avatar: "/touxiang/1.png", personality: "{{char}}是{{user}}的朋友，在花店工作", greeting: "", sourceLabel: "角色卡", sourceCharacterCardId: "owner-card" });
function seed() {
  const state = { ...emptyPocketState(), contacts: [actor("奶糖"), actor("薄荷")] };
  state.contacts[0].messages = [{ id: "wechat", role: "assistant", content: "明天给花换水", createdAt: time }];
  return state;
}
function saveNotes(root, notes) {
  const owner = root.contacts[0];
  return commitCharacterPhoneView(root, owner.id, { ...characterPhoneView(root, owner.id, user), notes });
}

test("notes survive owner views, WeChat writes and storage normalization without crossing owners", () => {
  const root = seed(); const owner = root.contacts[0]; const note = makePocketNote("花店待办", "换水\n整理花束", time);
  const saved = saveNotes(root, [note]);
  assert.deepEqual(saved.contacts[0].messages, root.contacts[0].messages);
  const reloaded = normalizePocketState(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(characterPhoneView(reloaded, owner.id, user).notes, [note]);
  assert.deepEqual(characterPhoneView(reloaded, root.contacts[1].id, user).notes, []);
  const view = characterPhoneView(reloaded, owner.id, user);
  view.contacts[0].messages.push({ id: "later-chat", role: "user", content: "新消息", createdAt: time });
  const later = commitCharacterPhoneView(reloaded, owner.id, view);
  assert.deepEqual(later.characterPhones[owner.id].notes, [note]);
  assert.deepEqual(normalizePocketNotes([note, note, { id: "broken", title: 123, body: "无效" }]), [note]);
});

test("generated notes append atomically, deduplicate and never replace existing manual notes", () => {
  const note = makePocketNote("手写便签", "保留我", time);
  const raw = JSON.stringify({ notes: [{ title: "花店待办", body: "换水\n整理花束" }, { title: note.title, body: note.body }] });
  const next = applyPocketNotesGeneration([note], `\x60\x60\x60json\n${raw}\n\x60\x60\x60`, time);
  assert.equal(next.length, 2); assert.equal(next[0], note); assert.equal(next[1].wechatTime, time);
  assert.throws(() => applyPocketNotesGeneration([note], "不是 JSON", time), /格式/);
  assert.throws(() => applyPocketNotesGeneration([note], JSON.stringify({ notes: [{ title: "有效", body: "内容" }, { title: "无效", body: 123 }] }), time), /格式/);
  assert.throws(() => applyPocketNotesGeneration([note], JSON.stringify({ notes: [] }), time), /有效便签/);
  assert.throws(() => applyPocketNotesGeneration([note], JSON.stringify({ notes: [{ title: note.title, body: note.body }] }), time), /重复/);
  assert.equal(note.body, "保留我");
});

test("notes inject once in the shared timeline, edit in place, revise Pi context and delete through tombstones", () => {
  const root = seed(); const note = makePocketNote("花店待办", "换水", time);
  const saved = saveNotes(root, [note]); const ownerId = root.contacts[0].id;
  const main = { id: "main", role: "user", content: "主会话", createdAt: time };
  const existing = syncPocketContext([main], null, getPocketConversations(root), user.nickname);
  const before = syncPocketContext(existing, getPocketConversations(root), getPocketConversations(saved), user.nickname);
  assert.deepEqual(before.map(message => message.content), ["主会话", "明天给花换水", "花店待办\n换水"]);
  const record = before.at(-1); const identity = getPocketMessageIdentity(record);
  assert.equal(record.source, "notes"); assert.equal(identity.app, "notes"); assert.equal(identity.phoneOwnerId, ownerId);
  assert.match(formatPocketContextMessage(record), /【便签 · 奶糖/);
  assert.equal(syncPocketContext(before, null, getPocketConversations(saved), user.nickname), before);
  assert.equal(syncPocketContext(before, null, [], user.nickname), before);
  const edited = saveNotes(saved, [{ ...note, body: "修改后" }]);
  const after = syncPocketContext([...before, { ...main, id: "later", content: "后续主线" }], getPocketConversations(saved), getPocketConversations(edited), user.nickname);
  assert.equal(after[2].id, record.id); assert.equal(after[2].content, "花店待办\n修改后"); assert.equal(after[3].content, "后续主线");
  assert.notEqual(pocketContextRevision(before), pocketContextRevision(after));
  const cleared = recordPocketContextDeletions(edited, saveNotes(edited, []));
  assert.deepEqual(cleared.deletedContextMessages, [{ contactId: pocketNotesContextId(ownerId), messageId: note.id }]);
  assert.equal(syncPocketContext(after, null, getPocketConversations(cleared), user.nickname, cleared.deletedContextMessages).length, 3);
  const removedOwner = recordPocketContextDeletions(saved, { ...saved, contacts: saved.contacts.slice(1) });
  assert.ok(removedOwner.deletedContextMessages.some(item => item.messageId === note.id));
});

test("main edits and deletes sync to the owner's notes even when the phone is closed", () => {
  const root = saveNotes(seed(), [makePocketNote("原标题", "正文\n第二行", time)]); const ownerId = root.contacts[0].id;
  const history = syncPocketContext([], null, getPocketConversations(root), user.nickname);
  const editedHistory = history.map(message => message.source === "notes" ? { ...message, content: "新标题\n新正文\n下一行" } : message);
  const patched = applyPocketContextChanges(root, getPocketContextChanges(history, editedHistory));
  assert.equal(patched.characterPhones[ownerId].notes[0].title, "新标题");
  assert.equal(patched.characterPhones[ownerId].notes[0].body, "新正文\n下一行");
  assert.deepEqual(patched.contacts, root.contacts);
  const values = new Map([[`renge_pocket_phone_v1:notes-test`, JSON.stringify(root)]]);
  const oldStorage = globalThis.localStorage; const oldWindow = globalThis.window;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  globalThis.window = new EventTarget();
  try {
    syncPocketPhoneFromContext("notes-test", history, editedHistory);
    assert.equal(JSON.parse(values.get("renge_pocket_phone_v1:notes-test")).characterPhones[ownerId].notes[0].title, "新标题");
    syncPocketPhoneFromContext("notes-test", editedHistory, editedHistory.filter(message => message.source !== "notes"));
    const removed = normalizePocketState(JSON.parse(values.get("renge_pocket_phone_v1:notes-test")));
    assert.deepEqual(removed.characterPhones[ownerId].notes, []);
    assert.equal(syncPocketContext(editedHistory, null, getPocketConversations(removed), user.nickname, removed.deletedContextMessages).length, 1);
  } finally { globalThis.localStorage = oldStorage; globalThis.window = oldWindow; }
});

test("notes generation quotes all shared sources and applies the same worldbook placement rules as WeChat", () => {
  const owner = actor("奶糖"); const note = makePocketNote("私密计划", "不要当作已经完成的事", time);
  const task = pocketNotesConversation(owner, [note]);
  const records = syncPocketContext([], null, [task], user.nickname);
  const quoted = buildPocketHistoryMessage(records[0], task.id);
  assert.equal(quoted.role, "user"); assert.match(quoted.content, /便签背景资料/);
  const book = normalizeWorldBook({ id: "active", entries: [{ content: "前置世界书", constant: true, position: "before_char" }, { content: "{{char}}记得{{user}}喜欢画画", constant: true, position: "at_depth", depth: 1 }] });
  const history = [...Array.from({ length: 65 }, (_, index) => ({ role: "user", content: `主会话事实-${index}` })), quoted];
  const request = buildSharedPocketConversation(task, user, history, [book], [book.id]);
  assert.match(request[0].content, /奶糖是小月的朋友/); assert.match(request[0].content, /前置世界书/);
  assert.match(request.at(-2).content, /奶糖记得小月喜欢画画/);
  assert.deepEqual(request.slice(1, -2), history.slice(0, -1)); assert.deepEqual(request.at(-1), quoted);
  assert.doesNotMatch(request[0].content, /texts 字段|9 项激素|微信回复规则/);
  assert.match(pocketNotesGenerationPrompt(owner, [note], user), /"notes"/);
  assert.match(pocketNotesGenerationPrompt(owner, [note], user), /已有便签/);
  assert.equal(pocketNoteContent(note), "私密计划\n不要当作已经完成的事");
});

test("dates in private notes never advance the current story clock", () => {
  const clock = { initialTime: time, initialRealTime: Date.now() };
  assert.equal(updatePocketStoryClock(clock, [{ id: "note", source: "notes", content: "明天上午9点去买花" }]), clock);
});

test("the notes projection does not inherit or duplicate the owner's WeChat inner monologues", () => {
  const root = seed(); const owner = root.contacts[0];
  owner.innerHistory = [{ id: "thought", content: "微信里的心事", createdAt: time, speaker: { id: owner.id, name: owner.name, avatar: owner.avatar } }];
  const saved = saveNotes(root, [makePocketNote("便签", "一条内容", time)]);
  const history = syncPocketContext([], null, getPocketConversations(saved), user.nickname);
  assert.equal(history.filter(message => message.content === "微信里的心事").length, 1);
  assert.equal(history.filter(message => message.source === "notes").length, 1);
});
