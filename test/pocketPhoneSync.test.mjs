import assert from "node:assert/strict";
import test from "node:test";
import { syncPocketContext } from "../src/pocketPhoneContext.ts";
import { emptyPocketState, getPocketConversations, getPocketPendingMessages, normalizePocketState, resetPocketContactChat } from "../src/pocketPhoneState.ts";
import { applyPocketContextChanges, getPocketContextChanges, recordPocketContextDeletions, subscribePocketContextChanges, syncPocketPhoneFromContext } from "../src/pocketPhoneSync.ts";

const message = (id, role = "user", extra = {}) => ({ id, role, content: id, createdAt: "2026-10-07T12:00:00Z", ...extra });
const contact = (id, messages) => ({ id, name: id, avatar: "/touxiang/9.png", personality: "朋友", greeting: "", sourceLabel: "自定义角色", messages, createdAt: "2026-10-07T12:00:00Z" });
const stateWith = (contacts, groups = []) => ({ ...emptyPocketState(), contacts, groups });
const mirror = state => syncPocketContext([message("main")], null, getPocketConversations(state), "小月");

test("main edits update phone text in place, preserve metadata and paragraphs, and never echo stale text back", () => {
  const state = stateWith([contact("friend", [message("sent"), message("reply", "assistant", { replyContextMessageId: "sent" })])]);
  const previous = mirror(state);
  const next = previous.map(item => item.content === "reply" ? { ...item, content: "改过的第一段\n\n第二段" } : item);
  const updated = applyPocketContextChanges(state, getPocketContextChanges(previous, next));
  assert.deepEqual(updated.contacts[0].messages, [state.contacts[0].messages[0], { ...state.contacts[0].messages[1], content: "改过的第一段\n\n第二段" }]);
  assert.equal(updated.settings, state.settings);
  assert.equal(syncPocketContext(next, getPocketConversations(state), getPocketConversations(updated), "小月"), next);
  assert.deepEqual(normalizePocketState(JSON.parse(JSON.stringify(updated))), updated);
});

test("deleting incoming/outgoing messages affects only the matching contact or group, including colliding message IDs", () => {
  const friend = contact("friend", [message("same"), message("reply", "assistant")]);
  const other = contact("other", [message("same")]);
  const group = { id: "group", name: "群聊", members: [{ id: friend.id, name: friend.name, avatar: friend.avatar, personality: friend.personality }],
    messages: [message("same"), message("reply", "assistant", { speaker: { id: friend.id, name: friend.name, avatar: friend.avatar } })], createdAt: friend.createdAt };
  const state = stateWith([friend, other], [group]);
  const previous = mirror(state);
  const next = previous.filter(item => !item.extra?.pocketPhone || item.extra.pocketPhone.contactId === "other" || item.extra.pocketPhone.contactId === "group" && item.role === "assistant")
    .map(item => item.extra?.pocketPhone?.contactId === "group" ? { ...item, content: "改过的群消息" } : item);
  const updated = applyPocketContextChanges(state, getPocketContextChanges(previous, next));
  assert.deepEqual(updated.contacts[0].messages, []);
  assert.equal(updated.contacts[1], other);
  assert.deepEqual(updated.groups[0].messages, [{ ...group.messages[1], content: "改过的群消息" }]);
  assert.equal(syncPocketContext(next, getPocketConversations(state), getPocketConversations(updated), "小月"), next);
});

test("ordinary main edits and newly imported history never delete uninjected phone records", () => {
  const state = stateWith([contact("friend", [message("local-only")])]);
  assert.deepEqual(getPocketContextChanges([message("main")], []), []);
  assert.equal(applyPocketContextChanges(state, getPocketContextChanges([], mirror(state))), state);
  assert.equal(applyPocketContextChanges(state, [{ contactId: "unknown", messageId: "local-only", content: null }]).contacts[0], state.contacts[0]);
  assert.equal(applyPocketContextChanges(state, []), state);
});

test("saved deletion markers remove stale restored main records while preserving unrelated restored context", () => {
  const state = stateWith([contact("friend", [message("sent"), message("reply", "assistant")]), contact("other", [message("other-reply", "assistant")])]);
  const stale = mirror(state);
  const updated = applyPocketContextChanges(state, [{ contactId: "friend", messageId: "sent", content: null }]);
  const restored = normalizePocketState(JSON.parse(JSON.stringify(updated)));
  const history = syncPocketContext(stale, null, getPocketConversations(restored), "小月", restored.deletedContextMessages);
  assert.deepEqual(history.map(message => message.content), ["main", "reply", "other-reply"]);
  const cleared = recordPocketContextDeletions(restored, { ...restored, contacts: restored.contacts.filter(contact => contact.id !== "friend") });
  const clearedHistory = syncPocketContext(stale, null, getPocketConversations(cleared), "小月", cleared.deletedContextMessages);
  assert.deepEqual(clearedHistory.map(message => message.content), ["main", "other-reply"]);
  assert.equal(recordPocketContextDeletions(cleared, cleared), cleared);
  assert.deepEqual(applyPocketContextChanges(emptyPocketState(), [{ contactId: "restored-only", messageId: "deleted", content: null }]).deletedContextMessages,
    [{ contactId: "restored-only", messageId: "deleted" }]);
});

