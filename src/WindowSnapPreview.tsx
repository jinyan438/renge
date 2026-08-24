import type { WindowSnapSide } from "./windowSnapUtils";

export function WindowSnapPreview({ side }: { side: WindowSnapSide | null }) {
  if (!side) return null;
  return <div aria-hidden="true" className={`managed-window-snap-preview is-${side}`} />;
}
