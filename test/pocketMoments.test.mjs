import assert from "node:assert/strict";
import test from "node:test";
import { addPocketMomentComment, applyPocketMomentsGeneration, applyPocketMomentsInteraction, canSeePocketMoment, makePocketMoment, normalizePocketMoments, pocketMomentActors, pocketMomentContextAllowed, pocketMomentViewerIds, pocketMomentsConversation, pocketMomentsTask, POCKET_MOMENTS_ID, POCKET_MOMENTS_USER_ID, togglePocketMomentLike, visiblePocketMoments } from "../src/pocketMomentsState.ts";
import { emptyPocketState, getPocketConversations, makePocketContact, normalizePocketState } from "../src/pocketPhoneState.ts";
import { characterPhoneView, commitCharacterPhoneView } from "../src/pocketCharacterPhone.ts";
import { applyPocketContextChanges, getPocketContextChanges, reconcilePocketMomentsContext, recordPocketContextDeletions, syncPocketPhoneFromContext } from "../src/pocketPhoneSync.ts";
import { buildPocketHistoryMessage, buildSharedPocketConversation, formatPocketContextMessage, getPocketMessageIdentity, pocketContextRevision, syncPocketContext } from "../src/pocketPhoneContext.ts";
import { normalizeWorldBook } from "../src/worldbookUtils.ts";
import { updatePocketStoryClock } from "../src/pocketWechatClock.ts";

const user = { nickname: "小月", bio: "用户喜欢画画", avatarImage: "/touxiang/20.png" };
const time = "2031-02-28T15:45:00Z";
const actor = name => makePocketContact({ name, avatar: "/touxiang/9.png", personality: "{{char}}是{{user}}的朋友，在花店工作", greeting: "", sourceLabel: "角色卡", sourceCharacterCardId: "owner-card" });
const draft = (text = "今天的花开了", visibility = "public", visibleTo = []) => ({ text, pic: "", images: [], location: "", visibility, visibleTo });
function seed() { return { ...emptyPocketState(), contacts: [actor("奶糖"), actor("薄荷")] }; }
function generated(authorId, extra = {}) { return JSON.stringify({ moments: [{ authorId, text: "花店的新鲜动态", pic: "一束白花", visibility: "public", likes: [], comments: [], ...extra }] }); }

test("public, private and partial moments share canonical posts across phones with stable audience identities", () => {
  const root = seed(); const circle = pocketMomentActors(root, "", user); const [a, b] = circle.friends;
  const posts = [makePocketMoment(circle.viewer, draft("公开"), circle.friends, time), makePocketMoment(circle.viewer, draft("仅我知道", "private"), circle.friends, time), makePocketMoment(circle.viewer, draft("只给奶糖看", "part", [a.id]), circle.friends, time)];
  root.moments = posts;
  assert.equal(visiblePocketMoments(posts, circle.viewer, circle.friends).length, 3);
  for (const [id, count] of [[a.id, 2], [b.id, 1]]) { const view = pocketMomentActors(root, id, user); assert.equal(visiblePocketMoments(posts, view.viewer, view.friends).length, count); }
  assert.equal(canSeePocketMoment(posts[1], a.id), false); assert.equal(canSeePocketMoment(posts[2], b.id), false);
  const view = characterPhoneView(root, a.id, user); assert.equal(view.moments, root.moments);
  view.moments = [...posts, makePocketMoment(a, draft("角色私密心事", "private"), [circle.viewer], time)];
  const saved = commitCharacterPhoneView(root, a.id, view); const reloaded = normalizePocketState(JSON.parse(JSON.stringify(saved)));
  assert.equal(reloaded.moments.length, 4); assert.equal(visiblePocketMoments(reloaded.moments, circle.viewer, circle.friends).length, 3);
  root.contacts[0].nickname = "新的昵称"; assert.equal(canSeePocketMoment(posts[2], pocketMomentActors(root, a.id, user).viewer.id), true);
  assert.throws(() => makePocketMoment(circle.viewer, draft("部分可见", "part", ["unknown"]), circle.friends, time), /选择至少一位/);
});

