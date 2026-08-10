import {
  Activity,
  ArrowLeft,
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  Construction,
  FolderOpen,
  GripVertical,
  Globe,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Smartphone,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { BrowserSidebarPanel } from "./BrowserSidebarPanel";
import type { BrowserPageComment } from "./browserSidebarComments";
import { FilesSidebarPanel, type FileBrowserSource } from "./FilesSidebarPanel";
import { TerminalSidebarPanel } from "./TerminalSidebarPanel";
import { WechatSidebar } from "./WechatSidebar";
import { registerTerminalSidebarOpener } from "./terminalSidebarRuntime";
import { registerBrowserSidebarOpener } from "./browserSidebarRuntime";
import {
  clampRightSidebarWidth,
  getRightSidebarMaxWidth,
  RIGHT_SIDEBAR_MIN_WIDTH,
} from "./rightSidebarSizing";
import {
  getStatusBarItemValue,
  isDefaultStatusBarPreset,
  MAX_STATUS_BAR_PRESETS,
  normalizeStatusBarState,
  type StatusBarPreset,
  type StatusBarState,
} from "./statusBarUtils";
import type { AgentPersona } from "./types";
import type { WechatContact } from "./wechatSidebarUtils";
import "./status-bar.css";

type StatusBarItem = StatusBarState["items"][number];
type StatusBarItemType = StatusBarItem["type"];
type StatusBarItemWidth = StatusBarItem["width"];
type StatusBarItemSize = StatusBarItem["size"];
export type StatusBarProviderOption = {
  id: string;
  name: string;
  models: string[];
};

export type StatusBarSidebarProps = {
  state: StatusBarState;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onStateChange: (next: StatusBarState) => void;
  onClearValues: () => void;
  onManualUpdate: () => void | Promise<void>;
  providerOptions: StatusBarProviderOption[];
  presets: StatusBarPreset[];
  onPresetsChange: (next: StatusBarPreset[]) => void;
  manualUpdateDisabled?: boolean;
  manualUpdateRunning?: boolean;
  fileBrowserSource?: FileBrowserSource | null;
  onChooseWorkspace?: () => void | Promise<void>;
  onBrowserComment?: (comment: BrowserPageComment) => void;
  terminalWorkspaceKey?: string;
  terminalWorkspacePath?: string;
  personas: AgentPersona[];
  userProfile: {
    nickname: string;
    bio: string;
    avatarImage: string;
  };
  chatGenerationBusy?: boolean;
  chatSessionId: string;
  onWechatSendMessage: (contact: WechatContact, content: string) => Promise<string>;
};

type StatusBarCssProperties = CSSProperties & {
  "--status-accent"?: string;
  "--right-sidebar-width"?: string;
};

type RightSidebarToolId = "phone" | "review" | "terminal" | "browser" | "files" | "status";
type RightSidebarViewId = "menu" | RightSidebarToolId;

const RIGHT_SIDEBAR_DEFAULT_WIDTH = 360;
const RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "renge-chat-right-sidebar-width";

const RIGHT_SIDEBAR_TOOLS = [
  {
    id: "phone",
    label: "手机",
    description: "微信联系人与共享上下文聊天",
    icon: Smartphone,
    available: true,
  },
  {
    id: "review",
    label: "审阅",
    description: "查看与审阅代码变更",
    icon: ClipboardCheck,
    available: false,
  },
  {
    id: "terminal",
    label: "终端",
    description: "运行命令并查看输出",
    icon: SquareTerminal,
    available: true,
  },
  {
    id: "browser",
    label: "浏览器",
    description: "AI 读取、控制和编辑网页",
    icon: Globe,
    available: true,
  },
  {
    id: "files",
    label: "文件",
    description: "浏览工作区或临时文件",
    icon: FolderOpen,
    available: true,
  },
  {
    id: "status",
    label: "状态栏",
    description: "查看会话中的动态状态",
    icon: Activity,
    available: true,
  },
] as const satisfies ReadonlyArray<{
  id: RightSidebarToolId;
  label: string;
  description: string;
  icon: typeof Activity;
  available: boolean;
}>;

function loadRightSidebarWidth() {
  if (typeof window === "undefined") return RIGHT_SIDEBAR_DEFAULT_WIDTH;
  try {
    const storedWidth = Number.parseFloat(
      window.localStorage.getItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY) ?? "",
    );
    return Number.isFinite(storedWidth)
      ? clampRightSidebarWidth(
          storedWidth,
          getRightSidebarMaxWidth(window.innerWidth, 0),
        )
      : RIGHT_SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return RIGHT_SIDEBAR_DEFAULT_WIDTH;
  }
}

function saveRightSidebarWidth(width: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // The sidebar still resizes for the current session when storage is unavailable.
  }
}

const DEFAULT_ACCENT_COLOR = "#ff758c";
const EDITOR_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const STATUS_TYPE_OPTIONS: Array<{ value: StatusBarItemType; label: string }> = [
  { value: "grid", label: "方块数据" },
  { value: "banner", label: "横幅提示" },
  { value: "progress", label: "进度条" },
  { value: "list", label: "列表行" },
  { value: "divider", label: "分割线" },
  { value: "header", label: "顶部标签" },
];

const STATUS_WIDTH_OPTIONS: Array<{ value: StatusBarItemWidth; label: string }> = [
  { value: "short", label: "短" },
  { value: "medium", label: "中" },
  { value: "long", label: "长" },
];

const STATUS_SIZE_OPTIONS: Array<{ value: StatusBarItemSize; label: string }> = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "large", label: "大" },
];

const ITEM_TYPE_DEFAULTS: Record<
  StatusBarItemType,
  Pick<StatusBarItem, "description" | "label" | "icon" | "width" | "size" | "initialValue">
> = {
  header: {
    description: "",
    label: "时间",
    icon: "🕒",
    width: "short",
    size: "small",
    initialValue: "待填入",
  },
  banner: {
    description: "",
    label: "心理",
    icon: "🎭",
    width: "long",
    size: "medium",
    initialValue: "平静",
  },
  grid: {
    description: "",
    label: "新属性",
    icon: "✨",
    width: "medium",
    size: "medium",
    initialValue: "待填入",
  },
  progress: {
    description: "",
    label: "进度",
    icon: "📊",
    width: "long",
    size: "medium",
    initialValue: 0,
  },
  list: {
    description: "",
    label: "条目",
    icon: "📍",
    width: "long",
    size: "medium",
    initialValue: "待填入",
  },
  divider: {
    description: "",
    label: "分割线",
    icon: "",
    width: "long",
    size: "small",
    initialValue: "",
  },
};

function cloneStatusBarState(state: StatusBarState): StatusBarState {
  return {
    ...state,
    items: state.items.map((item) => ({ ...item })),
    values: { ...state.values },
  };
}

function createStatusItemId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `status-item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createStatusPresetId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `status-preset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clonePresetItems(items: StatusBarPreset["items"]): StatusBarPreset["items"] {
  return items.map((item) => ({ ...item }));
}

function createUniquePresetName(presets: StatusBarPreset[], requestedName: string) {
  const userPresetCount = presets.filter((preset) => !isDefaultStatusBarPreset(preset)).length;
  const baseName = requestedName.trim().slice(0, 48) || `状态栏预设 ${userPresetCount + 1}`;
  const existingNames = new Set(presets.map((preset) => preset.name.toLocaleLowerCase()));
  if (!existingNames.has(baseName.toLocaleLowerCase())) return baseName;

  let suffix = 2;
  let candidate = "";
  do {
    const suffixText = ` ${suffix}`;
    candidate = `${baseName.slice(0, 48 - suffixText.length)}${suffixText}`;
    suffix += 1;
  } while (existingNames.has(candidate.toLocaleLowerCase()));
  return candidate;
}

