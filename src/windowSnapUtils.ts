export type WindowSnapSide = "left" | "right";

export const WINDOW_SNAP_COMPACT_BREAKPOINT = 820;
export const WINDOW_SNAP_EDGE_THRESHOLD = 28;

export function getWindowSnapCandidate(
  pointerX: number,
  viewportWidth: number,
  edgeThreshold = WINDOW_SNAP_EDGE_THRESHOLD,
): WindowSnapSide | null {
  if (
    !Number.isFinite(pointerX) ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= WINDOW_SNAP_COMPACT_BREAKPOINT
  ) {
    return null;
  }
  const threshold = Math.max(0, Math.min(edgeThreshold, viewportWidth / 2));
  if (pointerX <= threshold) return "left";
  if (pointerX >= viewportWidth - threshold) return "right";
  return null;
}
