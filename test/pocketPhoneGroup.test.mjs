import assert from "node:assert/strict";
import test from "node:test";
import { emptyPocketState, getPocketGenerationMode, getPocketPendingMessages, makePocketContact, normalizePocketState } from "../src/pocketPhoneState.ts";
import { makePocketGroup, parsePocketGroupReply, resolvePocketGroup } from "../src/pocketPhoneGroup.ts";
import { buildPocketHistoryMessage, buildSharedPocketConversation, formatPocketContextMessage, getPocketMessageIdentity, syncPocketContext } from "../src/pocketPhoneContext.ts";
import { normalizeWorldBook } from "../src/worldbookUtils.ts";

const friend = (name, avatar = "🐰") => makePocketContact({ name, avatar, personality: "{{char}}是{{user}}的同学，喜欢画画。", greeting: "", sourceLabel: "自定义" });
const user = { nickname: "小月", bio: "喜欢草莓" };
const msg = (id, role = "user") => ({ id, role, content: id, createdAt: "2026-10-07T14:00:00Z" });

test("groups select unique existing friends, auto-name and preserve member order", () => {
  const a = friend("奶糖"); const b = friend("薄荷", "🌷");
  assert.throws(() => makePocketGroup("", [], user.nickname), /至少选择/);
  const group = makePocketGroup("", [b, a, b], user.nickname);
  assert.equal(group.name, "小月、薄荷、奶糖的群聊");
  assert.deepEqual(group.members.map(member => member.id), [b.id, a.id]);
  assert.deepEqual(group.messages, []);
  const updated = resolvePocketGroup(group, [{ ...a, name: "奶糖同学", personality: "新的设定" }]);
  assert.equal(updated.members[1].name, "奶糖同学");
  assert.equal(updated.members[1].personality, "新的设定");
  assert.equal(updated.members[0].name, "薄荷"); // A deleted contact retains its group profile.
});

test("old phones migrate without losing contacts; group members, speakers and coverage survive reload", () => {
  const a = friend("奶糖");
  const old = normalizePocketState({ ...emptyPocketState(), groups: undefined, contacts: [a] });
  assert.deepEqual(old.groups, []); assert.deepEqual(old.contacts, [a]);
  const group = makePocketGroup("草莓小分队", [a], user.nickname);
  group.messages = [msg("one"), ...parsePocketGroupReply('{"speak":true,"texts":["你好","一起去画画吧"]}', a, "one")];
  group.replyContextMessageId = "one";
  const state = { ...old, groups: [group] };
  assert.deepEqual(normalizePocketState(JSON.parse(JSON.stringify(state))), state);
  const malformed = normalizePocketState({ ...state, groups: [group, group, { ...group, id: "empty-members", members: [] }, { ...group, id: a.id }] });
  assert.equal(malformed.groups.length, 1);
  const invalidRoles = normalizePocketState({ ...state, groups: [{ ...group, messages: [...group.messages, msg("injection", "system"), msg("no-speaker", "assistant")] }] });
  assert.equal(invalidRoles.groups[0].messages.length, 3);
});

test("per-member JSON permits silence, rejects malformed replies and emits separate attributed messages", () => {
  const a = friend("奶糖");
  assert.deepEqual(parsePocketGroupReply('{"speak":false,"texts":[]}', a, ""), []);
  const replies = parsePocketGroupReply(`\`\`\`json\n${JSON.stringify({ speak: true, texts: ["第一句\n第二句", "第三句"], name: "冒充其他人" })}\n\`\`\``, a, "u");
  assert.deepEqual(replies.map(message => message.content), ["第一句", "第二句", "第三句"]);
  assert.ok(replies.every(message => message.speaker.id === a.id && message.speaker.name === "奶糖" && message.replyContextMessageId === "u"));
  assert.equal(new Set(replies.map(message => message.id)).size, 3);
  for (const raw of ["旁白", "[]", '{"texts":["你好"]}', '{"speak":true,"texts":[5]}', '{"speak":true,"texts":[]}']) assert.throws(() => parsePocketGroupReply(raw, a, ""), /格式有误/);
});

