export type PiContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  breakdown?: { label: string; tokens: number }[];
};

export type ContextTokenMeterSnapshot = {
  usageKey: string;
  currentTokens: number;
  thresholdTokens: number | null;
  usageRatio: number | null;
  limitingModelId: string;
  modelIds: string[];
  missingModelIds: string[];
  usesActualRequestTokens: boolean;
  nativePiContext: boolean;
  compressed: boolean;
  removedMessageCount: number;
  machineCompressedMessageCount: number;
  astPrunedMessageCount: number;
  assistantWindowedMessageCount: number;
  appendedMessageCount: number;
  contextBreakdown: { label: string; tokens: number }[];
};

export function hasUsablePiContextUsage(usage: PiContextUsage | undefined): usage is PiContextUsage & { tokens: number } {
  return usage?.tokens !== null && Number.isFinite(usage?.tokens) && Number(usage?.tokens) > 0;
}

export function createNativeContextTokenMeter(usageKey: string, modelId: string, usage: PiContextUsage & { tokens: number }, modelIds = [modelId]): ContextTokenMeterSnapshot {
  return {
    usageKey, currentTokens: usage.tokens, thresholdTokens: usage.contextWindow,
    usageRatio: usage.tokens / usage.contextWindow, limitingModelId: modelId, modelIds, missingModelIds: [],
    usesActualRequestTokens: true, nativePiContext: true, compressed: false,
    removedMessageCount: 0, machineCompressedMessageCount: 0, astPrunedMessageCount: 0,
    assistantWindowedMessageCount: 0, appendedMessageCount: 0,
    contextBreakdown: usage.breakdown ?? [{ label: "Pi 原生上下文", tokens: usage.tokens }],
  };
}

/** Keyed subscriptions keep background sessions and the App tree out of meter updates. */
export function createPiContextUsageStore() {
  const values = new Map<string, PiContextUsage>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (key: string) => listeners.get(key)?.forEach((listener) => listener());
  return {
    getSnapshot(key: string) { return values.get(key); },
    subscribe(key: string, listener: () => void) {
      const subscribers = listeners.get(key) ?? new Set();
      subscribers.add(listener);
      listeners.set(key, subscribers);
      return () => { subscribers.delete(listener); if (!subscribers.size) listeners.delete(key); };
    },
    update(key: string, usage: PiContextUsage | null | undefined) {
      if (!key || !usage || !Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return;
      if (usage.tokens !== null && (!Number.isFinite(usage.tokens) || usage.tokens <= 0)) return;
      const previous = values.get(key);
      if (previous?.tokens === usage.tokens && previous.contextWindow === usage.contextWindow && previous.percent === usage.percent &&
        previous.breakdown?.length === usage.breakdown?.length &&
        (previous.breakdown ?? []).every((part, index) => part.label === usage.breakdown?.[index]?.label && part.tokens === usage.breakdown?.[index]?.tokens)) return;
      values.set(key, usage);
      notify(key);
    },
    clearSession(sessionId: string) {
      for (const key of values.keys()) {
        if (!key.startsWith(`${sessionId}\u0000`)) continue;
        values.delete(key);
        notify(key);
      }
    },
  };
}

export type PiContextUsageStore = ReturnType<typeof createPiContextUsageStore>;
