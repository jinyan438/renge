type PiStreamEventQueueOptions<Event> = {
  dispatch: (event: Event) => void | Promise<void>;
  shouldPaintAfter: (event: Event) => boolean;
  waitForPaint: () => Promise<void>;
  mergePending?: (previous: Event, next: Event) => Event | undefined;
  signal?: AbortSignal;
};

type ToolCallDeltaEvent = {
  type: string;
  delta?: string;
  argumentsText?: string;
  toolCallId?: string;
};

type PiStreamRenderEvent<Event> =
  | { kind: "pi"; event: Event }
  | { kind: "content"; delta: string }
  | { kind: "reasoning"; delta: string };

export const PI_TOOL_PROGRESS_INTERVAL_MS = 100;

function mergeToolProgress<Event extends ToolCallDeltaEvent>(previous: Event, next: Event): Event | undefined {
  if (!previous.toolCallId || previous.toolCallId !== next.toolCallId || previous.type !== next.type) return undefined;
  // tool_update carries a complete result snapshot, not an output fragment.
  if (next.type === "tool_update") return next;
  if (next.type !== "tool_call_delta") return undefined;
  const argumentsText = next.argumentsText ?? (
    previous.argumentsText === undefined ? undefined : previous.argumentsText + (next.delta ?? "")
  );
  return {
    ...previous, ...next,
    delta: (previous.delta ?? "") + (next.delta ?? ""),
    ...(argumentsText === undefined ? {} : { argumentsText }),
  };
}

function scheduleToolProgress(callback: () => void, delayMs: number) {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

export function createPiStreamEventQueue<Event>({
  dispatch,
  shouldPaintAfter,
  waitForPaint,
  mergePending,
  signal,
}: PiStreamEventQueueOptions<Event>) {
  const pending: Event[] = [];
  let head = 0;
  let activeDrain: Promise<void> | null = null;
  let failure: unknown;
  let failed = false;
  let cancelled = signal?.aborted ?? false;

  const cancel = () => {
    cancelled = true;
    pending.length = 0;
    head = 0;
    signal?.removeEventListener("abort", cancel);
  };
  if (!cancelled) signal?.addEventListener("abort", cancel, { once: true });

  const drain = async () => {
    try {
      while (!cancelled && head < pending.length) {
        const event = pending[head++];
        await dispatch(event);
        // Catch up to the wire before yielding for animation. In particular,
        // execution/completion events must not sit behind an argument replay.
        if (!cancelled && head === pending.length) {
          pending.length = 0;
          head = 0;
          if (shouldPaintAfter(event)) await waitForPaint();
        }
      }
    } catch (error) {
      failed = true;
      failure = error;
      cancel();
    }
  };

  const ensureDrain = () => {
    if (activeDrain || failed || cancelled || head === pending.length) return;
    // Batch fragments received in the same network read before parsing or
    // rendering the growing argument string.
    activeDrain = Promise.resolve().then(drain).finally(() => {
      activeDrain = null;
      ensureDrain();
    });
  };

  return {
    enqueue(event: Event) {
      if (failed || cancelled) return;
      const lastIndex = pending.length - 1;
      const merged = lastIndex >= head
        ? mergePending?.(pending[lastIndex], event)
        : undefined;
      if (merged !== undefined) pending[lastIndex] = merged;
      else pending.push(event);
      ensureDrain();
    },
    cancel,
    async waitForIdle() {
      while (activeDrain) await activeDrain;
      if (failed) throw failure;
    },
  };
}

/**
 * Serializes every render-affecting stream event in wire order.
 *
 * Pi tool events can pause for a paint while text frames keep arriving. If
 * text is rendered outside this queue, that later text overtakes the tool and
 * the tool bubble is appended after the final answer instead of at its source
 * position.
 * Adjacent fragments for the same tool are merged, and buffered output is
 * drained without artificial character pacing so the UI follows execution.
 */
export function createPiStreamRenderQueue<Event extends ToolCallDeltaEvent>({
  dispatchPiEvent,
  dispatchContent,
  dispatchReasoning,
  waitForPaint,
  signal,
  scheduleProgress = scheduleToolProgress,
}: {
  dispatchPiEvent: (event: Event) => void | Promise<void>;
  dispatchContent: (delta: string) => void;
  dispatchReasoning: (delta: string) => void;
  waitForPaint: () => Promise<void>;
  signal?: AbortSignal;
  scheduleProgress?: (callback: () => void, delayMs: number) => () => void;
}) {
  const queue = createPiStreamEventQueue<PiStreamRenderEvent<Event>>({
    dispatch(item) {
      if (item.kind === "pi") return dispatchPiEvent(item.event);
      if (item.kind === "content") dispatchContent(item.delta);
      else dispatchReasoning(item.delta);
    },
    shouldPaintAfter: (item) =>
      item.kind === "pi" &&
      ["tool_call_start", "tool_call_delta", "tool_start"].includes(item.event.type),
    mergePending(previous, next) {
      if (previous.kind === "content" && next.kind === "content") {
        return { kind: "content", delta: previous.delta + next.delta };
      }
      if (previous.kind === "reasoning" && next.kind === "reasoning") {
        return { kind: "reasoning", delta: previous.delta + next.delta };
      }
      if (previous.kind !== "pi" || next.kind !== "pi") return undefined;
      const event = mergeToolProgress(previous.event, next.event);
      return event === undefined ? undefined : { kind: "pi", event };
    },
    waitForPaint,
    signal,
  });

  let pendingProgress: Event | undefined;
  let cancelProgress: (() => void) | undefined;
  let cancelled = signal?.aborted ?? false;
  const flushProgress = () => {
    cancelProgress?.();
    cancelProgress = undefined;
    const event = pendingProgress;
    pendingProgress = undefined;
    if (event && !cancelled) queue.enqueue({ kind: "pi", event });
  };
  const cancel = () => {
    cancelled = true;
    cancelProgress?.();
    cancelProgress = undefined;
    pendingProgress = undefined;
    queue.cancel();
    signal?.removeEventListener("abort", cancel);
  };
  if (!cancelled) signal?.addEventListener("abort", cancel, { once: true });

  return {
    enqueuePiEvent(event: Event) {
      if (cancelled) return;
      if (event.toolCallId && ["tool_call_delta", "tool_update"].includes(event.type)) {
        const merged = pendingProgress && mergeToolProgress(pendingProgress, event);
        if (pendingProgress && !merged) flushProgress();
        pendingProgress = merged ?? event;
        // Network reads may deliver just one tiny fragment each. Paint pacing
        // alone does not bound the repeated argument parsing and App renders.
        cancelProgress ??= scheduleProgress(flushProgress, PI_TOOL_PROGRESS_INTERVAL_MS);
        return;
      }
      // Lifecycle events and tool requests flush immediately, in wire order.
      flushProgress();
      queue.enqueue({ kind: "pi", event });
    },
    enqueueContent(delta: string) {
      if (!delta || cancelled) return;
      flushProgress();
      queue.enqueue({ kind: "content", delta });
    },
    enqueueReasoning(delta: string) {
      if (!delta || cancelled) return;
      flushProgress();
      queue.enqueue({ kind: "reasoning", delta });
    },
    async waitForIdle() {
      flushProgress();
      await queue.waitForIdle();
    },
    cancel,
  };
}