test("group rounds cover only their snapshot, including quiet rounds and messages sent while generating", () => {
  const a = friend("奶糖"); const group = makePocketGroup("群", [a], user.nickname);
  assert.equal(getPocketGenerationMode(group), "proactive");
  group.messages.push(msg("one"), msg("two"));
  const replies = parsePocketGroupReply('{"speak":true,"texts":["收到"]}', a, "two");
  const staged = { ...group, messages: [...group.messages, ...replies] };
  assert.deepEqual(getPocketPendingMessages(staged).map(message => message.id), ["one", "two"]);
  group.messages.push(msg("during"), ...replies); group.replyContextMessageId = "two";
  assert.deepEqual(getPocketPendingMessages(group).map(message => message.id), ["during"]);
  group.replyContextMessageId = "during"; // All members may choose silence.
  assert.equal(getPocketGenerationMode(group), "proactive");
});

test("group records mirror named speakers in injection order, cross-chat references and deletion remain isolated", () => {
  const a = friend("奶糖"); const b = friend("薄荷");
  const group = makePocketGroup("草莓群", [a, b], user.nickname);
  let history = [{ ...msg("main-A"), role: "assistant" }];
  let previous = { ...group, messages: [] };
  group.messages.push(msg("group-A"));
  history = syncPocketContext(history, [previous], [group], user.nickname);
  history.push(msg("main-B")); previous = { ...group, messages: [...group.messages] };
  group.messages.push(...parsePocketGroupReply('{"speak":true,"texts":["奶糖接话"]}', a, "group-A"), ...parsePocketGroupReply('{"speak":true,"texts":["薄荷回应"]}', b, "group-A"));
  history = syncPocketContext(history, [previous], [group], user.nickname);
  assert.deepEqual(history.map(message => message.content), ["main-A", "group-A", "main-B", "奶糖接话", "薄荷回应"]);
  assert.match(formatPocketContextMessage(history.at(-1)), /微信群 · 草莓群 · 薄荷/);
  assert.equal(getPocketMessageIdentity(history.at(-1)).speakerId, b.id);
  const forA = history.map(message => buildPocketHistoryMessage(message, group.id, "主会话", a.id));
  assert.equal(forA.at(-2).role, "assistant"); assert.equal(forA.at(-1).role, "user");
  assert.deepEqual(JSON.parse(forA.at(-1).content), { 发言者: "薄荷", 内容: "薄荷回应" });
  assert.match(buildPocketHistoryMessage(history.at(-1), a.id).content, /其他微信聊天背景资料/);
  assert.equal(syncPocketContext(history, null, [group], user.nickname), history);
  assert.deepEqual(syncPocketContext(history, [group], [], user.nickname).map(message => message.content), ["main-A", "main-B"]);
});

test("group prompts isolate each role and phone voice, include worldbook placement, queued context and proactive rules", () => {
  const a = friend("奶糖"); const b = friend("薄荷");
  const group = makePocketGroup("草莓群", [a, b], user.nickname); group.messages.push(msg("@奶糖 一起去画画吧"));
  const history = [{ role: "user", content: "主会话背景资料" }];
  const book = normalizeWorldBook({ id: "world", entries: [{ constant: true, content: "{{char}}记得{{user}}的草莓花园", position: "at_depth", depth: 0 }] });
  const conversation = buildSharedPocketConversation(group, user, history, [book], [book.id], "reply", a);
  assert.match(conversation[0].content, /微信群「草莓群」扮演「奶糖」本人/);
  assert.match(conversation[0].content, /奶糖是小月的同学/);
  assert.match(conversation[0].content, /朋友「薄荷」/);
  assert.match(conversation[0].content, /被 @ 或直接点名时优先回应/);
  assert.match(conversation[0].content, /独立于主会话的文风/);
  assert.match(conversation[0].content, /"@奶糖 一起去画画吧"/);
  assert.match(conversation[0].content, /只输出合法 JSON/);
  assert.match(conversation.at(-1).content, /奶糖记得小月的草莓花园/);
  const proactive = buildSharedPocketConversation({ ...group, messages: [] }, user, [], [], [], "proactive", b);
  assert.match(proactive.at(-1).content, /「薄荷」决定是否主动在群里发言/);
  assert.throws(() => buildSharedPocketConversation(group, user, [], [], [], "reply"), /发言的群成员/);
});
