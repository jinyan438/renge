import assert from "node:assert/strict";
import test from "node:test";
import { POCKET_AVATARS } from "../src/pocketPhoneState.ts";
import { emptyRedState } from "../src/pocketXiaohongshuState.ts";
import { appendGeneratedRedFeed, appendGeneratedRedReplies, buildRedTaskContact, getRedRoleChoices, getRedRoles, selectedRedRoles, syncRedRoleAvatars } from "../src/pocketXiaohongshuGeneration.ts";

const roles = [{ id: "contact:friend", name: "奶糖", personality: "{{char}}是{{user}}的绘画搭档", sourceCharacterCardId: "friend" }, { id: "persona:stranger", name: "路人", personality: "喜欢画画" }];
const post = title => ({ authorId: "contact:friend", author: "奶糖", title, content: `${title}正文`, tags: ["画画"], coverText: title, coverTone: "mint", avatar: "https://example.com/tracker.jpg", likes: 3, comments: [{ author: "路人", content: "好好看", likes: 2 }] });
const community = title => ({ id: `new:${title}`, name: `花店${title}`, personality: "北街花店的店员，温和开朗，喜欢水彩，说话简短。", profile: { bio: "日子会开花", age: 22, location: "北街" } });
const batch = title => ({ actors: [community(title)], notes: [{ ...post(`${title}社区`), authorId: `new:${title}`, author: `花店${title}`, comments: [] }, post(title)] });
const generate = (state, title, random = () => .8) => appendGeneratedRedFeed(state, JSON.stringify(batch(title)), roles, "小月", random);
test("generation appends new posts and comments, assigning stable random pool avatars", () => {
  const first = generate(emptyRedState(), "第一篇"); const second = generate(first, "第二篇", () => 0);
  assert.equal(first.notes.length, 2); assert.equal(second.notes.length, 4); assert.equal(second.comments.length, 2);
  assert.deepEqual(second.notes[2], first.notes[0]); assert.equal(second.notes[0].avatar, first.notes[0].avatar);
  assert.ok(POCKET_AVATARS.includes(first.notes[0].avatar)); assert.notEqual(first.notes[0].avatar, post("x").avatar);
  assert.equal(second.actors.length, 4); assert.equal(first.actors.find(actor => actor.name === "奶糖").sourceCharacterCardId, "friend");
});
test("malformed batches are atomic, repeats are rejected and model output cannot impersonate the user", () => {
  const state = generate(emptyRedState(), "已有"); const snapshot = structuredClone(state);
  assert.throws(() => appendGeneratedRedFeed(state, '{"notes":[', roles, "小月"), /JSON/);
  assert.throws(() => appendGeneratedRedFeed(state, JSON.stringify({ notes: [post("新"), { ...post("坏"), content: "" }] }), roles, "小月"), /正文/);
  assert.throws(() => appendGeneratedRedFeed(state, JSON.stringify({ notes: [post("已有")] }), roles, "小月"), /没有生成新内容/);
  assert.throws(() => appendGeneratedRedFeed(state, JSON.stringify({ notes: [{ ...post("冒充"), authorId: "self", author: "小月" }] }), roles, "小月"), /替用户发言/);
  assert.deepEqual(state, snapshot);
});
test("comment replies target the submitted snapshot and retry without duplicate user messages", () => {
  let state = generate(emptyRedState(), "画画"); const note = state.notes[0];
  const comment = { id: "user-one", noteId: note.id, actorId: "self", author: "小月", avatar: "/touxiang/20.png", content: "我也想画", time: "刚刚", location: "", likes: 0 };
  const late = { ...comment, id: "user-two", content: "这条稍后回复" };
  state = { ...state, comments: [...state.comments, comment, late], pendingReplies: [comment.id, late.id] };
  const task = { kind: "reply", noteId: note.id, commentId: comment.id };
  const request = buildRedTaskContact(state, "小月", roles, task);
  assert.match(request.personality, /奶糖是小月的绘画搭档/); assert.match(request.personality, /user-one/);
  const output = JSON.stringify({ replies: [{ authorId: "contact:friend", content: "一起画吧" }] });
  const replied = appendGeneratedRedReplies(state, output, roles, "小月", task);
  assert.equal(replied.comments.at(-1).parentId, comment.id); assert.equal(replied.comments.at(-1).responseToId, comment.id);
  assert.equal(replied.comments.at(-1).isAuthor, true); assert.deepEqual(replied.pendingReplies, [late.id]);
  assert.equal(appendGeneratedRedReplies(replied, output, roles, "小月", task), replied);
  assert.equal(replied.comments.filter(comment => comment.actorId === "self").length, 2);
  const stranger = state.actors.find(actor => actor.name === "路人");
  const withActorId = appendGeneratedRedReplies(state, JSON.stringify({ replies: [{ authorId: stranger.id, content: "陌生角色也记得自己的头像" }] }), roles, "小月", task);
  assert.equal(withActorId.comments.at(-1).avatar, stranger.avatar);
});
test("role candidates use enabled persona traits and latest saved phone roles", () => {
  const result = getRedRoles([{ id: "friend", name: "奶糖", personality: "最新手机设定" }], [{ id: "persona", name: "小林", description: "温柔", entryTypes: [{ name: "喜好", entries: [{ key: "喜欢", value: "蓝莓", enabled: true }, { key: "禁用", value: "不能导入", enabled: false }] }] }]);
  assert.equal(result[0].personality, "最新手机设定"); assert.match(result[1].personality, /蓝莓/); assert.doesNotMatch(result[1].personality, /不能导入/);
});

