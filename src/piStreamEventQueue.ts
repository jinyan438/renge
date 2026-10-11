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
}: {
  dispatchPiEvent: (event: Event) => void | Promise<void>;
  dispatchContent: (delta: string) => void;
  dispatchReasoning: (delta: string) => void;
  waitForPaint: () => Promise<void>;
  signal?: AbortSignal;
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
      if (
        previous.kind !== "pi" || next.kind !== "pi" ||
        previous.event.type !== "tool_call_delta" ||
        next.event.type !== "tool_call_delta" ||
        !previous.event.toolCallId ||
        previous.event.toolCallId !== next.event.toolCallId
      ) return undefined;

      const argumentsText = next.event.argumentsText ?? (
        previous.event.argumentsText === undefined
          ? undefined
          : previous.event.argumentsText + (next.event.delta ?? "")
      );
      return {
        kind: "pi",
        event: {
          ...previous.event,
          ...next.event,
          delta: (previous.event.delta ?? "") + (next.event.delta ?? ""),
          ...(argumentsText === undefined ? {} : { argumentsText }),
        },
      };
    },
    waitForPaint,
    signal,
  });

  return {
    enqueuePiEvent(event: Event) {
      queue.enqueue({ kind: "pi", event });
    },
    enqueueContent(delta: string) {
      if (delta) queue.enqueue({ kind: "content", delta });
    },
    enqueueReasoning(delta: string) {
      if (delta) queue.enqueue({ kind: "reasoning", delta });
    },
    waitForIdle: queue.waitForIdle,
    cancel: queue.cancel,
  };
}
