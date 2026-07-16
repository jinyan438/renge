import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";

type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

type ResizeBounds = {
  width: number;
  height: number;
  left: number;
  top: number;
};

type ResizeSession = {
  active: boolean;
  pointerId: number;
  direction: ResizeDirection;
  startX: number;
  startY: number;
  startRect: DOMRect;
  startLeft: number;
  startTop: number;
  viewportWidth: number;
  viewportHeight: number;
  previousCursor: string;
  previousUserSelect: string;
};

type WindowResizeHandlesProps = {
  targetRef: RefObject<HTMLElement | null>;
  minWidth: number;
  minHeight: number;
  viewportMargin?: number;
};

const handleStyles: Array<{
  direction: ResizeDirection;
  cursor: CSSProperties["cursor"];
  style: CSSProperties;
}> = [
  { direction: "n", cursor: "ns-resize", style: { top: 0, right: 16, left: 16, height: 9 } },
  { direction: "e", cursor: "ew-resize", style: { top: 16, right: 0, bottom: 16, width: 9 } },
  { direction: "s", cursor: "ns-resize", style: { right: 16, bottom: 0, left: 16, height: 9 } },
  { direction: "w", cursor: "ew-resize", style: { top: 16, bottom: 16, left: 0, width: 9 } },
  { direction: "nw", cursor: "nwse-resize", style: { top: 0, left: 0, width: 18, height: 18 } },
  { direction: "ne", cursor: "nesw-resize", style: { top: 0, right: 0, width: 18, height: 18 } },
  { direction: "se", cursor: "nwse-resize", style: { right: 0, bottom: 0, width: 18, height: 18 } },
  { direction: "sw", cursor: "nesw-resize", style: { bottom: 0, left: 0, width: 18, height: 18 } },
];

const initialSession: ResizeSession = {
  active: false,
  pointerId: -1,
  direction: "se",
  startX: 0,
  startY: 0,
  startRect: new DOMRect(),
  startLeft: 0,
  startTop: 0,
  viewportWidth: 0,
  viewportHeight: 0,
  previousCursor: "",
  previousUserSelect: "",
};

