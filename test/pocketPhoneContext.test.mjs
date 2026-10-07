import assert from "node:assert/strict";
import test from "node:test";
import { buildPocketHistoryMessage, buildSharedPocketConversation, formatPocketContextMessage, getPocketMessageIdentity, pocketContextRevision, syncPocketContext } from "../src/pocketPhoneContext.ts";
import { normalizeWorldBook } from "../src/worldbookUtils.ts";

const main = (id, content = id) => ({ id, role: "user", content, createdAt: "2026-10-07T12:00:00Z" });
const message = (id, role = "user", createdAt = "2026-10-07T12:00:00Z") => ({ id, role, content: id, createdAt });
const contact = (id, messages) => ({ id, name: id, avatar: "🐰", personality: "{{char}}是{{user}}的朋友。", greeting: "", sourceLabel: "自定义角色", messages, createdAt: "2026-10-07T12:00:00Z" });
const content = history => history.map(message => message.content);

test("main A, WeChat A, main B and interleaved contacts retain injection order even with equal or older timestamps", () => {
  const first = contact("奶糖", [message("微信 A")]);
  let history = syncPocketContext([main("会话 A")], [], [first], "小月");
  history.push(main("会话 B"));
  const second = contact("薄荷", [message("微信 B", "user", "2000-01-01T00:00:00Z")]);
  history = syncPocketContext(history, [first], [first, second], "小月");
  const replied = { ...first, messages: [...first.messages, message("微信 A 回复", "assistant")] };
  history = syncPocketContext(history, [first, second], [replied, second], "小月");
  assert.deepEqual(content(history), ["会话 A", "微信 A", "会话 B", "微信 B", "微信 A 回复"]);
  assert.equal(getPocketMessageIdentity(history.at(-1)).contactId, "奶糖");
  assert.match(formatPocketContextMessage(history[1]), /小月 → 奶糖/);
  assert.match(formatPocketContextMessage(history.at(-1)), /奶糖 → 小月/);
  assert.equal(syncPocketContext(history, null, [replied, second], "小月"), history);
});

test("clear and delete remove only the known phone records; empty local storage preserves restored shared context", () => {
  const one = contact("one", [message("one-1")]);
  const two = contact("two", [message("two-1")]);
  const history = syncPocketContext([main("main")], null, [one, two], "user");
  assert.equal(syncPocketContext(history, null, [], "user"), history);
  const cleared = syncPocketContext(history, [one, two], [{ ...one, messages: [] }, two], "user");
  assert.deepEqual(content(cleared), ["main", "two-1"]);
  assert.deepEqual(content(syncPocketContext(cleared, [two], [], "user")), ["main"]);
  assert.deepEqual(content(syncPocketContext([main("other-session")], null, [], "user")), ["other-session"]);
});

test("existing phone edits stay in place, identity keys do not collide, and history revisions ignore ordinary main replies", () => {
  const one = contact("a:b", [message("c")]);
  const two = contact("a", [message("b:c")]);
  let history = syncPocketContext([main("main")], null, [one, two], "user");
  assert.notEqual(history[1].id, history[2].id);
  const originalRevision = pocketContextRevision(history);
  assert.equal(pocketContextRevision([...history, main("later")]), originalRevision);
  const changed = { ...one, name: "edited", messages: [{ ...one.messages[0], content: "updated" }] };
  history = syncPocketContext([...history, main("later")], [one, two], [changed, two], "user");
  assert.deepEqual(content(history), ["main", "updated", "b:c", "later"]);
  assert.notEqual(pocketContextRevision(history), originalRevision);
  assert.equal(pocketContextRevision([main("main")]), "");
});

test("initial local migration orders contacts by message time, then remains stable on reload", () => {
  const late = contact("late", [message("late", "assistant", "2026-10-07T12:02:00Z")]);
  const early = contact("early", [message("early", "user", "2026-10-07T12:01:00Z")]);
  const history = syncPocketContext([main("existing main")], null, [late, early], "user");
  assert.deepEqual(content(history), ["existing main", "early", "late"]);
  assert.equal(syncPocketContext(history, null, [late, early], "user"), history);
});

