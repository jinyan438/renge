import assert from "node:assert/strict";
import test from "node:test";
import { applyPocketInnerTurns, parsePocketWechatTurn, POCKET_HORMONES } from "../src/pocketPhoneInner.ts";
import { emptyPocketState, makePocketContact, normalizePocketState, resetPocketContactChat } from "../src/pocketPhoneState.ts";
import { makePocketGroup, parsePocketGroupReply, resetPocketGroupChat } from "../src/pocketPhoneGroup.ts";
import { buildPocketHistoryMessage, buildSharedPocketConversation, formatPocketContextMessage, getPocketMessageIdentity, syncPocketContext } from "../src/pocketPhoneContext.ts";
import { applyPocketContextChanges, recordPocketContextDeletions } from "../src/pocketPhoneSync.ts";

const hormones = (value = 50) => Object.fromEntries(POCKET_HORMONES.map(item => [item.key, value]));
const output = (monologue, value = 50, texts = ["我们一起去画画吧"]) => JSON.stringify({ texts, innerMonologue: monologue, hormones: hormones(value) });
const person = name => makePocketContact({ name, nickname: `${name}的日记`, avatar: "/touxiang/7.png", personality: `${name}喜欢画画`, greeting: "", sourceLabel: "自定义" });
const user = { nickname: "小月", bio: "" };

test("each turn requires a private monologue and nine bounded numeric values, with atomic validation", () => {
  assert.equal(POCKET_HORMONES.length, 9);
  const turn = parsePocketWechatTurn(output("想靠近一点"));
  assert.deepEqual(turn.texts, ["我们一起去画画吧"]); assert.equal(turn.innerState.monologue, "想靠近一点");
  const next = parsePocketWechatTurn(output("今天安心了", 60), turn.innerState);
  assert.equal(next.innerState.hormones.dopamine, 60); assert.equal(next.innerState.previousHormones.dopamine, 50);
  for (const bad of ["实际消息而非 JSON", output(""), JSON.stringify({ texts: ["好"], innerMonologue: "想法", hormones: { dopamine: 50 } }), output("想法", -1), output("想法", 101), JSON.stringify({ texts: [], innerMonologue: "想法", hormones: hormones() })]) assert.throws(() => parsePocketWechatTurn(bad), /格式|缺少/);
  assert.deepEqual(turn.innerState.hormones, hormones());
});

test("independent people retain their latest state and monologue history across reload without leaking it into bubbles", () => {
  const a = person("奶糖"); const b = person("薄荷");
  const state = { ...emptyPocketState(), contacts: [a, b], groups: [makePocketGroup("画画群", [a, b], user.nickname)] };
  const turn = parsePocketWechatTurn(output("有点期待见面", 64));
  const next = applyPocketInnerTurns(state, a.id, [{ speaker: a, innerState: turn.innerState }], [{ id: "reply", role: "assistant", content: turn.texts[0], createdAt: turn.innerState.updatedAt }], "");
  assert.equal(state.contacts[0].innerState, undefined);
  assert.equal(next.contacts[1].innerState, undefined); assert.equal(next.groups[0].members[0].innerState.hormones.dopamine, 64);
  assert.equal(next.contacts[0].innerHistory[0].content, "有点期待见面"); assert.equal(next.contacts[0].messages[0].content, turn.texts[0]);
  assert.deepEqual(normalizePocketState(JSON.parse(JSON.stringify(next))), next);
  const invalid = normalizePocketState({ ...next, contacts: [{ ...next.contacts[0], innerState: { ...turn.innerState, hormones: { dopamine: 500 } } }] });
  assert.equal(invalid.contacts[0].innerState, undefined); assert.equal(invalid.contacts[0].messages.length, 1);
});

test("shared history keeps every monologue but injects only the latest hormone snapshot for each person", () => {
  const a = person("奶糖"); let state = { ...emptyPocketState(), contacts: [a] }; let history = [];
  for (const [index, value] of [31, 72].entries()) {
    const turn = parsePocketWechatTurn(output(`私密想法${index}`, value), state.contacts[0].innerState);
    turn.innerState.updatedAt = `2026-10-08T10:00:0${index}Z`;
    const previous = state; state = applyPocketInnerTurns(state, a.id, [{ speaker: a, innerState: turn.innerState }], [{ id: `reply-${index}`, role: "assistant", content: `实际消息${index}`, createdAt: turn.innerState.updatedAt }], "");
    history = syncPocketContext(history, previous.contacts, state.contacts, user.nickname);
  }
  assert.deepEqual(history.filter(message => getPocketMessageIdentity(message).kind === "inner-monologue").map(message => message.content), ["私密想法0", "私密想法1"]);
  assert.equal(history.filter(message => message.extra.pocketHormones).length, 1);
  const main = history.map(formatPocketContextMessage).join("\n");
  assert.match(main, /"dopamine":72/); assert.doesNotMatch(main, /"dopamine":31/);
  const request = buildSharedPocketConversation(state.contacts[0], user, history.map(message => buildPocketHistoryMessage(message, a.id)), [], []);
  assert.match(JSON.stringify(request), /私密想法0/); assert.match(request[0].content, /"dopamine":72/); assert.doesNotMatch(JSON.stringify(request), /"dopamine":31/);
  assert.ok(history.filter(message => getPocketMessageIdentity(message).kind).every(message => buildPocketHistoryMessage(message, a.id).role === "user"));
});

