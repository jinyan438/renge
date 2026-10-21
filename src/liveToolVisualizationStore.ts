/** Live tool progress is an overlay on durable message anchors, not App state. */
export function createLiveToolVisualizationStore<Visualization extends { toolCallId?: string }>() {
  const sessions = new Map<string, Map<string, Visualization>>();
  const listeners = new Map<string, Set<() => void>>();
  const snapshots = new Map<string, WeakMap<object, object>>();
  const keyFor = (sessionId: string, toolCallId: string) => `${sessionId}\u0000${toolCallId}`;
  const notify = (sessionId: string, toolCallId: string) => listeners.get(keyFor(sessionId, toolCallId))?.forEach((listener) => listener());
  return {
    getSnapshot(sessionId: string, toolCallId: string) {
      return sessions.get(sessionId)?.get(toolCallId);
    },
    subscribe(sessionId: string, toolCallId: string, listener: () => void) {
      const key = keyFor(sessionId, toolCallId);
      const subscribers = listeners.get(key) ?? new Set();
      subscribers.add(listener);
      listeners.set(key, subscribers);
      return () => { subscribers.delete(listener); if (!subscribers.size) listeners.delete(key); };
    },
    update(sessionId: string, toolCallId: string, visualization: Visualization) {
      const pending = sessions.get(sessionId) ?? new Map<string, Visualization>();
      if (pending.get(toolCallId) === visualization) return;
      pending.set(toolCallId, visualization);
      sessions.set(sessionId, pending);
      snapshots.delete(sessionId);
      notify(sessionId, toolCallId);
    },
    materialize<Message extends { toolVisualization?: Visualization }>(sessionId: string, messages: Message[]): Message[] {
      const pending = sessions.get(sessionId);
      if (!pending?.size) return messages;
      const cache = snapshots.get(sessionId) ?? new WeakMap<object, object>();
      const cached = cache.get(messages);
      if (cached) return cached as Message[];
      let changed = false;
      const next = messages.map((message) => {
        const id = message.toolVisualization?.toolCallId;
        const visualization = id ? pending.get(id) : undefined;
        if (!visualization || visualization === message.toolVisualization) return message;
        changed = true;
        return { ...message, toolVisualization: visualization };
      });
      const result = changed ? next : messages;
      cache.set(messages, result);
      snapshots.set(sessionId, cache);
      return result;
    },
    clearSession(sessionId: string) {
      const pending = sessions.get(sessionId);
      if (!pending) return;
      sessions.delete(sessionId);
      snapshots.delete(sessionId);
      pending.forEach((_value, toolCallId) => notify(sessionId, toolCallId));
    },
  };
}

export type LiveToolVisualizationStore<Visualization extends { toolCallId?: string }> = ReturnType<typeof createLiveToolVisualizationStore<Visualization>>;