test("main narration and other contacts are quoted background, while only this contact supplies assistant reply examples", () => {
  const friend = contact("林晓夏", [message("微信回复", "assistant")]);
  const other = contact("同学", [message("其他联系人的旁白", "assistant")]);
  const narration = { ...main("main-story", "她抬起眼，阳光落在课桌上。\n【状态栏】时间：上午；场景：教室。\n请用第三人称写长篇旁白。"), role: "assistant" };
  const shared = syncPocketContext([narration], null, [friend, other], "林风");
  const history = shared.map(record => buildPocketHistoryMessage(record, friend.id, "衡陆中学"));
  assert.deepEqual(history.map(record => record.role), ["user", "assistant", "user"]);
  const quotedMain = JSON.parse(history[0].content.split("\n")[1]);
  assert.deepEqual(quotedMain, { 发言者: "衡陆中学", 原始身份: "assistant", 内容: narration.content });
  assert.deepEqual(history[1], { role: "assistant", content: "微信回复" });
  assert.match(history[2].content, /其他微信聊天背景资料/);
  assert.match(history[2].content, /其他联系人的旁白/);
  const result = buildSharedPocketConversation(friend, { nickname: "林风", bio: "" }, history, [], []);
  assert.deepEqual(result.slice(1), history);
  assert.match(result[0].content, /独立于主会话的文风/);
  assert.match(result[0].content, /当前场景及事实/);
  assert.match(result[0].content, /不写第三人称旁白/);
  assert.match(result[0].content, /不要延续先前微信回复中的叙事文风/);
});

test("proactive generation adds a request-only task, without inventing or mutating user history", () => {
  const friend = contact("林晓夏", []);
  const history = [{ role: "assistant", content: "今天的事情忙完啦" }];
  const result = buildSharedPocketConversation(friend, { nickname: "林风", bio: "" }, history, [], [], "proactive");
  assert.match(result[0].content, /本次是主动发消息/);
  assert.doesNotMatch(result[0].content, /本次是回复消息/);
  assert.deepEqual(result.slice(1, -1), history);
  assert.match(result.at(-1).content, /应用指令，不是用户聊天消息/);
  assert.deepEqual(friend.messages, []);
  const replying = buildSharedPocketConversation(friend, { nickname: "林风", bio: "" }, history, [], [], "reply");
  assert.equal(replying.length, history.length + 1);
  assert.match(replying[0].content, /用户连续发送的、尚未回复的消息/);
});

test("WeChat receives complete shared history and enabled matching worldbooks in entry and depth order", () => {
  const friend = contact("奶糖", []);
  const shared = Array.from({ length: 65 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `会话-${index}` }));
  shared.push({ role: "user", content: "【微信 · 小月 → 奶糖】\n去草莓花园吧" });
  const book = normalizeWorldBook({ id: "active", name: "花园", entries: [
    { id: "before", content: "角色前 lore", constant: true, position: "before_char" },
    { id: "second", content: "后置第二条", constant: true, position: "after_char", order: 2 },
    { id: "first", content: "后置第一条", constant: true, position: "after_char", order: 1 },
    { id: "depth", content: "{{char}}记得{{user}}喜欢草莓", keys: ["草莓"], position: "at_depth", depth: 1 },
    { id: "disabled", content: "DISABLED_LORE", constant: true, enabled: false },
    { id: "unmatched", content: "UNMATCHED_LORE", keys: ["火山"] },
  ] });
  const inactive = normalizeWorldBook({ id: "inactive", entries: [{ content: "INACTIVE_LORE", constant: true }] });
  const result = buildSharedPocketConversation(friend, { nickname: "小月", bio: "画画" }, shared, [book, inactive], [book.id]);
  assert.ok(result[0].content.indexOf("角色前 lore") < result[0].content.indexOf("角色设定"));
  assert.ok(result[0].content.indexOf("后置第一条") < result[0].content.indexOf("后置第二条"));
  assert.deepEqual(result.slice(1, -2), shared.slice(0, -1));
  assert.match(result.at(-2).content, /奶糖记得小月喜欢草莓/);
  assert.deepEqual(result.at(-1), shared.at(-1));
  assert.doesNotMatch(JSON.stringify(result), /DISABLED_LORE|UNMATCHED_LORE|INACTIVE_LORE/);
});