test("only checked roles enter the pool; saved authors cannot rejoin through feed or reply history", () => {
  const old = generate(emptyRedState(), "历史帖子");
  assert.equal(getRedRoleChoices(roles, old.actors).length, 2);
  assert.deepEqual(selectedRedRoles(old, roles), []);
  assert.match(buildRedTaskContact(old, "小月", [], { kind: "feed" }).personality, /未勾选角色/);
  const state = { ...old, selectedRoleIds: [roles[1].id] };
  const selected = selectedRedRoles(state, roles);
  assert.deepEqual(selected.map(role => role.name), ["路人"]);
  const task = buildRedTaskContact(state, "小月", selected, { kind: "feed" });
  assert.doesNotMatch(task.personality, /绘画搭档/);
  assert.match(task.personality, /未勾选角色/);
  assert.deepEqual(task.contextCharacterCardIds, []);
  assert.throws(() => appendGeneratedRedFeed(state, JSON.stringify({ notes: [post("未勾选作者")] }), selected, "小月"), /未勾选/);
});

test("unselected authors, commenters and replies are rejected atomically", () => {
  const state = generate(emptyRedState(), "历史帖子"); const snapshot = structuredClone(state);
  const selected = [roles[0]];
  assert.throws(() => appendGeneratedRedFeed(state, JSON.stringify({ notes: [post("新帖")] }), selected, "小月"), /未勾选/);
  assert.throws(() => appendGeneratedRedFeed(state, JSON.stringify({ notes: [{ ...post("旧作者"), authorId: state.actors.find(actor => actor.name === "路人").id, author: "路人", comments: [] }] }), selected, "小月"), /未勾选/);
  const target = { id: "user", noteId: state.notes[0].id, actorId: "self", author: "小月", content: "你好", generated: false };
  const pending = { ...state, comments: [...state.comments, target], pendingReplies: [target.id] };
  const task = { kind: "reply", noteId: target.noteId, commentId: target.id };
  assert.throws(() => appendGeneratedRedReplies(pending, JSON.stringify({ replies: [{ authorId: roles[1].id, content: "未勾选回复" }] }), selected, "小月", task), /未勾选/);
  const other = buildRedTaskContact(pending, "小月", [roles[1]], task);
  assert.equal(other.name, "路人"); assert.match(other.personality, /本次优先发言角色：路人/);
  assert.deepEqual(state, snapshot); assert.deepEqual(pending.pendingReplies, [target.id]);
});

test("existing contact and persona avatars override random avatars, including saved posts", () => {
  const image = "data:image/png;base64,aGVsbG8=";
  const candidates = getRedRoles([{ id: "friend", name: "奶糖", avatar: "/touxiang/7.png", personality: "朋友" }], [{ id: "stranger", name: "路人", avatarImage: image, description: "朋友", entryTypes: [] }]);
  assert.deepEqual(candidates.map(role => role.avatar), ["/touxiang/7.png", image]);
  let randomCalls = 0;
  const result = appendGeneratedRedFeed(emptyRedState(), JSON.stringify(batch("已有头像")), candidates, "小月", () => { randomCalls++; return .8; });
  assert.equal(randomCalls, 1);
  assert.equal(result.notes[0].avatar, "/touxiang/7.png"); assert.equal(result.comments[0].avatar, image);
  const restored = syncRedRoleAvatars(result, candidates.map(role => ({ ...role, avatar: image })));
  assert.equal(restored.notes[0].avatar, image);
  assert.equal(syncRedRoleAvatars(restored, candidates.map(role => ({ ...role, avatar: image }))), restored);
  assert.equal(result.notes[0].avatar, "/touxiang/7.png");
});

test("direct card actors stay out of role choices and the pool, while imported contacts remain eligible", () => {
  const roles = getRedRoles([{ id: "friend", name: "奶糖", avatar: "/touxiang/7.png", personality: "手机设定", sourceCharacterCardId: "friend-card" }], []);
  const actors = [{ id: "card:legacy", name: "仅角色卡", avatar: "/touxiang/1.png", personality: "旧的直接导入角色" }];
  const state = { ...emptyRedState(), actors, selectedRoleIds: ["card:legacy", "contact:friend"] };
  assert.deepEqual(getRedRoleChoices(roles, actors).map(role => role.name), ["奶糖"]);
  assert.deepEqual(selectedRedRoles(state, roles).map(role => role.id), ["contact:friend"]);
  assert.equal(roles[0].sourceCharacterCardId, "friend-card");
});
