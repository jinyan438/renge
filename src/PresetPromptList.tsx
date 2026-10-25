import { GripVertical } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type PointerEvent } from "react";
import type { ChatPresetPrompt } from "./presetUtils";

type Props = {
  prompts: ChatPresetPrompt[];
  selectedIdentifier?: string;
  onSelect: (identifier: string) => void;
  onToggle: (identifier: string, enabled: boolean) => void;
  onMove: (identifier: string, insertionIndex: number) => void;
};

type DragSession = {
  identifier: string;
  pointerId: number;
  handle: HTMLButtonElement;
  prompts: ChatPresetPrompt[];
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  insertionIndex: number | null;
};

function visibleListBounds(list: HTMLElement) {
  const view = list.ownerDocument.defaultView!;
  const rect = list.getBoundingClientRect();
  const bounds = { left: Math.max(0, rect.left), right: Math.min(view.innerWidth, rect.right),
    top: Math.max(0, rect.top), bottom: Math.min(view.innerHeight, rect.bottom) };
  for (let parent = list.parentElement; parent; parent = parent.parentElement) {
    const style = view.getComputedStyle(parent);
    const clip = parent.getBoundingClientRect();
    if (style.overflowY !== "visible") {
      bounds.top = Math.max(bounds.top, clip.top + parent.clientTop);
      bounds.bottom = Math.min(bounds.bottom, clip.top + parent.clientTop + parent.clientHeight);
    }
    if (style.overflowX !== "visible") {
      bounds.left = Math.max(bounds.left, clip.left + parent.clientLeft);
      bounds.right = Math.min(bounds.right, clip.left + parent.clientLeft + parent.clientWidth);
    }
  }
  return bounds;
}

