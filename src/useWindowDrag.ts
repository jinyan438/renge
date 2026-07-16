import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";

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
}: UseWindowDragOptions) {
  const offsetRef = useRef<WindowOffset>(initialOffset);
  const pendingRef = useRef<WindowOffset>(initialOffset);
  const sessionRef = useRef<DragSession>({ ...idleSession });
  const frameRef = useRef<number | null>(null);

  const paint = useCallback(() => {
    frameRef.current = null;
    const target = targetRef.current;
    if (!target) return;
    const { x, y } = pendingRef.current;
    target.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, [targetRef]);

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session.active || session.pointerId !== event.pointerId) return;
      session.active = false;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        paint();
      }
      offsetRef.current = pendingRef.current;
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
      const rect = target.getBoundingClientRect();
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      sessionRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffset: offsetRef.current,
        startRect: rect,
        previousCursor,
        previousUserSelect,
      };
      pendingRef.current = offsetRef.current;
      target.style.willChange = "transform";
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    },
    [disabled, targetRef],
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
      if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(paint);
    },
    [paint, viewportMargin, visibleTitleWidth],
  );

  useEffect(() => {
    offsetRef.current = initialOffset;
    pendingRef.current = initialOffset;
    const target = targetRef.current;
    if (target) {
      const { x, y } = initialOffset;
      target.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, [initialOffset.x, initialOffset.y, targetRef]);

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
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
  };
}
