import assert from "node:assert/strict";
import test from "node:test";
import { emptyPocketState, normalizePocketState, POCKET_AVATARS } from "../src/pocketPhoneState.ts";
import { emptyRedState, normalizeRedState } from "../src/pocketXiaohongshuState.ts";
import { addRedWechatFriend } from "../src/pocketXiaohongshuFriend.ts";
import { appendGeneratedRedFeed, appendGeneratedRedReplies, buildRedTaskContact, getRedRoleChoices, getRedRoles } from "../src/pocketXiaohongshuGeneration.ts";
import { buildSharedPocketConversation } from "../src/pocketPhoneContext.ts";

const person = { id: "new:deer", name: "小鹿", personality: "北街花店店员，开朗温柔，喜欢水彩，说话简短。", profile: { bio: "日子会开花", gender: "女", age: 22, location: "北街", followers: 1083, receivedLikes: 3836, background: "ocean" }, avatar: "https://example.com/tracker.png" };
const post = { authorId: person.id, author: person.name, title: "花店日常", content: "今天给花店换了新的水彩招牌。" };
const output = { actors: [person], notes: [post] };

test("unchecked generation creates independent persistent people, avatars and profile metadata", () => {
  const state = appendGeneratedRedFeed(emptyRedState(), JSON.stringify(output), [], "小月");
  const actor = state.actors[0];
  assert.ok(actor.id.startsWith("community:")); assert.ok(POCKET_AVATARS.includes(actor.avatar));
  assert.equal(actor.personality, person.personality); assert.equal(actor.profile.followers, 1083); assert.equal(actor.profile.age, 22);
  assert.equal(state.notes[0].authorId, actor.id); assert.deepEqual(state.selectedRoleIds, []);
  assert.deepEqual(getRedRoleChoices([], state.actors), []);
  assert.deepEqual(normalizeRedState(JSON.parse(JSON.stringify(state))), state);
  assert.match(buildRedTaskContact(state, "小月", [], { kind: "feed" }).personality, /花店店员/);
});

test("mixed batches require a new community author and a selected author", () => {
  const roles = [{ id: "persona:friend", name: "奶糖", personality: "绘画朋友" }];
  assert.throws(() => appendGeneratedRedFeed(emptyRedState(), JSON.stringify(output), roles, "小月"), /已勾选角色/);
  assert.throws(() => appendGeneratedRedFeed(emptyRedState(), JSON.stringify({ notes: [{ ...post, authorId: roles[0].id, author: roles[0].name }] }), roles, "小月"), /新社区人物/);
  const mixed = appendGeneratedRedFeed(emptyRedState(), JSON.stringify({ ...output, notes: [post, { ...post, title: "一起画画", authorId: roles[0].id, author: roles[0].name }] }), roles, "小月");
  assert.deepEqual(new Set(mixed.notes.map(note => note.author)), new Set(["小鹿", "奶糖"]));
});

test("new people require their own personas and cannot bypass unchecked role selection", () => {
  const roles = [{ id: "persona:deer", name: person.name, personality: "不能注入的已有角色" }];
  assert.throws(() => appendGeneratedRedFeed(emptyRedState(), JSON.stringify(output), [], "小月", Math.random, roles), /未勾选/);
  assert.throws(() => appendGeneratedRedFeed(emptyRedState(), JSON.stringify({ ...output, actors: [{ ...person, personality: "" }] }), [], "小月"), /人设/);
  assert.throws(() => appendGeneratedRedFeed(emptyRedState(), JSON.stringify({ ...output, actors: [{ ...person, name: "小月" }] }), [], "小月"), /替用户发言/);
  assert.throws(() => appendGeneratedRedFeed(emptyRedState(), JSON.stringify({ ...output, notes: [{ ...post, author: "另一个昵称" }] }), [], "小月"), /不一致/);
});

test("community authors immediately reply without selection with stable identities", () => {
  const old = appendGeneratedRedFeed(emptyRedState(), JSON.stringify(output), [], "小月"); const note = old.notes[0];
  const comment = { id: "user", noteId: note.id, actorId: "self", author: "小月", content: "一起画吧" };
  const state = { ...old, comments: [comment], pendingReplies: [comment.id] };
  const task = { kind: "reply", noteId: note.id, commentId: comment.id };
  assert.equal(buildRedTaskContact(state, "小月", [], task).name, person.name);
  const replied = appendGeneratedRedReplies(state, JSON.stringify({ replies: [{ authorId: note.authorId, content: "好呀" }] }), [], "小月", task);
  assert.equal(replied.comments.at(-1).avatar, note.avatar); assert.equal(replied.comments.at(-1).isAuthor, true);
  assert.deepEqual(replied.pendingReplies, []); assert.deepEqual(replied.actors, old.actors);
  const newcomer = { ...person, id: "new:flower", name: "小花" };
  const other = appendGeneratedRedReplies(state, JSON.stringify({ actors: [newcomer], replies: [{ authorId: newcomer.id, content: "我也来" }] }), [], "小月", task);
  assert.equal(other.actors.at(-1).personality, newcomer.personality);
});

test("private message adds one WeChat friend with saved persona and same avatar across reload", () => {
  const red = appendGeneratedRedFeed(emptyRedState(), JSON.stringify(output), [], "小月"); const actor = red.actors[0];
  const previous = emptyPocketState(); const result = addRedWechatFriend(previous, actor);
  assert.equal(previous.contacts.length, 0); assert.equal(result.state.contacts.length, 1);
  assert.equal(result.contact.avatar, actor.avatar); assert.equal(result.contact.sourceXiaohongshuActorId, actor.id);
  assert.match(result.contact.personality, /花店店员/); assert.match(result.contact.personality, /22岁/); assert.deepEqual(result.contact.messages, []);
  const restored = normalizePocketState(JSON.parse(JSON.stringify(result.state)));
  const again = addRedWechatFriend(restored, actor);
  assert.equal(again.state, restored); assert.equal(again.contact.id, result.contact.id);
  const request = buildSharedPocketConversation(again.contact, { nickname: "小月", bio: "" }, [], [], [], "proactive");
  assert.match(request[0].content, /花店店员/); assert.match(request[0].content, /微信回复规则/);
  assert.equal(getRedRoles(restored.contacts, [])[0].id, actor.id);
  assert.deepEqual(getRedRoleChoices(getRedRoles(restored.contacts, []), red.actors), []);
});

test("private messages reuse existing friends without overwriting edits or conversations", () => {
  const red = appendGeneratedRedFeed(emptyRedState(), JSON.stringify(output), [], "小月"); const actor = red.actors[0];
  const result = addRedWechatFriend(emptyPocketState(), actor);
  const saved = { ...result.state, contacts: [{ ...result.contact, name: "改过的昵称", personality: "用户编辑的人设", messages: [{ id: "old", role: "user", content: "保留聊天", createdAt: "" }] }] };
  assert.equal(addRedWechatFriend(saved, actor).state, saved);
  const original = { ...emptyPocketState(), contacts: [{ ...result.contact, id: "original", sourceXiaohongshuActorId: undefined }] };
  assert.equal(addRedWechatFriend(original, actor).state, original);
  assert.equal(addRedWechatFriend(original, { ...actor, id: "contact:original", name: "原角色" }).contact.id, "original");
});
