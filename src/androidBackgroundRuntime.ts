type AndroidBackgroundTimerBridge = {
  scheduleBackgroundTimer?(timerId: number, delayMs: number, repeating: boolean): void;
  cancelBackgroundTimer?(timerId: number): void;
};

type BackgroundTimerWindow = Window & {
  eval(source: string): unknown;
  RengeAndroidNative?: AndroidBackgroundTimerBridge;
  __rengeAndroidBackgroundTimersInstalled?: boolean;
  __rengeDispatchBackgroundTimer?: (timerId: number) => void;
};

type NativeTimerEntry = {
  callback: (...args: unknown[]) => unknown;
  args: unknown[];
  repeating: boolean;
};

const MAX_TIMER_DELAY = 2_147_483_647;
const HIDDEN_FRAME_DELAY = 16;
const MIN_INTERVAL_DELAY = 4;

function normalizeDelay(timeout: number | undefined, repeating: boolean) {
  const value = Number(timeout);
  if (!Number.isFinite(value)) return repeating ? MIN_INTERVAL_DELAY : 0;
  const normalized = Math.max(0, Math.min(MAX_TIMER_DELAY, Math.trunc(value)));
  return repeating ? Math.max(MIN_INTERVAL_DELAY, normalized) : normalized;
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

/**
 * WebView throttles timers and animation frames in a hidden Activity. Android
 * schedules these callbacks on its main Handler and dispatches them back into
 * the page through evaluateJavascript.
 */
export function installAndroidBackgroundTimerShim(host: BackgroundTimerWindow = window) {
  const bridge = host.RengeAndroidNative;
  if (
    host.__rengeAndroidBackgroundTimersInstalled ||
    !bridge?.scheduleBackgroundTimer ||
    !bridge.cancelBackgroundTimer
  ) {
    return false;
  }

  const originalSetTimeout = host.setTimeout.bind(host);
  const originalClearTimeout = host.clearTimeout.bind(host);
  const originalSetInterval = host.setInterval.bind(host);
  const originalClearInterval = host.clearInterval.bind(host);
  const originalRequestAnimationFrame = host.requestAnimationFrame?.bind(host);
  const originalCancelAnimationFrame = host.cancelAnimationFrame?.bind(host);
  const timers = new Map<number, NativeTimerEntry>();
  let nextTimerId = -1;

  const allocateTimerId = () => {
    while (timers.has(nextTimerId)) {
      nextTimerId -= 1;
      if (nextTimerId <= -MAX_TIMER_DELAY) nextTimerId = -1;
    }
    const timerId = nextTimerId;
    nextTimerId -= 1;
    if (nextTimerId <= -MAX_TIMER_DELAY) nextTimerId = -1;
    return timerId;
  };

  const cancelNativeTimer = (timerId: number) => {
    if (!timers.delete(timerId)) return false;
    bridge.cancelBackgroundTimer!(timerId);
    return true;
  };

  const scheduleNativeTimer = (
    handler: TimerHandler,
    timeout: number | undefined,
    repeating: boolean,
    args: unknown[],
  ) => {
    const callback = isCallable(handler) ? handler : () => host.eval(String(handler));
    const timerId = allocateTimerId();
    timers.set(timerId, { callback, args, repeating });
    try {
      bridge.scheduleBackgroundTimer!(timerId, normalizeDelay(timeout, repeating), repeating);
      return timerId;
    } catch {
      timers.delete(timerId);
      return repeating
        ? originalSetInterval(handler, timeout, ...args)
        : originalSetTimeout(handler, timeout, ...args);
    }
  };

  host.__rengeDispatchBackgroundTimer = (timerId) => {
    const entry = timers.get(timerId);
    if (!entry) return;
    if (!entry.repeating) timers.delete(timerId);
    try {
      entry.callback(...entry.args);
    } catch (error) {
      originalSetTimeout(() => {
        throw error;
      }, 0);
    }
  };

  host.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
    scheduleNativeTimer(handler, timeout, false, args)) as typeof host.setTimeout;
  host.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
    scheduleNativeTimer(handler, timeout, true, args)) as typeof host.setInterval;
  host.clearTimeout = ((timerId?: number) => {
    if (typeof timerId === "number" && cancelNativeTimer(timerId)) return;
    originalClearTimeout(timerId);
  }) as typeof host.clearTimeout;
  host.clearInterval = ((timerId?: number) => {
    if (typeof timerId === "number" && cancelNativeTimer(timerId)) return;
    originalClearInterval(timerId);
  }) as typeof host.clearInterval;

  if (originalRequestAnimationFrame && originalCancelAnimationFrame) {
    host.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      if (host.document.visibilityState !== "hidden") {
        return originalRequestAnimationFrame(callback);
      }
      return scheduleNativeTimer(
        () => callback(host.performance.now()),
        HIDDEN_FRAME_DELAY,
        false,
        [],
      );
    }) as typeof host.requestAnimationFrame;
    host.cancelAnimationFrame = ((timerId: number) => {
      if (cancelNativeTimer(timerId)) return;
      originalCancelAnimationFrame(timerId);
    }) as typeof host.cancelAnimationFrame;
  }

  host.__rengeAndroidBackgroundTimersInstalled = true;
  return true;
}
