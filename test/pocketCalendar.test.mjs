import assert from "node:assert/strict";
import test from "node:test";
import { formatPocketCalendarTime, jumpPocketCalendarClock, parsePocketCalendarTime, pocketCalendarFields, pocketCalendarMonth, shiftPocketCalendarMonth, syncPocketCalendarContext } from "../src/pocketCalendarState.ts";
import { buildPocketHistoryMessage, pocketContextRevision, syncPocketContext } from "../src/pocketPhoneContext.ts";
import { emptyPocketState, makePocketContact, normalizePocketState } from "../src/pocketPhoneState.ts";
import { pocketWechatNow, stampPocketWechatTimes, updatePocketStoryClock } from "../src/pocketWechatClock.ts";

const realStart = Date.UTC(2026, 9, 8, 6);
const clock = () => ({ initialTime: new Date(2000, 5, 6, 20).toISOString(), initialRealTime: realStart });
const jump = (id, date, time, offset = 0) => ({ id, time: parsePocketCalendarTime(date, time), createdAt: new Date(realStart + offset).toISOString() });

test("calendar fields preserve year, month, day, hour and minute, including leap days and years below 100", () => {
  const time = parsePocketCalendarTime("2031-02-28", "23:45");
  assert.deepEqual(pocketCalendarFields(time), { date: "2031-02-28", time: "23:45" });
  assert.equal(formatPocketCalendarTime(time), "2031年2月28日 23:45");
  assert.equal(pocketCalendarFields(parsePocketCalendarTime("0001-01-01", "00:00")).date, "0001-01-01");
  assert.ok(parsePocketCalendarTime("2000-02-29", "12:30"));
  for (const [date, time] of [["1900-02-29", "09:00"], ["2031-04-31", "09:00"], ["2031-00-01", "09:00"], ["0000-01-01", "09:00"], ["2031-02-28", "24:00"], ["2031-02-28", "12:60"], ["", ""], ["2031-02-28", "09:30:10"]]) assert.equal(parsePocketCalendarTime(date, time), undefined);
});

test("calendar browsing respects month lengths, leap years, Monday-first weeks and year boundaries", () => {
  assert.equal(shiftPocketCalendarMonth("2031-01-31", 1), "2031-02-28");
  assert.equal(shiftPocketCalendarMonth("2032-01-31", 1), "2032-02-29");
  assert.equal(shiftPocketCalendarMonth("2031-12-31", 1), "2032-01-31");
  assert.equal(shiftPocketCalendarMonth("2031-01-31", -1), "2030-12-31");
  assert.equal(shiftPocketCalendarMonth("0001-01-01", -1), undefined);
  assert.equal(shiftPocketCalendarMonth("9999-12-01", 1), undefined);
  assert.deepEqual(pocketCalendarMonth("2026-06-06"), { year: 2026, month: 6, selectedDay: 6, days: 30, offset: 0 });
});

test("jumping inserts one app context record without adding contact messages or altering previous history", () => {
  const contact = makePocketContact({ name: "奶糖", personality: "朋友", avatar: "/touxiang/9.png", greeting: "", sourceLabel: "自定义角色" });
  contact.messages = [{ id: "old", role: "user", content: "原消息", createdAt: new Date(realStart).toISOString() }];
  const state = stampPocketWechatTimes({ ...emptyPocketState(), contacts: [contact], wechatClock: clock() });
  const history = syncPocketContext([{ id: "scene", role: "assistant", content: "当前时间：6月6日晚上8点。", createdAt: new Date(realStart).toISOString() }], null, state.contacts, "小月");
  const event = jump("calendar:one", "2031-02-28", "23:45");
  const updated = syncPocketCalendarContext(history, event);
  assert.deepEqual(updated.slice(0, -1), history);
  assert.equal(updated.at(-1).source, "calendar");
  assert.match(updated.at(-1).content, /当前剧情时间：2031年2月28日 23:45/);
  assert.equal(syncPocketCalendarContext(updated, event), updated);
  assert.notEqual(pocketContextRevision(updated), pocketContextRevision(history));
  assert.match(buildPocketHistoryMessage(updated.at(-1), contact.id).content, /日历.*时间更新/);
  const next = stampPocketWechatTimes({ ...state, wechatClock: jumpPocketCalendarClock(state.wechatClock, event) });
  assert.equal(next.contacts[0].messages, state.contacts[0].messages);
  assert.deepEqual(normalizePocketState(JSON.parse(JSON.stringify(next))).wechatClock, next.wechatClock);
  assert.equal(syncPocketContext(updated, state.contacts, next.contacts, "小月"), updated);
});

test("calendar anchors survive repeated sync and real elapsed time, while later body updates take priority", () => {
  const before = { id: "before", role: "assistant", content: "当前时间：6月6日晚上8点。", createdAt: new Date(realStart).toISOString() };
  const event = jump("calendar:future", "2031-02-28", "23:45");
  const history = syncPocketCalendarContext([before], event);
  const selected = jumpPocketCalendarClock(clock(), event);
  assert.equal(updatePocketStoryClock(selected, history, realStart + 3600000), selected);
  assert.deepEqual(pocketCalendarFields(pocketWechatNow(selected, realStart + 3600000)), { date: "2031-03-01", time: "00:45" });
  const next = updatePocketStoryClock(selected, [...history, { id: "after", content: "次日早上九点。" }], realStart + 7200000);
  assert.deepEqual(pocketCalendarFields(next.storyTime), { date: "2031-03-01", time: "09:00" });
  const edited = updatePocketStoryClock(selected, history.map(message => message.id === event.id ? { ...message, content: "当前时间：2032年4月1日 12:30" } : message), realStart + 7200000);
  assert.deepEqual(pocketCalendarFields(edited.storyTime), { date: "2032-04-01", time: "12:30" });
  const deleted = updatePocketStoryClock(selected, [before], realStart + 7200000);
  assert.deepEqual(pocketCalendarFields(deleted.storyTime), { date: "2000-06-06", time: "20:00" });
});

test("backward jumps reset the current anchor and invalid calendar updates fail before injection", () => {
  const first = jumpPocketCalendarClock(clock(), jump("future", "2031-01-01", "20:00"));
  const second = jump("past", "1999-12-31", "23:30", 3600000);
  const returned = jumpPocketCalendarClock(first, second);
  assert.deepEqual(pocketCalendarFields(pocketWechatNow(returned, realStart + 5400000)), { date: "2000-01-01", time: "00:00" });
  assert.throws(() => syncPocketCalendarContext([], { id: "bad", time: "invalid", createdAt: second.createdAt }), /有效/);
  assert.throws(() => jumpPocketCalendarClock(first, { ...second, id: "" }), /有效/);
});
