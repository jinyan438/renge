import assert from "node:assert/strict";
import test from "node:test";
import { POCKET_AVATARS } from "../src/pocketPhoneState.ts";
import { emptyRedState } from "../src/pocketXiaohongshuState.ts";
import { appendGeneratedRedFeed, appendGeneratedRedReplies, buildRedTaskContact, getRedRoles } from "../src/pocketXiaohongshuGeneration.ts";

const roles = [{ id: "card:friend", name: "奶糖", personality: "{{char}}是{{user}}的绘画搭档", sourceCharacterCardId: "friend" }];
const post = title => ({ authorId: "card:friend", author: "奶糖", title, content: `${title}正文`, tags: ["画画"], coverText: title, coverTone: "mint", avatar: "https://example.com/tracker.jpg", likes: 3, comments: [{ author: "路人", content: "好好看", likes: 2 }] });
const generate = (state, title, random = () => .8) => appendGeneratedRedFeed(state, JSON.stringify({ notes: [post(title)] }), roles, "小月", random);
test("generation appends new posts and comments, assigning stable random pool avatars", () => {
  const first = generate(emptyRedState(), "第一篇"); const second = generate(first, "第二篇", () => 0);
  assert.equal(first.notes.length, 1); assert.equal(second.notes.length, 2); assert.equal(second.comments.length, 2);
  assert.deepEqual(second.notes[1], first.notes[0]); assert.equal(second.notes[0].avatar, first.notes[0].avatar);
  assert.ok(POCKET_AVATARS.includes(first.notes[0].avatar)); assert.notEqual(first.notes[0].avatar, post("x").avatar);
  assert.equal(second.actors.length, 2); assert.equal(first.actors[0].sourceCharacterCardId, "friend");
});
test("malformed batches are atomic, repeats are rejected and model output cannot impersonate the user", () => {
  const state = generate(emptyRedState(), "已有"); const snapshot = structuredClone(state);
  assert.throws(() => appendGeneratedRedFeed(state, '{"notes":[', roles, "小月"), /JSON/);
  assert.throws(() => appendGeneratedRedFeed(state, JSON.stringify({ notes: [post("新"), { ...post("坏"), content: "" }] }), roles, "小月"), /正文/);
  assert.throws(() => generate(state, "已有"), /没有生成新内容/);
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
  const output = JSON.stringify({ replies: [{ authorId: "card:friend", content: "一起画吧" }] });
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
  const result = getRedRoles([{ id: "friend", name: "奶糖", personality: "最新手机设定" }], [{ id: "persona", name: "小林", description: "温柔", entryTypes: [{ name: "喜好", entries: [{ key: "喜欢", value: "蓝莓", enabled: true }, { key: "禁用", value: "不能导入", enabled: false }] }] }], []);
  assert.equal(result[0].personality, "最新手机设定"); assert.match(result[1].personality, /蓝莓/); assert.doesNotMatch(result[1].personality, /不能导入/);
});
