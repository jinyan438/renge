import assert from "node:assert/strict";
import test from "node:test";
import { emptyPocketState, normalizePocketState, pocketDisplayName, POCKET_AVATARS } from "../src/pocketPhoneState.ts";
import { emptyRedState, normalizeRedState, redActorNickname } from "../src/pocketXiaohongshuState.ts";
import { addRedWechatFriend, syncRedWechatNicknames } from "../src/pocketXiaohongshuFriend.ts";
import { appendGeneratedRedFeed, appendGeneratedRedReplies, buildRedTaskContact, getRedRoleChoices, getRedRoles } from "../src/pocketXiaohongshuGeneration.ts";
import { buildSharedPocketConversation, getPocketMessageIdentity, syncPocketContext } from "../src/pocketPhoneContext.ts";
import { makePocketGroup, parsePocketGroupReply } from "../src/pocketPhoneGroup.ts";

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
  assert.deepEqual(new Set(mixed.actors.map(actor => actor.name)), new Set(["小鹿", "奶糖"]));
  assert.ok(mixed.notes.every(note => note.author === mixed.actors.find(actor => actor.id === note.authorId).nickname));
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

test("selected roles and new people have separate account nicknames while retaining real identities", () => {
  const roles = [{ id: "contact:friend", name: "奶糖", avatar: "/touxiang/7.png", personality: "{{char}}是{{user}}的绘画搭档", sourceCharacterCardId: "friend-card" }];
  const state = appendGeneratedRedFeed(emptyRedState(), JSON.stringify({ actors: [{ id: roles[0].id, name: "奶糖", nickname: "奶芙画画中", personality: "不能覆盖原有人设" }, { ...person, nickname: "鹿鹿种花" }], notes: [{ ...post, author: "鹿鹿种花", comments: [{ authorId: roles[0].id, author: "奶芙画画中", content: "好看！" }] }, { ...post, authorId: roles[0].id, author: "奶芙画画中", title: "水彩日常" }] }), roles, "小月");
  const actor = state.actors.find(actor => actor.id === roles[0].id);
  assert.equal(actor.name, "奶糖"); assert.equal(actor.nickname, "奶芙画画中"); assert.equal(actor.personality, roles[0].personality); assert.equal(actor.avatar, roles[0].avatar);
  assert.equal(state.notes[0].author, actor.nickname); assert.equal(state.comments[0].author, actor.nickname);
  const prompt = buildRedTaskContact(state, "小月", getRedRoleChoices(roles, state.actors), { kind: "feed" });
  assert.match(prompt.personality, /奶糖是小月的绘画搭档/); assert.match(prompt.personality, /奶芙画画中/);
  const imported = addRedWechatFriend(emptyPocketState(), actor);
  assert.equal(imported.contact.name, actor.name); assert.equal(pocketDisplayName(imported.contact), actor.nickname);
  const request = buildSharedPocketConversation(imported.contact, { nickname: "小月", bio: "" }, [], [], [], "proactive");
  assert.match(request[0].content, /微信昵称是「奶芙画画中」/); assert.match(request[0].content, /奶糖是小月的绘画搭档/);
});

test("legacy content gains stable nicknames without losing follows, IDs, avatars or text", () => {
  const actor = { id: "contact:friend", name: "奶糖", avatar: "/touxiang/7.png", personality: "画画" };
  const old = { ...emptyRedState(), actors: [actor], followed: [actor.name], selectedRoleIds: [actor.id], notes: [{ ...post, id: "old-note", authorId: actor.id, author: actor.name, avatar: actor.avatar, generated: true }], comments: [{ id: "old-comment", noteId: "old-note", actorId: actor.id, author: actor.name, avatar: actor.avatar, content: "原来的评论", generated: true }] };
  const restored = normalizeRedState(old);
  const nickname = redActorNickname(actor);
  assert.notEqual(nickname, actor.name); assert.equal(restored.actors[0].name, actor.name);
  assert.equal(restored.notes[0].author, nickname); assert.equal(restored.comments[0].author, nickname);
  assert.deepEqual(restored.followed, [nickname]); assert.deepEqual(restored.selectedRoleIds, [actor.id]);
  assert.equal(restored.notes[0].content, post.content); assert.equal(restored.comments[0].id, "old-comment");
  assert.deepEqual(normalizeRedState(restored), restored);
});

test("existing WeChat contacts gain the same alias while preserving names, settings and messages", () => {
  const contact = { id: "friend", name: "奶糖", avatar: "/touxiang/7.png", personality: "用户设定", messages: [{ id: "old", role: "user", content: "保留记录", createdAt: "" }] };
  const actor = { id: "contact:friend", name: contact.name, nickname: "奶芙画画中", avatar: contact.avatar, personality: "画画" };
  const state = { ...emptyPocketState(), contacts: [contact] }; const red = { ...emptyRedState(), actors: [actor] };
  const next = syncRedWechatNicknames(state, red);
  assert.equal(next.contacts[0].name, contact.name); assert.equal(next.contacts[0].nickname, actor.nickname);
  assert.deepEqual(next.contacts[0].messages, contact.messages); assert.equal(next.contacts[0].personality, contact.personality);
  assert.equal(syncRedWechatNicknames(next, red), next); assert.equal(addRedWechatFriend(next, actor).state, next);
  assert.equal(normalizePocketState(next).contacts[0].nickname, actor.nickname);
});

test("group aliases survive reload and shared context while model roles still use character names", () => {
  const member = { id: "friend", name: "奶糖", nickname: "奶芙画画中", avatar: "/touxiang/7.png", personality: "{{char}}喜欢水彩" };
  let group = makePocketGroup("画画群", [member], "小月");
  group.messages = parsePocketGroupReply('{"speak":true,"texts":["一起画画吧"]}', group.members[0], "");
  const restored = normalizePocketState({ ...emptyPocketState(), groups: [group] }).groups[0];
  assert.equal(restored.members[0].name, member.name); assert.equal(restored.members[0].nickname, member.nickname);
  assert.equal(restored.messages[0].speaker.name, member.nickname);
  const history = syncPocketContext([], null, [restored], "小月");
  assert.equal(getPocketMessageIdentity(history[0]).contactName, member.nickname);
  const prompt = buildSharedPocketConversation(restored, { nickname: "小月", bio: "" }, [], [], [], "proactive", restored.members[0]);
  assert.match(prompt[0].content, /奶糖喜欢水彩/); assert.match(prompt[0].content, /奶芙画画中/);
});