function createUniqueVariableName(items: StatusBarItem[], prefix = "新变量") {
  const existingNames = new Set(
    items
      .filter((item) => item.type !== "divider")
      .map((item) => item.variableName.trim().toLocaleLowerCase()),
  );
  if (!existingNames.has(prefix.toLocaleLowerCase())) return prefix;

  let suffix = 2;
  while (existingNames.has(`${prefix}${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${prefix}${suffix}`;
}

function createStatusItem(type: StatusBarItemType, items: StatusBarItem[]): StatusBarItem {
  const defaults = ITEM_TYPE_DEFAULTS[type];
  return {
    id: createStatusItemId(),
    variableName: type === "divider" ? "" : createUniqueVariableName(items),
    type,
    ...defaults,
  };
}

function getSafeAccentColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : DEFAULT_ACCENT_COLOR;
}

function clampProgressValue(value: unknown) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(100, Math.max(0, Math.round(numericValue)));
}

function formatStatusValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "尚未更新";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getItemLabel(item: StatusBarItem) {
  return item.label.trim() || item.variableName.trim() || "未命名条目";
}

function StatusPanelItem({
  item,
  state,
  previewItemId,
  dragging = false,
}: {
  item: StatusBarItem;
  state: StatusBarState;
  previewItemId?: string;
  dragging?: boolean;
}) {
  const value = getStatusBarItemValue(state, item);
  const label = getItemLabel(item);
  const itemClassName = [
    "status-panel-item",
    `type-${item.type}`,
    `width-${item.width}`,
    `size-${item.size}`,
    dragging ? "is-preview-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const previewProps = { "data-status-preview-item-id": previewItemId };

  if (item.type === "divider") {
    return (
      <div className={itemClassName} {...previewProps}>
        <span />
        <strong>
          {item.icon ? <i aria-hidden="true">{item.icon}</i> : null}
          {label}
        </strong>
        <span />
      </div>
    );
  }

  if (item.type === "banner") {
    return (
      <div className={itemClassName} title={item.variableName} {...previewProps}>
        <strong>
          {item.icon ? <i aria-hidden="true">{item.icon}</i> : null}
          {label}：
        </strong>
        <span>{formatStatusValue(value)}</span>
      </div>
    );
  }

  if (item.type === "progress") {
    const progress = clampProgressValue(value);
    return (
      <div className={itemClassName} title={item.variableName} {...previewProps}>
        <div className="status-progress-heading">
          <strong>
            {item.icon ? <i aria-hidden="true">{item.icon}</i> : null}
            {label}
          </strong>
          <span>{progress}%</span>
        </div>
        <div
          aria-label={`${label} ${progress}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          className="status-progress-track"
          role="progressbar"
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  if (item.type === "list") {
    return (
      <div className={itemClassName} title={item.variableName} {...previewProps}>
        {item.icon ? <i className="status-list-icon" aria-hidden="true">{item.icon}</i> : null}
        <div>
          <strong>{label}</strong>
          <span>{formatStatusValue(value)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={itemClassName} title={item.variableName} {...previewProps}>
      <strong>
        {item.icon ? <i aria-hidden="true">{item.icon}</i> : null}
        {label}
      </strong>
      <span>{formatStatusValue(value)}</span>
    </div>
  );
}

type StatusPanelPreviewProps = {
  state: StatusBarState;
  editor?: boolean;
  draggedItemId?: string;
  onItemInsert?: (
    sourceItemId: string,
    beforeItemId: string | null,
    group: "header" | "body",
  ) => void;
  onPointerDragStart?: (itemId: string) => void;
  onPointerDragEnd?: () => void;
};

function StatusPanelPreview({
  state,
  editor = false,
  draggedItemId = "",
  onItemInsert,
  onPointerDragStart,
  onPointerDragEnd,
}: StatusPanelPreviewProps) {
  const accentColor = getSafeAccentColor(state.accentColor);
  const headerItems = state.items.filter((item) => item.type === "header");
  const bodyItems = state.items.filter((item) => item.type !== "header");
  const style = { "--status-accent": accentColor } as StatusBarCssProperties;
  const canDragItems = editor && Boolean(onItemInsert);
  const [insertionIndicator, setInsertionIndicator] = useState<{
    beforeItemId: string | null;
    group: "header" | "body";
    style: CSSProperties;
  } | null>(null);
  const pointerDragRef = useRef<{
    pointerId: number;
    sourceItemId: string;
    group: "header" | "body";
    beforeItemId: string | null | undefined;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);

  const handlePreviewPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!canDragItems || event.button !== 0 || !(event.target instanceof Element)) return;
    const itemElement = event.target.closest<HTMLElement>("[data-status-preview-item-id]");
    const sourceItemId = itemElement?.dataset.statusPreviewItemId ?? "";
    if (!itemElement || !sourceItemId || !event.currentTarget.contains(itemElement)) return;
    const group = itemElement.closest(".status-panel-header-values") ? "header" : "body";
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setInsertionIndicator(null);
    pointerDragRef.current = {
      pointerId: event.pointerId,
      sourceItemId,
      group,
      beforeItemId: undefined,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
    };
  };

  const handlePreviewPointerMove = (event: PointerEvent<HTMLElement>) => {
    const pointerDrag = pointerDragRef.current;
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    if (
      !pointerDrag.started &&
      Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) < 5
    ) {
      return;
    }
    if (!pointerDrag.started) {
      pointerDrag.started = true;
      onPointerDragStart?.(pointerDrag.sourceItemId);
    }
    const pointedItem = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-status-preview-item-id]");
    if (pointedItem) {
      pointerDrag.beforeItemId = undefined;
      setInsertionIndicator(null);
      return;
    }

    const allItemElements = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("[data-status-preview-item-id]"),
    );
    const sourceElement = allItemElements.find(
      (element) => element.dataset.statusPreviewItemId === pointerDrag.sourceItemId,
    );
    const groupElement =
      pointerDrag.group === "header"
        ? sourceElement?.closest(".status-panel-header-values")
        : sourceElement?.closest(".status-panel-items");
    const groupItemElements = allItemElements.filter(
      (element) => element.parentElement === groupElement,
    );
    const sourceIndex = groupItemElements.findIndex(
      (element) => element.dataset.statusPreviewItemId === pointerDrag.sourceItemId,
    );
    if (!groupElement || sourceIndex < 0) {
      pointerDrag.beforeItemId = undefined;
      setInsertionIndicator(null);
      return;
    }

    const previewRect = event.currentTarget.getBoundingClientRect();
    const boundaryCandidates = Array.from(
      { length: groupItemElements.length + 1 },
      (_, index) => {
        if (index === sourceIndex || index === sourceIndex + 1) return null;
        const previousElement = groupItemElements[index - 1];
        const nextElement = groupItemElements[index];
        const previousRect = previousElement?.getBoundingClientRect();
        const nextRect = nextElement?.getBoundingClientRect();
        const beforeItemId = nextElement?.dataset.statusPreviewItemId ?? null;
        if (previousRect && nextRect) {
          const sameRow =
            Math.abs(previousRect.top - nextRect.top) < 4 &&
            nextRect.left >= previousRect.right;
          if (sameRow) {
            const x = (previousRect.right + nextRect.left) / 2;
            const top = Math.min(previousRect.top, nextRect.top);
            const bottom = Math.max(previousRect.bottom, nextRect.bottom);
            const verticalDistance =
              event.clientY < top
                ? top - event.clientY
                : event.clientY > bottom
                  ? event.clientY - bottom
                  : 0;
            return {
              beforeItemId,
              distance: Math.hypot(event.clientX - x, verticalDistance),
              style: {
                height: Math.max(12, bottom - top),
                left: x - previewRect.left - 1,
                top: top - previewRect.top,
                width: 2,
              } satisfies CSSProperties,
            };
          }
          const y = (previousRect.bottom + nextRect.top) / 2;
          const left = Math.min(previousRect.left, nextRect.left);
          const right = Math.max(previousRect.right, nextRect.right);
          const horizontalDistance =
            event.clientX < left
              ? left - event.clientX
              : event.clientX > right
                ? event.clientX - right
                : 0;
          return {
            beforeItemId,
            distance: Math.hypot(event.clientY - y, horizontalDistance),
            style: {
              height: 2,
              left: left - previewRect.left,
              top: y - previewRect.top - 1,
              width: Math.max(18, right - left),
            } satisfies CSSProperties,
          };
        }
        const edgeRect = nextRect ?? previousRect;
        if (!edgeRect) return null;
        const y = nextRect ? edgeRect.top - 6 : edgeRect.bottom + 6;
        const horizontalDistance =
          event.clientX < edgeRect.left
            ? edgeRect.left - event.clientX
            : event.clientX > edgeRect.right
              ? event.clientX - edgeRect.right
              : 0;
        return {
          beforeItemId,
          distance: Math.hypot(event.clientY - y, horizontalDistance),
          style: {
            height: 2,
            left: edgeRect.left - previewRect.left,
            top: y - previewRect.top - 1,
            width: Math.max(18, edgeRect.width),
          } satisfies CSSProperties,
        };
      },
    )
      .filter((candidate) => candidate !== null)
      .sort((first, second) => first.distance - second.distance);
    const closestBoundary = boundaryCandidates[0];
    if (!closestBoundary || closestBoundary.distance > 18) {
      pointerDrag.beforeItemId = undefined;
      setInsertionIndicator(null);
      return;
    }
    pointerDrag.beforeItemId = closestBoundary.beforeItemId;
    setInsertionIndicator((current) =>
      current?.beforeItemId === closestBoundary.beforeItemId &&
      current.group === pointerDrag.group
        ? current
        : {
            beforeItemId: closestBoundary.beforeItemId,
            group: pointerDrag.group,
            style: closestBoundary.style,
          },
    );
  };

  const finishPreviewPointerDrag = (
    event: PointerEvent<HTMLElement>,
    commitMove = true,
  ) => {
    const pointerDrag = pointerDragRef.current;
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    if (
      commitMove &&
      pointerDrag.started &&
      pointerDrag.beforeItemId !== undefined
    ) {
      onItemInsert?.(
        pointerDrag.sourceItemId,
        pointerDrag.beforeItemId,
        pointerDrag.group,
      );
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerDragRef.current = null;
    setInsertionIndicator(null);
    onPointerDragEnd?.();
  };

  return (
    <section
      className={`status-panel-preview ${editor ? "is-editor-preview" : ""}`}
      onPointerCancel={
        canDragItems ? (event) => finishPreviewPointerDrag(event, false) : undefined
      }
      onPointerDown={canDragItems ? handlePreviewPointerDown : undefined}
      onPointerMove={canDragItems ? handlePreviewPointerMove : undefined}
      onPointerUp={canDragItems ? finishPreviewPointerDrag : undefined}
      style={style}
      aria-label={`${state.title || "状态栏"}预览`}
    >
      <header className="status-panel-preview-header">
        <span className="status-panel-title">{state.title.trim() || "状态监测终端"}</span>
        {headerItems.length > 0 ? (
          <div className="status-panel-header-values">
            {headerItems.map((item) => (
              <span
                className={`width-${item.width} size-${item.size} ${
                  draggedItemId === item.id ? "is-preview-dragging" : ""
                }`}
                data-status-preview-item-id={canDragItems ? item.id : undefined}
                key={item.id}
                title={`${getItemLabel(item)} · ${item.variableName}`}
              >
                {item.icon ? <i aria-hidden="true">{item.icon}</i> : null}
                {formatStatusValue(getStatusBarItemValue(state, item))}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {bodyItems.length > 0 ? (
        <div className="status-panel-items">
          {bodyItems.map((item) => (
            <StatusPanelItem
              dragging={draggedItemId === item.id}
              item={item}
              key={item.id}
              previewItemId={canDragItems ? item.id : undefined}
              state={state}
            />
          ))}
        </div>
      ) : headerItems.length === 0 ? (
        <div className="status-panel-empty">
          <span>尚未添加状态条目</span>
          <small>打开编辑器，创建需要由 AI 维护的变量。</small>
        </div>
      ) : null}
      {insertionIndicator ? (
        <span
          aria-hidden="true"
          className="status-preview-insertion-indicator"
          style={insertionIndicator.style}
        />
      ) : null}
    </section>
  );
}

function validateStatusItems(items: StatusBarItem[]) {
  const errors = new Map<string, string>();
  const groupedNames = new Map<string, string[]>();

  items.forEach((item) => {
    if (item.type === "divider") return;
    const variableName = item.variableName.trim();
    if (!variableName) {
      errors.set(item.id, "变量名不能为空。AI 将通过变量名提交更新。" );
      return;
    }
    const normalizedName = variableName.toLocaleLowerCase();
    groupedNames.set(normalizedName, [...(groupedNames.get(normalizedName) ?? []), item.id]);
  });

  groupedNames.forEach((itemIds) => {
    if (itemIds.length < 2) return;
    itemIds.forEach((itemId) => errors.set(itemId, "变量名必须唯一。"));
  });

  return errors;
}

function normalizeDraftForSave(
  draft: StatusBarState,
  values: StatusBarState["values"],
  enabled: boolean,
) {
  return {
    ...draft,
    enabled,
    title: draft.title.trim() || "状态监测终端",
    accentColor: getSafeAccentColor(draft.accentColor),
    items: draft.items.map((item) => ({
      ...item,
      variableName: item.type === "divider" ? "" : item.variableName.trim(),
      description: item.type === "divider" ? "" : item.description.trim(),
      label: item.label.trim() || item.variableName.trim() || "分割线",
      icon: item.icon.trim(),
      initialValue:
        item.type === "divider"
          ? ""
          : item.type === "progress"
            ? clampProgressValue(item.initialValue)
            : item.initialValue,
    })),
    values,
    updatedAt: new Date().toISOString(),
  } satisfies StatusBarState;
}

export function StatusBarSidebar({
  state,
  collapsed,
  onCollapsedChange,
  onStateChange,
  onClearValues,
  onManualUpdate,
  providerOptions,
  presets,
  onPresetsChange,
  manualUpdateDisabled = false,
  manualUpdateRunning = false,
  fileBrowserSource = null,
  onChooseWorkspace,
  onBrowserComment,
  terminalWorkspaceKey = "default",
  terminalWorkspacePath = "",
  personas,
  userProfile,
  chatGenerationBusy = false,
  chatSessionId,
  onWechatSendMessage,
}: StatusBarSidebarProps) {
  const [activeToolId, setActiveToolId] = useState<RightSidebarViewId>("menu");
  const [requestedTerminalId, setRequestedTerminalId] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(loadRightSidebarWidth);
  const [sidebarMaxWidth, setSidebarMaxWidth] = useState(() =>
    typeof window === "undefined"
      ? RIGHT_SIDEBAR_DEFAULT_WIDTH
      : getRightSidebarMaxWidth(window.innerWidth, 0),
  );
  const sidebarRef = useRef<HTMLElement | null>(null);
  const resizeSessionRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH,
    currentWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH,
    maxWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH,
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<StatusBarState>(() => cloneStatusBarState(state));
  const [draggedItemId, setDraggedItemId] = useState("");
  const [dragOverItemId, setDragOverItemId] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const [valuesClearedInEditor, setValuesClearedInEditor] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presetFeedback, setPresetFeedback] = useState("");
  const [deleteConfirmationPresetId, setDeleteConfirmationPresetId] = useState("");
  const latestStateRef = useRef(state);
  const editorModalRef = useRef<HTMLElement | null>(null);
  const editorInitialFocusRef = useRef<HTMLInputElement | null>(null);
  const presetSelectRef = useRef<HTMLSelectElement | null>(null);
  const editorTriggerRef = useRef<HTMLElement | null>(null);
  const editorFallbackFocusRef = useRef<HTMLButtonElement | null>(null);
  latestStateRef.current = state;

  const validationErrors = useMemo(() => validateStatusItems(draft.items), [draft.items]);
  const selectedStatusProvider = useMemo(
    () => providerOptions.find((provider) => provider.id === draft.providerId),
    [draft.providerId, providerOptions],
  );
  const statusModelOptions = useMemo(() => {
    const models = selectedStatusProvider?.models ?? [];
    return draft.modelId && !models.includes(draft.modelId)
      ? [draft.modelId, ...models]
      : models;
  }, [draft.modelId, selectedStatusProvider]);
  const modelConfigurationError = !selectedStatusProvider
    ? "请选择状态栏供应商"
    : !draft.modelId.trim()
      ? "请选择状态栏模型"
      : "";
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  );
  const selectedPresetIsDefault = isDefaultStatusBarPreset(selectedPreset);
  const userPresetCount = useMemo(
    () => presets.filter((preset) => !isDefaultStatusBarPreset(preset)).length,
    [presets],
  );
  const sidebarStyle = {
    "--status-accent": getSafeAccentColor(state.accentColor),
    "--right-sidebar-width": `${sidebarWidth}px`,
  } as StatusBarCssProperties;

  const getAvailableSidebarMaxWidth = () => {
    const chatShell = sidebarRef.current?.parentElement;
    if (!chatShell) {
      return typeof window === "undefined"
        ? RIGHT_SIDEBAR_DEFAULT_WIDTH
        : getRightSidebarMaxWidth(window.innerWidth, 0);
    }
    const leftSidebar = chatShell.querySelector<HTMLElement>(":scope > .chat-sidebar");
    const leftSidebarWidth = leftSidebar?.getBoundingClientRect().width ?? 0;
    return getRightSidebarMaxWidth(
      chatShell.getBoundingClientRect().width,
      leftSidebarWidth,
    );
  };

  const finishSidebarResize = (handle?: HTMLElement, pointerId?: number) => {
    const session = resizeSessionRef.current;
    if (!session.active) return;
    session.active = false;
    document.body.classList.remove("right-sidebar-resizing");
    if (handle && pointerId !== undefined && handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    saveRightSidebarWidth(session.currentWidth);
  };

  const startSidebarResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const currentWidth = sidebarRef.current?.getBoundingClientRect().width ?? sidebarWidth;
    const maxWidth = getAvailableSidebarMaxWidth();
    setSidebarMaxWidth(maxWidth);
    resizeSessionRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: currentWidth,
      currentWidth,
      maxWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("right-sidebar-resizing");
    event.preventDefault();
  };

  const resizeSidebar = (event: PointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    if (!session.active || session.pointerId !== event.pointerId) return;
    const nextWidth = clampRightSidebarWidth(
      session.startWidth + session.startX - event.clientX,
      session.maxWidth,
    );
    session.currentWidth = nextWidth;
    setSidebarWidth(nextWidth);
  };

  const stopSidebarResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeSessionRef.current.pointerId !== event.pointerId) return;
    finishSidebarResize(event.currentTarget, event.pointerId);
  };

  const resizeSidebarWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
    if (direction === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const maxWidth = getAvailableSidebarMaxWidth();
    const nextWidth =
      event.key === "Home"
        ? RIGHT_SIDEBAR_DEFAULT_WIDTH
        : event.key === "End"
          ? maxWidth
          : sidebarWidth + direction * (event.shiftKey ? 40 : 16);
    const clampedWidth = clampRightSidebarWidth(nextWidth, maxWidth);
    setSidebarMaxWidth(maxWidth);
    setSidebarWidth(clampedWidth);
    saveRightSidebarWidth(clampedWidth);
  };

  useEffect(
    () => () => {
      document.body.classList.remove("right-sidebar-resizing");
    },
    [],
  );

  useEffect(
    () =>
      registerTerminalSidebarOpener((terminalId) => {
        setRequestedTerminalId(terminalId ?? "");
        setActiveToolId("terminal");
        onCollapsedChange(false);
      }),
    [onCollapsedChange],
  );

  useEffect(() => {
    if (collapsed) return;
    const chatShell = sidebarRef.current?.parentElement;
    if (!chatShell) return;
    const keepSidebarInsideWorkspace = () => {
      const nextMaxWidth = getAvailableSidebarMaxWidth();
      setSidebarMaxWidth(nextMaxWidth);
      setSidebarWidth((currentWidth) => {
        const nextWidth = clampRightSidebarWidth(currentWidth, nextMaxWidth);
        if (nextWidth !== currentWidth) saveRightSidebarWidth(nextWidth);
        return nextWidth;
      });
    };
    keepSidebarInsideWorkspace();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", keepSidebarInsideWorkspace);
      return () => window.removeEventListener("resize", keepSidebarInsideWorkspace);
    }
    const resizeObserver = new ResizeObserver(keepSidebarInsideWorkspace);
    resizeObserver.observe(chatShell);
    const leftSidebar = chatShell.querySelector<HTMLElement>(":scope > .chat-sidebar");
    if (leftSidebar) resizeObserver.observe(leftSidebar);
    return () => resizeObserver.disconnect();
  }, [collapsed]);

  useEffect(() => {
    if (collapsed) setActiveToolId("menu");
  }, [collapsed]);

  useEffect(
    () =>
      registerBrowserSidebarOpener(() => {
        setActiveToolId("browser");
        onCollapsedChange(false);
      }),
    [onCollapsedChange],
  );

  const closeEditor = () => setEditorOpen(false);

  useEffect(() => {
    if (!editorOpen || typeof document === "undefined") return;
    const modal = editorModalRef.current;
    const appRoot = document.getElementById("root");
    const previousRootInert = appRoot?.inert ?? false;
    const previousRootHadInertAttribute = appRoot?.hasAttribute("inert") ?? false;
    const previousRootAriaHidden = appRoot?.getAttribute("aria-hidden") ?? null;
    const previousBodyOverflow = document.body.style.overflow;
    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute("inert", "");
    }
    document.body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      editorInitialFocusRef.current?.focus();
      appRoot?.setAttribute("aria-hidden", "true");
    });

    const getFocusableElements = () =>
      modal
        ? Array.from(modal.querySelectorAll<HTMLElement>(EDITOR_FOCUSABLE_SELECTOR)).filter(
            (element) => element.getClientRects().length > 0,
          )
        : [];

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeEditor();
        return;
      }
      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        modal?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey) {
        if (activeElement === firstElement || !modal?.contains(activeElement)) {
          event.preventDefault();
          lastElement.focus();
        }
        return;
      }
      if (activeElement === lastElement || !modal?.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (appRoot) {
        appRoot.inert = previousRootInert;
        if (previousRootHadInertAttribute) appRoot.setAttribute("inert", "");
        else appRoot.removeAttribute("inert");
        if (previousRootAriaHidden === null) appRoot.removeAttribute("aria-hidden");
        else appRoot.setAttribute("aria-hidden", previousRootAriaHidden);
      }
      document.body.style.overflow = previousBodyOverflow;

      const trigger = editorTriggerRef.current;
      const fallbackTrigger = editorFallbackFocusRef.current;
      editorTriggerRef.current = null;
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) {
          trigger.focus();
        } else if (fallbackTrigger?.isConnected) {
          fallbackTrigger.focus();
        }
      });
    };
  }, [editorOpen]);

  const openEditor = (event?: MouseEvent<HTMLButtonElement>) => {
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    editorTriggerRef.current =
      event?.currentTarget ?? (activeElement instanceof HTMLElement ? activeElement : null);
    setDraft(cloneStatusBarState(state));
    setShowValidation(false);
    setValuesClearedInEditor(false);
    setDraggedItemId("");
    setDragOverItemId("");
    setPresetFeedback("");
    setDeleteConfirmationPresetId("");
    setEditorOpen(true);
  };

  const updateDraft = (patch: Partial<StatusBarState>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const updateDraftItem = (itemId: string, patch: Partial<StatusBarItem>) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    }));
  };

  const changeDraftItemType = (item: StatusBarItem, type: StatusBarItemType) => {
    if (type === item.type) return;
    const defaults = ITEM_TYPE_DEFAULTS[type];
    updateDraftItem(item.id, {
      type,
      variableName:
        type === "divider"
          ? ""
          : item.variableName.trim() || createUniqueVariableName(draft.items),
      width: type === "divider" ? "long" : item.width || defaults.width,
      size: type === "divider" ? "small" : item.size || defaults.size,
      initialValue:
        type === "divider"
          ? ""
          : type === "progress"
            ? clampProgressValue(item.initialValue)
            : item.initialValue === ""
              ? defaults.initialValue
              : item.initialValue,
    });
  };

  const addDraftItem = (type: StatusBarItemType) => {
    setDraft((current) => ({
      ...current,
      items: [...current.items, createStatusItem(type, current.items)],
    }));
  };

  const removeDraftItem = (itemId: string) => {
    setDraft((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== itemId),
    }));
  };

  const moveDraftItem = (itemId: string, direction: -1 | 1) => {
    setDraft((current) => {
      const sourceIndex = current.items.findIndex((item) => item.id === itemId);
      const targetIndex = sourceIndex + direction;
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= current.items.length) return current;
      const nextItems = [...current.items];
      const [movedItem] = nextItems.splice(sourceIndex, 1);
      nextItems.splice(targetIndex, 0, movedItem);
      return { ...current, items: nextItems };
    });
  };

  const handleDragStart = (event: DragEvent<HTMLElement>, itemId: string) => {
    setDraggedItemId(itemId);
    setDragOverItemId("");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", itemId);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, targetItemId: string) => {
    event.preventDefault();
    const sourceItemId = draggedItemId || event.dataTransfer.getData("text/plain");
    setDraggedItemId("");
    setDragOverItemId("");
    if (!sourceItemId || sourceItemId === targetItemId) return;
    reorderDraftItems(sourceItemId, targetItemId);
  };

  const reorderDraftItems = (sourceItemId: string, targetItemId: string) => {
    setDraft((current) => {
      const sourceIndex = current.items.findIndex((item) => item.id === sourceItemId);
      const targetIndex = current.items.findIndex((item) => item.id === targetItemId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const nextItems = [...current.items];
      const [movedItem] = nextItems.splice(sourceIndex, 1);
      nextItems.splice(targetIndex, 0, movedItem);
      return { ...current, items: nextItems };
    });
  };

  const insertDraftItemAtPreviewGap = (
    sourceItemId: string,
    beforeItemId: string | null,
    group: "header" | "body",
  ) => {
    setDraft((current) => {
      const sourceIndex = current.items.findIndex((item) => item.id === sourceItemId);
      if (sourceIndex < 0 || beforeItemId === sourceItemId) return current;
      const nextItems = [...current.items];
      const [movedItem] = nextItems.splice(sourceIndex, 1);
      let targetIndex = beforeItemId
        ? nextItems.findIndex((item) => item.id === beforeItemId)
        : -1;
      if (beforeItemId && targetIndex < 0) return current;
      if (!beforeItemId) {
        const belongsToGroup = (item: StatusBarItem) =>
          group === "header" ? item.type === "header" : item.type !== "header";
        const lastGroupIndex = nextItems.reduce(
          (lastIndex, item, index) => (belongsToGroup(item) ? index : lastIndex),
          -1,
        );
        targetIndex =
          lastGroupIndex >= 0
            ? lastGroupIndex + 1
            : group === "header"
              ? 0
              : nextItems.length;
      }
      nextItems.splice(targetIndex, 0, movedItem);
      return nextItems.every((item, index) => item.id === current.items[index]?.id)
        ? current
        : { ...current, items: nextItems };
    });
  };

  const clearSessionValues = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("清空当前会话的全部状态值？条目结构和初始值会保留。")
    ) {
      return;
    }
    onClearValues();
    setValuesClearedInEditor(true);
    setDraft((current) => ({
      ...current,
      values: {} as StatusBarState["values"],
    }));
  };

  const createPresetFromDraft = (id: string, name: string, createdAt: string) => {
    const normalizedDraft = normalizeDraftForSave(
      draft,
      {} as StatusBarState["values"],
      false,
    );
    return {
      id,
      name,
      title: normalizedDraft.title,
      accentColor: normalizedDraft.accentColor,
      items: normalizedDraft.items.map(({ id: _id, ...item }) => item),
      createdAt,
      updatedAt: new Date().toISOString(),
    } satisfies StatusBarPreset;
  };

  const validateDraftBeforePresetSave = () => {
    const nextErrors = validateStatusItems(draft.items);
    if (nextErrors.size === 0) return true;
    setShowValidation(true);
    setPresetFeedback("请先修正变量名，再保存预设。");
    return false;
  };

  const saveDraftAsNewPreset = () => {
    setDeleteConfirmationPresetId("");
    if (!validateDraftBeforePresetSave()) return;
    if (userPresetCount >= MAX_STATUS_BAR_PRESETS) {
      setPresetFeedback(`最多可保存 ${MAX_STATUS_BAR_PRESETS} 个状态栏预设。`);
      return;
    }
    const timestamp = new Date().toISOString();
    const name = createUniquePresetName(presets, presetName);
    const preset = createPresetFromDraft(createStatusPresetId(), name, timestamp);
    onPresetsChange([...presets, preset]);
    setSelectedPresetId(preset.id);
    setPresetName(preset.name);
    setPresetFeedback(`已保存新预设“${preset.name}”。`);
  };

  const updateSelectedPreset = () => {
    setDeleteConfirmationPresetId("");
    if (!selectedPreset) return;
    if (isDefaultStatusBarPreset(selectedPreset)) {
      setPresetFeedback("应用默认预设为内置只读预设；请保存为新预设后再修改。");
      return;
    }
    if (!validateDraftBeforePresetSave()) return;
    const requestedName = presetName.trim().slice(0, 48) || selectedPreset.name;
    const name = createUniquePresetName(
      presets.filter((preset) => preset.id !== selectedPreset.id),
      requestedName,
    );
    const nextPreset = createPresetFromDraft(
      selectedPreset.id,
      name,
      selectedPreset.createdAt,
    );
    onPresetsChange(
      presets.map((preset) => (preset.id === selectedPreset.id ? nextPreset : preset)),
    );
    setPresetName(name);
    setPresetFeedback(`已更新预设“${name}”。`);
  };

  const applySelectedPreset = () => {
    if (!selectedPreset) return;
    setDeleteConfirmationPresetId("");
    setDraft((current) => ({
      ...current,
      title: selectedPreset.title,
      accentColor: selectedPreset.accentColor,
      items: clonePresetItems(selectedPreset.items).map((item) => ({
        ...item,
        id: createStatusItemId(),
      })),
      values: {} as StatusBarState["values"],
      updatedAt: new Date().toISOString(),
    }));
    setValuesClearedInEditor(true);
    setShowValidation(false);
    setPresetName(selectedPreset.name);
    setPresetFeedback(`已载入“${selectedPreset.name}”，保存状态栏后应用到当前会话。`);
  };

  const deleteSelectedPreset = () => {
    if (!selectedPreset) return;
    if (isDefaultStatusBarPreset(selectedPreset)) {
      setDeleteConfirmationPresetId("");
      setPresetFeedback("应用默认预设不可删除；可以应用后保存为新预设。");
      return;
    }
    if (deleteConfirmationPresetId !== selectedPreset.id) {
      setDeleteConfirmationPresetId(selectedPreset.id);
      setPresetFeedback(`再次点击“确认删除”，即可删除预设“${selectedPreset.name}”。`);
      return;
    }
    onPresetsChange(presets.filter((preset) => preset.id !== selectedPreset.id));
    setSelectedPresetId("");
    setPresetName("");
    setDeleteConfirmationPresetId("");
    setPresetFeedback(`已删除预设“${selectedPreset.name}”。`);
    window.requestAnimationFrame(() => presetSelectRef.current?.focus());
  };

  const saveDraft = () => {
    const nextErrors = validateStatusItems(draft.items);
    if (nextErrors.size > 0 || modelConfigurationError) {
      setShowValidation(true);
      return;
    }
    const latestState = latestStateRef.current;
    const nextState = normalizeDraftForSave(
      draft,
      valuesClearedInEditor
        ? ({} as StatusBarState["values"])
        : latestState.values,
      latestState.enabled,
    );
    onStateChange(nextState);
    closeEditor();
  };

  const editorPreviewState = useMemo(
    () => ({
      ...draft,
      values: valuesClearedInEditor ? draft.values : state.values,
    }),
    [draft, state.values, valuesClearedInEditor],
  );

  const editorModal =
    editorOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="status-bar-editor-backdrop"
            onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
              if (event.target === event.currentTarget) closeEditor();
            }}
          >
            <section
              ref={editorModalRef}
              aria-labelledby="status-bar-editor-title"
              aria-modal="true"
              className="status-bar-editor-modal"
              role="dialog"
              tabIndex={-1}
              style={{
                "--status-accent": getSafeAccentColor(draft.accentColor),
              } as StatusBarCssProperties}
            >
              <header className="status-bar-editor-header">
                <div>
                  <span>STATUS BAR DESIGNER</span>
                  <h2 id="status-bar-editor-title">状态栏可视化编辑</h2>
                  <p>定义变量、展示方式与顺序，右侧会实时呈现最终效果。</p>
                </div>
                <button
                  aria-label="关闭状态栏编辑器"
                  className="status-editor-icon-button"
                  onClick={closeEditor}
                  type="button"
                >
                  <X size={19} />
                </button>
              </header>

              <div className="status-bar-editor-content">
                <section className="status-bar-editor-form" aria-label="状态栏条目配置">
                  <div className="status-bar-preset-manager">
                    <div className="status-bar-preset-heading">
                      <div>
                        <strong>状态栏预设</strong>
                        <span>跨会话保存模型、条目结构和样式，不保存实时变量值</span>
                      </div>
                      <small>{userPresetCount} / {MAX_STATUS_BAR_PRESETS}</small>
                    </div>
                    <div className="status-bar-preset-fields">
                      <label>
                        <span>已保存预设</span>
                        <select
                          ref={presetSelectRef}
                          onChange={(event) => {
                            const nextId = event.target.value;
                            const nextPreset = presets.find((preset) => preset.id === nextId);
                            setSelectedPresetId(nextId);
                            setPresetName(nextPreset?.name ?? "");
                            setPresetFeedback(
                              isDefaultStatusBarPreset(nextPreset)
                                ? "应用默认预设为内置只读预设；修改后请保存为新预设。"
                                : "",
                            );
                            setDeleteConfirmationPresetId("");
                          }}
                          value={selectedPresetId}
                        >
                          <option value="">选择一个预设</option>
                          {presets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name}
                              {isDefaultStatusBarPreset(preset) ? "（应用默认·只读）" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>预设名称</span>
                        <input
                          maxLength={48}
                          onChange={(event) => setPresetName(event.target.value)}
                          placeholder={`状态栏预设 ${userPresetCount + 1}`}
                          type="text"
                          value={presetName}
                        />
                      </label>
                    </div>
                    <div className="status-bar-preset-actions">
                      <button disabled={!selectedPreset} onClick={applySelectedPreset} type="button">
                        <RotateCcw size={15} />
                        应用所选
                      </button>
                      <button onClick={saveDraftAsNewPreset} type="button">
                        <Plus size={15} />
                        保存为新预设
                      </button>
                      <button
                        disabled={!selectedPreset || selectedPresetIsDefault}
                        onClick={updateSelectedPreset}
                        title={
                          selectedPresetIsDefault
                            ? "应用默认预设不可修改，请保存为新预设"
                            : "更新所选预设"
                        }
                        type="button"
                      >
                        <Save size={15} />
                        更新所选
                      </button>
                      <button
                        className="danger"
                        disabled={!selectedPreset || selectedPresetIsDefault}
                        onClick={deleteSelectedPreset}
                        title={
                          selectedPresetIsDefault
                            ? "应用默认预设不可删除"
                            : deleteConfirmationPresetId === selectedPreset?.id
                            ? "再次点击确认删除预设"
                            : "删除所选预设"
                        }
                        type="button"
                      >
                        <Trash2 size={15} />
                        {deleteConfirmationPresetId === selectedPreset?.id ? "确认删除" : "删除"}
                      </button>
                    </div>
                    {presetFeedback ? (
                      <p aria-live="polite" className="status-bar-preset-feedback" role="status">
                        {presetFeedback}
                      </p>
                    ) : null}
                  </div>

                  <div className="status-bar-general-fields">
                    <label>
                      <span>状态栏供应商</span>
                      <select
                        onChange={(event) => {
                          const providerId = event.target.value;
                          const provider = providerOptions.find(
                            (candidate) => candidate.id === providerId,
                          );
                          updateDraft({
                            providerId,
                            modelId:
                              provider?.models.includes(draft.modelId)
                                ? draft.modelId
                                : provider?.models[0] ?? "",
                          });
                        }}
                        value={draft.providerId}
                      >
                        <option value="">选择供应商</option>
                        {providerOptions.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.name || "未命名供应商"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>状态栏模型</span>
                      <select
                        disabled={!selectedStatusProvider}
                        onChange={(event) => updateDraft({ modelId: event.target.value })}
                        value={draft.modelId}
                      >
                        <option value="">选择模型</option>
                        {statusModelOptions.map((modelId) => (
                          <option key={modelId} value={modelId}>
                            {modelId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>面板标题</span>
                      <input
                        ref={editorInitialFocusRef}
                        maxLength={48}
                        onChange={(event) => updateDraft({ title: event.target.value })}
                        placeholder="状态监测终端"
                        type="text"
                        value={draft.title}
                      />
                    </label>
                    <label>
                      <span>强调色</span>
                      <span className="status-color-field">
                        <input
                          aria-label="选择状态栏强调色"
                          onChange={(event) => updateDraft({ accentColor: event.target.value })}
                          type="color"
                          value={getSafeAccentColor(draft.accentColor)}
                        />
                        <input
                          maxLength={7}
                          onChange={(event) => updateDraft({ accentColor: event.target.value })}
                          spellCheck={false}
                          type="text"
                          value={draft.accentColor}
                        />
                      </span>
                    </label>
                  </div>

                  <div className="status-bar-item-toolbar">
                    <div>
                      <strong>状态条目</strong>
                      <span>{draft.items.length} 项 · 拖动手柄调整顺序</span>
                    </div>
                    <div>
                      <button onClick={() => addDraftItem("grid")} type="button">
                        <Plus size={15} />
                        添加条目
                      </button>
                      <button onClick={() => addDraftItem("progress")} type="button">
                        <Plus size={15} />
                        进度条
                      </button>
                      <button onClick={() => addDraftItem("divider")} type="button">
                        <Plus size={15} />
                        分割线
                      </button>
                    </div>
                  </div>

                  <div className="status-bar-item-editor-list">
                    {draft.items.length === 0 ? (
                      <div className="status-bar-editor-empty">
                        <span>还没有条目</span>
                        <small>添加一个条目后即可设置变量名和展示样式。</small>
                      </div>
                    ) : (
                      draft.items.map((item, index) => {
                        const itemError = validationErrors.get(item.id);
                        const isDivider = item.type === "divider";
                        return (
                          <div
                            className={`status-bar-item-editor ${
                              dragOverItemId === item.id ? "is-drag-over" : ""
                            } ${showValidation && itemError ? "has-error" : ""}`}
                            key={item.id}
                            onDragLeave={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                setDragOverItemId("");
                              }
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              if (draggedItemId && draggedItemId !== item.id) {
                                setDragOverItemId(item.id);
                              }
                            }}
                            onDrop={(event) => handleDrop(event, item.id)}
                          >
                            <div className="status-bar-item-editor-heading">
                              <button
                                aria-label={`拖动第 ${index + 1} 项`}
                                className="status-drag-handle"
                                draggable
                                onDragEnd={() => {
                                  setDraggedItemId("");
                                  setDragOverItemId("");
                                }}
                                onDragStart={(event) => handleDragStart(event, item.id)}
                                title="拖动排序"
                                type="button"
                              >
                                <GripVertical size={17} />
                              </button>
                              <span className="status-item-index">{index + 1}</span>
                              <strong>{getItemLabel(item)}</strong>
                              <div className="status-item-order-actions">
                                <button
                                  aria-label="上移"
                                  disabled={index === 0}
                                  onClick={() => moveDraftItem(item.id, -1)}
                                  type="button"
                                >
                                  <ChevronUp size={15} />
                                </button>
                                <button
                                  aria-label="下移"
                                  disabled={index === draft.items.length - 1}
                                  onClick={() => moveDraftItem(item.id, 1)}
                                  type="button"
                                >
                                  <ChevronDown size={15} />
                                </button>
                                <button
                                  aria-label="删除条目"
                                  className="danger"
                                  onClick={() => removeDraftItem(item.id)}
                                  type="button"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </div>

                            <div className="status-bar-item-fields">
                              <label className="variable-field">
                                <span>变量名</span>
                                <input
                                  aria-invalid={showValidation && Boolean(itemError)}
                                  disabled={isDivider}
                                  maxLength={64}
                                  onChange={(event) =>
                                    updateDraftItem(item.id, { variableName: event.target.value })
                                  }
                                  placeholder={isDivider ? "分割线不占变量" : "例如：好感度"}
                                  type="text"
                                  value={item.variableName}
                                />
                              </label>
                              <label>
                                <span>显示名称</span>
                                <input
                                  maxLength={48}
                                  onChange={(event) =>
                                    updateDraftItem(item.id, { label: event.target.value })
                                  }
                                  placeholder="显示名称"
                                  type="text"
                                  value={item.label}
                                />
                              </label>
                              <label className="icon-field">
                                <span>图标</span>
                                <input
                                  maxLength={12}
                                  onChange={(event) =>
                                    updateDraftItem(item.id, { icon: event.target.value })
                                  }
                                  placeholder="✨"
                                  type="text"
                                  value={item.icon}
                                />
                              </label>
                              <label>
                                <span>样式类型</span>
                                <select
                                  onChange={(event) =>
                                    changeDraftItemType(item, event.target.value as StatusBarItemType)
                                  }
                                  value={item.type}
                                >
                                  {STATUS_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>宽度</span>
                                <select
                                  onChange={(event) =>
                                    updateDraftItem(item.id, {
                                      width: event.target.value as StatusBarItemWidth,
                                    })
                                  }
                                  value={item.width}
                                >
                                  {STATUS_WIDTH_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>尺寸</span>
                                <select
                                  onChange={(event) =>
                                    updateDraftItem(item.id, {
                                      size: event.target.value as StatusBarItemSize,
                                    })
                                  }
                                  value={item.size}
                                >
                                  {STATUS_SIZE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="variable-description-field">
                                <span>变量说明</span>
                                <textarea
                                  disabled={isDivider}
                                  maxLength={1000}
                                  onChange={(event) =>
                                    updateDraftItem(item.id, { description: event.target.value })
                                  }
                                  placeholder={
                                    isDivider
                                      ? "分割线无需说明"
                                      : "例如：仅在角色明确表达情绪变化时更新，填写简短情绪词"
                                  }
                                  rows={2}
                                  value={item.description}
                                />
                              </label>
                              <label className="initial-value-field">
                                <span>初始值</span>
                                <input
                                  disabled={isDivider}
                                  max={item.type === "progress" ? 100 : undefined}
                                  min={item.type === "progress" ? 0 : undefined}
                                  onChange={(event) =>
                                    updateDraftItem(item.id, {
                                      initialValue:
                                        item.type === "progress"
                                          ? event.target.value === ""
                                            ? ""
                                            : clampProgressValue(event.target.value)
                                          : event.target.value,
                                    })
                                  }
                                  placeholder={isDivider ? "无变量" : "首次显示的值"}
                                  type={item.type === "progress" ? "number" : "text"}
                                  value={item.initialValue}
                                />
                              </label>
                            </div>
                            {showValidation && itemError ? (
                              <p className="status-item-error">{itemError}</p>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                <aside className="status-bar-editor-preview-column">
                  <div className="status-editor-preview-heading">
                    <div>
                      <span>LIVE PREVIEW</span>
                      <strong>实时预览</strong>
                    </div>
                    <small>按住条目，拖到条目之间的空白位置排序；未填入时使用初始值</small>
                  </div>
                  <StatusPanelPreview
                    draggedItemId={draggedItemId}
                    editor
                    onItemInsert={insertDraftItemAtPreviewGap}
                    onPointerDragEnd={() => {
                      setDraggedItemId("");
                      setDragOverItemId("");
                    }}
                    onPointerDragStart={(itemId) => {
                      setDraggedItemId(itemId);
                      setDragOverItemId("");
                    }}
                    state={editorPreviewState}
                  />
                  <div className="status-editor-variable-note">
                    <strong>变量更新规则</strong>
                    <p>AI 回复完成后只提交发生变化的变量。未提交的条目会保留当前值，分割线不会进入变量列表。</p>
                  </div>
                </aside>
              </div>

              <footer className="status-bar-editor-footer">
                <button
                  className="status-editor-clear-button"
                  disabled={Object.keys(state.values).length === 0 || valuesClearedInEditor}
                  onClick={clearSessionValues}
                  type="button"
                >
                  <RotateCcw size={16} />
                  清空本会话值
                </button>
                <div>
                  {showValidation && validationErrors.size > 0 ? (
                    <span className="status-editor-validation-summary">
                      请修正 {validationErrors.size} 个变量名问题
                    </span>
                  ) : null}
                  {showValidation && modelConfigurationError ? (
                    <span className="status-editor-validation-summary">
                      {modelConfigurationError}
                    </span>
                  ) : null}
                  <button onClick={closeEditor} type="button">
                    取消
                  </button>
                  <button className="primary" onClick={saveDraft} type="button">
                    <Save size={16} />
                    保存状态栏
                  </button>
                </div>
              </footer>
            </section>
          </div>,
          document.body,
        )
      : null;

  const activeRightSidebarTool =
    activeToolId === "menu"
      ? null
      : RIGHT_SIDEBAR_TOOLS.find((tool) => tool.id === activeToolId) ?? null;

  return (
    <>
      {!collapsed ? (
        <button
          aria-label="关闭右侧栏"
          className="status-bar-mobile-backdrop"
          onClick={() => onCollapsedChange(true)}
          type="button"
        />
      ) : null}
      <aside
        ref={sidebarRef}
        aria-hidden={collapsed ? "true" : undefined}
        aria-label="右侧工具栏"
        className={`status-bar-sidebar right-tools-sidebar ${
          activeToolId === "status" || activeToolId === "terminal"
            ? "is-status-view"
            : "is-light-view"
        } ${collapsed ? "is-collapsed" : ""}`}
        inert={collapsed ? true : undefined}
        style={sidebarStyle}
      >
        <div
          aria-label="调整右侧栏宽度"
          aria-orientation="vertical"
          aria-valuemax={sidebarMaxWidth}
          aria-valuemin={RIGHT_SIDEBAR_MIN_WIDTH}
          aria-valuenow={sidebarWidth}
          className="right-sidebar-resize-handle"
          onDoubleClick={() => {
            const nextWidth = clampRightSidebarWidth(
              RIGHT_SIDEBAR_DEFAULT_WIDTH,
              getAvailableSidebarMaxWidth(),
            );
            setSidebarWidth(nextWidth);
            saveRightSidebarWidth(nextWidth);
          }}
          onKeyDown={resizeSidebarWithKeyboard}
          onLostPointerCapture={stopSidebarResize}
          onPointerCancel={stopSidebarResize}
          onPointerDown={startSidebarResize}
          onPointerMove={resizeSidebar}
          onPointerUp={stopSidebarResize}
          role="separator"
          tabIndex={0}
          title="左右拖动调整宽度，双击恢复默认"
        >
          <GripVertical aria-hidden="true" size={14} />
        </div>

        {activeToolId === "menu" ? (
          <section className="right-tools-menu" aria-label="工作区工具菜单">
            <header className="right-tools-sidebar-header">
              <div>
                <span>WORKSPACE</span>
                <strong>右侧栏</strong>
              </div>
              <button
                aria-label="关闭右侧栏"
                onClick={() => onCollapsedChange(true)}
                title="关闭右侧栏"
                type="button"
              >
                <X size={16} />
              </button>
            </header>
            <div className="right-tools-menu-body">
              <div className="right-tools-menu-heading">
                <strong>工作区工具</strong>
                <p>选择要在右侧栏中打开的工具。</p>
              </div>
              <nav aria-label="右侧工具" className="right-tools-list">
                {RIGHT_SIDEBAR_TOOLS.map((tool) => {
                  const ToolIcon = tool.icon;
                  return (
                    <button key={tool.id} onClick={() => setActiveToolId(tool.id)} type="button">
                      <span className="right-tool-icon" aria-hidden="true">
                        <ToolIcon size={17} />
                      </span>
                      <span className="right-tool-copy">
                        <strong>{tool.label}</strong>
                        <small>{tool.description}</small>
                      </span>
                      <span className={tool.available ? "is-available" : undefined}>
                        {tool.available ? "打开" : "待实现"}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </section>
        ) : activeToolId === "browser" ? null : activeToolId === "phone" ? (
          <WechatSidebar
            busy={chatGenerationBusy}
            onBack={() => setActiveToolId("menu")}
            onClose={() => onCollapsedChange(true)}
            onSendMessage={onWechatSendMessage}
            personas={personas}
            sessionId={chatSessionId}
            userProfile={userProfile}
          />
        ) : activeToolId === "terminal" ? (
          <TerminalSidebarPanel
            onBack={() => setActiveToolId("menu")}
            onClose={() => onCollapsedChange(true)}
            requestedSessionId={requestedTerminalId}
            workspaceKey={terminalWorkspaceKey}
            workspacePath={terminalWorkspacePath}
          />
        ) : activeToolId === "files" ? (
          <FilesSidebarPanel
            onBack={() => setActiveToolId("menu")}
            onChooseWorkspace={onChooseWorkspace}
            onClose={() => onCollapsedChange(true)}
            source={fileBrowserSource}
          />
        ) : activeToolId === "status" ? (
          <section className="right-tool-content status-tool-content" aria-label="状态栏">
            <header className="status-bar-sidebar-header">
              <div className="status-bar-sidebar-title">
                <button
                  aria-label="返回工作区工具"
                  className="status-bar-back-to-tools"
                  onClick={() => setActiveToolId("menu")}
                  title="返回工作区工具"
                  type="button"
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="status-bar-sidebar-heading">
                  <span>SESSION STATUS</span>
                  <strong>{state.title.trim() || "状态监测终端"}</strong>
                </div>
              </div>
              <div className="status-bar-sidebar-actions">
                <label
                  className="status-bar-enable-switch"
                  title={state.enabled ? "关闭 AI 状态更新" : "开启 AI 状态更新"}
                >
                  <input
                    aria-label="启用状态栏"
                    checked={state.enabled}
                    onChange={(event) =>
                      onStateChange({
                        ...state,
                        enabled: event.target.checked,
                        updatedAt: new Date().toISOString(),
                      })
                    }
                    type="checkbox"
                  />
                  <span aria-hidden="true" />
                </label>
                <button
                  aria-busy={manualUpdateRunning}
                  aria-label="手动更新状态栏"
                  className={
                    manualUpdateRunning
                      ? "status-bar-manual-update is-updating"
                      : "status-bar-manual-update"
                  }
                  disabled={!state.enabled || manualUpdateDisabled || manualUpdateRunning}
                  onClick={() => void onManualUpdate()}
                  title={
                    !state.enabled
                      ? "请先启用状态栏"
                      : manualUpdateRunning
                        ? "正在更新状态栏"
                        : "根据当前会话手动更新状态栏"
                  }
                  type="button"
                >
                  <RefreshCw size={15} />
                </button>
                <button
                  ref={editorFallbackFocusRef}
                  aria-label="编辑状态栏"
                  onClick={openEditor}
                  title="编辑状态栏"
                  type="button"
                >
                  <Pencil size={16} />
                </button>
              </div>
            </header>

            <div className="status-bar-sidebar-body">
              {!state.enabled ? (
                <button className="status-bar-disabled-callout" onClick={openEditor} type="button">
                  <span>状态栏尚未启用</span>
                  <small>开启后，AI 会在回复完成时更新发生变化的变量。</small>
                </button>
              ) : null}
              <div className={!state.enabled ? "status-bar-preview-disabled" : undefined}>
                <StatusPanelPreview state={state} />
              </div>
            </div>

            <footer className="status-bar-sidebar-footer">
              <span className={state.enabled ? "is-enabled" : undefined}>
                {state.enabled ? "AI 自动更新" : "自动更新已关闭"}
              </span>
              <time dateTime={state.updatedAt}>{formatUpdatedAt(state.updatedAt)}</time>
            </footer>
          </section>
        ) : (
          <section
            className="right-tool-content right-tool-placeholder-view"
            aria-label={`${activeRightSidebarTool?.label ?? "工具"}面板`}
            aria-live="polite"
          >
            <header className="right-tool-page-header">
              <button
                className="right-tool-page-back"
                onClick={() => setActiveToolId("menu")}
                type="button"
              >
                <ArrowLeft size={16} />
                <span>{activeRightSidebarTool?.label ?? "工具"}</span>
              </button>
              <button
                aria-label="关闭右侧栏"
                onClick={() => onCollapsedChange(true)}
                title="关闭右侧栏"
                type="button"
              >
                <X size={16} />
              </button>
            </header>
            <div className="right-tool-placeholder-body">
              <span aria-hidden="true">
                <Construction size={24} />
              </span>
              <strong>{activeRightSidebarTool?.label}功能待实现</strong>
              <p>工具面板已经预留，后续可在这里接入完整功能。</p>
            </div>
          </section>
        )}
        <div
          aria-hidden={activeToolId === "browser" ? undefined : "true"}
          className={`right-tools-browser-slot ${
            activeToolId === "browser" ? "is-active" : ""
          }`}
          inert={activeToolId === "browser" ? undefined : true}
        >
          <BrowserSidebarPanel
            onBack={() => setActiveToolId("menu")}
            onClose={() => onCollapsedChange(true)}
            onBrowserComment={onBrowserComment}
          />
        </div>
        {editorModal}
      </aside>
    </>
  );
}
