import assert from "node:assert/strict";
import test from "node:test";
import { emptyPocketState, makePocketContact, normalizePocketState, pocketStorageKey } from "../src/pocketPhoneState.ts";
import { createPocketWechatClock, ensurePocketWechatClock, formatPocketWechatTime, normalizePocketWechatClock, parsePocketStoryTime, pocketWechatNow, pocketWechatTimePrompt, stampPocketWechatTimes, updatePocketStoryClock } from "../src/pocketWechatClock.ts";
import { subscribePocketWechatClock, syncPocketWechatClock } from "../src/pocketWechatClockSync.ts";
import { characterPhoneView, commitCharacterPhoneView } from "../src/pocketCharacterPhone.ts";
import { appendPocketAttachment, editPocketBalance, pocketReplyMessages } from "../src/pocketWechatMedia.ts";
import { formatPocketContextMessage, syncPocketContext } from "../src/pocketPhoneContext.ts";

const realStart = Date.UTC(2026, 9, 8, 6);
const local = (month, day, hour, minute = 0) => new Date(2000, month - 1, day, hour, minute).toISOString();
const clock = () => ({ initialTime: local(6, 6, 20), initialRealTime: realStart });
const message = (id, content, extra = {}) => ({ id, content, ...extra });
const hours = n => n * 3600000;
const actor = () => makePocketContact({ name: "奶糖", avatar: "/touxiang/9.png", personality: "朋友", greeting: "", sourceLabel: "自定义角色" });

test("an independent seed ignores the real date and advances 27 hours across reload exactly as requested", () => {
  const first = createPocketWechatClock(realStart, () => 0.25);
  assert.equal(first.initialTime, createPocketWechatClock(realStart + hours(10000), () => 0.25).initialTime);
  assert.equal(pocketWechatNow(clock(), realStart), local(6, 6, 20));
  const restored = normalizePocketState(JSON.parse(JSON.stringify({ ...emptyPocketState(), wechatClock: clock() })));
  assert.equal(pocketWechatNow(restored.wechatClock, realStart + hours(27)), local(6, 7, 23));
  assert.equal(ensurePocketWechatClock(restored, realStart + hours(50)), restored);
  assert.equal(normalizePocketWechatClock({ initialTime: "invalid", initialRealTime: realStart }), undefined);
  assert.equal(normalizePocketWechatClock({ initialTime: clock().initialTime, initialRealTime: NaN }), undefined);
});

test("the main body calibrates the clock, handles Chinese dates and relative narration, and does not reset on re-reading", () => {
  const main = [message("scene", "<status>日期：六月六日\n时间：晚上八点十五分</status>")];
  const first = updatePocketStoryClock(clock(), main, realStart);
  assert.equal(pocketWechatNow(first, realStart), local(6, 6, 20, 15));
  assert.equal(updatePocketStoryClock(first, main, realStart + hours(27)), first);
  assert.equal(pocketWechatNow(first, realStart + hours(27)), local(6, 7, 23, 15));
  const next = [...main, message("next-scene", "第二天早上九点，两人回到教室。三小时后，他们一起吃午饭。")];
  const updated = updatePocketStoryClock(first, next, realStart + hours(100));
  assert.equal(pocketWechatNow(updated, realStart + hours(100)), local(6, 7, 12));
  assert.equal(pocketWechatNow(updated, realStart + hours(102)), local(6, 7, 14));
  const persisted = normalizePocketWechatClock(JSON.parse(JSON.stringify(updated)));
  assert.deepEqual(updatePocketStoryClock(persisted, next, realStart + hours(103)), persisted);
  assert.match(pocketWechatTimePrompt(updated, realStart + hours(102)), /主会话正文.*优先/);
});

test("explicit body time can jump forwards or backwards and edits/deletions recompute the story baseline", () => {
  const main = [message("one", "时间：2026年6月6日20:00"), message("two", "当前时间：6月8日 09:30")];
  const updated = updatePocketStoryClock(clock(), main, realStart + hours(20));
  assert.equal(new Date(pocketWechatNow(updated, realStart + hours(20))).getFullYear(), 2026);
  assert.equal(new Date(updated.storyTime).getDate(), 8);
  const edited = updatePocketStoryClock(updated, [main[0], message("two", "当前时间：6月5日 18:00")], realStart + hours(21));
  assert.equal(new Date(edited.storyTime).getDate(), 5);
  assert.equal(new Date(edited.storyTime).getHours(), 18);
  const deleted = updatePocketStoryClock(edited, main.slice(0, 1), realStart + hours(22));
  assert.equal(new Date(deleted.storyTime).getDate(), 6);
  assert.equal(new Date(deleted.storyTime).getHours(), 20);
  assert.deepEqual(updatePocketStoryClock(deleted, [], realStart + hours(23)), clock());
});

