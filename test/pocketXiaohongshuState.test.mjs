import assert from "node:assert/strict";
import test from "node:test";
import { POCKET_AVATARS, POCKET_EXTRACTED_AVATARS, safePocketAvatar } from "../src/pocketPhoneState.ts";
import { emptyRedState, normalizeRedState, randomRedAvatar, redStorageKey, safeRedImage, toggleRedItem } from "../src/pocketXiaohongshuState.ts";

test("new red phones contain no seeded notes, comments or actors", () => {
  assert.deepEqual(normalizeRedState(null), emptyRedState());
  assert.deepEqual(emptyRedState().notes, []); assert.deepEqual(emptyRedState().comments, []);
  assert.notEqual(redStorageKey("one"), redStorageKey("two"));
  assert.deepEqual(toggleRedItem(toggleRedItem([], "note"), "note"), []);
});
test("all extracted avatars join the phone picker and random character avatar pool", () => {
  assert.equal(POCKET_AVATARS.length, 31); assert.equal(POCKET_EXTRACTED_AVATARS.length, 11);
  POCKET_EXTRACTED_AVATARS.forEach(avatar => { assert.equal(safePocketAvatar(avatar), avatar); assert.equal(safeRedImage(avatar), true); });
  for (let index = 0; index < POCKET_AVATARS.length; index++) assert.equal(randomRedAvatar(() => (index + .1) / POCKET_AVATARS.length), POCKET_AVATARS[index]);
  assert.equal(safeRedImage("https://example.com/avatar.jpg"), false);
  assert.equal(safeRedImage("data:image/svg+xml;base64,PHN2Zz4="), false);
});
test("legacy user posts survive migration while retired defaults and their references disappear", () => {
  const post = { id: "mine", title: "我自己的笔记", content: "正文", tags: ["日常"], images: ["data:image/png;base64,aGVsbG8="], author: "小月", avatar: "/touxiang/20.png", time: "刚刚" };
  const old = { version: 1, notes: [post, { ...post, id: "game" }], comments: [{ id: "my-comment", noteId: "mine", author: "小月", avatar: "/touxiang/20.png", content: "自己的评论" }, { id: "old-comment", noteId: "game", content: "默认帖子评论" }], liked: ["game", "mine"], saved: ["work"], history: ["game", "mine"] };
  const restored = normalizeRedState(old);
  assert.equal(restored.version, 2); assert.equal(restored.notes.length, 1);
  assert.equal(restored.notes[0].title, post.title); assert.deepEqual(restored.notes[0].images, post.images);
  assert.equal(restored.comments.length, 1); assert.deepEqual(restored.liked, ["mine"]); assert.deepEqual(restored.saved, []); assert.deepEqual(restored.history, ["mine"]);
});
test("actors, generated records, pending replies and interaction counts survive restoration", () => {
  const actor = { id: "actor", name: "奶糖", avatar: POCKET_EXTRACTED_AVATARS[0], personality: "喜欢画画" };
  const note = { id: "note", authorId: actor.id, title: "今天画画了", content: "正文", generated: true, likes: 24, saves: 8, images: [], tags: ["画画"], category: "生活", time: "刚刚" };
  const comment = { id: "comment", noteId: "note", actorId: "self", author: "小月", content: "可以一起吗？", avatar: "/touxiang/20.png" };
  const state = normalizeRedState({ ...emptyRedState(), actors: [actor], notes: [note], comments: [comment], pendingReplies: ["comment"], liked: ["note"], likedComments: ["comment"] });
  const restored = normalizeRedState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state); assert.equal(restored.notes[0].avatar, actor.avatar); assert.equal(restored.notes[0].likes, 24);
  assert.deepEqual(restored.pendingReplies, ["comment"]);
  assert.equal(normalizeRedState({ ...state, comments: [...state.comments, { ...comment, id: "reply", generated: true, responseToId: "comment" }] }).pendingReplies.length, 0);
});

test("role checkboxes and custom actor avatars survive reload without opting in historical authors", () => {
  const avatar = "data:image/png;base64,aGVsbG8=";
  const actor = { id: "card:friend", name: "奶糖", avatar, personality: "绘画搭档" };
  const state = { ...emptyRedState(), actors: [actor], selectedRoleIds: [actor.id, actor.id, null, "", 123], notes: [{ id: "note", title: "画画", authorId: actor.id, generated: true, tags: [], images: [] }], comments: [{ id: "comment", noteId: "note", actorId: actor.id, content: "自评", generated: true }] };
  const restored = normalizeRedState(state);
  assert.deepEqual(restored.selectedRoleIds, [actor.id]);
  assert.equal(restored.actors[0].avatar, avatar); assert.equal(restored.notes[0].avatar, avatar); assert.equal(restored.comments[0].avatar, avatar);
  assert.deepEqual(normalizeRedState(JSON.parse(JSON.stringify(restored))), restored);
  const { selectedRoleIds, ...legacy } = state;
  assert.deepEqual(normalizeRedState(legacy).selectedRoleIds, []);
});