test("reset greetings receive fresh identities, mirror at reset time and never restore cleared messages", () => {
  const friend = { ...contact("friend", [message("greeting", "assistant", { content: "小月，你好！" }), message("sent"), message("reply", "assistant")]), greeting: "{{user}}，你好！", personality: "最新设定" };
  const state = stateWith([friend, contact("other", [message("other-reply", "assistant")])]);
  const stale = [...mirror(state), message("main-after-chat")];
  const cleared = recordPocketContextDeletions(state, { ...state, contacts: [resetPocketContactChat(friend, "小月"), state.contacts[1]] });
  const next = syncPocketContext(stale, getPocketConversations(state), getPocketConversations(cleared), "小月", cleared.deletedContextMessages);
  assert.deepEqual(next.map(message => message.content), ["main", "other-reply", "main-after-chat", "小月，你好！"]);
  assert.equal(next.at(-1).extra.pocketPhone.messageId, cleared.contacts[0].messages[0].id);
  assert.notEqual(next.at(-1).extra.pocketPhone.messageId, "greeting");
  const restored = normalizePocketState(JSON.parse(JSON.stringify(cleared)));
  assert.deepEqual(syncPocketContext(stale, null, getPocketConversations(restored), "小月", restored.deletedContextMessages).map(message => message.content), next.map(message => message.content));
  assert.equal(syncPocketContext(next, null, getPocketConversations(restored), "小月", restored.deletedContextMessages), next);
  assert.equal(restored.contacts[0].personality, "最新设定");
});

test("deleting a covered message repairs reply markers without treating earlier answered messages as pending", () => {
  const friend = contact("friend", [message("earlier"), message("covered"), message("reply", "assistant", { replyContextMessageId: "covered" }), message("late")]);
  const group = { id: "group", name: "群聊", members: [{ id: friend.id, name: friend.name, avatar: friend.avatar, personality: friend.personality }],
    messages: [message("earlier"), message("covered"), message("late")], replyContextMessageId: "covered", createdAt: friend.createdAt };
  const state = stateWith([friend], [group]);
  const updated = applyPocketContextChanges(state, ["friend", "group"].map(contactId => ({ contactId, messageId: "covered", content: null })));
  assert.equal(updated.contacts[0].messages[1].replyContextMessageId, "earlier");
  assert.equal(updated.groups[0].replyContextMessageId, "earlier");
  assert.deepEqual(getPocketPendingMessages(updated.contacts[0]).map(item => item.id), ["late"]);
  assert.deepEqual(getPocketPendingMessages(updated.groups[0]).map(item => item.id), ["late"]);
  const deletedReply = applyPocketContextChanges(updated, [{ contactId: "friend", messageId: "reply", content: null }]);
  assert.deepEqual(getPocketPendingMessages(deletedReply.contacts[0]).map(item => item.id), ["earlier", "late"]);
});

test("the storage bridge persists closed phones and delivers session-specific changes even when storage fails", t => {
  const originals = { window: globalThis.window, localStorage: globalThis.localStorage };
  const target = new EventTarget();
  const state = stateWith([contact("friend", [message("sent")])]);
  const stored = new Map([["renge_pocket_phone_v1:one", JSON.stringify(state)], ["renge_pocket_phone_v1:two", JSON.stringify(state)]]);
  globalThis.window = target;
  globalThis.localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  t.after(() => { for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const updates = [];
  const unsubscribe = subscribePocketContextChanges("one", (changes, warning) => updates.push({ changes, warning }));
  const unsubscribeOther = subscribePocketContextChanges("two", () => assert.fail("another session must not receive this edit"));
  t.after(() => { unsubscribe(); unsubscribeOther(); });
  const previous = mirror(state);
  const edited = previous.map(item => item.content === "sent" ? { ...item, content: "updated" } : item);
  syncPocketPhoneFromContext("one", previous, edited);
  assert.equal(JSON.parse(stored.get("renge_pocket_phone_v1:one")).contacts[0].messages[0].content, "updated");
  assert.deepEqual(JSON.parse(stored.get("renge_pocket_phone_v1:two")), state);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].warning, "");
  globalThis.localStorage.setItem = () => { throw new Error("quota"); };
  syncPocketPhoneFromContext("one", edited, [edited[0]]);
  assert.equal(updates.at(-1).changes[0].content, null);
  assert.match(updates.at(-1).warning, /暂未保存/);
  unsubscribe();
  syncPocketPhoneFromContext("one", previous, edited);
  assert.equal(updates.length, 2);
});
