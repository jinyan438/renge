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
export const CHAT_SCROLL_SETTLE_MS = 180;
export const CHAT_INPUT_SETTLE_MS = 420;
export const CHAT_SCROLL_ACTIVITY_MESSAGE = "renge-chat-scroll-activity";
const CHAT_MESSAGE_VIRTUALIZED_CLASS = "chat-message-virtualized";

/**
 * Keeps the newest message in normal layout while it can still grow, then
 * records its final height before enabling native offscreen rendering skips.
 */
export function createChatMessageVirtualizer(thread: HTMLElement) {
  if (
    typeof CSS === "undefined" ||
    typeof CSS.supports !== "function" ||
    !CSS.supports("content-visibility", "auto")
  ) {
    return () => undefined;
  }

  const pendingMessages = new Set<HTMLElement>();
  const observedMessages = new Set<HTMLElement>();
  let frameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const getLatestMessage = () => {
    const messages = thread.querySelectorAll<HTMLElement>(".chat-message");
    return messages.item(messages.length - 1);
  };

  const keepLatestMessageLive = () => {
    const latestMessage = getLatestMessage();
    if (!latestMessage) return null;
    pendingMessages.delete(latestMessage);
    resizeObserver?.unobserve(latestMessage);
    observedMessages.delete(latestMessage);
    latestMessage.classList.remove(CHAT_MESSAGE_VIRTUALIZED_CLASS);
    latestMessage.style.removeProperty("--chat-message-intrinsic-height");
    return latestMessage;
  };

  const flush = () => {
    frameId = null;
    const latestMessage = keepLatestMessageLive();
    const candidates = Array.from(pendingMessages).filter(
      (message) =>
        message !== latestMessage &&
        message.isConnected &&
        thread.contains(message) &&
        !message.classList.contains(CHAT_MESSAGE_VIRTUALIZED_CLASS),
    );
    pendingMessages.clear();

    // Read every height before writing styles so this costs one layout pass.
    const measurements = candidates.map((message) => ({
      message,
      height: message.getBoundingClientRect().height,
    }));
    measurements.forEach(({ message, height }) => {
      if (!Number.isFinite(height) || height <= 0) return;
      message.style.setProperty("--chat-message-intrinsic-height", `${height}px`);
      message.classList.add(CHAT_MESSAGE_VIRTUALIZED_CLASS);
      resizeObserver?.unobserve(message);
      observedMessages.delete(message);
    });
  };

  const schedule = () => {
    if (frameId !== null) return;
    frameId = window.requestAnimationFrame(flush);
  };

  resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          const latestMessage = getLatestMessage();
          entries.forEach((entry) => {
            const message = entry.target as HTMLElement;
            if (
              message !== latestMessage &&
              !message.classList.contains(CHAT_MESSAGE_VIRTUALIZED_CLASS)
            ) {
              pendingMessages.add(message);
            }
          });
          if (pendingMessages.size > 0) schedule();
        })
      : null;

  const observeMessage = (message: HTMLElement, latestMessage: HTMLElement | null) => {
    if (message === latestMessage) return;
    pendingMessages.add(message);
    if (!resizeObserver || observedMessages.has(message)) return;
    observedMessages.add(message);
    resizeObserver.observe(message);
  };

  const collect = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    const latestMessage = keepLatestMessageLive();
    if (node.matches(".chat-message")) observeMessage(node, latestMessage);
    node
      .querySelectorAll<HTMLElement>(`.chat-message:not(.${CHAT_MESSAGE_VIRTUALIZED_CLASS})`)
      .forEach((message) => observeMessage(message, latestMessage));
    if (pendingMessages.size > 0) schedule();
  };

  const release = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    const messages = [
      ...(node.matches(".chat-message") ? [node] : []),
      ...node.querySelectorAll<HTMLElement>(".chat-message"),
    ];
    messages.forEach((message) => {
      pendingMessages.delete(message);
      resizeObserver?.unobserve(message);
      observedMessages.delete(message);
    });
  };

  collect(thread);
  const observer =
    typeof MutationObserver === "function"
      ? new MutationObserver((records) => {
          records.forEach((record) => record.removedNodes.forEach(release));
          collect(thread);
        })
      : null;
  observer?.observe(thread, { childList: true });

  return () => {
    observer?.disconnect();
    resizeObserver?.disconnect();
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    frameId = null;
    pendingMessages.clear();
    observedMessages.clear();
  };
}

export function createChatScrollScheduler(options: {
  now?: () => number;
  settleMs?: number;
} = {}) {
  const now = options.now ?? (() => performance.now());
  const settleMs = options.settleMs ?? CHAT_SCROLL_SETTLE_MS;
  let scrollUntil = Number.NEGATIVE_INFINITY;

  return {
    markScrolling(durationMs = settleMs) {
      scrollUntil = Math.max(scrollUntil, now() + Math.max(0, durationMs));
    },
    isScrolling() {
      return now() < scrollUntil;
    },
    schedule(
      callback: () => void,
      schedule: ScheduleChatStreamFlush,
      delayMs = 0,
    ) {
      let cancelled = false;
      let cancelScheduled: (() => void) | null = null;
      const attempt = () => {
        cancelScheduled = null;
        if (cancelled) return;
        const remainingMs = scrollUntil - now();
        if (remainingMs > 0) {
          cancelScheduled = schedule(attempt, remainingMs);
          return;
        }
        callback();
      };
      cancelScheduled = schedule(attempt, delayMs);
      return () => {
        cancelled = true;
        cancelScheduled?.();
        cancelScheduled = null;
      };
    },
  };
}

