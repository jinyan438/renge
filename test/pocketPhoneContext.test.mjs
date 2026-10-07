import assert from "node:assert/strict";
import test from "node:test";
import { buildSharedPocketConversation, formatPocketContextMessage, getPocketMessageIdentity, pocketContextRevision, syncPocketContext } from "../src/pocketPhoneContext.ts";
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
