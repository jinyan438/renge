import { normalizePocketState, pocketStorageKey } from "./pocketPhoneState.ts";
import { ensurePocketWechatClock, stampPocketWechatTimes, updatePocketStoryClock, type PocketStoryMessage, type PocketWechatClock } from "./pocketWechatClock.ts";

const CLOCK_CHANGED = "renge:pocket-wechat-clock-changed";
type ClockEvent = { sessionId: string; clock: PocketWechatClock; storageWarning: string };

// The main chat owns story-time updates even while the phone is closed. It
// patches only the clock; an open phone keeps its drafts and generation state.
export function syncPocketWechatClock(sessionId: string, messages: PocketStoryMessage[], realNow = Date.now()) {
  if (!sessionId) return;
  let clock: PocketWechatClock | undefined; let storageWarning = "";
  try {
    const key = pocketStorageKey(sessionId); const saved = localStorage.getItem(key);
    if (!saved) return; // The independent calendar starts on first phone use.
    const state = normalizePocketState(JSON.parse(saved));
    const initialized = ensurePocketWechatClock(state, realNow);
    clock = updatePocketStoryClock(initialized.wechatClock!, messages, realNow);
    const next = stampPocketWechatTimes(clock === initialized.wechatClock ? initialized : { ...initialized, wechatClock: clock });
    if (next === state) return;
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    storageWarning = "手机存储空间不足或不可用，微信时间暂未保存。请保留当前页面。";
  }
  if (clock) window.dispatchEvent(new CustomEvent<ClockEvent>(CLOCK_CHANGED, { detail: { sessionId, clock, storageWarning } }));
}

export function subscribePocketWechatClock(sessionId: string, receive: (clock: PocketWechatClock, storageWarning: string) => void) {
  const target = window;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ClockEvent>).detail;
    if (detail.sessionId === sessionId) receive(detail.clock, detail.storageWarning);
  };
  target.addEventListener(CLOCK_CHANGED, listener);
  return () => target.removeEventListener(CLOCK_CHANGED, listener);
}