export const chatScrollScheduler = createChatScrollScheduler();
const chatIdleActivityScheduler = createChatScrollScheduler();
const automaticScrollTargets = new WeakMap<HTMLElement, number>();

export function markChatInputActivity() {
  chatIdleActivityScheduler.markScrolling(CHAT_INPUT_SETTLE_MS);
}

export function scrollChatToLatest(thread: HTMLElement) {
  if (chatScrollScheduler.isScrolling()) return;
  const scrollTop = Math.max(0, thread.scrollHeight - thread.clientHeight);
  if (Math.abs(thread.scrollTop - scrollTop) < 1) return;
  automaticScrollTargets.set(thread, scrollTop);
  thread.scrollTop = scrollTop;
}

export function scheduleChatFrameWork(callback: () => void, delayMs = 0) {
  return chatScrollScheduler.schedule(callback, (attempt, delay) => {
    let frameId: number | null = null;
    const timerId = window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        frameId = window.requestAnimationFrame(attempt);
      } else {
        attempt();
      }
    }, delay);
    return () => {
      window.clearTimeout(timerId);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, delayMs);
}

export function observeChatScrollActivity(thread: HTMLElement) {
  let scrollEndTimer: number | null = null;
  const notifyPreviews = (scrolling: boolean) => {
    thread.querySelectorAll<HTMLIFrameElement>(".chat-html-preview iframe").forEach((frame) => {
      frame.contentWindow?.postMessage({ type: CHAT_SCROLL_ACTIVITY_MESSAGE, scrolling }, "*");
    });
  };
  const markScrolling = () => {
    automaticScrollTargets.delete(thread);
    chatScrollScheduler.markScrolling();
    chatIdleActivityScheduler.markScrolling();
    if (scrollEndTimer === null) notifyPreviews(true);
    else window.clearTimeout(scrollEndTimer);
    scrollEndTimer = window.setTimeout(() => {
      scrollEndTimer = null;
      notifyPreviews(false);
    }, CHAT_SCROLL_SETTLE_MS);
  };
  const handleScroll = () => {
    const automaticTarget = automaticScrollTargets.get(thread);
    if (automaticTarget !== undefined && Math.abs(thread.scrollTop - automaticTarget) < 1) return;
    automaticScrollTargets.delete(thread);
    markScrolling();
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (event.buttons === 1) markScrolling();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest("input, textarea, select"))
    ) return;
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
      markScrolling();
    }
  };

  thread.addEventListener("wheel", markScrolling, { passive: true });
  thread.addEventListener("touchmove", markScrolling, { passive: true });
  thread.addEventListener("pointerdown", markScrolling, { passive: true });
  thread.addEventListener("pointermove", handlePointerMove, { passive: true });
  thread.addEventListener("keydown", handleKeyDown);
  thread.addEventListener("scroll", handleScroll, { passive: true });
  return () => {
    automaticScrollTargets.delete(thread);
    if (scrollEndTimer !== null) {
      window.clearTimeout(scrollEndTimer);
      notifyPreviews(false);
    }
    thread.removeEventListener("wheel", markScrolling);
    thread.removeEventListener("touchmove", markScrolling);
    thread.removeEventListener("pointerdown", markScrolling);
    thread.removeEventListener("pointermove", handlePointerMove);
    thread.removeEventListener("keydown", handleKeyDown);
    thread.removeEventListener("scroll", handleScroll);
  };
}

export function scheduleChatIdleWork(
  callback: () => void,
  delayMs = 0,
  timeoutMs = 1200,
) {
  return chatIdleActivityScheduler.schedule(callback, (attempt, delay) => {
    let idleId: number | null = null;
    const timerId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(attempt, { timeout: timeoutMs });
      } else {
        attempt();
      }
    }, delay);
    return () => {
      window.clearTimeout(timerId);
      if (idleId !== null) window.cancelIdleCallback(idleId);
    };
  }, delayMs);
}

export function createChatPreviewMountQueue(
  schedule: ScheduleChatStreamFlush = scheduleChatIdleWork,
) {
  type MountTask = { mount: () => void; gapMs: number; cancelled: boolean };
  const tasks: MountTask[] = [];
  let activeTask: MountTask | null = null;
  let cancelScheduled: (() => void) | null = null;
  let coolingDown = false;

  const drain = () => {
    if (activeTask || coolingDown) return;
    while (tasks[0]?.cancelled) tasks.shift();
    const task = tasks.shift();
    if (!task) return;
    activeTask = task;
    cancelScheduled = schedule(() => {
      cancelScheduled = null;
      activeTask = null;
      coolingDown = true;
      try {
        if (!task.cancelled) task.mount();
      } finally {
        cancelScheduled = schedule(() => {
          cancelScheduled = null;
          coolingDown = false;
          drain();
        }, task.gapMs);
      }
    }, 0);
  };

  return {
    enqueue(mount: () => void, gapMs = 120) {
      const task: MountTask = { mount, gapMs, cancelled: false };
      tasks.push(task);
      drain();
      return () => {
        task.cancelled = true;
        if (activeTask !== task) return;
        cancelScheduled?.();
        cancelScheduled = null;
        activeTask = null;
        drain();
      };
    },
  };
}

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
  const schedule = options.schedule ?? scheduleChatFrameWork;
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
