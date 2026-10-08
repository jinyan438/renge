import assert from "node:assert/strict";
import test from "node:test";
import { emptyRedState, normalizeRedState, RED_NOTES, redStorageKey, safeRedImage, toggleRedItem } from "../src/pocketXiaohongshuState.ts";

test("Xiaohongshu interactions start empty and storage is isolated by conversation", () => {
  assert.deepEqual(normalizeRedState(null), emptyRedState());
  assert.deepEqual(normalizeRedState({ version: 2, liked: ["work"] }), emptyRedState());
  assert.notEqual(redStorageKey("one"), redStorageKey("two"));
  assert.notEqual(redStorageKey("one"), "renge_pocket_phone_v1:one");
  assert.deepEqual(toggleRedItem(toggleRedItem([], "work"), "work"), []);
});

test("restoring preserves published notes, comments, replies and interaction state", () => {
  const note = { ...RED_NOTES[0], id: "published", title: "我的第一篇笔记", images: ["data:image/png;base64,aGVsbG8="], author: "小月", avatar: "/touxiang/20.png", likes: 0, saves: 0, comments: 0, category: "生活", location: "" };
  const comments = [{ id: "mine", noteId: "published", author: "小月", avatar: "/touxiang/20.png", content: "第一条评论", time: "刚刚", location: "", likes: 0 }, { id: "reply", noteId: "work", parentId: "work-watermelon", author: "小月", avatar: "/touxiang/20.png", content: "回复", time: "刚刚", location: "", likes: 0 }];
  const state = { ...emptyRedState(), notes: [note], comments, liked: ["work"], saved: ["game"], followed: ["小职人先先贝"], likedComments: ["work-ssr"], hidden: ["mall"], history: ["work", "game"] };
  const restored = normalizeRedState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.notes[0].title, note.title);
  assert.deepEqual(restored.notes[0].images, note.images);
  assert.deepEqual(restored.comments, comments);
  for (const key of ["liked", "saved", "followed", "likedComments", "hidden", "history"]) assert.deepEqual(restored[key], state[key]);
});

test("restoring rejects malformed, duplicate and remote image records", () => {
  const valid = { ...RED_NOTES[0], id: "published" };
  const state = normalizeRedState({ ...emptyRedState(), liked: ["work", "work", 42, null], notes: [null, valid, valid, RED_NOTES[0], { ...valid, id: "blank", title: " " }, { ...valid, id: "remote", images: ["javascript:alert(1)", "https://example.com/photo.jpg", "data:image/svg+xml;base64,PHN2Zz4="] }], comments: [null, { id: "orphan", noteId: "missing", content: "lost" }, { id: "empty", noteId: "game", content: " " }] });
  assert.deepEqual(state.liked, ["work"]);
  assert.deepEqual(state.notes.map(note => note.id), ["published", "remote"]);
  assert.deepEqual(state.notes[1].images, []);
  assert.deepEqual(state.comments, []);
  assert.equal(safeRedImage("/xiaohongshu/game-note.jpg"), true);
  assert.equal(safeRedImage("/xiaohongshu/../../secret.jpg"), false);
  assert.equal(safeRedImage("data:image/svg+xml;base64,PHN2Zz4="), false);
});
