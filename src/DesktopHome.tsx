import {
  ArrowRight,
  Bot,
  BookOpen,
  Boxes,
  MessageSquare,
  Puzzle,
  Settings2,
  Sparkles,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import characterCardsModuleIcon from "./assets/module-icons/character-cards.png";
import chatModuleIcon from "./assets/module-icons/chat.png";
import extensionsModuleIcon from "./assets/module-icons/extensions.png";
import personaStudioModuleIcon from "./assets/module-icons/persona-studio.png";
import recentSessionsModuleIcon from "./assets/module-icons/recent-sessions.png";
import rengeBrandModuleIcon from "./assets/module-icons/renge-brand.png";
import settingsModuleIcon from "./assets/module-icons/settings.png";
import defaultDesktopWallpaper from "./assets/wallpapers/default-desktop.webp";
import { WindowResizeHandles } from "./WindowResizeHandles";

const BACKGROUND_IMAGE = defaultDesktopWallpaper;

const PROJECT_THUMBNAILS = [
  chatModuleIcon,
  personaStudioModuleIcon,
  characterCardsModuleIcon,
  extensionsModuleIcon,
  settingsModuleIcon,
  recentSessionsModuleIcon,
] as const;

const ABOUT_ICON = rengeBrandModuleIcon;
const NOTES_ICON = recentSessionsModuleIcon;

export type HomeDestination = "studio" | "characters" | "extensions" | "settings" | "chat";

export type HomeRecentSession = {
  id: string;
  title: string;
  workspaceName: string;
  messageCount: number;
  updatedAt: string;
};

type ProjectId = HomeDestination | "recent";
type OverlayId = ProjectId | "about";

type DesktopHomeProps = {
  activePersonaName: string;
  chatModelLabel: string;
  chatModelReady: boolean;
  personaCount: number;
  characterCount: number;
  extensionCount: number;
  enabledExtensionCount: number;
  sessionCount: number;
  recentSessions: HomeRecentSession[];
  overlayZIndex: number;
  onOverlayActivate: () => void;
  onNavigate: (destination: HomeDestination) => void;
  onOpenRecentSession: (sessionId: string) => void;
  children?: ReactNode;
};

type ProjectSpec = {
  id: ProjectId;
  title: string;
  kicker: string;
  description: string;
  actionLabel: string;
  anchorX: number;
  anchorY: number;
  thumbnail: string;
  icon: ReactNode;
  stats: string[];
};

type DragOffset = { x: number; y: number };
type ProjectPosition = { x: number; y: number };
type ProjectPositionLayout = "desktop" | "compact";
type StoredProjectPositions = Partial<
  Record<ProjectPositionLayout, Partial<Record<ProjectId, ProjectPosition>>>
>;
type DragCompletion = {
  offset: DragOffset;
  containerWidth: number;
  containerHeight: number;
};
type ProjectSnapTarget = { id: string; x: number; y: number };
type ProjectDragState = {
  active: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  startCenterX: number;
  startCenterY: number;
  distance: number;
  snapTargets: ProjectSnapTarget[];
  snapXTargetId: string | null;
  snapYTargetId: string | null;
};

const glassBorder = "1px solid rgba(255,255,255,0.2)";
const PROJECT_CARD_SELECTOR = "[data-desktop-project-icon]";
const PROJECT_ICON_CENTER_Y = 54;
const PROJECT_SNAP_THRESHOLD = 14;
const PROJECT_SNAP_RELEASE_THRESHOLD = 22;
const PROJECT_SNAP_NEARBY_DISTANCE = 280;
const PROJECT_POSITIONS_STORAGE_KEY = "renge.desktop.projectPositions.v1";
const PROJECT_IDS: readonly ProjectId[] = [
  "chat",
  "studio",
  "characters",
  "extensions",
  "settings",
  "recent",
];

function isStoredProjectPosition(value: unknown): value is ProjectPosition {
  if (!value || typeof value !== "object") return false;
  const position = value as Partial<ProjectPosition>;
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    (position.x as number) >= -25 &&
    (position.x as number) <= 125 &&
    (position.y as number) >= -25 &&
    (position.y as number) <= 125
  );
}

function normalizeStoredProjectPositions(value: unknown): StoredProjectPositions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as StoredProjectPositions;
  const normalized: StoredProjectPositions = {};
  for (const layout of ["desktop", "compact"] as const) {
    const layoutSource = source[layout];
    if (!layoutSource || typeof layoutSource !== "object") continue;
    const layoutPositions: Partial<Record<ProjectId, ProjectPosition>> = {};
    for (const projectId of PROJECT_IDS) {
      const position = layoutSource[projectId];
      if (isStoredProjectPosition(position)) layoutPositions[projectId] = position;
    }
    if (Object.keys(layoutPositions).length > 0) normalized[layout] = layoutPositions;
  }
  return normalized;
}

function hasStoredProjectPositions(positions: StoredProjectPositions) {
  return ["desktop", "compact"].some((layout) =>
    Object.keys(positions[layout as ProjectPositionLayout] ?? {}).length > 0,
  );
}

