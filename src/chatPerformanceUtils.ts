export type ChatStreamUpdate = {
  content: string;
  reasoning: string;
};

type ScheduleChatStreamFlush = (
  callback: () => void,
  delayMs: number,
) => () => void;

export const CHAT_STREAM_RENDER_INTERVAL_MS = 32;
export const ROLEPLAY_CHAT_STREAM_RENDER_INTERVAL_MS = 80;

function defaultScheduleChatStreamFlush(callback: () => void, delayMs: number) {
  let frameId: number | null = null;
  const timerId = window.setTimeout(() => {
    if (document.visibilityState === "visible") {
      frameId = window.requestAnimationFrame(callback);
      return;
    }
    callback();
  }, delayMs);

  return () => {
    window.clearTimeout(timerId);
    if (frameId !== null) window.cancelAnimationFrame(frameId);
  };
}

/**
 * Coalesces provider fragments into a single UI update. The final text is never
 * delayed: callers flush before completing a message or changing its mode.
 */
export function createChatStreamUpdateBatcher(options: {
  apply: (update: ChatStreamUpdate) => void;
  intervalMs?: number;
  now?: () => number;
  schedule?: ScheduleChatStreamFlush;
  signal?: AbortSignal;
}) {
  const intervalMs = Math.max(0, options.intervalMs ?? CHAT_STREAM_RENDER_INTERVAL_MS);
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? defaultScheduleChatStreamFlush;
  let pendingContent = "";
  let pendingReasoning = "";
  let lastFlushedAt = Number.NEGATIVE_INFINITY;
  let cancelScheduled: (() => void) | null = null;
  let cancelled = false;

  const flush = () => {
    if (cancelled) return;
    cancelScheduled?.();
    cancelScheduled = null;
    if (!pendingContent && !pendingReasoning) return;

    const update = {
      content: pendingContent,
      reasoning: pendingReasoning,
    };
    pendingContent = "";
    pendingReasoning = "";
    lastFlushedAt = now();
    options.apply(update);
  };

  const requestFlush = () => {
    if (cancelled || cancelScheduled) return;
    const delayMs = Math.max(0, intervalMs - (now() - lastFlushedAt));
    cancelScheduled = schedule(() => {
      cancelScheduled = null;
      flush();
    }, delayMs);
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    cancelScheduled?.();
    cancelScheduled = null;
    pendingContent = "";
    pendingReasoning = "";
    options.signal?.removeEventListener("abort", cancel);
  };

  options.signal?.addEventListener("abort", cancel, { once: true });

  return {
    pushContent(delta: string) {
      if (!delta || cancelled) return;
      pendingContent += delta;
      requestFlush();
    },
    pushReasoning(delta: string) {
      if (!delta || cancelled) return;
      pendingReasoning += delta;
      requestFlush();
    },
    flush() {
      flush();
      options.signal?.removeEventListener("abort", cancel);
    },
    cancel,
  };
}
