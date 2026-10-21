import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import type { LiveToolVisualizationStore } from "./liveToolVisualizationStore";

/** Updating a tool must not redraw the desktop, sidebar or historical messages. */
export function ChatLiveToolVisualization<Visualization extends { toolCallId?: string }>({ store, sessionId, initial, children }: {
  store: LiveToolVisualizationStore<Visualization>;
  sessionId: string;
  initial: Visualization;
  children: (visualization: Visualization) => ReactNode;
}) {
  const toolCallId = initial.toolCallId ?? "";
  const subscribe = useCallback((listener: () => void) => store.subscribe(sessionId, toolCallId, listener), [store, sessionId, toolCallId]);
  const getSnapshot = useCallback(() => store.getSnapshot(sessionId, toolCallId) ?? initial, [store, sessionId, toolCallId, initial]);
  const visualization = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return children(visualization);
}
