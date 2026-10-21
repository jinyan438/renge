import { memo, useCallback, useSyncExternalStore, type ReactNode } from "react";
import type { LiveToolVisualizationStore } from "./liveToolVisualizationStore";

/** Updating a tool must not redraw the desktop, sidebar or historical messages. */
function LiveToolVisualization<Visualization extends { toolCallId?: string }>({ store, sessionId, initial, render, renderKey }: {
  store: LiveToolVisualizationStore<Visualization>;
  sessionId: string;
  initial: Visualization;
  render: (visualization: Visualization, key: string) => ReactNode;
  renderKey: string;
}) {
  const toolCallId = initial.toolCallId ?? "";
  const subscribe = useCallback((listener: () => void) => store.subscribe(sessionId, toolCallId, listener), [store, sessionId, toolCallId]);
  const getSnapshot = useCallback(() => store.getSnapshot(sessionId, toolCallId) ?? initial, [store, sessionId, toolCallId, initial]);
  const visualization = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return render(visualization, renderKey);
}

// Canonical updates for another tool must not rebuild unchanged tool cards.
export const ChatLiveToolVisualization = memo(LiveToolVisualization) as typeof LiveToolVisualization;
