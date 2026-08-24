import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getWindowSnapCandidate,
  WINDOW_SNAP_COMPACT_BREAKPOINT,
  type WindowSnapSide,
} from "./windowSnapUtils";

export type WindowOffset = {
  x: number;
  y: number;
};

type DragSession = {
  active: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: WindowOffset;
  startRect: DOMRect;
  previousCursor: string;
  previousUserSelect: string;
};

type UseWindowDragOptions = {
  targetRef: RefObject<HTMLElement | null>;
  initialOffset?: WindowOffset;
  disabled?: boolean;
  visibleTitleWidth?: number;
  viewportMargin?: number;
  snapEnabled?: boolean;
};

const idleSession: DragSession = {
  active: false,
  pointerId: -1,
  startX: 0,
  startY: 0,
  startOffset: { x: 0, y: 0 },
  startRect: new DOMRect(),
  previousCursor: "",
  previousUserSelect: "",
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function useWindowDrag({
  targetRef,
  initialOffset = { x: 0, y: 0 },
  disabled = false,
  visibleTitleWidth = 112,
  viewportMargin = 8,
  snapEnabled = true,
}: UseWindowDragOptions) {
  const offsetRef = useRef<WindowOffset>(initialOffset);
  const pendingRef = useRef<WindowOffset>(initialOffset);
  const restoreOffsetRef = useRef<WindowOffset>(initialOffset);
  const sessionRef = useRef<DragSession>({ ...idleSession });
  const frameRef = useRef<number | null>(null);
  const snapSideRef = useRef<WindowSnapSide | null>(null);
  const snapPreviewSideRef = useRef<WindowSnapSide | null>(null);
  const [snappedSide, setSnappedSide] = useState<WindowSnapSide | null>(null);
  const [snapPreviewSide, setSnapPreviewSide] = useState<WindowSnapSide | null>(null);

  const updateSnapPreview = useCallback((side: WindowSnapSide | null) => {
    snapPreviewSideRef.current = side;
    setSnapPreviewSide((current) => (current === side ? current : side));
  }, []);

  const updateSnappedSide = useCallback(
    (side: WindowSnapSide | null) => {
      snapSideRef.current = side;
      setSnappedSide((current) => (current === side ? current : side));
      const target = targetRef.current;
      if (!target) return;
      if (side) target.dataset.windowSnap = side;
      else delete target.dataset.windowSnap;
    },
    [targetRef],
  );

  const paint = useCallback(() => {
    frameRef.current = null;
    const target = targetRef.current;
    if (!target) return;
    const { x, y } = pendingRef.current;
    target.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, [targetRef]);

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, commitSnap: boolean) => {
      const session = sessionRef.current;
      if (!session.active || session.pointerId !== event.pointerId) return;
      session.active = false;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        paint();
      }
      const candidate = commitSnap ? snapPreviewSideRef.current : null;
      if (candidate) {
        restoreOffsetRef.current = session.startOffset;
        offsetRef.current = session.startOffset;
        pendingRef.current = session.startOffset;
        updateSnappedSide(candidate);
      } else {
        offsetRef.current = pendingRef.current;
      }
      updateSnapPreview(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const target = targetRef.current;
      if (target) target.style.willChange = "auto";
      document.body.style.cursor = session.previousCursor;
      document.body.style.userSelect = session.previousUserSelect;
    },
    [paint, targetRef, updateSnapPreview, updateSnappedSide],
  );

  const clearSnap = useCallback(() => {
    if (!snapSideRef.current && !targetRef.current?.dataset.windowSnap) return;
    const restoreOffset = restoreOffsetRef.current;
    offsetRef.current = restoreOffset;
    pendingRef.current = restoreOffset;
    updateSnappedSide(null);
    const target = targetRef.current;
    if (target) {
      target.style.transform = `translate3d(${restoreOffset.x}px, ${restoreOffset.y}px, 0)`;
    }
    updateSnapPreview(null);
  }, [targetRef, updateSnapPreview, updateSnappedSide]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        disabled ||
        event.button !== 0 ||
        window.innerWidth <= 820 ||
        (event.target as HTMLElement).closest("button, input, textarea, select, a")
      ) {
        return;
      }

      const target = targetRef.current;
      if (!target) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      let rect = target.getBoundingClientRect();
      let startOffset = offsetRef.current;
      if (snapSideRef.current || target.dataset.windowSnap) {
        const snappedRect = rect;
        const restoreOffset = restoreOffsetRef.current;
        updateSnappedSide(null);
        target.style.transform = `translate3d(${restoreOffset.x}px, ${restoreOffset.y}px, 0)`;
        const restoredRect = target.getBoundingClientRect();
        const horizontalRatio = clamp(
          (event.clientX - snappedRect.left) / Math.max(1, snappedRect.width),
          0.12,
          0.88,
        );
        const desiredLeft = event.clientX - restoredRect.width * horizontalRatio;
        const desiredTop = event.clientY - clamp(event.clientY - snappedRect.top, 10, 38);
        const rawDx = desiredLeft - restoredRect.left;
        const rawDy = desiredTop - restoredRect.top;
        const minimumDx = visibleTitleWidth - restoredRect.right;
        const maximumDx = window.innerWidth - visibleTitleWidth - restoredRect.left;
        const minimumDy = viewportMargin - restoredRect.top;
        const maximumDy = window.innerHeight - 42 - viewportMargin - restoredRect.top;
        startOffset = {
          x: restoreOffset.x + clamp(rawDx, minimumDx, maximumDx),
          y: restoreOffset.y + clamp(rawDy, minimumDy, maximumDy),
        };
        offsetRef.current = startOffset;
        pendingRef.current = startOffset;
        target.style.transform = `translate3d(${startOffset.x}px, ${startOffset.y}px, 0)`;
        rect = target.getBoundingClientRect();
      }
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      sessionRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffset,
        startRect: rect,
        previousCursor,
        previousUserSelect,
      };
      pendingRef.current = offsetRef.current;
      target.style.willChange = "transform";
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    },
    [disabled, targetRef, updateSnappedSide, viewportMargin, visibleTitleWidth],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session.active || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      const rawDx = event.clientX - session.startX;
      const rawDy = event.clientY - session.startY;
      const minimumDx = visibleTitleWidth - session.startRect.right;
      const maximumDx = window.innerWidth - visibleTitleWidth - session.startRect.left;
      const minimumDy = viewportMargin - session.startRect.top;
      const maximumDy = window.innerHeight - 42 - viewportMargin - session.startRect.top;
      pendingRef.current = {
        x: session.startOffset.x + clamp(rawDx, minimumDx, maximumDx),
        y: session.startOffset.y + clamp(rawDy, minimumDy, maximumDy),
      };
      updateSnapPreview(
        snapEnabled
          ? getWindowSnapCandidate(event.clientX, window.innerWidth)
          : null,
      );
      if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(paint);
    },
    [paint, snapEnabled, updateSnapPreview, viewportMargin, visibleTitleWidth],
  );

  useEffect(() => {
    if (snapSideRef.current) {
      restoreOffsetRef.current = initialOffset;
      return;
    }
    offsetRef.current = initialOffset;
    pendingRef.current = initialOffset;
    restoreOffsetRef.current = initialOffset;
    const target = targetRef.current;
    if (target) {
      const { x, y } = initialOffset;
      target.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, [initialOffset.x, initialOffset.y, targetRef]);

  useEffect(() => {
    const compactQuery = window.matchMedia(`(max-width: ${WINDOW_SNAP_COMPACT_BREAKPOINT}px)`);
    const clearForCompactViewport = () => {
      if (compactQuery.matches) clearSnap();
    };
    clearForCompactViewport();
    compactQuery.addEventListener("change", clearForCompactViewport);
    return () => compactQuery.removeEventListener("change", clearForCompactViewport);
  }, [clearSnap]);

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

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => finishDrag(event, true),
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => finishDrag(event, false),
    clearSnap,
    snappedSide,
    snapPreviewSide,
  };
}
