import type { PocketMessage, PocketState } from "./pocketPhoneState.ts";

// Real timestamps remain available for storage ordering. This clock and each
// message's saved WeChat time describe the fictional calendar shown in the UI.
export type PocketWechatClock = {
  initialTime: string;
  initialRealTime: number;
  storyTime?: string;
  storyRealTime?: number;
  storyKey?: string;
};
export type PocketStoryMessage = { id: string; content: string; source?: string; outputStatus?: string; extra?: Record<string, unknown> };
const validTime = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

export function normalizePocketWechatClock(value: unknown): PocketWechatClock | undefined {
  if (!value || typeof value !== "object") return;
  const clock = value as Record<string, unknown>;
  if (!validTime(clock.initialTime) || typeof clock.initialRealTime !== "number" || !Number.isFinite(clock.initialRealTime)) return;
  return { initialTime: clock.initialTime, initialRealTime: clock.initialRealTime,
    ...(validTime(clock.storyTime) && typeof clock.storyRealTime === "number" && Number.isFinite(clock.storyRealTime) && typeof clock.storyKey === "string"
      ? { storyTime: clock.storyTime, storyRealTime: clock.storyRealTime, storyKey: clock.storyKey } : {}),
  };
}

export function createPocketWechatClock(realNow = Date.now(), random = Math.random): PocketWechatClock {
  // The seed calendar never reads the system date. Year 2000 is an internal
  // calendar base; no year is invented in the displayed date or model prompt.
  const initial = new Date(2000, Math.floor(random() * 12), 1 + Math.floor(random() * 28), Math.floor(random() * 24), Math.floor(random() * 60));
  return { initialTime: initial.toISOString(), initialRealTime: realNow };
}

export function pocketWechatNow(clock: PocketWechatClock, realNow = Date.now()): string {
  const anchor = clock.storyTime || clock.initialTime;
  const realAnchor = clock.storyRealTime ?? clock.initialRealTime;
  return new Date(Date.parse(anchor) + realNow - realAnchor).toISOString();
}

const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const numberPattern = "[0-9零〇一二两三四五六七八九十百]+";
function chineseNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  if (value.includes("百")) { const [a, b] = value.split("百"); return (chineseNumber(a) || 1) * 100 + (b ? chineseNumber(b) : 0); }
  if (value.includes("十")) { const [a, b] = value.split("十"); return (a ? digits[a] : 1) * 10 + (b ? digits[b] : 0); }
  return [...value].reduce((result, char) => result * 10 + digits[char], 0);
}