test("likes, comments and replies remain synchronized and invisible actors cannot interact", () => {
  const circle = pocketMomentActors(seed(), "", user); const [a, b] = circle.friends;
  let post = makePocketMoment(circle.viewer, draft("只给你看", "part", [a.id]), circle.friends, time);
  post = togglePocketMomentLike(post, a, time); assert.equal(post.likes.length, 1);
  assert.equal(togglePocketMomentLike(post, a, time).likes.length, 0);
  assert.throws(() => togglePocketMomentLike(post, b, time), /不可见/);
  assert.throws(() => addPocketMomentComment(post, b, "不该知道", time), /不可见/);
  post = addPocketMomentComment(post, a, "我看到了", time);
  post = addPocketMomentComment(post, circle.viewer, "谢谢", time, a);
  assert.equal(post.comments[1].replyTo.id, a.id);
  assert.throws(() => addPocketMomentComment(post, a, "自我回复", time, a), /其他人的评论/);
  assert.deepEqual(normalizePocketMoments(JSON.parse(JSON.stringify([post])))[0].comments, post.comments);
});

test("model generation validates full batches, excludes the real user, preserves old posts and rejects visibility leaks", () => {
  const circle = pocketMomentActors(seed(), "", user); const [a, b] = circle.friends;
  const old = makePocketMoment(circle.viewer, draft("我的旧动态"), circle.friends, time);
  const next = applyPocketMomentsGeneration([old], generated(a.id, { likes: [b.id], comments: [{ authorId: b.id, text: "花好漂亮" }, { authorId: a.id, text: "谢谢", replyToId: b.id }] }), circle.viewer, circle.friends, time);
  assert.equal(next.length, 2); assert.equal(next[0], old); assert.equal(next[1].comments.length, 2);
  assert.equal(applyPocketMomentsGeneration(next, generated(a.id), circle.viewer, circle.friends, time).length, 2);
  assert.throws(() => applyPocketMomentsGeneration([old], generated(POCKET_MOMENTS_USER_ID), circle.viewer, circle.friends, time), /名单外/);
  assert.throws(() => applyPocketMomentsGeneration([old], generated(a.id, { likes: [POCKET_MOMENTS_USER_ID] }), circle.viewer, circle.friends, time), /未知好友/);
  assert.throws(() => applyPocketMomentsGeneration([old], generated(a.id, { visibility: "private" }), circle.viewer, circle.friends, time), /可见范围/);
  const invalid = JSON.parse(generated(a.id)); invalid.moments.push({ authorId: "unknown", text: "错误", pic: "", likes: [], comments: [] });
  assert.throws(() => applyPocketMomentsGeneration([old], JSON.stringify(invalid), circle.viewer, circle.friends, time), /名单外/); assert.equal(old.comments.length, 0);
  const privatePost = applyPocketMomentsGeneration([], generated(a.id, { visibility: "private" }), a, [circle.viewer, b], time, true)[0];
  assert.equal(canSeePocketMoment(privatePost, circle.viewer.id), false);
  assert.throws(() => applyPocketMomentsGeneration([], generated(a.id, { visibility: "private", comments: [{ authorId: b.id, text: "泄露" }] }), a, [circle.viewer, b], time, true), /不可见/);
  assert.equal(applyPocketMomentsGeneration([], '{"moments":[]}', a, [circle.viewer], time, true).length, 0);
});

