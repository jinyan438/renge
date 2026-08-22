export type PiStreamingMessageSegment = {
  messageId: string;
  pushContent: (delta: string) => void;
  pushReasoning: (delta: string) => void;
  finish: () => Promise<void>;
  complete: (content: string, reasoning?: string) => boolean;
  cancel: () => void;
  remove: () => void;
};

type PiStreamingTimelineEntry = {
  segment: PiStreamingMessageSegment;
  content: string;
  reasoning: string;
  finishPromise?: Promise<void>;
};

export function createPiStreamingTimeline(options: {
  createSegment: (messageId?: string) => PiStreamingMessageSegment;
  initialMessageId?: string;
  onSegmentStarted?: (messageId: string) => void;
}) {
  const entries: PiStreamingTimelineEntry[] = [];
  let activeEntry: PiStreamingTimelineEntry | null = null;
  let reservedMessageId = options.initialMessageId;

  const ensureActiveEntry = () => {
    if (activeEntry) return activeEntry;
    const segment = options.createSegment(reservedMessageId);
    reservedMessageId = undefined;
    activeEntry = {
      segment,
      content: "",
      reasoning: "",
    };
    entries.push(activeEntry);
    options.onSegmentStarted?.(segment.messageId);
    return activeEntry;
  };

  const sealActiveEntry = () => {
    const entry = activeEntry;
    activeEntry = null;
    if (!entry || entry.finishPromise) return;
    entry.finishPromise = entry.segment.finish();
  };

  const finishEntries = async () => {
    sealActiveEntry();
    await Promise.all(entries.map((entry) => entry.finishPromise ?? Promise.resolve()));
  };

  return {
    get messageId() {
      return activeEntry?.segment.messageId ?? entries.at(-1)?.segment.messageId ?? reservedMessageId;
    },
    get segmentCount() {
      return entries.length;
    },
    pushContent(delta: string) {
      if (!delta) return;
      const entry = ensureActiveEntry();
      entry.content += delta;
      entry.segment.pushContent(delta);
    },
    pushReasoning(delta: string) {
      if (!delta) return;
      const entry = ensureActiveEntry();
      entry.reasoning += delta;
      entry.segment.pushReasoning(delta);
    },
    beforeTool() {
      sealActiveEntry();
    },
    finish: finishEntries,
    complete(content: string, reasoning = "") {
      if (entries.length === 0) {
        if (!content.trim() && !reasoning.trim()) return false;
        const entry = ensureActiveEntry();
        entry.content = content;
        entry.reasoning = reasoning;
        entry.segment.complete(content, reasoning);
        activeEntry = null;
        return true;
      }

      if (entries.length === 1) {
        entries[0].content = content;
        entries[0].reasoning = reasoning;
      }
      entries.forEach((entry) => {
        entry.segment.complete(entry.content, entry.reasoning);
      });
      return entries.some(
        (entry) => entry.content.trim() || entry.reasoning.trim(),
      );
    },
    cancel() {
      activeEntry = null;
      entries.forEach((entry) => entry.segment.cancel());
    },
    remove() {
      activeEntry = null;
      entries.forEach((entry) => entry.segment.remove());
    },
  };
}