function loadProjectPositionsFromLocalStorage() {
  if (typeof window === "undefined") return {};
  try {
    const rawValue = localStorage.getItem(PROJECT_POSITIONS_STORAGE_KEY);
    return rawValue ? normalizeStoredProjectPositions(JSON.parse(rawValue) as unknown) : {};
  } catch {
    return {};
  }
}

function saveProjectPositionsToLocalStorage(positions: StoredProjectPositions) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PROJECT_POSITIONS_STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

function usePersistentProjectPositions() {
  const desktopStoreAvailable =
    typeof window !== "undefined" &&
    Boolean(
      window.rengeDesktop?.isElectron &&
        window.rengeDesktop.loadDesktopProjectPositions &&
        window.rengeDesktop.saveDesktopProjectPositions,
    );
  const [positions, setPositions] = useState<StoredProjectPositions>(() =>
    loadProjectPositionsFromLocalStorage(),
  );
  const positionsRef = useRef(positions);
  const [positionsReady, setPositionsReady] = useState(() => !desktopStoreAvailable);

  useEffect(() => {
    const desktopApi = window.rengeDesktop;
    if (!desktopApi?.loadDesktopProjectPositions) {
      setPositionsReady(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const loaded = normalizeStoredProjectPositions(
          await desktopApi.loadDesktopProjectPositions?.(),
        );
        if (cancelled) return;
        if (hasStoredProjectPositions(loaded)) {
          positionsRef.current = loaded;
          setPositions(loaded);
          saveProjectPositionsToLocalStorage(loaded);
        } else if (
          hasStoredProjectPositions(positionsRef.current) &&
          desktopApi.saveDesktopProjectPositions
        ) {
          await desktopApi.saveDesktopProjectPositions(positionsRef.current);
        }
      } catch {
        // The browser-local copy remains available as a fallback.
      } finally {
        if (!cancelled) setPositionsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateProjectPosition = useCallback(
    (projectId: ProjectId, layout: ProjectPositionLayout, position: ProjectPosition) => {
      if (!isStoredProjectPosition(position)) return;
      const next: StoredProjectPositions = {
        ...positionsRef.current,
        [layout]: {
          ...(positionsRef.current[layout] ?? {}),
          [projectId]: position,
        },
      };
      positionsRef.current = next;
      setPositions(next);
      saveProjectPositionsToLocalStorage(next);
      const saveToDesktop = window.rengeDesktop?.saveDesktopProjectPositions;
      if (saveToDesktop) void saveToDesktop(next).catch(() => undefined);
    },
    [],
  );

  return { positions, positionsReady, updateProjectPosition };
}

function useCompactViewport() {
  const [compact, setCompact] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(max-width: 720px), (max-height: 620px)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px), (max-height: 620px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return compact;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

function useDraggable({
  resetKey,
  onDragComplete,
}: {
  resetKey: string;
  onDragComplete: (completion: DragCompletion) => void;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef<DragOffset>({ x: 0, y: 0 });
  const pendingOffsetRef = useRef<DragOffset>({ x: 0, y: 0 });
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<ProjectDragState>({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    startCenterX: 0,
    startCenterY: 0,
    distance: 0,
    snapTargets: [],
    snapXTargetId: null,
    snapYTargetId: null,
  });
  const suppressClickRef = useRef(false);

  const paint = useCallback(() => {
    frameRef.current = null;
    const node = elementRef.current;
    if (!node) return;
    const { x, y } = pendingOffsetRef.current;
    node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, []);

  const schedulePaint = useCallback(() => {
    if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(paint);
  }, [paint]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const node = elementRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const snapTargets = node.parentElement
      ? Array.from(node.parentElement.querySelectorAll<HTMLDivElement>(PROJECT_CARD_SELECTOR))
          .filter((target) => target !== node)
          .map((target) => {
            const targetRect = target.getBoundingClientRect();
            return {
              id: target.dataset.desktopProjectIcon ?? "",
              x: targetRect.left + targetRect.width / 2,
              y: targetRect.top + PROJECT_ICON_CENTER_Y,
            };
          })
          .filter((target) => target.id)
      : [];
    node.setPointerCapture(event.pointerId);
    node.style.willChange = "transform";
    pendingOffsetRef.current = { ...offsetRef.current };
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
      startCenterX: rect.left + rect.width / 2,
      startCenterY: rect.top + PROJECT_ICON_CENTER_Y,
      distance: 0,
      snapTargets,
      snapXTargetId: null,
      snapYTargetId: null,
    };
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      drag.distance = Math.hypot(dx, dy);
      const centerX = drag.startCenterX + dx;
      const centerY = drag.startCenterY + dy;

      const pickSnapTarget = (axis: "x" | "y", lockedTargetId: string | null) => {
        const axisDistance = (target: ProjectSnapTarget) =>
          Math.abs((axis === "x" ? target.x : target.y) - (axis === "x" ? centerX : centerY));
        const crossDistance = (target: ProjectSnapTarget) =>
          Math.abs((axis === "x" ? target.y : target.x) - (axis === "x" ? centerY : centerX));
        const lockedTarget = lockedTargetId
          ? drag.snapTargets.find((target) => target.id === lockedTargetId)
          : undefined;

        if (
          lockedTarget &&
          axisDistance(lockedTarget) <= PROJECT_SNAP_RELEASE_THRESHOLD &&
          crossDistance(lockedTarget) <= PROJECT_SNAP_NEARBY_DISTANCE
        ) {
          return lockedTarget;
        }

        let closestTarget: ProjectSnapTarget | null = null;
        let closestDistance = PROJECT_SNAP_THRESHOLD + 1;
        for (const target of drag.snapTargets) {
          const distance = axisDistance(target);
          if (
            distance <= PROJECT_SNAP_THRESHOLD &&
            distance < closestDistance &&
            crossDistance(target) <= PROJECT_SNAP_NEARBY_DISTANCE
          ) {
            closestTarget = target;
            closestDistance = distance;
          }
        }
        return closestTarget;
      };

      let snapXTarget = pickSnapTarget("x", drag.snapXTargetId);
      let snapYTarget = pickSnapTarget("y", drag.snapYTargetId);
      if (snapXTarget?.id === snapYTarget?.id) {
        snapXTarget = null;
        snapYTarget = null;
      }
      drag.snapXTargetId = snapXTarget?.id ?? null;
      drag.snapYTargetId = snapYTarget?.id ?? null;

      pendingOffsetRef.current = {
        x: drag.originX + dx + (snapXTarget ? snapXTarget.x - centerX : 0),
        y: drag.originY + dy + (snapYTarget ? snapYTarget.y - centerY : 0),
      };
      schedulePaint();
    },
    [schedulePaint],
  );

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    drag.active = false;
    drag.snapTargets = [];
    drag.snapXTargetId = null;
    drag.snapYTargetId = null;
    suppressClickRef.current = drag.distance >= 5;
    const completedOffset = { ...pendingOffsetRef.current };
    offsetRef.current = completedOffset;
    const node = elementRef.current;
    if (node) {
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      node.style.willChange = "auto";
      const containerRect = node.parentElement?.getBoundingClientRect();
      if (
        drag.distance >= 5 &&
        containerRect &&
        containerRect.width > 0 &&
        containerRect.height > 0
      ) {
        onDragComplete({
          offset: completedOffset,
          containerWidth: containerRect.width,
          containerHeight: containerRect.height,
        });
        offsetRef.current = { x: 0, y: 0 };
        pendingOffsetRef.current = { x: 0, y: 0 };
        node.style.transform = "translate3d(0,0,0)";
      }
    }
  }, [onDragComplete]);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  useEffect(() => {
    const drag = dragRef.current;
    const node = elementRef.current;
    if (node && drag.active && node.hasPointerCapture(drag.pointerId)) {
      node.releasePointerCapture(drag.pointerId);
    }
    drag.active = false;
    drag.snapTargets = [];
    drag.snapXTargetId = null;
    drag.snapYTargetId = null;
    offsetRef.current = { x: 0, y: 0 };
    pendingOffsetRef.current = { x: 0, y: 0 };
    if (node) {
      node.style.transform = "translate3d(0,0,0)";
      node.style.willChange = "auto";
    }
  }, [resetKey]);

  return {
    elementRef,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    consumeSuppressedClick,
  };
}

function ProjectCard({
  project,
  compact,
  compactPosition,
  savedPosition,
  onPositionChange,
  onOpen,
  reducedMotion,
}: {
  project: ProjectSpec;
  compact: boolean;
  compactPosition: { x: number; y: number };
  savedPosition: ProjectPosition | null;
  onPositionChange: (position: ProjectPosition) => void;
  onOpen: () => void;
  reducedMotion: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const positionLayout: ProjectPositionLayout = compact ? "compact" : "desktop";
  const anchorX = savedPosition?.x ?? (compact ? compactPosition.x : project.anchorX);
  const anchorY = savedPosition?.y ?? (compact ? compactPosition.y : project.anchorY);
  const persistPosition = useCallback(
    ({ offset, containerWidth, containerHeight }: DragCompletion) => {
      onPositionChange({
        x: anchorX + (offset.x / containerWidth) * 100,
        y: anchorY + (offset.y / containerHeight) * 100,
      });
    },
    [anchorX, anchorY, onPositionChange],
  );
  const drag = useDraggable({ resetKey: positionLayout, onDragComplete: persistPosition });

  const open = () => {
    if (!drag.consumeSuppressedClick()) onOpen();
  };

  return (
    <div
      ref={drag.elementRef}
      data-desktop-project-icon={project.id}
      role="button"
      tabIndex={0}
      aria-label={`打开${project.title}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: `calc(${anchorX}% - 52px)`,
        top: `calc(${anchorY}% - 64px)`,
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        flexDirection: "column",
        gap: 8,
        width: 108,
        color: "white",
        cursor: "grab",
        userSelect: "none",
        touchAction: "none",
        transform: "translate3d(0,0,0)",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div
        style={{
          display: "grid",
          width: 108,
          minHeight: 108,
          padding: 12,
          placeItems: "center",
          border: `2px solid ${hovered ? "rgba(255,255,255,0.24)" : "transparent"}`,
          borderRadius: 10,
          background: hovered ? "rgba(0,0,0,0.18)" : "transparent",
          transition: reducedMotion ? "none" : "background 0.18s ease, border-color 0.18s ease",
        }}
      >
        <img
          src={project.thumbnail}
          alt=""
          width={80}
          height={80}
          loading="eager"
          decoding="async"
          draggable={false}
          style={{
            display: "block",
            width: 80,
            height: 80,
            border: 0,
            borderRadius: 8,
            objectFit: "cover",
            boxShadow: "0 1px 8px rgba(0,0,0,0.14)",
            pointerEvents: "none",
          }}
        />
      </div>
      <div
        style={{
          maxWidth: 150,
          padding: hovered ? "4px 8px" : "4px 0",
          overflow: "hidden",
          borderRadius: 4,
          background: hovered ? "rgb(0,102,221)" : "transparent",
          color: "rgb(247,247,247)",
          fontFamily: "'Inter',sans-serif",
          fontSize: compact ? 13 : 16,
          fontWeight: 400,
          lineHeight: 1.4,
          letterSpacing: "-0.04em",
          textAlign: "center",
          textOverflow: "ellipsis",
          textShadow: "0 1px 8px rgba(0,0,0,0.48)",
          whiteSpace: "nowrap",
          transition: reducedMotion ? "none" : "background 0.18s ease, padding 0.18s ease",
        }}
      >
        {project.title}
      </div>
    </div>
  );
}

function DockIcon({
  label,
  image,
  children,
  background,
  onClick,
  compact,
  reducedMotion,
}: {
  label: string;
  image?: string;
  children?: ReactNode;
  background?: string;
  onClick: () => void;
  compact: boolean;
  reducedMotion: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const size = compact ? 42 : 48;

  return (
    <div
      style={{ position: "relative", display: "flex", alignItems: "center", flexDirection: "column" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        role="tooltip"
        style={{
          position: "absolute",
          bottom: "calc(100% + 12px)",
          left: "50%",
          zIndex: 3,
          padding: "6px 12px",
          borderRadius: 64,
          background: "white",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          color: "black",
          fontFamily: "'Inter',sans-serif",
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "-0.04em",
          opacity: hovered ? 1 : 0,
          pointerEvents: "none",
          transform: `translateX(-50%) translateY(${hovered ? 0 : 3}px)`,
          transition: reducedMotion ? "none" : "opacity 0.15s ease, transform 0.15s ease",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <span
          style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            width: 0,
            height: 0,
            borderTop: "8px solid white",
            borderRight: "6px solid transparent",
            borderLeft: "6px solid transparent",
            transform: "translateX(-50%)",
          }}
        />
      </div>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        style={{
          display: "grid",
          width: size,
          height: size,
          padding: 0,
          overflow: "hidden",
          placeItems: "center",
          border: image ? 0 : glassBorder,
          borderRadius: "28%",
          background: image ? "transparent" : (background ?? "rgba(255,255,255,0.92)"),
          boxShadow: "0 5px 14px rgba(0,0,0,0.18)",
          color: "white",
          transform: hovered ? "translate3d(0,-2px,0) scale(1.12)" : "translate3d(0,0,0) scale(1)",
          transition: reducedMotion ? "none" : "transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        {image ? (
          <img
            src={image}
            alt=""
            width={size}
            height={size}
            decoding="async"
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
          />
        ) : (
          children
        )}
      </button>
    </div>
  );
}

function WindowShell({
  title,
  wide = false,
  zIndex,
  onActivate,
  onClose,
  children,
}: {
  title: string;
  wide?: boolean;
  zIndex: number;
  onActivate: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const compact = useCompactViewport();
  const reducedMotion = useReducedMotion();
  const windowRef = useRef<HTMLElement | null>(null);
  const dragLayerRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef<DragOffset>({ x: 0, y: 0 });
  const dragRef = useRef({ active: false, pointerId: -1, startX: 0, startY: 0, x: 0, y: 0 });
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<DragOffset>({ x: 0, y: 0 });

  useEffect(() => {
    if (reducedMotion) {
      setVisible(true);
      return;
    }
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [reducedMotion]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const onTitlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      maximized ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button")
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: offsetRef.current.x,
      y: offsetRef.current.y,
    };
    if (dragLayerRef.current) dragLayerRef.current.style.willChange = "transform";
  };

  const onTitlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    pendingRef.current = {
      x: drag.x + event.clientX - drag.startX,
      y: drag.y + event.clientY - drag.startY,
    };
    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const node = dragLayerRef.current;
        if (!node) return;
        const { x, y } = pendingRef.current;
        node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      });
    }
  };

  const onTitlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    drag.active = false;
    offsetRef.current = pendingRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragLayerRef.current) dragLayerRef.current.style.willChange = "auto";
  };

  return createPortal(
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: compact ? 12 : 32,
        pointerEvents: "none",
      }}
    >
      <div
        ref={dragLayerRef}
        className={`desktop-home-window-drag-layer ${maximized ? "is-maximized" : ""}`}
        style={{ transform: "translate3d(0,0,0)" }}
      >
        <section
          ref={windowRef}
          className={`desktop-home-window-shell ${maximized ? "is-maximized" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onPointerDownCapture={onActivate}
          style={{
            position: "relative",
            display: "flex",
            width: compact ? "calc(100vw - 24px)" : wide ? "70vw" : "60vw",
            maxWidth: wide ? 840 : 720,
            maxHeight: compact ? "calc(100dvh - 130px)" : "70vh",
            overflow: "hidden",
            flexDirection: "column",
            border: "1px solid rgba(255,255,255,0.82)",
            borderRadius: compact ? 18 : 24,
            background: "rgba(255,255,255,0.97)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.28)",
            opacity: visible ? 1 : 0,
            pointerEvents: "all",
            transform: visible ? "scale(1)" : "scale(0.8)",
            transformOrigin: "center",
            transition: reducedMotion
              ? "none"
              : "transform 0.4s cubic-bezier(0.34,1.28,0.64,1), opacity 0.3s ease",
          }}
        >
          <WindowResizeHandles
            targetRef={windowRef}
            minWidth={320}
            minHeight={240}
            disabled={maximized}
          />
          <div
            onPointerDown={onTitlePointerDown}
            onPointerMove={onTitlePointerMove}
            onPointerUp={onTitlePointerUp}
            onPointerCancel={onTitlePointerUp}
            onDoubleClick={() => setMaximized((current) => !current)}
            style={{
              position: "relative",
              display: "flex",
              height: 40,
              minHeight: 40,
              alignItems: "center",
              padding: "0 16px",
              borderBottom: "1px solid rgb(229,229,234)",
              cursor: maximized ? "default" : "grab",
              touchAction: "none",
            }}
          >
            <div className="desktop-home-window-lights">
              <button
                type="button"
                className="desktop-home-window-light close"
                title="关闭窗口"
                aria-label="关闭窗口"
                onClick={onClose}
              />
              <button
                type="button"
                className="desktop-home-window-light minimize"
                title="最小化窗口"
                aria-label="最小化窗口"
                onClick={onClose}
              />
              <button
                type="button"
                className="desktop-home-window-light maximize"
                title={maximized ? "还原窗口" : "最大化窗口"}
                aria-label={maximized ? "还原窗口" : "最大化窗口"}
                onClick={() => setMaximized((current) => !current)}
              />
            </div>
            <span
              style={{
                position: "absolute",
                left: "50%",
                overflow: "hidden",
                maxWidth: "55%",
                color: "rgb(134,134,139)",
                fontFamily: "'Inter',sans-serif",
                fontSize: compact ? 13 : 15,
                fontWeight: 400,
                letterSpacing: "-0.04em",
                textOverflow: "ellipsis",
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              minHeight: 0,
              padding: 16,
              overflowY: "auto",
              flex: 1,
              flexDirection: "column",
              gap: 16,
              overscrollBehavior: "contain",
            }}
          >
            {children}
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}

const panelHeadingStyle: CSSProperties = {
  margin: 0,
  color: "#171719",
  fontFamily: "'Inter',sans-serif",
  fontSize: 24,
  fontWeight: 600,
  letterSpacing: "-0.045em",
  lineHeight: 1.15,
};

const panelCopyStyle: CSSProperties = {
  margin: 0,
  color: "#68686d",
  fontSize: 14,
  lineHeight: 1.7,
};

function PrimaryWindowButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        minHeight: 42,
        alignItems: "center",
        alignSelf: "flex-start",
        justifyContent: "center",
        gap: 8,
        padding: "0 16px",
        border: 0,
        borderRadius: 11,
        background: "rgb(0,102,221)",
        boxShadow: "0 6px 18px rgba(0,102,221,0.2)",
        color: "white",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {children}
      <ArrowRight size={15} />
    </button>
  );
}

export function DesktopHome({
  activePersonaName,
  chatModelLabel,
  chatModelReady,
  personaCount,
  characterCount,
  extensionCount,
  enabledExtensionCount,
  sessionCount,
  recentSessions,
  overlayZIndex,
  onOverlayActivate,
  onNavigate,
  onOpenRecentSession,
  children,
}: DesktopHomeProps) {
  const [overlay, setOverlay] = useState<OverlayId | null>(null);
  const compact = useCompactViewport();
  const reducedMotion = useReducedMotion();
  const { positions, positionsReady, updateProjectPosition } = usePersistentProjectPositions();
  const positionLayout: ProjectPositionLayout = compact ? "compact" : "desktop";

  useEffect(() => {
    document.body.classList.add("desktop-home-active");
    return () => document.body.classList.remove("desktop-home-active");
  }, []);

  const closeOverlay = useCallback(() => setOverlay(null), []);
  const openOverlay = useCallback(
    (nextOverlay: OverlayId) => {
      setOverlay(nextOverlay);
      onOverlayActivate();
    },
    [onOverlayActivate],
  );

  const projects = useMemo<ProjectSpec[]>(
    () => [
      {
        id: "chat",
        title: "Agent Chat",
        kicker: "CONVERSATION",
        description: "使用当前模型直接对话，或带着人格与角色设定进入一段新的会话。",
        actionLabel: "开始对话",
        anchorX: 42.75,
        anchorY: 48.5,
        thumbnail: PROJECT_THUMBNAILS[0],
        icon: <MessageSquare size={20} />,
        stats: [chatModelLabel, `${sessionCount} 个会话`],
      },
      {
        id: "studio",
        title: "人格工作室",
        kicker: "PERSONA STUDIO",
        description: "编辑人格档案、长期记忆、行为边界与结构化条目，让智能体保持一致。",
        actionLabel: "打开工作室",
        anchorX: 26,
        anchorY: 29.5,
        thumbnail: PROJECT_THUMBNAILS[1],
        icon: <Bot size={20} />,
        stats: [`${personaCount} 个人格`, `当前：${activePersonaName}`],
      },
      {
        id: "characters",
        title: "角色卡管理",
        kicker: "CHARACTER LIBRARY",
        description: "导入、编辑、翻译与导出 SillyTavern PNG / JSON 角色卡。",
        actionLabel: "打开管理器",
        anchorX: 23.33,
        anchorY: 60.88,
        thumbnail: PROJECT_THUMBNAILS[2],
        icon: <BookOpen size={20} />,
        stats: [`${characterCount} 张角色卡`, "PNG / JSON"],
      },
      {
        id: "extensions",
        title: "扩展中心",
        kicker: "EXTENSIONS",
        description: "安装和运行酒馆扩展兼容层，为会话增加模板、变量与提示词能力。",
        actionLabel: "管理扩展",
        anchorX: 68,
        anchorY: 62.13,
        thumbnail: PROJECT_THUMBNAILS[3],
        icon: <Puzzle size={20} />,
        stats: [`${extensionCount} 个已安装`, `${enabledExtensionCount} 个已启用`],
      },
      {
        id: "settings",
        title: "系统设置",
        kicker: "PREFERENCES",
        description: "管理模型服务、提示词、预设、世界书、正则与设备能力。",
        actionLabel: "打开设置",
        anchorX: 66.08,
        anchorY: 19.63,
        thumbnail: PROJECT_THUMBNAILS[4],
        icon: <Settings2 size={20} />,
        stats: [chatModelReady ? "模型已就绪" : "模型待配置", chatModelLabel],
      },
      {
        id: "recent",
        title: "最近会话",
        kicker: "RECENT NOTES",
        description: "继续处理最近的对话与工作区上下文，快速回到上一次离开的地方。",
        actionLabel: "查看全部会话",
        anchorX: 73.92,
        anchorY: 40.75,
        thumbnail: PROJECT_THUMBNAILS[5],
        icon: <Sparkles size={20} />,
        stats: [`${sessionCount} 个会话`, recentSessions[0]?.title ?? "暂无会话"],
      },
    ],
    [
      activePersonaName,
      characterCount,
      chatModelLabel,
      chatModelReady,
      enabledExtensionCount,
      extensionCount,
      personaCount,
      recentSessions,
      sessionCount,
    ],
  );

  const activeProject = projects.find((project) => project.id === overlay);
  const compactPositions = [
    { x: 30, y: 27 },
    { x: 70, y: 25 },
    { x: 30, y: 47 },
    { x: 70, y: 45 },
    { x: 30, y: 67 },
    { x: 70, y: 65 },
  ];

  const goTo = (destination: HomeDestination) => {
    setOverlay(null);
    onNavigate(destination);
  };

  return (
    <main
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        minHeight: 480,
        overflow: "hidden",
        isolation: "isolate",
        background: "#77746d",
        color: "white",
        fontFamily: "'Inter',sans-serif",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          backgroundImage: `url(${BACKGROUND_IMAGE})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
          transform: "translateZ(0)",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          background: "linear-gradient(180deg, rgba(84,84,84,0) 0%, rgb(0,0,0) 100%)",
          opacity: 0.4,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          zIndex: 1,
          width: "100%",
          height: compact ? "13.333%" : "15.792%",
          pointerEvents: "none",
          transform: "translate3d(-50%,0,0)",
          WebkitBackdropFilter: compact ? "blur(6px)" : "blur(10px)",
          backdropFilter: compact ? "blur(6px)" : "blur(10px)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 40%)",
          maskImage: "linear-gradient(to bottom, transparent 0%, black 40%)",
        }}
      />

      <header
        style={{
          position: "absolute",
          top: compact ? 18 : 28,
          right: compact ? 18 : 32,
          left: compact ? 18 : 32,
          zIndex: 3,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          pointerEvents: "none",
          textShadow: "0 1px 14px rgba(0,0,0,0.28)",
        }}
      >
        <div>
          <div style={{ fontSize: compact ? 15 : 18, fontWeight: 600, letterSpacing: "-0.05em" }}>
            Renge Agent Lab
          </div>
          <div
            style={{
              marginTop: 4,
              color: "rgba(255,255,255,0.72)",
              fontSize: compact ? 10 : 11,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Persona Intelligence Workspace
          </div>
        </div>
        <div
          style={{
            display: compact ? "none" : "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 11px",
            border: glassBorder,
            borderRadius: 999,
            background: "rgba(14,14,14,0.16)",
            color: "rgba(255,255,255,0.86)",
            fontSize: 11,
            backdropFilter: "blur(5px)",
            WebkitBackdropFilter: "blur(5px)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: chatModelReady ? "#45e47e" : "#ffc84a",
              boxShadow: `0 0 0 3px ${chatModelReady ? "rgba(69,228,126,.18)" : "rgba(255,200,74,.18)"}`,
            }}
          />
          {activePersonaName} · {chatModelLabel}
        </div>
      </header>

      {positionsReady &&
        projects.map((project, index) => (
          <ProjectCard
            key={project.id}
            project={project}
            compact={compact}
            compactPosition={compactPositions[index]}
            savedPosition={positions[positionLayout]?.[project.id] ?? null}
            onPositionChange={(position) =>
              updateProjectPosition(project.id, positionLayout, position)
            }
            onOpen={() => openOverlay(project.id)}
            reducedMotion={reducedMotion}
          />
        ))}

      {!compact && (
        <div
          style={{
            position: "absolute",
            bottom: 28,
            left: 32,
            zIndex: 3,
            color: "rgba(255,255,255,0.58)",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.08em",
            pointerEvents: "none",
            textTransform: "uppercase",
          }}
        >
          Drag to arrange · Click to open
        </div>
      )}

      <nav
        aria-label="快捷启动栏"
        style={{
          position: "absolute",
          bottom: compact ? 2 : 24,
          left: "50%",
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          gap: compact ? 8 : 16,
          padding: compact ? 9 : 12,
          border: glassBorder,
          borderRadius: compact ? 20 : 24,
          background: "rgba(255,255,255,0.1)",
          boxShadow: "0 14px 34px rgba(0,0,0,0.12)",
          transform: "translate3d(-50%,0,0)",
          WebkitBackdropFilter: "blur(5px)",
          backdropFilter: "blur(5px)",
        }}
      >
        <DockIcon
          label="关于 Renge"
          image={ABOUT_ICON}
          compact={compact}
          reducedMotion={reducedMotion}
          onClick={() => openOverlay("about")}
        />
        <DockIcon
          label="最近会话"
          image={NOTES_ICON}
          compact={compact}
          reducedMotion={reducedMotion}
          onClick={() => openOverlay("recent")}
        />
        <div
          aria-hidden="true"
          style={{
            width: 1,
            height: compact ? 42 : 48,
            borderRadius: 64,
            background: "rgba(255,255,255,0.2)",
          }}
        />
        <DockIcon
          label="人格工作室"
          image={personaStudioModuleIcon}
          compact={compact}
          reducedMotion={reducedMotion}
          onClick={() => goTo("studio")}
        />
        <DockIcon
          label="开始对话"
          image={chatModuleIcon}
          compact={compact}
          reducedMotion={reducedMotion}
          onClick={() => goTo("chat")}
        />
        <DockIcon
          label="系统设置"
          image={settingsModuleIcon}
          compact={compact}
          reducedMotion={reducedMotion}
          onClick={() => goTo("settings")}
        />
      </nav>

      {activeProject && activeProject.id !== "recent" && (
        <WindowShell
          title={activeProject.title}
          zIndex={overlayZIndex}
          onActivate={onOverlayActivate}
          onClose={closeOverlay}
        >
          <div
            style={{
              display: "grid",
              minHeight: compact ? 112 : 148,
              gridTemplateColumns: compact ? "80px minmax(0,1fr)" : "118px minmax(0,1fr)",
              gap: compact ? 14 : 20,
              alignItems: "center",
            }}
          >
            <img
              src={activeProject.thumbnail}
              alt=""
              width={118}
              height={118}
              decoding="async"
              style={{
                width: "100%",
                aspectRatio: "1",
                borderRadius: 14,
                objectFit: "cover",
                boxShadow: "0 10px 28px rgba(25,25,28,.16)",
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  marginBottom: 7,
                  color: "rgb(0,102,221)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.12em",
                }}
              >
                {activeProject.icon}
                {activeProject.kicker}
              </div>
              <h2 style={{ ...panelHeadingStyle, fontSize: compact ? 20 : 24 }}>{activeProject.title}</h2>
              <p style={{ ...panelCopyStyle, marginTop: 9, fontSize: compact ? 12 : 14 }}>
                {activeProject.description}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {activeProject.stats.map((stat) => (
              <span
                key={stat}
                style={{
                  maxWidth: "100%",
                  padding: "7px 10px",
                  overflow: "hidden",
                  border: "1px solid #e8e8ec",
                  borderRadius: 9,
                  background: "#f7f7f9",
                  color: "#636369",
                  fontSize: 11,
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {stat}
              </span>
            ))}
          </div>
          <PrimaryWindowButton onClick={() => goTo(activeProject.id as HomeDestination)}>
            {activeProject.actionLabel}
          </PrimaryWindowButton>
        </WindowShell>
      )}

      {overlay === "recent" && (
        <WindowShell
          title="最近会话"
          wide
          zIndex={overlayZIndex}
          onActivate={onOverlayActivate}
          onClose={closeOverlay}
        >
          <div>
            <h2 style={panelHeadingStyle}>继续上一次对话</h2>
            <p style={{ ...panelCopyStyle, marginTop: 7 }}>选择一个会话，立即回到对应的工作区。</p>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {recentSessions.length > 0 ? (
              recentSessions.map((session) => (
                <button
                  type="button"
                  key={session.id}
                  onClick={() => {
                    setOverlay(null);
                    onOpenRecentSession(session.id);
                  }}
                  style={{
                    display: "grid",
                    width: "100%",
                    minHeight: 62,
                    gridTemplateColumns: "40px minmax(0,1fr) auto",
                    gap: 11,
                    alignItems: "center",
                    padding: "8px 11px",
                    border: "1px solid #e5e5e9",
                    borderRadius: 12,
                    background: "#fafafd",
                    color: "#202024",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      display: "grid",
                      width: 40,
                      height: 40,
                      placeItems: "center",
                      borderRadius: 10,
                      background: "linear-gradient(145deg,#67aaff,#0767dc)",
                      color: "white",
                    }}
                  >
                    <MessageSquare size={17} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <strong
                      style={{
                        display: "block",
                        overflow: "hidden",
                        fontSize: 13,
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {session.title}
                    </strong>
                    <small
                      style={{
                        display: "block",
                        marginTop: 4,
                        overflow: "hidden",
                        color: "#808086",
                        fontSize: 10,
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {session.workspaceName} · {session.messageCount} 条消息
                    </small>
                  </span>
                  <time
                    dateTime={session.updatedAt}
                    style={{
                      display: compact ? "none" : "block",
                      color: "#929298",
                      fontSize: 10,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {new Date(session.updatedAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </button>
              ))
            ) : (
              <div
                style={{
                  display: "grid",
                  minHeight: 160,
                  placeItems: "center",
                  border: "1px dashed #d9d9de",
                  borderRadius: 14,
                  color: "#85858b",
                  fontSize: 13,
                }}
              >
                还没有会话，去开启一段新对话吧。
              </div>
            )}
          </div>
          <PrimaryWindowButton onClick={() => goTo("chat")}>查看全部会话</PrimaryWindowButton>
        </WindowShell>
      )}

      {overlay === "about" && (
        <WindowShell
          title="关于 Renge"
          zIndex={overlayZIndex}
          onActivate={onOverlayActivate}
          onClose={closeOverlay}
        >
          <div
            style={{
              display: "grid",
              minHeight: 190,
              placeItems: "center",
              alignContent: "center",
              gap: 12,
              padding: 18,
              borderRadius: 16,
              background: "linear-gradient(145deg,#f4f8f6,#eef3ff)",
              textAlign: "center",
            }}
          >
            <span
              style={{
                display: "grid",
                width: 62,
                height: 62,
                placeItems: "center",
                borderRadius: 18,
                background: "linear-gradient(145deg,#30353d,#101215)",
                boxShadow: "0 12px 28px rgba(17,20,25,.2)",
                color: "white",
              }}
            >
              <Boxes size={29} />
            </span>
            <div>
              <h2 style={panelHeadingStyle}>Renge Agent Lab</h2>
              <p style={{ ...panelCopyStyle, marginTop: 7 }}>
                为人格、角色与智能体对话打造的一体化创作工作台。
              </p>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[`${personaCount} 个人格`, `${characterCount} 张角色卡`, `${sessionCount} 个会话`].map(
              (stat) => (
                <span
                  key={stat}
                  style={{
                    padding: "7px 10px",
                    border: "1px solid #e8e8ec",
                    borderRadius: 9,
                    background: "#f7f7f9",
                    color: "#636369",
                    fontSize: 11,
                  }}
                >
                  {stat}
                </span>
              ),
            )}
          </div>
        </WindowShell>
      )}

      {children}
    </main>
  );
}
