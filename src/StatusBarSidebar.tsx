import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripVertical,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  getStatusBarItemValue,
  type StatusBarState,
} from "./statusBarUtils";
import "./status-bar.css";

type StatusBarItem = StatusBarState["items"][number];
type StatusBarItemType = StatusBarItem["type"];
type StatusBarItemWidth = StatusBarItem["width"];
type StatusBarItemSize = StatusBarItem["size"];

export type StatusBarSidebarProps = {
  state: StatusBarState;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onStateChange: (next: StatusBarState) => void;
  onClearValues: () => void;
};

type StatusBarCssProperties = CSSProperties & {
  "--status-accent"?: string;
};

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
  Pick<StatusBarItem, "label" | "icon" | "width" | "size" | "initialValue">
> = {
  header: {
    label: "时间",
    icon: "🕒",
    width: "short",
    size: "small",
    initialValue: "未设定",
  },
  banner: {
    label: "心理",
    icon: "🎭",
    width: "long",
    size: "medium",
    initialValue: "平静",
  },
  grid: {
    label: "新属性",
    icon: "✨",
    width: "medium",
    size: "medium",
    initialValue: "未设定",
  },
  progress: {
    label: "进度",
    icon: "📊",
    width: "long",
    size: "medium",
    initialValue: 0,
  },
  list: {
    label: "条目",
    icon: "📍",
    width: "long",
    size: "medium",
    initialValue: "未设定",
  },
  divider: {
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
}: {
  item: StatusBarItem;
  state: StatusBarState;
}) {
  const value = getStatusBarItemValue(state, item);
  const label = getItemLabel(item);
  const itemClassName = [
    "status-panel-item",
    `type-${item.type}`,
    `width-${item.width}`,
    `size-${item.size}`,
  ].join(" ");

  if (item.type === "divider") {
    return (
      <div className={itemClassName}>
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
      <div className={itemClassName} title={item.variableName}>
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
      <div className={itemClassName} title={item.variableName}>
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
      <div className={itemClassName} title={item.variableName}>
        {item.icon ? <i className="status-list-icon" aria-hidden="true">{item.icon}</i> : null}
        <div>
          <strong>{label}</strong>
          <span>{formatStatusValue(value)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={itemClassName} title={item.variableName}>
      <strong>
        {item.icon ? <i aria-hidden="true">{item.icon}</i> : null}
        {label}
      </strong>
      <span>{formatStatusValue(value)}</span>
    </div>
  );
}

function StatusPanelPreview({ state, editor = false }: { state: StatusBarState; editor?: boolean }) {
  const accentColor = getSafeAccentColor(state.accentColor);
  const headerItems = state.items.filter((item) => item.type === "header");
  const bodyItems = state.items.filter((item) => item.type !== "header");
  const style = { "--status-accent": accentColor } as StatusBarCssProperties;

  return (
    <section
      className={`status-panel-preview ${editor ? "is-editor-preview" : ""}`}
      style={style}
      aria-label={`${state.title || "状态栏"}预览`}
    >
      <header className="status-panel-preview-header">
        <span className="status-panel-title">{state.title.trim() || "状态监测终端"}</span>
        {headerItems.length > 0 ? (
          <div className="status-panel-header-values">
            {headerItems.map((item) => (
              <span
                className={`width-${item.width} size-${item.size}`}
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
            <StatusPanelItem item={item} state={state} key={item.id} />
          ))}
        </div>
      ) : headerItems.length === 0 ? (
        <div className="status-panel-empty">
          <span>尚未添加状态条目</span>
          <small>打开编辑器，创建需要由 AI 维护的变量。</small>
        </div>
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
}: StatusBarSidebarProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<StatusBarState>(() => cloneStatusBarState(state));
  const [draggedItemId, setDraggedItemId] = useState("");
  const [dragOverItemId, setDragOverItemId] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const [valuesClearedInEditor, setValuesClearedInEditor] = useState(false);
  const latestStateRef = useRef(state);
  const editorModalRef = useRef<HTMLElement | null>(null);
  const editorInitialFocusRef = useRef<HTMLInputElement | null>(null);
  const editorTriggerRef = useRef<HTMLElement | null>(null);
  const editorFallbackFocusRef = useRef<HTMLButtonElement | null>(null);
  latestStateRef.current = state;

  const validationErrors = useMemo(() => validateStatusItems(draft.items), [draft.items]);
  const sidebarStyle = {
    "--status-accent": getSafeAccentColor(state.accentColor),
  } as StatusBarCssProperties;

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

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, itemId: string) => {
    setDraggedItemId(itemId);
    setDragOverItemId("");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", itemId);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetItemId: string) => {
    event.preventDefault();
    const sourceItemId = draggedItemId || event.dataTransfer.getData("text/plain");
    setDraggedItemId("");
    setDragOverItemId("");
    if (!sourceItemId || sourceItemId === targetItemId) return;

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

  const saveDraft = () => {
    const nextErrors = validateStatusItems(draft.items);
    if (nextErrors.size > 0) {
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
                  <div className="status-bar-general-fields">
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
                    <small>显示当前会话值；未填入时使用初始值</small>
                  </div>
                  <StatusPanelPreview editor state={editorPreviewState} />
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

  if (collapsed) {
    return (
      <aside
        aria-label="已折叠的状态栏"
        className="status-bar-sidebar is-collapsed"
        style={sidebarStyle}
      >
        <button
          aria-label={`展开状态栏，AI 自动更新${state.enabled ? "已启用" : "已关闭"}`}
          className="status-bar-expand-button"
          onClick={() => onCollapsedChange(false)}
          title="展开状态栏"
          type="button"
        >
          <ChevronLeft size={18} />
          <span>状态</span>
          {state.enabled ? <i aria-hidden="true" /> : null}
        </button>
        {editorModal}
      </aside>
    );
  }

  return (
    <>
      <button
        aria-label="关闭右侧状态栏"
        className="status-bar-mobile-backdrop"
        onClick={() => onCollapsedChange(true)}
        type="button"
      />
      <aside aria-label="会话状态栏" className="status-bar-sidebar" style={sidebarStyle}>
        <header className="status-bar-sidebar-header">
          <div className="status-bar-sidebar-heading">
            <span>SESSION STATUS</span>
            <strong>{state.title.trim() || "状态监测终端"}</strong>
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
              ref={editorFallbackFocusRef}
              aria-label="编辑状态栏"
              onClick={openEditor}
              title="编辑状态栏"
              type="button"
            >
              <Pencil size={16} />
            </button>
            <button
              aria-label="折叠状态栏"
              onClick={() => onCollapsedChange(true)}
              title="折叠状态栏"
              type="button"
            >
              <ChevronRight size={17} />
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
        {editorModal}
      </aside>
    </>
  );
}
