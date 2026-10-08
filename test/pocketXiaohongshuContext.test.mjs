import assert from "node:assert/strict";
import test from "node:test";
import { buildPocketHistoryMessage, buildSharedPocketConversation, formatPocketContextMessage, getPocketMessageIdentity, pocketContextRevision, syncPocketContext } from "../src/pocketPhoneContext.ts";
import { applyRedContextChanges, clearRedContent, redContextConversation } from "../src/pocketXiaohongshuContext.ts";
import { appendGeneratedRedFeed, buildRedTaskContact } from "../src/pocketXiaohongshuGeneration.ts";
import { emptyRedState, normalizeRedState, RED_CONTEXT_ID } from "../src/pocketXiaohongshuState.ts";
import { normalizeWorldBook } from "../src/worldbookUtils.ts";

const roles = [{ id: "friend", name: "奶糖", personality: "朋友" }];
function fixture() { return appendGeneratedRedFeed(emptyRedState(), JSON.stringify({ actors: [{ id: "new:friend", name: "奶糖", personality: "朋友" }], notes: [{ author: "奶糖", title: "草莓花园", content: "和朋友在北街画画。", tags: ["草莓"], comments: [] }] }), [], "小月"); }
const main = id => ({ id, role: "user", content: id, createdAt: "2026-10-08T01:00:00Z" });
test("red notes share the ordered main timeline, label correctly and change the Pi context revision", () => {
  const state = fixture(); const contact = redContextConversation(state);
  let history = syncPocketContext([main("主会话A")], null, [contact], "小月");
  assert.equal(history[1].source, "xiaohongshu"); assert.equal(getPocketMessageIdentity(history[1]).app, "xiaohongshu");
  assert.match(formatPocketContextMessage(history[1]), /小红书 · 奶糖/);
  const revision = pocketContextRevision(history);
  const next = appendGeneratedRedFeed(state, JSON.stringify({ actors: [{ id: "new:other", name: "新朋友", personality: "画画的朋友" }], notes: [{ author: "新朋友", title: "第二篇", content: "新的日常" }] }), [], "小月");
  history = syncPocketContext([...history, main("主会话B")], [contact], [redContextConversation(next)], "小月");
  assert.deepEqual(history.map(message => message.id), ["主会话A", history[1].id, "主会话B", history[3].id]);
  assert.match(history[3].content, /第二篇/); assert.notEqual(pocketContextRevision(history), revision);
  assert.equal(syncPocketContext(history, null, [redContextConversation(next)], "小月"), history);
  assert.equal(buildPocketHistoryMessage(history[1], "wechat-friend").role, "user");
});

test("clearing all content removes shared red records, prevents stale restores and retains role settings", () => {
  const old = fixture(); const note = old.notes[0];
  const state = { ...old, selectedRoleIds: ["friend"], liked: [note.id], saved: [note.id], history: [note.id], hidden: [note.id], followed: [note.author], likedComments: ["comment"], pendingReplies: ["comment"], comments: [{ id: "comment", noteId: note.id, author: "小月", avatar: "/touxiang/20.png", content: "未回复评论", time: "刚刚", location: "", likes: 0 }] };
  const history = syncPocketContext([main("保留主聊天")], null, [redContextConversation(state)], "小月");
  const cleared = clearRedContent(state);
  for (const key of ["notes", "comments", "liked", "saved", "history", "hidden", "followed", "likedComments", "pendingReplies"]) assert.deepEqual(cleared[key], []);
  assert.deepEqual(cleared.selectedRoleIds, ["friend"]); assert.deepEqual(cleared.actors, state.actors);
  assert.equal(cleared.deletedContextMessages.length, 2);
  assert.deepEqual(normalizeRedState(JSON.parse(JSON.stringify(cleared))), cleared);
  assert.deepEqual(syncPocketContext(history, null, [redContextConversation(cleared)], "小月", cleared.deletedContextMessages), [main("保留主聊天")]);
  assert.deepEqual(clearRedContent(cleared), cleared);
  assert.equal(state.notes.length, 1); assert.equal(state.comments.length, 1);
});
test("red generation includes complete quoted history and enabled worldbook placement without WeChat output rules", () => {
  const state = fixture(); const contact = buildRedTaskContact(state, "小月", roles, { kind: "feed" });
  const history = Array.from({ length: 65 }, (_, index) => buildPocketHistoryMessage(main(`主会话-${index}`), RED_CONTEXT_ID));
  history.push(...syncPocketContext([], null, [contact], "小月").map(message => buildPocketHistoryMessage(message, RED_CONTEXT_ID)));
  const book = normalizeWorldBook({ id: "active", entries: [{ content: "角色前世界书", constant: true, position: "before_char" }, { content: "{{user}}的草莓世界书", keys: ["草莓"], position: "at_depth", depth: 1 }, { content: "DISABLED_LORE", constant: true, enabled: false }] });
  const inactive = normalizeWorldBook({ id: "inactive", entries: [{ content: "INACTIVE_LORE", constant: true }] });
  const request = buildSharedPocketConversation(contact, { nickname: "小月", bio: "画画" }, history, [book, inactive], [book.id], "proactive");
  assert.match(request[0].content, /增量生成/); assert.match(request[0].content, /独立于主会话和微信/);
  assert.ok(request[0].content.indexOf("角色前世界书") < request[0].content.indexOf("本次任务"));
  assert.match(JSON.stringify(request), /主会话-0|主会话-64/); assert.match(JSON.stringify(request), /小月的草莓世界书/);
  assert.match(request.at(-1).content, /应用指令，不是用户聊天消息/);
  assert.doesNotMatch(JSON.stringify(request), /DISABLED_LORE|INACTIVE_LORE|微信回复规则/);
});
test("main edits update notes/comments and deletion markers prevent stale restore from resurrecting posts", () => {
  const state = fixture(); const note = state.notes[0];
  const commented = { ...state, comments: [{ id: "user", noteId: note.id, author: "小月", avatar: "/touxiang/20.png", content: "旧评论", time: "刚刚", location: "", likes: 0 }], pendingReplies: ["user"] };
  const edited = applyRedContextChanges(commented, [{ contactId: RED_CONTEXT_ID, messageId: "comment:user", content: "在《草莓花园》下评论\n\n改后的评论" }]);
  assert.equal(edited.comments[0].content, "改后的评论");
  const deleted = applyRedContextChanges(edited, [{ contactId: RED_CONTEXT_ID, messageId: `note:${note.id}`, content: null }]);
  assert.equal(deleted.notes.length, 0); assert.equal(deleted.comments.length, 0); assert.equal(deleted.pendingReplies.length, 0);
  const oldHistory = syncPocketContext([], null, [redContextConversation(commented)], "小月");
  assert.deepEqual(syncPocketContext(oldHistory, null, [redContextConversation(deleted)], "小月", deleted.deletedContextMessages), []);
});