test("AI interaction appends only eligible actors, deduplicates, and author replies can target real user comments", () => {
  const circle = pocketMomentActors(seed(), "", user); const [a, b] = circle.friends;
  let post = makePocketMoment(a, draft(), [circle.viewer, b], time);
  post = addPocketMomentComment(post, circle.viewer, "想看看这束花", time);
  const reply = JSON.stringify({ likes: [], comments: [{ authorId: a.id, text: "下次带你看看", replyToId: circle.viewer.id }] });
  const replied = applyPocketMomentsInteraction(post, reply, [a], time);
  assert.equal(replied.comments.length, 2); assert.equal(replied.comments[1].replyTo.id, circle.viewer.id);
  assert.equal(applyPocketMomentsInteraction(replied, reply, [a], time).comments.length, 2);
  assert.throws(() => applyPocketMomentsInteraction(post, '{"likes":[],"comments":[{"authorId":"unknown","text":"错误"}]}', [a], time), /未知评论者/);
  assert.throws(() => applyPocketMomentsInteraction(post, JSON.stringify({ likes: [], comments: [{ authorId: a.id, text: "自评" }] }), [a], time), /帖主只能回复/);
});

test("moments share ordered context, edit in place and delete posts with all dependent records and tombstones", () => {
  const root = seed(); const circle = pocketMomentActors(root, "", user); const [a] = circle.friends;
  let post = makePocketMoment(circle.viewer, draft("原动态"), circle.friends, time);
  post = addPocketMomentComment(togglePocketMomentLike(post, a, time), a, "原评论", time);
  root.moments = [post];
  const main = { id: "main", role: "user", content: "主线", createdAt: time };
  const history = syncPocketContext([main], [], getPocketConversations(root), user.nickname);
  assert.equal(history.length, 4); assert.equal(history[1].source, "moments"); assert.equal(getPocketMessageIdentity(history[1]).app, "moments");
  assert.match(formatPocketContextMessage(history[1]), /朋友圈 · 小月/); assert.match(formatPocketContextMessage(history[2]), /朋友圈 · 奶糖/);
  assert.equal(syncPocketContext(history, null, getPocketConversations(root), user.nickname), history);
  const edited = applyPocketContextChanges(root, [{ contactId: POCKET_MOMENTS_ID, messageId: `post:${post.id}`, content: "修改后的动态" }, { contactId: POCKET_MOMENTS_ID, messageId: `comment:${post.comments[0].id}`, content: "修改后的评论" }]);
  const after = syncPocketContext([...history, { ...main, id: "later" }], getPocketConversations(root), getPocketConversations(edited), user.nickname);
  assert.equal(after[1].id, history[1].id); assert.equal(after[1].content, "修改后的动态"); assert.equal(after.at(-1).id, "later"); assert.notEqual(pocketContextRevision(history), pocketContextRevision(after));
  const removed = applyPocketContextChanges(edited, [{ contactId: POCKET_MOMENTS_ID, messageId: `post:${post.id}`, content: null }]);
  assert.equal(removed.moments.length, 0); assert.equal(removed.deletedContextMessages.length, 3);
  assert.deepEqual(syncPocketContext(after, null, getPocketConversations(removed), user.nickname, removed.deletedContextMessages).map(message => message.id), ["main", "later"]);
  const cleared = recordPocketContextDeletions(root, { ...root, moments: [] }); assert.equal(cleared.deletedContextMessages.length, 3);
});

