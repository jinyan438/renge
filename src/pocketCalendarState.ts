import type { PocketContextMessage } from "./pocketPhoneContext.ts";
import type { PocketWechatClock } from "./pocketWechatClock.ts";

export type PocketCalendarJump = { id: string; time: string; createdAt: string };
const pad = (value: number, size = 2) => String(value).padStart(size, "0");

export function pocketCalendarFields(time: string): { date: string; time: string } {
  const date = new Date(time);
  return { date: `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}

export function parsePocketCalendarTime(date: string, time: string): string | undefined {
  const day = date.match(/^(\d{4})-(\d{2})-(\d{2})$/); const hour = time.match(/^(\d{2}):(\d{2})$/);
  if (!day || !hour) return;
  const [year, month, dateNumber] = day.slice(1).map(Number); const [hours, minutes] = hour.slice(1).map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || dateNumber < 1 || dateNumber > 31 || hours > 23 || minutes > 59) return;
  const result = new Date(0); result.setFullYear(year, month - 1, dateNumber); result.setHours(hours, minutes, 0, 0);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== dateNumber || result.getHours() !== hours || result.getMinutes() !== minutes) return;
  return result.toISOString();
}

export function pocketCalendarMonth(date: string) {
  const parsed = parsePocketCalendarTime(date, "00:00");
  if (!parsed) return;
  const current = new Date(parsed); const year = current.getFullYear(); const month = current.getMonth();
  const last = new Date(current); last.setMonth(month + 1, 0);
  const first = new Date(current); first.setDate(1);
  return { year, month: month + 1, selectedDay: current.getDate(), days: last.getDate(), offset: (first.getDay() + 6) % 7 };
}

export function shiftPocketCalendarMonth(date: string, offset: number): string | undefined {
  const parsed = parsePocketCalendarTime(date, "00:00");
  if (!parsed) return;
  const current = new Date(parsed); const day = current.getDate();
  current.setDate(1); current.setMonth(current.getMonth() + offset);
  if (current.getFullYear() < 1 || current.getFullYear() > 9999) return;
  const last = new Date(current); last.setMonth(last.getMonth() + 1, 0);
  current.setDate(Math.min(day, last.getDate()));
  return pocketCalendarFields(current.toISOString()).date;
}

export function formatPocketCalendarTime(time: string): string {
  const date = new Date(time);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function jumpPocketCalendarClock(clock: PocketWechatClock, jump: PocketCalendarJump): PocketWechatClock {
  const realTime = Date.parse(jump.createdAt);
  if (!jump.id || !Number.isFinite(Date.parse(jump.time)) || !Number.isFinite(realTime)) throw new Error("请选择有效的日期和时间。");
  return { ...clock, storyTime: jump.time, storyRealTime: realTime, storyKey: JSON.stringify([jump.id, jump.time]) };
}

// Calendar updates are app context records in the main timeline. They are never
// saved as contact messages, and their source survives session export/reload.
export function syncPocketCalendarContext<T extends PocketContextMessage>(history: T[], jump?: PocketCalendarJump): Array<T | PocketContextMessage> {
  if (!jump || history.some(message => message.id === jump.id)) return history;
  jumpPocketCalendarClock({ initialTime: jump.time, initialRealTime: Date.parse(jump.createdAt) }, jump);
  return [...history, { id: jump.id, role: "user", source: "calendar", createdAt: jump.createdAt,
    content: `【日历 · 时间更新】\n当前剧情时间：${formatPocketCalendarTime(jump.time)}。\n这是用户在日历中设置的时间节点，请以此作为当前时间继续会话。`,
  }];
}
