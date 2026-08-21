type PiStreamEventQueueOptions<Event> = {
  dispatch: (event: Event) => void | Promise<void>;
  shouldPaintAfter: (event: Event) => boolean;
  waitForPaint: () => Promise<void>;
};

export function createPiStreamEventQueue<Event>({
  dispatch,
  shouldPaintAfter,
  waitForPaint,
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

        // Apply every delta already waiting, then expose the latest partial
        // arguments in one browser paint before any end/execution event.
        while (pending.length > 0 && shouldPaintAfter(pending[0])) {
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