test("generation references only visible moments and shares worldbook placement without WeChat output rules", () => {
  const root = seed(); const circle = pocketMomentActors(root, "", user); const [a, b] = circle.friends;
  root.moments = [makePocketMoment(circle.viewer, draft("隐私内容", "private"), circle.friends, time), makePocketMoment(circle.viewer, draft("仅奶糖", "part", [a.id]), circle.friends, time), makePocketMoment(circle.viewer, draft("公开内容"), circle.friends, time)];
  const history = syncPocketContext([], null, getPocketConversations(root), user.nickname);
  assert.equal(history.filter(message => pocketMomentContextAllowed(message, [a.id])).length, 2);
  assert.equal(history.filter(message => pocketMomentContextAllowed(message, [b.id])).length, 1);
  assert.equal(history.filter(message => pocketMomentContextAllowed(message, [a.id, b.id])).length, 1);
  assert.equal(history.filter(message => pocketMomentContextAllowed(message, [circle.viewer.id])).length, 3);
  assert.equal(history.filter(message => pocketMomentContextAllowed(message, [])).length, 0);
  const task = pocketMomentsTask(circle.viewer, circle.friends, [a.id]);
  const book = normalizeWorldBook({ id: "active", entries: [{ content: "前置朋友圈设定", constant: true, position: "before_char" }, { content: "深度世界书", constant: true, position: "at_depth", depth: 1 }] });
  const quoted = history.filter(message => pocketMomentContextAllowed(message, [a.id])).map(message => buildPocketHistoryMessage(message, task.id));
  assert.ok(quoted.every(message => message.role === "user")); assert.match(quoted[0].content, /朋友圈背景资料/);
  const request = buildSharedPocketConversation(task, user, quoted, [book], [book.id]);
  assert.match(request[0].content, /前置朋友圈设定/); assert.match(request.at(-2).content, /深度世界书/); assert.doesNotMatch(request[0].content, /微信回复规则|9 项激素/);
  assert.deepEqual(pocketMomentViewerIds({ ...root.contacts[0], syncedOwnerId: a.id }), [POCKET_MOMENTS_USER_ID]);
  assert.deepEqual(pocketMomentViewerIds({ ...root.contacts[0], app: "notes", phoneOwner: root.contacts[0] }), [a.id]);
  assert.deepEqual(pocketMomentViewerIds({ members: [root.contacts[0]] }, root.contacts[0]), [a.id]);
});

test("main-chat post edits immediately refresh interaction topics and post deletion removes all dependent history", () => {
  const root = seed(); const circle = pocketMomentActors(root, "", user); const [a] = circle.friends;
  const post = addPocketMomentComment(togglePocketMomentLike(makePocketMoment(circle.viewer, draft("旧动态"), circle.friends, time), a, time), a, "评论", time);
  const history = syncPocketContext([], null, [pocketMomentsConversation([post])], user.nickname).map(message => ({ ...message, customMainField: "保留主会话元数据" }));
  const editedPost = { ...post, text: "新动态" };
  const after = reconcilePocketMomentsContext(history, [post], [editedPost]);
  assert.equal(after[0].id, history[0].id); assert.equal(after[1].content, "赞了「新动态」"); assert.equal(after[2].extra.pocketMoment.postText, "新动态");
  assert.ok(after.every(message => message.customMainField === "保留主会话元数据"));
  assert.deepEqual(reconcilePocketMomentsContext(after.slice(1), [editedPost], []), []);
  const restored = { ...after[0], extra: { ...after[0].extra, pocketPhone: { ...after[0].extra.pocketPhone, messageId: "restored-absent-locally" } } };
  assert.deepEqual(reconcilePocketMomentsContext([restored], [post], []), [restored]);
});

test("closed-phone edits and cascade deletion persist and timeline edits cannot advance the story clock", () => {
  const root = seed(); const circle = pocketMomentActors(root, "", user);
  root.moments = [makePocketMoment(circle.viewer, draft("明天上午9点去花店"), circle.friends, time)];
  const history = syncPocketContext([], null, [pocketMomentsConversation(root.moments)], user.nickname);
  const oldStorage = globalThis.localStorage; const oldWindow = globalThis.window;
  const values = new Map([["renge_pocket_phone_v1:moments-test", JSON.stringify(root)]]);
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; globalThis.window = new EventTarget();
  try {
    const editedHistory = history.map(message => ({ ...message, content: "主会话编辑的动态" }));
    syncPocketPhoneFromContext("moments-test", history, editedHistory);
    assert.equal(JSON.parse(values.get("renge_pocket_phone_v1:moments-test")).moments[0].text, "主会话编辑的动态");
    assert.equal(getPocketContextChanges(history, editedHistory).length, 1);
    syncPocketPhoneFromContext("moments-test", editedHistory, []);
    assert.equal(JSON.parse(values.get("renge_pocket_phone_v1:moments-test")).moments.length, 0);
  } finally { globalThis.localStorage = oldStorage; globalThis.window = oldWindow; }
  const clock = { initialTime: time, initialRealTime: Date.now() }; assert.equal(updatePocketStoryClock(clock, history), clock);
});