export function WindowResizeHandles({
  targetRef,
  minWidth,
  minHeight,
  viewportMargin = 8,
}: WindowResizeHandlesProps) {
  const sessionRef = useRef<ResizeSession>({ ...initialSession });
  const pendingRef = useRef<ResizeBounds | null>(null);
  const frameRef = useRef<number | null>(null);

  const paint = useCallback(() => {
    frameRef.current = null;
    const target = targetRef.current;
    const pending = pendingRef.current;
    if (!target || !pending) return;
    target.style.width = `${pending.width}px`;
    target.style.height = `${pending.height}px`;
    target.style.left = `${pending.left}px`;
    target.style.top = `${pending.top}px`;
  }, [targetRef]);

  const schedulePaint = useCallback(() => {
    if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(paint);
  }, [paint]);

  const onPointerDown = useCallback(
    (direction: ResizeDirection, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = targetRef.current;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = target.getBoundingClientRect();
      const computedPosition = window.getComputedStyle(target).position;
      if (computedPosition === "static") target.style.position = "relative";
      target.style.boxSizing = "border-box";
      target.style.width = `${rect.width}px`;
      target.style.height = `${rect.height}px`;
      target.style.maxWidth = "none";
      target.style.maxHeight = "none";
      target.style.willChange = "width, height, left, top";
      event.currentTarget.setPointerCapture(event.pointerId);
      const cursor = handleStyles.find((handle) => handle.direction === direction)?.cursor ?? "default";
      sessionRef.current = {
        active: true,
        pointerId: event.pointerId,
        direction,
        startX: event.clientX,
        startY: event.clientY,
        startRect: rect,
        startLeft: Number.parseFloat(target.style.left) || 0,
        startTop: Number.parseFloat(target.style.top) || 0,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        previousCursor: document.body.style.cursor,
        previousUserSelect: document.body.style.userSelect,
      };
      pendingRef.current = {
        width: rect.width,
        height: rect.height,
        left: sessionRef.current.startLeft,
        top: sessionRef.current.startTop,
      };
      document.body.style.cursor = String(cursor);
      document.body.style.userSelect = "none";
    },
    [targetRef],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const session = sessionRef.current;
      if (!session.active || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      const effectiveMinWidth = Math.min(
        minWidth,
        Math.max(160, session.viewportWidth - viewportMargin * 2),
      );
      const effectiveMinHeight = Math.min(
        minHeight,
        Math.max(160, session.viewportHeight - viewportMargin * 2),
      );
      let left = session.startRect.left;
      let right = session.startRect.right;
      let top = session.startRect.top;
      let bottom = session.startRect.bottom;

      if (session.direction.includes("w")) {
        left = Math.max(
          viewportMargin,
          Math.min(session.startRect.left + dx, session.startRect.right - effectiveMinWidth),
        );
      }
      if (session.direction.includes("e")) {
        right = Math.min(
          session.viewportWidth - viewportMargin,
          Math.max(session.startRect.right + dx, session.startRect.left + effectiveMinWidth),
        );
      }
      if (session.direction.includes("n")) {
        top = Math.max(
          viewportMargin,
          Math.min(session.startRect.top + dy, session.startRect.bottom - effectiveMinHeight),
        );
      }
      if (session.direction.includes("s")) {
        bottom = Math.min(
          session.viewportHeight - viewportMargin,
          Math.max(session.startRect.bottom + dy, session.startRect.top + effectiveMinHeight),
        );
      }

      pendingRef.current = {
        width: right - left,
        height: bottom - top,
        left:
          session.startLeft +
          (left + right - session.startRect.left - session.startRect.right) / 2,
        top:
          session.startTop +
          (top + bottom - session.startRect.top - session.startRect.bottom) / 2,
      };
      schedulePaint();
    },
    [minHeight, minWidth, schedulePaint, viewportMargin],
  );

  const finishResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const session = sessionRef.current;
      if (!session.active || session.pointerId !== event.pointerId) return;
      session.active = false;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        paint();
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const target = targetRef.current;
      if (target) target.style.willChange = "auto";
      document.body.style.cursor = session.previousCursor;
      document.body.style.userSelect = session.previousUserSelect;
    },
    [paint, targetRef],
  );

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      const session = sessionRef.current;
      if (session.active) {
        document.body.style.cursor = session.previousCursor;
        document.body.style.userSelect = session.previousUserSelect;
      }
    },
    [],
  );

  useEffect(() => {
    const compactQuery = window.matchMedia("(max-width: 820px)");
    const resetForCompactViewport = () => {
      if (!compactQuery.matches) return;
      const session = sessionRef.current;
      if (session.active) {
        session.active = false;
        document.body.style.cursor = session.previousCursor;
        document.body.style.userSelect = session.previousUserSelect;
      }
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      const target = targetRef.current;
      if (!target) return;
      target.style.removeProperty("width");
      target.style.removeProperty("height");
      target.style.removeProperty("left");
      target.style.removeProperty("top");
      target.style.removeProperty("max-width");
      target.style.removeProperty("max-height");
      target.style.removeProperty("will-change");
      pendingRef.current = null;
    };
    resetForCompactViewport();
    compactQuery.addEventListener("change", resetForCompactViewport);
    return () => compactQuery.removeEventListener("change", resetForCompactViewport);
  }, [targetRef]);

  return (
    <>
      {handleStyles.map(({ direction, cursor, style }) => (
        <div
          key={direction}
          className="window-resize-handle"
          aria-hidden="true"
          data-resize-direction={direction}
          onPointerDown={(event) => onPointerDown(direction, event)}
          onPointerMove={onPointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          style={{ ...style, cursor }}
        />
      ))}
    </>
  );
}