test("quiet group members still generate their own state and the same person has one latest hormone snapshot across chats", () => {
  const a = person("奶糖"); const group = makePocketGroup("画画群", [a], user.nickname);
  let state = { ...emptyPocketState(), contacts: [a], groups: [group] };
  const first = parsePocketWechatTurn(output("单聊时的心事", 30)); first.innerState.updatedAt = "2026-10-08T10:00:00Z";
  state = applyPocketInnerTurns(state, a.id, [{ speaker: a, innerState: first.innerState }], [], "");
  let history = syncPocketContext([], null, [...state.contacts, ...state.groups], user.nickname);
  const quiet = parsePocketWechatTurn(JSON.stringify({ speak: false, texts: [], innerMonologue: "想先听大家聊天", hormones: hormones(70) }), first.innerState, true); quiet.innerState.updatedAt = "2026-10-08T10:00:01Z";
  const previous = state;
  state = applyPocketInnerTurns(state, group.id, [{ speaker: group.members[0], innerState: quiet.innerState }], parsePocketGroupReply(JSON.stringify({ speak: quiet.speak, texts: quiet.texts }), group.members[0], ""), "");
  history = syncPocketContext(history, [...previous.contacts, ...previous.groups], [...state.contacts, ...state.groups], user.nickname);
  assert.equal(state.groups[0].messages.length, 0); assert.equal(state.groups[0].innerHistory.length, 1);
  assert.equal(state.contacts[0].innerState.hormones.dopamine, 70);
  assert.equal(history.filter(message => message.extra.pocketHormones).length, 1);
  assert.doesNotMatch(history.map(formatPocketContextMessage).join("\n"), /"dopamine":30/);
});

test("clear and shared monologue edits preserve regular messages and remove only the corresponding inner records", () => {
  const a = person("奶糖"); const turn = parsePocketWechatTurn(output("原来心事"));
  const state = applyPocketInnerTurns({ ...emptyPocketState(), contacts: [a] }, a.id, [{ speaker: a, innerState: turn.innerState }], [{ id: "reply", role: "assistant", content: "实际聊天", createdAt: turn.innerState.updatedAt }], "");
  const entryId = `inner:${state.contacts[0].innerHistory[0].id}`;
  const edited = applyPocketContextChanges(state, [{ contactId: a.id, messageId: entryId, content: "编辑过的心事" }]);
  assert.equal(edited.contacts[0].innerHistory[0].content, "编辑过的心事"); assert.equal(edited.contacts[0].messages[0].content, "实际聊天");
  assert.equal(edited.contacts[0].innerState.monologue, "编辑过的心事");
  const cleared = recordPocketContextDeletions(state, { ...state, contacts: [resetPocketContactChat(state.contacts[0], user.nickname)] });
  assert.equal(cleared.contacts[0].innerState, undefined); assert.equal(cleared.contacts[0].innerHistory, undefined);
  assert.ok(cleared.deletedContextMessages.some(marker => marker.messageId === entryId));
  const history = syncPocketContext([], null, state.contacts, user.nickname);
  assert.equal(syncPocketContext(history, state.contacts, cleared.contacts, user.nickname, cleared.deletedContextMessages).length, 0);
  const group = makePocketGroup("画画群", [a], user.nickname);
  const grouped = applyPocketInnerTurns({ ...emptyPocketState(), contacts: [a], groups: [group] }, group.id, [{ speaker: a, innerState: turn.innerState }], [], "");
  const clearGroup = recordPocketContextDeletions(grouped, { ...grouped, groups: [resetPocketGroupChat(grouped.groups[0])] });
  assert.equal(clearGroup.groups[0].innerHistory, undefined);
  assert.ok(clearGroup.deletedContextMessages.some(marker => marker.messageId.startsWith("inner:")));
});
