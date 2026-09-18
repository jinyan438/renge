type PiStreamEventQueueOptions<Event> = {
  dispatch: (event: Event) => void | Promise<void>;
  shouldPaintAfter: (event: Event) => boolean;
  waitForPaint: () => Promise<void>;
  paintWeight?: (event: Event) => number;
  maxPaintWeight?: number;
};

type ToolCallDeltaEvent = {
  type: string;
  delta?: string;
  argumentsText?: string;
};

type PiStreamRenderEvent<Event> =
  | { kind: "pi"; event: Event }
  | { kind: "content"; delta: string }
  | { kind: "reasoning"; delta: string };

export function splitLargePiToolCallDelta<Event extends ToolCallDeltaEvent>(
  event: Event,
  minimumChunkCharacters = 48,
  maximumChunks = 240,
): Event[] {
  const delta = event.type === "tool_call_delta" ? event.delta ?? "" : "";
  if (delta.length <= minimumChunkCharacters) return [event];

  const characters = Array.from(delta);
  const chunkSize = Math.max(
    minimumChunkCharacters,
    Math.ceil(characters.length / maximumChunks),
  );
  const chunks: Event[] = [];
  for (let index = 0; index < characters.length; index += chunkSize) {
    const chunk = {
      ...event,
      delta: characters.slice(index, index + chunkSize).join(""),
    };
    delete chunk.argumentsText;
    chunks.push(chunk);
  }
  return chunks;
}

export function createPiStreamEventQueue<Event>({
  dispatch,
  shouldPaintAfter,
  waitForPaint,
  paintWeight = () => 1,
  maxPaintWeight = Number.POSITIVE_INFINITY,
}: PiStreamEventQueueOptions<Event>) {
  const pending: Event[] = [];
  let activeDrain: Promise<void> | null = null;
  let failure: unknown;
  let failed = false;

  const drain = async () => {
    try {
      while (pending.length > 0) {
        const event = pending.shift()!;
        await dispatch(event);
        if (!shouldPaintAfter(event)) continue;

        // Coalesce small provider fragments up to one visual frame, while
        // keeping large compatibility chunks on separate frames.
        let frameWeight = Math.max(0, paintWeight(event));
        while (
          pending.length > 0 &&
          shouldPaintAfter(pending[0]) &&
          frameWeight + Math.max(0, paintWeight(pending[0])) <= maxPaintWeight
        ) {
          frameWeight += Math.max(0, paintWeight(pending[0]));
          await dispatch(pending.shift()!);
        }
        await waitForPaint();
      }
    } catch (error) {
      failed = true;
      failure = error;
      pending.length = 0;
    }
  };

  const ensureDrain = () => {
    if (activeDrain || failed || pending.length === 0) return;
    activeDrain = drain().finally(() => {
      activeDrain = null;
      ensureDrain();
    });
  };

  return {
    enqueue(event: Event) {
      if (failed) return;
      pending.push(event);
      ensureDrain();
    },
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
 */
export function createPiStreamRenderQueue<Event extends ToolCallDeltaEvent>({
  dispatchPiEvent,
  dispatchContent,
  dispatchReasoning,
  waitForPaint,
}: {
  dispatchPiEvent: (event: Event) => void | Promise<void>;
  dispatchContent: (delta: string) => void;
  dispatchReasoning: (delta: string) => void;
  waitForPaint: () => Promise<void>;
}) {
  const queue = createPiStreamEventQueue<PiStreamRenderEvent<Event>>({
    dispatch(item) {
      if (item.kind === "pi") return dispatchPiEvent(item.event);
      if (item.kind === "content") dispatchContent(item.delta);
      else dispatchReasoning(item.delta);
    },
    shouldPaintAfter: (item) =>
      item.kind === "pi" && item.event.type === "tool_call_delta",
    paintWeight: (item) =>
      item.kind === "pi" ? item.event.delta?.length ?? 0 : 0,
    maxPaintWeight: 48,
    waitForPaint,
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
  };
}