test("plans, memories, quoted dialogue, hidden or unfinished text and phone messages do not become the current time", () => {
  for (const content of ["明天早上九点见。", "约好6月8日晚上8点见。", "6月8日晚上8点见", "回忆起6月8日晚上八点。", "“现在是6月8日晚上8点”", "<think>当前时间：6月8日晚上8点</think>普通回复", "```\n时间：6月8日20:00\n```", "日期：2月30日", "时间：25:00", "现实时间：10月8日06:00", "她的生日是6月8日。", "我吃了3/4的面包。"]) {
    assert.equal(parsePocketStoryTime(content, clock().initialTime), undefined, content);
  }
  const ignored = [message("wechat", "当前时间：6月8日20:00", { source: "wechat" }), message("red", "时间：6月8日20:00", { source: "xiaohongshu" }), message("running", "时间：6月8日20:00", { outputStatus: "running" }), message("hidden", "时间：6月8日20:00", { extra: { tavernIsHidden: true } })];
  assert.equal(updatePocketStoryClock(clock(), ignored, realStart).storyTime, undefined);
  assert.equal(parsePocketStoryTime("半个小时后，他回来了。", local(6, 6, 23, 45)), local(6, 7, 0, 15));
  assert.equal(parsePocketStoryTime("时间：晚上20:30", local(6, 6, 10)), local(6, 6, 20, 30));
  assert.equal(parsePocketStoryTime("时间：晚上十二点", local(6, 6, 10)), local(6, 6, 0));
  assert.equal(parsePocketStoryTime("时间：下午一点一刻", local(6, 6, 10)), local(6, 6, 13, 15));
  assert.equal(parsePocketStoryTime("时间：晚上十一点三刻", local(6, 6, 10)), local(6, 6, 23, 45));
  assert.equal(parsePocketStoryTime('{"日期":"6月8日", "时间":"09:30"}', local(6, 6, 10)), local(6, 8, 9, 30));
});

test("outgoing messages, generated replies, attachments and bills save one virtual timestamp across both phones", () => {
  const owner = actor(); const realAt = realStart + hours(27);
  owner.messages = [{ id: "first", role: "user", content: "第一条", createdAt: new Date(realStart).toISOString() }, ...pocketReplyMessages(["第二条"], new Date(realAt).toISOString(), "first")];
  let state = stampPocketWechatTimes({ ...emptyPocketState(), wechatClock: clock(), contacts: [owner] });
  assert.equal(state.contacts[0].messages[0].wechatTime, local(6, 6, 20));
  assert.equal(state.contacts[0].messages[1].wechatTime, local(6, 7, 23));
  assert.equal(state.contacts[0].messages[1].createdAt, new Date(realAt).toISOString());
  const user = { nickname: "小月", bio: "", avatarImage: "/touxiang/20.png" };
  const view = characterPhoneView(state, owner.id, user);
  assert.deepEqual(view.wechatClock, state.wechatClock);
  assert.equal(view.contacts[0].messages[1].wechatTime, local(6, 7, 23));
  state = commitCharacterPhoneView(state, owner.id, view);
  state = editPocketBalance(state, 100);
  state = appendPocketAttachment(state, owner.id, { kind: "image", description: "学校门口" });
  state = stampPocketWechatTimes(state);
  assert.ok(state.contacts[0].messages.at(-1).wechatTime);
  assert.ok(state.wallet.bills[0].wechatTime);
  const oldTime = state.contacts[0].messages[0].wechatTime;
  const recalibrated = stampPocketWechatTimes({ ...state, wechatClock: updatePocketStoryClock(state.wechatClock, [message("new", "当前时间：8月1日09:00")], realAt) });
  assert.equal(recalibrated.contacts[0].messages[0].wechatTime, oldTime);
  const restored = normalizePocketState(JSON.parse(JSON.stringify(recalibrated)));
  assert.deepEqual(restored.wechatClock, recalibrated.wechatClock);
  assert.deepEqual(restored.contacts[0].messages, recalibrated.contacts[0].messages);
  assert.deepEqual(restored.wallet, recalibrated.wallet);
  assert.equal(characterPhoneView(restored, owner.id, user).contacts[0].messages[0].wechatTime, oldTime);
  const history = syncPocketContext([], null, state.contacts, user.nickname);
  assert.equal(history[0].extra.pocketWechatTime, local(6, 6, 20));
  assert.ok(formatPocketContextMessage(history[0]).includes(formatPocketWechatTime(local(6, 6, 20))));
});

test("main updates persist for a closed phone, notify only its session, and survive quota failures without resetting elapsed time", t => {
  const originals = { window: globalThis.window, localStorage: globalThis.localStorage };
  const stored = new Map(["one", "two"].map(id => [pocketStorageKey(id), JSON.stringify({ ...emptyPocketState(), wechatClock: clock() })]));
  globalThis.window = new EventTarget();
  globalThis.localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  const updates = [];
  const off = subscribePocketWechatClock("one", (clock, warning) => updates.push({ clock, warning }));
  const offOther = subscribePocketWechatClock("two", () => assert.fail("cross-session clock update"));
  t.after(() => { off(); offOther(); for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const main = [message("scene", "日期：6月6日\n时间：晚上8点")];
  syncPocketWechatClock("one", main, realStart);
  syncPocketWechatClock("one", main, realStart + hours(27));
  assert.equal(updates.length, 1);
  assert.equal(pocketWechatNow(JSON.parse(stored.get(pocketStorageKey("one"))).wechatClock, realStart + hours(27)), local(6, 7, 23));
  assert.equal(JSON.parse(stored.get(pocketStorageKey("two"))).wechatClock.storyTime, undefined);
  globalThis.localStorage.setItem = () => { throw new Error("quota"); };
  syncPocketWechatClock("one", [...main, message("new", "当前时间：6月8日早上9点")], realStart + hours(28));
  assert.equal(updates.at(-1).clock.storyTime, local(6, 8, 9));
  assert.match(updates.at(-1).warning, /暂未保存/);
  syncPocketWechatClock("never-opened", main, realStart);
  assert.equal(stored.has(pocketStorageKey("never-opened")), false);
});