// Only present scene narration and labelled dates calibrate the clock. Plans,
// memories, quoted dialogue, reasoning, and code must not move the calendar.
export function parsePocketStoryTime(content: string, base: string): string | undefined {
  const body = content.replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/"((?:当前)?(?:时间|日期)|date|time)"\s*:\s*"([^"\n]+)"/gi, "$1：$2")
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "").replace(/[“「『][^”」』]*[”」』]|"[^"\n]*"/g, "")
    .replace(/<[^>]*>/g, " ");
  let current = new Date(base); let found = false;
  for (const clause of body.split(/[\n。！？!?；;，]/)) {
    if (!clause.trim() || /(?:明天|后天|昨天|前天|上次|去年|回忆|记得|约好|约定|打算|计划|准备在|将于|预计|如果|假如|比如|例如|现实(?:世界)?(?:时间)?)/.test(clause)) continue;
    const date = clause.match(new RegExp(`(?:(\\d{4})年)?(${numberPattern})月(${numberPattern})[日号]`))
      || clause.match(/(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})(?!\d)/);
    const dayJump = /(?:第二天|次日|翌日|隔天)/.test(clause);
    const relative = clause.match(new RegExp(`(?:过了|经过|又过了)\\s*(${numberPattern}|半|一个)\\s*(?:个)?(分钟|小时|天)`))
      || clause.match(new RegExp(`(${numberPattern}|半|一个)\\s*(?:个)?(分钟|小时|天)(?:之)?后`));
    const time = clause.match(new RegExp(`(?:(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|夜晚|深夜)\\s*)?(${numberPattern})(?:[:：]([0-9]{2})|[点时](?:((?!一刻|三刻)${numberPattern})分?|(半|一刻|三刻))?)`));
    if (!date && !dayJump && !relative && !time) continue;
    if (date && !time && !dayJump && !relative && !/(?:日期|时间|今天|当前|现在|到了|来到|date|time)/i.test(clause) && !/^\s*[*_#\s]*(?:\d{4}[-/年])?[0-9零〇一二两三四五六七八九十]+(?:月|[-/])/.test(clause)) continue;
    if (!/(?:当前|现在|已经|到了|时间|日期)/.test(clause) && /(?:[点时](?:半|\d+分)?见|约在|定在|将在|会在)/.test(clause)) continue;
    if (!date && !dayJump && !relative && !/(?:时间|时刻|日期|当前|现在|已经|到了|来到|时针|钟表|\d{1,2}[:：]\d{2})/.test(clause) && !/^\s*(?:[*_#\s]|[📅🕒⏰])*(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|夜晚|深夜)/u.test(clause)) continue;
    const next = new Date(current);
    if (date) {
      const year = date[1] ? Number(date[1]) : current.getFullYear();
      const month = chineseNumber(date[2]); const day = chineseNumber(date[3]);
      if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) continue;
      next.setFullYear(year, month - 1, day);
      if (next.getMonth() !== month - 1 || next.getDate() !== day) continue;
    } else if (dayJump) next.setDate(next.getDate() + 1);
    if (relative && !dayJump) {
      const amount = relative[1] === "半" ? 0.5 : relative[1] === "一个" ? 1 : chineseNumber(relative[1]);
      next.setTime(next.getTime() + amount * (relative[2] === "天" ? 86400000 : relative[2] === "小时" ? 3600000 : 60000));
    }
    if (time) {
      let hour = chineseNumber(time[2]);
      const minute = time[3] ? Number(time[3]) : time[4] ? chineseNumber(time[4]) : time[5] === "半" ? 30 : time[5] === "一刻" ? 15 : time[5] === "三刻" ? 45 : 0;
      if (hour > 23 || minute > 59) continue;
      if (/下午|傍晚|晚上|夜里|夜晚|深夜/.test(time[1] || "") && hour < 12) hour += 12;
      if (/凌晨|清晨|早上|上午/.test(time[1] || "") && hour === 12) hour = 0;
      if (/晚上|夜里|夜晚|深夜/.test(time[1] || "") && hour === 12) hour = 0;
      if (time[1] === "中午" && hour < 11) hour += 12;
      next.setHours(hour, minute, 0, 0);
    }
    current = next; found = true;
  }
  return found ? current.toISOString() : undefined;
}

export function updatePocketStoryClock(clock: PocketWechatClock, messages: PocketStoryMessage[], realNow = Date.now()): PocketWechatClock {
  let storyTime = clock.initialTime; let storyKey: string | undefined;
  for (const message of messages) {
    if (["wechat", "xiaohongshu", "notes", "moments"].includes(message.source || "") || message.outputStatus === "running" || message.extra?.tavernIsHidden || message.extra?.tavernIsSystem) continue;
    const parsed = parsePocketStoryTime(message.content, storyTime);
    if (!parsed) continue;
    storyTime = parsed; storyKey = JSON.stringify([message.id, parsed]);
  }
  // Re-reading the same scene never restarts elapsed time. Editing or deleting
  // the last time-bearing message recalculates from the remaining main body.
  if (storyKey === clock.storyKey) return clock;
  return { initialTime: clock.initialTime, initialRealTime: clock.initialRealTime,
    ...(storyKey ? { storyTime, storyKey, storyRealTime: realNow } : {}),
  };
}

export function ensurePocketWechatClock(state: PocketState, realNow = Date.now()): PocketState {
  return state.wechatClock ? state : { ...state, wechatClock: createPocketWechatClock(realNow) };
}

export function stampPocketWechatTimes(state: PocketState): PocketState {
  const clock = state.wechatClock;
  if (!clock) return state;
  const stamp = <T extends { createdAt: string; wechatTime?: string }>(item: T): T => item.wechatTime ? item : {
    ...item, wechatTime: pocketWechatNow(clock, Number.isFinite(Date.parse(item.createdAt)) ? Date.parse(item.createdAt) : clock.storyRealTime ?? clock.initialRealTime),
  };
  const stampConversation = <T extends { messages: PocketMessage[] }>(contact: T): T => {
    const messages = contact.messages.map(stamp);
    return messages.some((message, index) => message !== contact.messages[index]) ? { ...contact, messages } : contact;
  };
  const stampWallet = (wallet: PocketState["wallet"]) => {
    const bills = wallet.bills.map(stamp);
    return bills.some((bill, index) => bill !== wallet.bills[index]) ? { ...wallet, bills } : wallet;
  };
  const contacts = state.contacts.map(contact => contact.app === "xiaohongshu" ? contact : stampConversation(contact));
  const groups = state.groups.map(stampConversation); const wallet = stampWallet(state.wallet);
  let changed = wallet !== state.wallet || contacts.some((contact, index) => contact !== state.contacts[index]) || groups.some((group, index) => group !== state.groups[index]);
  const characterPhones = state.characterPhones ? Object.fromEntries(Object.entries(state.characterPhones).map(([id, phone]) => {
    const contacts = phone.contacts.map(stampConversation); const groups = phone.groups.map(stampConversation); const wallet = stampWallet(phone.wallet);
    if (wallet === phone.wallet && contacts.every((contact, index) => contact === phone.contacts[index]) && groups.every((group, index) => group === phone.groups[index])) return [id, phone];
    changed = true; return [id, { ...phone, contacts, groups, wallet }];
  })) : undefined;
  return changed ? { ...state, contacts, groups, wallet, ...(characterPhones ? { characterPhones } : {}) } : state;
}

export function pocketWechatMessageTime(message: Pick<PocketMessage, "createdAt" | "wechatTime">): string { return message.wechatTime || message.createdAt; }
export function formatPocketWechatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
export function pocketWechatTimePrompt(clock: PocketWechatClock, realNow = Date.now()): string {
  return `【微信时间变量】\n当前微信时间：${formatPocketWechatTime(pocketWechatNow(clock, realNow))}。这是独立于现实日期的剧情时间；无正文更新时按现实经过的时长等速推进，主会话正文的最新明确时间或时间流逝始终优先。过去的时间、未来约定和聊天中提到的日期不代表当前时间，不使用现实系统日期，不在气泡中报告这项应用规则。`;
}