export function PresetPromptList({ prompts, selectedIdentifier, onSelect, onToggle, onMove }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const frameRef = useRef<{ view: Window; id: number } | null>(null);
  const [drag, setDrag] = useState<{ identifier: string; insertionIndex: number | null } | null>(null);

  const stopDrag = () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (frameRef.current) frameRef.current.view.cancelAnimationFrame(frameRef.current.id);
    frameRef.current = null;
    if (session?.handle.hasPointerCapture(session.pointerId)) session.handle.releasePointerCapture(session.pointerId);
    setDrag(null);
  };

  useEffect(() => {
    const view = listRef.current?.ownerDocument.defaultView;
    const cancel = () => stopDrag();
    view?.addEventListener("blur", cancel);
    return () => {
      view?.removeEventListener("blur", cancel);
      if (frameRef.current) frameRef.current.view.cancelAnimationFrame(frameRef.current.id);
      sessionRef.current = null;
    };
  }, []);

  const updateDropTarget = (session: DragSession) => {
    const list = listRef.current;
    if (!list) return;
    const bounds = visibleListBounds(list);
    const inside = session.x >= bounds.left && session.x <= bounds.right &&
      session.y >= bounds.top && session.y <= bounds.bottom;
    let insertionIndex: number | null = null;
    if (inside) {
      const rows = Array.from(list.querySelectorAll<HTMLElement>(".preset-prompt-item"));
      const nextIndex = rows.findIndex((row) => {
        const rect = row.getBoundingClientRect();
        return session.y < rect.top + rect.height / 2;
      });
      insertionIndex = nextIndex < 0 ? rows.length : nextIndex;
    }
    session.insertionIndex = insertionIndex;
    setDrag((current) => current?.identifier === session.identifier && current.insertionIndex === insertionIndex
      ? current : { identifier: session.identifier, insertionIndex });
  };

  const autoScroll = () => {
    const session = sessionRef.current;
    const list = listRef.current;
    if (!session?.active || !list) return;
    const view = list.ownerDocument.defaultView!;
    const bounds = visibleListBounds(list);
    const { top, bottom } = bounds;
    if (session.x >= bounds.left && session.x <= bounds.right && session.y >= top && session.y <= bottom) {
      const edge = Math.min(48, (bottom - top) / 3);
      const speed = session.y < top + edge ? -12 * (1 - (session.y - top) / edge)
        : session.y > bottom - edge ? 12 * (1 - (bottom - session.y) / edge) : 0;
      if (speed) {
        const before = list.scrollTop;
        list.scrollTop += speed;
        // When the settings panel clips the list, continue scrolling that panel
        // after the list reaches its edge (or has too few rows to scroll).
        const rect = list.getBoundingClientRect();
        const clipped = speed > 0 ? bounds.bottom < rect.bottom - 1 : bounds.top > rect.top + 1;
        if (list.scrollTop === before && clipped) {
          for (let parent = list.parentElement; parent; parent = parent.parentElement) {
            if (!["auto", "scroll"].includes(view.getComputedStyle(parent).overflowY)) continue;
            const previous = parent.scrollTop;
            parent.scrollTop += speed;
            if (parent.scrollTop !== previous) break;
          }
        }
      }
    }
    updateDropTarget(session);
    frameRef.current = { view, id: view.requestAnimationFrame(autoScroll) };
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>, identifier: string) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    sessionRef.current = {
      identifier, pointerId: event.pointerId, handle: event.currentTarget, prompts,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      active: false, insertionIndex: null,
    };
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    session.x = event.clientX;
    session.y = event.clientY;
    if (!session.active && Math.hypot(session.x - session.startX, session.y - session.startY) >= 5) {
      session.active = true;
      autoScroll();
    }
    if (session.active) {
      event.preventDefault();
      updateDropTarget(session);
    }
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.active) {
      session.x = event.clientX;
      session.y = event.clientY;
      updateDropTarget(session);
    }
    const target = session.insertionIndex;
    stopDrag();
    if (session.active && target !== null && session.prompts === prompts) onMove(session.identifier, target);
  };

  return (
    <div className={`preset-prompt-list ${drag ? "is-dragging" : ""}`} ref={listRef}
      role="list" aria-label="提示词模块" onKeyDown={(event) => {
        if (event.key === "Escape") stopDrag();
      }}>
      {prompts.length === 0 ? <div className="preset-empty-state">当前预设没有提示词模块。</div> : (
        <>
          {prompts.map((prompt, index) => (
            <Fragment key={prompt.identifier}>
              <div className={`preset-prompt-drop-slot ${drag?.insertionIndex === index ? "active" : ""}`}
                data-insertion-index={index} aria-hidden="true" />
              <div className={`preset-prompt-item ${prompt.identifier === selectedIdentifier ? "active" : ""} ${prompt.enabled ? "" : "disabled"} ${drag?.identifier === prompt.identifier ? "dragging" : ""}`}
                role="listitem" data-prompt-identifier={prompt.identifier}>
                <input type="checkbox" aria-label={`启用 ${prompt.name}`} checked={prompt.enabled}
                  onChange={(event) => onToggle(prompt.identifier, event.target.checked)} />
                <button type="button" className="preset-prompt-select" onClick={() => onSelect(prompt.identifier)}>
                  <strong>{prompt.name}</strong>
                  <span>{prompt.role} · {prompt.marker ? "占位符" : prompt.injectionPosition === 2 ? `聊天深度 ${prompt.injectionDepth}` : "相对注入"}</span>
                </button>
                <button type="button" className="preset-prompt-drag-handle" aria-label={`拖动排序 ${prompt.name}`}
                  title="拖到模块之间的缝隙插入；也可用方向键上下移动" disabled={prompts.length < 2}
                  onPointerDown={(event) => startDrag(event, prompt.identifier)} onPointerMove={moveDrag}
                  onPointerUp={finishDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
                  onKeyDown={(event) => {
                    if (sessionRef.current || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                    event.preventDefault();
                    onMove(prompt.identifier, event.key === "ArrowUp" ? Math.max(0, index - 1) : Math.min(prompts.length, index + 2));
                  }}>
                  <GripVertical size={17} />
                </button>
              </div>
            </Fragment>
          ))}
          <div className={`preset-prompt-drop-slot ${drag?.insertionIndex === prompts.length ? "active" : ""}`}
            data-insertion-index={prompts.length} aria-hidden="true" />
        </>
      )}
    </div>
  );
}
