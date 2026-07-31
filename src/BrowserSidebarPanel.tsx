import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code2,
  Copy,
  Download,
  EllipsisVertical,
  ExternalLink,
  File,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Maximize2,
  Minus,
  MonitorSmartphone,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  createElement,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildAndroidBrowserCommandIntentUrl,
  buildAndroidBrowserIntentUrl,
  buildBrowserDocumentContentProbeScript,
  buildBrowserPageReadScript,
  buildBrowserScriptExecutionWrapper,
  calculateBrowserFitZoomFactor,
  isAndroidAppShell,
  isBrowserAddressInputAvailable,
  normalizeBrowserAddress,
  openAndroidBrowserAddress,
  registerBrowserSidebarController,
  scaleAndroidBrowserBounds,
  type AndroidBrowserCommand,
  type BrowserSidebarController,
  type BrowserToolArguments,
} from "./browserSidebarRuntime";
import {
  getBrowserTabAfterClose,
  MAX_BROWSER_TABS,
  parseBrowserOpenTabRequest,
} from "./browserSidebarTabs";
import {
  buildBrowserContextTargetProbeScript,
  calculateBrowserContextMenuPlacement,
  calculateBrowserOverlayAnchor,
  type BrowserContextTarget,
  type BrowserPageComment,
} from "./browserSidebarComments";
import "./browser-sidebar.css";

type ElectronWebviewElement = HTMLElement & {
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  downloadURL(url: string): void;
  getZoomFactor(): number;
  setZoomFactor(factor: number): void;
  getWebContentsId(): number;
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number;
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
  executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
  sendInputEvent(event: Record<string, unknown>): void;
};

type BrowserSidebarPanelProps = {
  onBack: () => void;
  onClose: () => void;
  onBrowserComment?: (comment: BrowserPageComment) => void;
};

type BrowserPageState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
};

type BrowserTabState = BrowserPageState & {
  id: string;
  initialUrl: string;
  address: string;
  error: string;
  zoomFactor: number;
  autoFit: boolean;
  hasDocumentContent: boolean;
};

type BrowserDownload = {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  receivedBytes: number;
  totalBytes: number;
  state: string;
  paused: boolean;
  startedAt: number;
  updatedAt: number;
  url: string;
};

type BrowserProfileSummary = {
  autofillPasswords: boolean;
  passwordCount: number;
  downloadDirectory: string;
};

type BrowserPopoverView = "menu" | "downloads" | "passwords" | "clear-data" | "settings";

type BrowserContextMenuRequest = {
  sourceWebContentsId: number;
  x: number;
  y: number;
  hostX?: number;
  hostY?: number;
  pageUrl: string;
  frameUrl: string;
  linkUrl: string;
  sourceUrl: string;
  mediaType: string;
  selectionText: string;
  isEditable: boolean;
};

type BrowserContextMenuState = {
  tabId: string;
  request: BrowserContextMenuRequest;
  target: BrowserContextTarget;
  anchorLeft: number;
  anchorTop: number;
  left: number;
  top: number;
  maxWidth?: number;
  maxHeight?: number;
};

type BrowserCommentEditorState = {
  tabId: string;
  target: BrowserContextTarget;
  screenshotDataUrl?: string;
  left: number;
  top: number;
  zoomFactor: number;
};

const DEFAULT_PAGE_STATE: BrowserPageState = {
  url: "about:blank",
  title: "新页面",
  canGoBack: false,
  canGoForward: false,
  loading: false,
};

const MIN_ZOOM_FACTOR = 0.25;
const MAX_ZOOM_FACTOR = 2;
const ZOOM_STEP = 0.1;
// Every chat and tab uses one app-wide Electron browser profile.
const SIDEBAR_BROWSER_PARTITION = "persist:renge-sidebar-browser";
let browserTabSequence = 0;

function createBrowserTab(url = "about:blank"): BrowserTabState {
  browserTabSequence += 1;
  return {
    ...DEFAULT_PAGE_STATE,
    id: `browser-tab-${Date.now()}-${browserTabSequence}`,
    initialUrl: url,
    url,
    address: url === "about:blank" ? "" : url,
    error: "",
    loading: url !== "about:blank",
    zoomFactor: 1,
    autoFit: true,
    hasDocumentContent: false,
  };
}

function getBrowserTabLabel(tab: BrowserTabState) {
  if (tab.url === "about:blank" && !tab.hasDocumentContent) return "新标签页";
  if (tab.title && tab.title !== DEFAULT_PAGE_STATE.title) return tab.title;
  try {
    return new URL(tab.url).hostname || "网页";
  } catch {
    return "网页";
  }
}

function formatDownloadBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "kB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function formatDownloadTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function getDownloadStatus(download: BrowserDownload) {
  const size = formatDownloadBytes(download.totalBytes || download.receivedBytes);
  if (download.state === "completed") return `已下载 · ${size}`;
  if (download.state === "cancelled") return "已取消";
  if (download.state === "interrupted") return "下载中断";
  if (download.paused) return `已暂停 · ${formatDownloadBytes(download.receivedBytes)} / ${size}`;
  if (download.totalBytes > 0) {
    const percentage = Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100));
    return `正在下载 ${percentage}% · ${formatDownloadBytes(download.receivedBytes)} / ${size}`;
  }
  return `正在下载 · ${formatDownloadBytes(download.receivedBytes)}`;
}

function isDownloadFinished(download: BrowserDownload) {
  return download.state === "completed";
}

function BrowserTabWebview({
  active,
  initialUrl,
  onNode,
  tabId,
}: {
  active: boolean;
  initialUrl: string;
  onNode: (tabId: string, node: ElectronWebviewElement | null) => void;
  tabId: string;
}) {
  const captureNode = useCallback(
    (node: HTMLElement | null) => onNode(tabId, node as ElectronWebviewElement | null),
    [onNode, tabId],
  );
  return createElement("webview", {
    ref: captureNode,
    // Electron enables popups by the presence of this attribute. React 19 drops an
    // unknown boolean attribute, so use a string to ensure it reaches the DOM.
    allowpopups: "true",
    "aria-hidden": active ? undefined : "true",
    className: `browser-sidebar-webview ${active ? "is-active" : ""}`,
    partition: SIDEBAR_BROWSER_PARTITION,
    src: initialUrl,
    tabIndex: active ? 0 : -1,
    webpreferences: "contextIsolation=yes,nodeIntegration=no,sandbox=yes",
  });
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function getStringArg(args: BrowserToolArguments, key: string) {
  const value = args[key];
  return value === undefined || value === null ? "" : String(value);
}

function buildTargetPrelude(
  args: BrowserToolArguments,
  selectorKey = "selector",
  refKey = "ref",
  variableName = "target",
) {
  const selectorVariable = `${variableName}Selector`;
  const refVariable = `${variableName}Ref`;
  return [
    `const ${selectorVariable} = ${JSON.stringify(getStringArg(args, selectorKey))};`,
    `const ${refVariable} = ${JSON.stringify(getStringArg(args, refKey))};`,
    `const ${variableName} = ${refVariable}`,
    `  ? Array.from(document.querySelectorAll('[data-renge-browser-ref]')).find((element) => element.getAttribute('data-renge-browser-ref') === ${refVariable}) ?? null`,
    `  : ${selectorVariable} ? document.querySelector(${selectorVariable}) : null;`,
    `if (!${variableName}) throw new Error(${refVariable} ? '页面中找不到元素引用：' + ${refVariable} : ${selectorVariable} ? '页面中找不到选择器：' + ${selectorVariable} : '必须提供 selector 或 ref');`,
  ].join("\n");
}

function getWebviewPageState(webview: ElectronWebviewElement, loading: boolean): BrowserPageState {
  return {
    url: webview.getURL() || "about:blank",
    title: webview.getTitle() || "新页面",
    canGoBack: webview.canGoBack(),
    canGoForward: webview.canGoForward(),
    loading,
  };
}

export function BrowserSidebarPanel({
  onBack,
  onClose,
  onBrowserComment,
}: BrowserSidebarPanelProps) {
  const electronAvailable = Boolean(window.rengeDesktop?.isElectron);
  const androidAppShell = isAndroidAppShell(window.location.search, window.navigator.userAgent);
  const androidAvailable = Boolean(
    androidAppShell || window.rengeAndroid?.isAndroid || window.RengeAndroidNative,
  );
  const addressInputAvailable = isBrowserAddressInputAvailable(
    electronAvailable,
    androidAvailable,
  );
  const [tabs, setTabs] = useState<BrowserTabState[]>(() => [createBrowserTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [webviewNodes, setWebviewNodes] = useState(
    () => new Map<string, ElectronWebviewElement>(),
  );
  const [popoverView, setPopoverView] = useState<BrowserPopoverView | null>(null);
  const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
  const [downloadActionsId, setDownloadActionsId] = useState("");
  const [profile, setProfile] = useState<BrowserProfileSummary | null>(null);
  const [deviceEmulationTabIds, setDeviceEmulationTabIds] = useState(
    () => new Set<string>(),
  );
  const [featureNotice, setFeatureNotice] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] = useState({ activeMatchOrdinal: 0, matches: 0 });
  const [contextMenu, setContextMenu] = useState<BrowserContextMenuState | null>(null);
  const [commentEditor, setCommentEditor] = useState<BrowserCommentEditorState | null>(null);
  const [commentText, setCommentText] = useState("");
  const [androidBrowserVisible, setAndroidBrowserVisible] = useState(false);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const webviewNodesRef = useRef(new Map<string, ElectronWebviewElement>());
  const webviewCleanupRef = useRef(new Map<string, () => void>());
  const fitRequestRef = useRef(new Map<string, number>());
  const popoverRootRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const commentInputRef = useRef<HTMLInputElement | null>(null);
  const contextRequestSequenceRef = useRef(0);
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const webviewNode = activeTab ? webviewNodes.get(activeTab.id) ?? null : null;
  const pageState: BrowserPageState = activeTab ?? DEFAULT_PAGE_STATE;
  const address = activeTab?.address ?? "";
  const error = activeTab?.error ?? "";
  const zoomFactor = activeTab?.zoomFactor ?? 1;
  const autoFit = activeTab?.autoFit ?? true;
  const deviceEmulationEnabled = activeTab
    ? deviceEmulationTabIds.has(activeTab.id)
    : false;
  const activeDownloadCount = downloads.filter((download) =>
    download.state === "progressing").length;
  const pageActionAvailable = electronAvailable
    && Boolean(webviewNode)
    && (pageState.url !== "about:blank" || Boolean(activeTab?.hasDocumentContent));

  const getAndroidBrowserBounds = useCallback(() => {
    const bounds = pageRef.current?.getBoundingClientRect();
    if (!bounds) return undefined;
    return scaleAndroidBrowserBounds(
      {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      window.devicePixelRatio,
    );
  }, []);

  const sendAndroidBrowserCommand = useCallback((
    command: AndroidBrowserCommand,
    url?: string,
  ) => {
    if (!androidAppShell) return;
    const bounds = command === "open" || command === "layout"
      ? getAndroidBrowserBounds()
      : undefined;
    const commandOptions = { command, url, ...bounds };
    const intentUrl = command === "open" && url
      ? buildAndroidBrowserIntentUrl(url, bounds)
      : buildAndroidBrowserCommandIntentUrl(command, { bounds });
    const nativeCommand = window.RengeAndroidNative?.browserCommand;
    if (nativeCommand) {
      try {
        const result = JSON.parse(
          nativeCommand.call(window.RengeAndroidNative, JSON.stringify(commandOptions)),
        ) as { error?: unknown };
        if (typeof result.error === "string" && result.error) throw new Error(result.error);
        return;
      } catch {
        // Fall back to the app scheme when the raw bridge is temporarily unavailable.
      }
    }
    window.location.assign(intentUrl);
  }, [androidAppShell, getAndroidBrowserBounds]);

  const updateBrowserTab = useCallback(
    (tabId: string, update: (tab: BrowserTabState) => BrowserTabState) => {
      setTabs((current) => {
        const next = current.map((tab) => (tab.id === tabId ? update(tab) : tab));
        tabsRef.current = next;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!androidAppShell) return;
    const handleState = (event: Event) => {
      const detail = (
        event as CustomEvent<Partial<BrowserPageState> & { visible?: boolean }>
      ).detail;
      if (!detail || typeof detail !== "object") return;
      const tabId = activeTabIdRef.current;
      updateBrowserTab(tabId, (tab) => {
        const url = typeof detail.url === "string" ? detail.url : tab.url;
        return {
          ...tab,
          url,
          address: url === "about:blank" ? "" : url,
          title: typeof detail.title === "string" ? detail.title : tab.title,
          canGoBack: Boolean(detail.canGoBack),
          canGoForward: Boolean(detail.canGoForward),
          loading: Boolean(detail.loading),
          error: "",
          hasDocumentContent: false,
        };
      });
      setAndroidBrowserVisible(detail.visible !== false);
    };
    window.addEventListener("renge-android-browser-state", handleState);
    return () => window.removeEventListener("renge-android-browser-state", handleState);
  }, [androidAppShell, updateBrowserTab]);

  useLayoutEffect(() => {
    if (!androidAppShell || !androidBrowserVisible) return;
    const page = pageRef.current;
    if (!page) return;
    let animationFrame = 0;
    const syncLayout = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        sendAndroidBrowserCommand("layout");
      });
    };
    const resizeObserver = new ResizeObserver(syncLayout);
    resizeObserver.observe(page);
    window.addEventListener("resize", syncLayout);
    window.visualViewport?.addEventListener("resize", syncLayout);
    window.visualViewport?.addEventListener("scroll", syncLayout);
    syncLayout();
    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncLayout);
      window.visualViewport?.removeEventListener("resize", syncLayout);
      window.visualViewport?.removeEventListener("scroll", syncLayout);
    };
  }, [androidAppShell, androidBrowserVisible, sendAndroidBrowserCommand]);

  useEffect(() => {
    if (!androidAppShell) return;
    return () => {
      try {
        sendAndroidBrowserCommand("close");
      } catch {
        // The host page may already be navigating away while it unmounts.
      }
    };
  }, [androidAppShell, sendAndroidBrowserCommand]);

  const selectBrowserTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    setContextMenu(null);
    setCommentEditor(null);
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
    if (androidAppShell) {
      if (tab.url !== "about:blank") {
        setAndroidBrowserVisible(true);
        sendAndroidBrowserCommand("open", tab.url);
      } else {
        setAndroidBrowserVisible(false);
        sendAndroidBrowserCommand("close");
      }
    }
  }, [androidAppShell, sendAndroidBrowserCommand]);

  const refreshPageState = useCallback(
    (tabId: string, node: ElectronWebviewElement, loading: boolean) => {
      const nextState = getWebviewPageState(node, loading);
      updateBrowserTab(tabId, (tab) => ({
        ...tab,
        ...nextState,
        address: nextState.url === "about:blank" ? "" : nextState.url,
        hasDocumentContent: nextState.url === "about:blank" && !loading
          ? tab.hasDocumentContent
          : false,
      }));
      return nextState;
    },
    [updateBrowserTab],
  );

  const refreshDocumentContentState = useCallback(
    async (tabId: string, node: ElectronWebviewElement) => {
      if ((node.getURL() || "about:blank") !== "about:blank") return false;
      const hasDocumentContent = await node.executeJavaScript<boolean>(
        buildBrowserDocumentContentProbeScript(),
      );
      if ((node.getURL() || "about:blank") !== "about:blank") return false;
      const title = node.getTitle() || "新页面";
      const currentTab = tabsRef.current.find((tab) => tab.id === tabId);
      if (
        currentTab?.url !== "about:blank"
        || (currentTab.hasDocumentContent === hasDocumentContent && currentTab.title === title)
      ) {
        return hasDocumentContent;
      }
      updateBrowserTab(tabId, (tab) => {
        if (tab.url !== "about:blank") return tab;
        return { ...tab, hasDocumentContent, title };
      });
      return hasDocumentContent;
    },
    [updateBrowserTab],
  );

  const applyZoomFactor = useCallback(
    (tabId: string, node: ElectronWebviewElement, value: number) => {
      const nextZoom = Math.min(
        MAX_ZOOM_FACTOR,
        Math.max(MIN_ZOOM_FACTOR, Math.round(value * 100) / 100),
      );
      node.setZoomFactor(nextZoom);
      updateBrowserTab(tabId, (tab) => ({ ...tab, zoomFactor: nextZoom }));
    },
    [updateBrowserTab],
  );

  const fitPageToWidth = useCallback(
    async (tabId: string, node: ElectronWebviewElement, force = false) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
      if (!tab || (!force && !tab.autoFit)) return;
      const containerWidth = node.getBoundingClientRect().width;
      const pageUrl = node.getURL();
      if (containerWidth < 80 || !pageUrl || pageUrl === "about:blank") return;

      const requestId = (fitRequestRef.current.get(tabId) ?? 0) + 1;
      fitRequestRef.current.set(tabId, requestId);
      const previousZoom = tab.zoomFactor;
      node.setZoomFactor(1);
      await sleep(40);
      let metrics: { contentWidth: number; viewportWidth: number };
      try {
        metrics = await node.executeJavaScript(`(() => {
          const root = document.documentElement;
          const body = document.body;
          const viewportWidth = Math.max(root?.clientWidth || 0, innerWidth || 0);
          const contentWidth = Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0, viewportWidth);
          return { viewportWidth, contentWidth };
        })()`);
      } catch (fitError) {
        if (requestId === fitRequestRef.current.get(tabId)) {
          applyZoomFactor(tabId, node, previousZoom);
        }
        throw fitError;
      }
      if (requestId !== fitRequestRef.current.get(tabId) || node.getURL() !== pageUrl) return;

      applyZoomFactor(
        tabId,
        node,
        calculateBrowserFitZoomFactor(metrics.viewportWidth, metrics.contentWidth),
      );
    },
    [applyZoomFactor],
  );

  const captureWebviewNode = useCallback(
    (tabId: string, node: ElectronWebviewElement | null) => {
      const existingNode = webviewNodesRef.current.get(tabId);
      if (existingNode === node) return;
      webviewCleanupRef.current.get(tabId)?.();
      webviewCleanupRef.current.delete(tabId);

      if (!node) {
        webviewNodesRef.current.delete(tabId);
        fitRequestRef.current.delete(tabId);
        setWebviewNodes((current) => {
          const next = new Map(current);
          next.delete(tabId);
          return next;
        });
        return;
      }

      webviewNodesRef.current.set(tabId, node);
      setWebviewNodes((current) => new Map(current).set(tabId, node));
      const startLoading = () => {
        setContextMenu((current) => current?.tabId === tabId ? null : current);
        setCommentEditor((current) => current?.tabId === tabId ? null : current);
        fitRequestRef.current.set(tabId, (fitRequestRef.current.get(tabId) ?? 0) + 1);
        const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
        if (tab?.autoFit) applyZoomFactor(tabId, node, 1);
        refreshPageState(tabId, node, true);
      };
      const stopLoading = () => {
        refreshPageState(tabId, node, false);
        if (activeTabIdRef.current === tabId) {
          void fitPageToWidth(tabId, node).catch(() => undefined);
        }
      };
      const navigation = () => {
        const loading = tabsRef.current.find((tab) => tab.id === tabId)?.loading ?? false;
        refreshPageState(tabId, node, loading);
      };
      const titleUpdated = (event: Event) => {
        const title = String((event as Event & { title?: string }).title ?? "");
        updateBrowserTab(tabId, (tab) => ({ ...tab, title: title || tab.title }));
      };
      const failed = (event: Event) => {
        const detail = event as Event & {
          errorCode?: number;
          errorDescription?: string;
          isMainFrame?: boolean;
        };
        if (detail.isMainFrame === false || detail.errorCode === -3) return;
        updateBrowserTab(tabId, (tab) => ({
          ...tab,
          error: detail.errorDescription || "页面加载失败",
        }));
        refreshPageState(tabId, node, false);
      };
      const foundInPage = (event: Event) => {
        if (activeTabIdRef.current !== tabId) return;
        const result = (event as Event & {
          result?: { activeMatchOrdinal?: number; matches?: number };
        }).result;
        setFindResult({
          activeMatchOrdinal: Number(result?.activeMatchOrdinal ?? 0),
          matches: Number(result?.matches ?? 0),
        });
      };
      node.addEventListener("did-start-loading", startLoading);
      node.addEventListener("did-stop-loading", stopLoading);
      node.addEventListener("did-navigate", navigation);
      node.addEventListener("did-navigate-in-page", navigation);
      node.addEventListener("page-title-updated", titleUpdated);
      node.addEventListener("did-fail-load", failed);
      node.addEventListener("found-in-page", foundInPage);

      let resizeTimer = 0;
      const resizeObserver = new ResizeObserver(() => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          if (activeTabIdRef.current === tabId) {
            void fitPageToWidth(tabId, node).catch(() => undefined);
          }
        }, 160);
      });
      resizeObserver.observe(node);
      webviewCleanupRef.current.set(tabId, () => {
        window.clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        node.removeEventListener("did-start-loading", startLoading);
        node.removeEventListener("did-stop-loading", stopLoading);
        node.removeEventListener("did-navigate", navigation);
        node.removeEventListener("did-navigate-in-page", navigation);
        node.removeEventListener("page-title-updated", titleUpdated);
        node.removeEventListener("did-fail-load", failed);
        node.removeEventListener("found-in-page", foundInPage);
      });
    },
    [applyZoomFactor, fitPageToWidth, refreshPageState, updateBrowserTab],
  );

  const createNewBrowserTab = useCallback(
    (url = "about:blank", sourceTabId = activeTabIdRef.current) => {
      const current = tabsRef.current;
      if (current.length >= MAX_BROWSER_TABS) {
        updateBrowserTab(sourceTabId, (tab) => ({
          ...tab,
          error: `最多同时打开 ${MAX_BROWSER_TABS} 个标签页`,
        }));
        return "";
      }
      const tab = createBrowserTab(url);
      const next = [...current, tab];
      tabsRef.current = next;
      activeTabIdRef.current = tab.id;
      setTabs(next);
      setActiveTabId(tab.id);
      if (androidAppShell) {
        if (url === "about:blank") {
          setAndroidBrowserVisible(false);
          sendAndroidBrowserCommand("close");
        } else {
          setAndroidBrowserVisible(true);
          sendAndroidBrowserCommand("open", normalizeBrowserAddress(url));
        }
      }
      return tab.id;
    },
    [androidAppShell, sendAndroidBrowserCommand, updateBrowserTab],
  );

  const closeBrowserTab = useCallback(
    (tabId: string) => {
      const current = tabsRef.current;
      setContextMenu((menu) => menu?.tabId === tabId ? null : menu);
      setCommentEditor((editor) => editor?.tabId === tabId ? null : editor);
      const closingNode = webviewNodesRef.current.get(tabId);
      setDeviceEmulationTabIds((enabledIds) => {
        if (!enabledIds.has(tabId)) return enabledIds;
        try {
          const webContentsId = closingNode?.getWebContentsId();
          if (webContentsId) {
            void window.rengeDesktop?.setSidebarBrowserDeviceEmulation?.({
              webContentsId,
              enabled: false,
            }).catch(() => undefined);
          }
        } catch {
          // The guest may already be destroyed while its tab is closing.
        }
        const next = new Set(enabledIds);
        next.delete(tabId);
        return next;
      });
      if (current.length === 1) {
        updateBrowserTab(tabId, (tab) => ({
          ...createBrowserTab(),
          id: tab.id,
          initialUrl: tab.initialUrl,
        }));
        void closingNode?.loadURL("about:blank").catch(() => undefined);
        if (androidAppShell) {
          setAndroidBrowserVisible(false);
          sendAndroidBrowserCommand("close");
        }
        return;
      }
      const nextActiveTabId = getBrowserTabAfterClose(
        current.map((tab) => tab.id),
        activeTabIdRef.current,
        tabId,
      );
      const next = current.filter((tab) => tab.id !== tabId);
      tabsRef.current = next;
      setTabs(next);
      if (nextActiveTabId && nextActiveTabId !== activeTabIdRef.current) {
        activeTabIdRef.current = nextActiveTabId;
        setActiveTabId(nextActiveTabId);
        if (androidAppShell) {
          const nextActiveTab = next.find((tab) => tab.id === nextActiveTabId);
          if (nextActiveTab && nextActiveTab.url !== "about:blank") {
            setAndroidBrowserVisible(true);
            sendAndroidBrowserCommand("open", nextActiveTab.url);
          } else {
            setAndroidBrowserVisible(false);
            sendAndroidBrowserCommand("close");
          }
        }
      }
    },
    [androidAppShell, sendAndroidBrowserCommand, updateBrowserTab],
  );

  const openAddress = useCallback(async (rawAddress: string) => {
    const tabId = activeTabIdRef.current;
    const node = webviewNodesRef.current.get(tabId);
    if (!node) throw new Error("浏览器页面容器尚未准备好");
    const url = normalizeBrowserAddress(rawAddress);
    updateBrowserTab(tabId, (tab) => ({
      ...tab,
      address: url === "about:blank" ? "" : url,
      error: "",
      url,
      loading: true,
      hasDocumentContent: false,
    }));
    try {
      await node.loadURL(url);
      return refreshPageState(tabId, node, false);
    } catch (loadError) {
      updateBrowserTab(tabId, (tab) => ({
        ...tab,
        error: loadError instanceof Error ? loadError.message : "页面加载失败",
        loading: false,
      }));
      throw loadError;
    }
  }, [refreshPageState, updateBrowserTab]);

  const changeZoom = (delta: number) => {
    if (!activeTab || !webviewNode) return;
    fitRequestRef.current.set(
      activeTab.id,
      (fitRequestRef.current.get(activeTab.id) ?? 0) + 1,
    );
    updateBrowserTab(activeTab.id, (tab) => ({ ...tab, autoFit: false }));
    applyZoomFactor(activeTab.id, webviewNode, activeTab.zoomFactor + delta);
  };

  const activateAutoFit = () => {
    if (!activeTab || !webviewNode) return;
    updateBrowserTab(activeTab.id, (tab) => ({ ...tab, autoFit: true }));
    void fitPageToWidth(activeTab.id, webviewNode, true).catch(() => undefined);
  };

  const resetZoom = () => {
    if (!activeTab || !webviewNode) return;
    fitRequestRef.current.set(
      activeTab.id,
      (fitRequestRef.current.get(activeTab.id) ?? 0) + 1,
    );
    updateBrowserTab(activeTab.id, (tab) => ({ ...tab, autoFit: false }));
    applyZoomFactor(activeTab.id, webviewNode, 1);
  };

  const reportFeatureError = useCallback((caught: unknown) => {
    const message = caught instanceof Error ? caught.message : String(caught || "操作失败");
    setFeatureNotice(message);
    const tabId = activeTabIdRef.current;
    updateBrowserTab(tabId, (tab) => ({ ...tab, error: message }));
  }, [updateBrowserTab]);

  const openPopover = (view: BrowserPopoverView) => {
    setFeatureNotice("");
    setDownloadActionsId("");
    setPopoverView((current) => current === view ? null : view);
  };

  const openFindBar = () => {
    setPopoverView(null);
    setFindOpen(true);
    window.setTimeout(() => findInputRef.current?.focus(), 0);
  };

  const closeFindBar = () => {
    try {
      webviewNode?.stopFindInPage("clearSelection");
    } catch {
      // The page may have closed while the find bar was open.
    }
    setFindOpen(false);
    setFindQuery("");
    setFindResult({ activeMatchOrdinal: 0, matches: 0 });
  };

  const findNext = (forward: boolean) => {
    if (!webviewNode || !findQuery.trim()) return;
    try {
      webviewNode.findInPage(findQuery, { findNext: true, forward });
    } catch (caught) {
      reportFeatureError(caught);
    }
  };

  const handleFindKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeFindBar();
    } else if (event.key === "Enter") {
      event.preventDefault();
      findNext(!event.shiftKey);
    }
  };

  const refreshBrowserProfile = useCallback(async () => {
    const getProfile = window.rengeDesktop?.getSidebarBrowserProfile;
    if (!getProfile) return null;
    const nextProfile = await getProfile();
    setProfile(nextProfile);
    return nextProfile;
  }, []);

  const importBrowserProfile = async () => {
    const importProfile = window.rengeDesktop?.importSidebarBrowserProfile;
    if (!importProfile) return;
    try {
      const result = await importProfile();
      if (result.canceled) return;
      await refreshBrowserProfile();
      const parts = [];
      if (result.cookiesImported) parts.push(`${result.cookiesImported} 条 Cookie`);
      if (result.passwordsImported) parts.push(`${result.passwordsImported} 个密码`);
      if (result.cookiesFailed) parts.push(`${result.cookiesFailed} 条 Cookie 导入失败`);
      setFeatureNotice(`已导入${parts.length ? `：${parts.join("，")}` : "浏览器数据"}`);
    } catch (caught) {
      reportFeatureError(caught);
    }
  };

  const updateAutofillSetting = async (enabled: boolean) => {
    const updateProfile = window.rengeDesktop?.updateSidebarBrowserProfile;
    if (!updateProfile) return;
    try {
      setProfile(await updateProfile({ autofillPasswords: enabled }));
      setFeatureNotice(enabled ? "已开启密码自动填充" : "已关闭密码自动填充");
    } catch (caught) {
      reportFeatureError(caught);
    }
  };

  const autofillPage = useCallback(async (
    node: ElectronWebviewElement,
    announce: boolean,
  ) => {
    const getAutofill = window.rengeDesktop?.getSidebarBrowserAutofill;
    if (!getAutofill) return false;
    let webContentsId: number;
    try {
      webContentsId = node.getWebContentsId();
    } catch {
      return false;
    }
    const credential = await getAutofill({ webContentsId });
    if (!credential) {
      if (announce) setFeatureNotice("当前站点没有可用的已导入密码");
      return false;
    }
    const result = await node.executeJavaScript<{ filled: boolean }>(`(() => {
      const username = ${JSON.stringify(credential.username)};
      const password = ${JSON.stringify(credential.password)};
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return !element.disabled && rect.width > 0 && rect.height > 0;
      };
      const passwordInput = Array.from(document.querySelectorAll('input[type="password"]')).find(visible);
      if (!passwordInput) return { filled: false };
      const form = passwordInput.form || passwordInput.closest('form') || document;
      const usernameInput = Array.from(form.querySelectorAll('input')).find((input) =>
        input !== passwordInput
        && visible(input)
        && ['text', 'email', 'tel', ''].includes(input.type)
        && /user|email|login|account|phone|用户|邮箱|账号|手机/i.test([input.name, input.id, input.autocomplete, input.placeholder].join(' ')))
      ) || Array.from(form.querySelectorAll('input')).find((input) =>
        input !== passwordInput && visible(input) && ['text', 'email', 'tel', ''].includes(input.type));
      const setValue = (input, value) => {
        if (!input || input.value) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue(usernameInput, username);
      setValue(passwordInput, password);
      return { filled: Boolean(passwordInput.value) };
    })()`, true);
    if (announce) {
      setFeatureNotice(result.filled ? `已填充 ${credential.name}` : "当前页面没有可填充的密码框");
    }
    return result.filled;
  }, []);

  const toggleDeviceEmulation = async () => {
    if (!activeTab || !webviewNode) return;
    const setEmulation = window.rengeDesktop?.setSidebarBrowserDeviceEmulation;
    if (!setEmulation) return;
    try {
      const result = await setEmulation({
        webContentsId: webviewNode.getWebContentsId(),
        enabled: !deviceEmulationEnabled,
      });
      setDeviceEmulationTabIds((current) => {
        const next = new Set(current);
        if (result.enabled) next.add(activeTab.id);
        else next.delete(activeTab.id);
        return next;
      });
      setFeatureNotice(result.enabled ? "已切换为 390 × 844 设备视图" : "已恢复桌面视图");
    } catch (caught) {
      reportFeatureError(caught);
    }
  };

  const capturePage = async () => {
    const capture = window.rengeDesktop?.captureSidebarBrowserPage;
    if (!capture || !webviewNode) return;
    try {
      const result = await capture({ webContentsId: webviewNode.getWebContentsId() });
      if (!result.canceled) setFeatureNotice(`截图已保存到 ${result.path ?? "所选位置"}`);
    } catch (caught) {
      reportFeatureError(caught);
    }
  };

  const clearBrowserData = async (
    action: "cache" | "cookies" | "history" | "passwords" | "all",
  ) => {
    const clearData = window.rengeDesktop?.clearSidebarBrowserData;
    if (!clearData) return;
    try {
      setProfile(await clearData({ action }));
      const labels = {
        cache: "缓存",
        cookies: "Cookie 和网站数据",
        history: "浏览历史",
        passwords: "已导入密码",
        all: "全部浏览数据",
      };
      setFeatureNotice(`已清除${labels[action]}`);
      if (action === "cookies" || action === "all") webviewNode?.reload();
    } catch (caught) {
      reportFeatureError(caught);
    }
  };

  const runDownloadAction = async (
    action: "open-folder" | "clear-completed" | "open" | "reveal" | "pause" | "resume" | "cancel" | "remove",
    id?: string,
  ) => {
    const runAction = window.rengeDesktop?.runSidebarBrowserDownloadAction;
    if (!runAction) return;
    try {
      await runAction({ action, id });
      setDownloadActionsId("");
    } catch (caught) {
      reportFeatureError(caught);
    }
  };

  const runContextAction = async (
    action: "copy-text" | "copy-image" | "open-external" | "inspect" | "capture-element",
    options: Record<string, unknown> = {},
    menu = contextMenu,
  ) => {
    if (!menu) return null;
    const runAction = window.rengeDesktop?.runSidebarBrowserContextAction;
    const node = webviewNodesRef.current.get(menu.tabId);
    if (!runAction || !node) return null;
    try {
      return await runAction({
        webContentsId: node.getWebContentsId(),
        action,
        ...options,
      });
    } catch (caught) {
      reportFeatureError(caught);
      return null;
    }
  };

  const openContextUrlInTab = (url: string) => {
    if (!contextMenu || !url) return;
    createNewBrowserTab(url, contextMenu.tabId);
    setContextMenu(null);
  };

  const saveContextUrl = (url: string) => {
    if (!contextMenu || !url) return;
    const node = webviewNodesRef.current.get(contextMenu.tabId);
    try {
      node?.downloadURL(url);
      setContextMenu(null);
    } catch (caught) {
      reportFeatureError(caught);
    }
  };

  const copyContextText = async (text: string) => {
    if (!text) return;
    await runContextAction("copy-text", { text });
    setContextMenu(null);
  };

  const startBrowserComment = async () => {
    const menu = contextMenu;
    if (!menu) return;
    setContextMenu(null);
    const node = webviewNodesRef.current.get(menu.tabId);
    const pageBounds = pageRef.current?.getBoundingClientRect();
    const zoom = node?.getZoomFactor() ?? 1;
    let screenshotDataUrl: string | undefined;
    if (node && menu.target.rect.width > 0 && menu.target.rect.height > 0) {
      const captureResult = await runContextAction("capture-element", {
        rect: {
          x: menu.target.rect.x * zoom,
          y: menu.target.rect.y * zoom,
          width: menu.target.rect.width * zoom,
          height: menu.target.rect.height * zoom,
        },
      }, menu);
      screenshotDataUrl = captureResult?.dataUrl;
    }
    const editorWidth = Math.min(440, Math.max(260, (pageBounds?.width ?? 360) - 24));
    const targetLeft = menu.target.rect.x * zoom;
    const targetBottom = (menu.target.rect.y + menu.target.rect.height) * zoom;
    const left = Math.max(
      12,
      Math.min(targetLeft + 18, (pageBounds?.width ?? 360) - editorWidth - 12),
    );
    const top = Math.max(
      12,
      Math.min(targetBottom - 62, (pageBounds?.height ?? 500) - 66),
    );
    setCommentText("");
    setCommentEditor({
      tabId: menu.tabId,
      target: menu.target,
      ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
      left,
      top,
      zoomFactor: zoom,
    });
    window.setTimeout(() => commentInputRef.current?.focus(), 0);
  };

  const submitBrowserComment = () => {
    const comment = commentText.trim();
    if (!commentEditor || !comment) return;
    if (!onBrowserComment) {
      reportFeatureError(new Error("当前聊天没有连接网页评论接收区"));
      return;
    }
    onBrowserComment({
      ...commentEditor.target,
      id: crypto.randomUUID(),
      comment,
      createdAt: new Date().toISOString(),
      ...(commentEditor.screenshotDataUrl
        ? { screenshotDataUrl: commentEditor.screenshotDataUrl }
        : {}),
    });
    setCommentEditor(null);
    setCommentText("");
  };

  const handleCommentKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setCommentEditor(null);
      setCommentText("");
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitBrowserComment();
    }
  };

  useEffect(() => {
    const subscribe = window.rengeDesktop?.onSidebarBrowserContextMenu;
    if (!subscribe) return;
    return subscribe((rawRequest) => {
      const request = rawRequest as BrowserContextMenuRequest;
      const requestSequence = contextRequestSequenceRef.current + 1;
      contextRequestSequenceRef.current = requestSequence;
      void (async () => {
        const sourceTab = tabsRef.current.find((tab) => {
          const node = webviewNodesRef.current.get(tab.id);
          try {
            return node?.getWebContentsId() === request.sourceWebContentsId;
          } catch {
            return false;
          }
        });
        if (!sourceTab) return;
        const node = webviewNodesRef.current.get(sourceTab.id);
        if (!node) return;
        const probedTarget = await node.executeJavaScript<BrowserContextTarget | null>(
          buildBrowserContextTargetProbeScript(request.x, request.y),
        );
        if (contextRequestSequenceRef.current !== requestSequence) return;
        const target: BrowserContextTarget = probedTarget ?? {
          pageUrl: request.pageUrl || node.getURL(),
          pageTitle: node.getTitle(),
          tagName: request.mediaType === "image" ? "img" : "body",
          selector: request.mediaType === "image" ? "img" : "body",
          path: request.mediaType === "image" ? "img" : "body",
          text: request.selectionText,
          ariaLabel: "",
          nearbyText: request.selectionText,
          outerHtml: "",
          imageUrl: request.sourceUrl,
          linkUrl: request.linkUrl,
          rect: { x: request.x, y: request.y, width: 1, height: 1 },
        };
        if (!target.imageUrl && request.sourceUrl) target.imageUrl = request.sourceUrl;
        if (!target.linkUrl && request.linkUrl) target.linkUrl = request.linkUrl;
        const pageBounds = pageRef.current?.getBoundingClientRect();
        const nodeBounds = node.getBoundingClientRect();
        const anchor = calculateBrowserOverlayAnchor({
          contentX: request.x,
          contentY: request.y,
          zoomFactor: node.getZoomFactor(),
          hostX: request.hostX,
          hostY: request.hostY,
          webviewLeft: nodeBounds.left,
          webviewTop: nodeBounds.top,
          containerLeft: pageBounds?.left ?? nodeBounds.left,
          containerTop: pageBounds?.top ?? nodeBounds.top,
        });
        selectBrowserTab(sourceTab.id);
        setPopoverView(null);
        setCommentEditor(null);
        setContextMenu({
          tabId: sourceTab.id,
          request,
          target,
          anchorLeft: anchor.left,
          anchorTop: anchor.top,
          left: anchor.left,
          top: anchor.top,
        });
      })().catch(reportFeatureError);
    });
  }, [reportFeatureError, selectBrowserTab]);

  useLayoutEffect(() => {
    if (!contextMenu) return;
    const page = pageRef.current;
    const menu = contextMenuRef.current;
    if (!page || !menu) return;
    const placement = calculateBrowserContextMenuPlacement({
      anchorX: contextMenu.anchorLeft,
      anchorY: contextMenu.anchorTop,
      menuWidth: menu.scrollWidth,
      menuHeight: menu.scrollHeight,
      viewportWidth: page.clientWidth,
      viewportHeight: page.clientHeight,
    });
    if (
      placement.left === contextMenu.left
      && placement.top === contextMenu.top
      && placement.maxWidth === contextMenu.maxWidth
      && placement.maxHeight === contextMenu.maxHeight
    ) return;
    setContextMenu((current) => current === contextMenu ? { ...current, ...placement } : current);
  }, [contextMenu]);

  useEffect(() => {
    let active = true;
    const desktopApi = window.rengeDesktop;
    void desktopApi?.listSidebarBrowserDownloads?.()
      .then((items) => {
        if (active) setDownloads(items);
      })
      .catch(() => undefined);
    void refreshBrowserProfile().catch(() => undefined);
    const unsubscribe = desktopApi?.onSidebarBrowserDownloads?.((items) => {
      if (active) setDownloads(items);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [refreshBrowserProfile]);

  useEffect(() => {
    if (!popoverView) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !popoverRootRef.current?.contains(event.target)) {
        setPopoverView(null);
        setDownloadActionsId("");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPopoverView(null);
      setDownloadActionsId("");
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [popoverView]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeContextMenu = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("pointerdown", closeContextMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeContextMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!findOpen || !webviewNode) return;
    const query = findQuery.trim();
    if (!query) {
      webviewNode.stopFindInPage("clearSelection");
      setFindResult({ activeMatchOrdinal: 0, matches: 0 });
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        webviewNode.findInPage(findQuery, { findNext: false, forward: true });
      } catch (caught) {
        reportFeatureError(caught);
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [findOpen, findQuery, reportFeatureError, webviewNode]);

  useEffect(() => {
    if (
      !profile?.autofillPasswords
      || !webviewNode
      || pageState.loading
      || pageState.url === "about:blank"
    ) return;
    void autofillPage(webviewNode, false).catch(() => undefined);
  }, [autofillPage, pageState.loading, pageState.url, profile?.autofillPasswords, webviewNode]);

  useEffect(() => {
    const subscribe = window.rengeDesktop?.onSidebarBrowserOpenTab;
    if (!subscribe) return;
    return subscribe((value) => {
      const request = parseBrowserOpenTabRequest(value);
      if (!request) return;
      const sourceTab = tabsRef.current.find((tab) => {
        const node = webviewNodesRef.current.get(tab.id);
        try {
          return node?.getWebContentsId() === request.sourceWebContentsId;
        } catch {
          return false;
        }
      });
      if (!sourceTab) return;
      createNewBrowserTab(request.url, sourceTab.id);
    });
  }, [createNewBrowserTab]);

  useEffect(() => {
    if (!activeTab || !webviewNode) return;
    void fitPageToWidth(activeTab.id, webviewNode).catch(() => undefined);
  }, [activeTab?.id, fitPageToWidth, webviewNode]);

  useEffect(() => {
    if (
      !activeTab
      || !webviewNode
      || activeTab.url !== "about:blank"
      || activeTab.hasDocumentContent
    ) return;
    const probe = () => {
      void refreshDocumentContentState(activeTab.id, webviewNode).catch(() => undefined);
    };
    probe();
    const intervalId = window.setInterval(probe, 600);
    return () => window.clearInterval(intervalId);
  }, [
    activeTab?.hasDocumentContent,
    activeTab?.id,
    activeTab?.url,
    refreshDocumentContentState,
    webviewNode,
  ]);

  const controller = useMemo<BrowserSidebarController | null>(() => {
    if (!activeTab || !webviewNode) return null;
    const controllerTabId = activeTab.id;
    const executeInPage = <T,>(script: string, userGesture = false) =>
      webviewNode.executeJavaScript<T>(script, userGesture);
    const readState = () => getWebviewPageState(
      webviewNode,
      tabsRef.current.find((tab) => tab.id === controllerTabId)?.loading ?? false,
    );
    const targetCenter = async (args: BrowserToolArguments) =>
      executeInPage<{ x: number; y: number; label: string }>(`(() => {
        ${buildTargetPrelude(args)}
        target.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = target.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), label: target.getAttribute('aria-label') || target.innerText || target.tagName };
      })()`, true);
    const nativeMouse = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
      webviewNode.sendInputEvent({
        type,
        x: Math.round(x * webviewNode.getZoomFactor()),
        y: Math.round(y * webviewNode.getZoomFactor()),
        ...extra,
      });

    return {
      async execute(toolName, args, signal) {
        if (signal?.aborted) throw new DOMException("操作已停止", "AbortError");
        switch (toolName) {
          case "browser_navigate":
            return openAddress(getStringArg(args, "url"));
          case "browser_history": {
            const action = getStringArg(args, "action");
            if (action === "back") {
              if (!webviewNode.canGoBack()) throw new Error("当前页面无法后退");
              webviewNode.goBack();
            } else if (action === "forward") {
              if (!webviewNode.canGoForward()) throw new Error("当前页面无法前进");
              webviewNode.goForward();
            } else if (action === "reload") webviewNode.reload();
            else if (action === "stop") webviewNode.stop();
            else throw new Error("未知浏览器历史操作");
            await sleep(180);
            return readState();
          }
          case "browser_read_page":
            return executeInPage(buildBrowserPageReadScript(args));
          case "browser_click": {
            const point = await targetCenter(args);
            nativeMouse("mouseMove", point.x, point.y);
            nativeMouse("mouseDown", point.x, point.y, { button: "left", clickCount: 1 });
            nativeMouse("mouseUp", point.x, point.y, { button: "left", clickCount: 1 });
            await sleep(180);
            return { ok: true, action: "click", target: point.label, ...readState() };
          }
          case "browser_hover": {
            const point = await targetCenter(args);
            nativeMouse("mouseMove", point.x, point.y);
            await sleep(120);
            return { ok: true, action: "hover", target: point.label, ...readState() };
          }
          case "browser_type":
            return executeInPage(`(() => {
              ${buildTargetPrelude(args)}
              const text = ${JSON.stringify(getStringArg(args, "text"))};
              const replace = ${args.replace === undefined ? "true" : JSON.stringify(Boolean(args.replace))};
              const submit = ${JSON.stringify(Boolean(args.submit))};
              target.scrollIntoView({ block: 'center', inline: 'center' });
              target.focus();
              if (target.isContentEditable) {
                if (replace) target.textContent = text; else target.textContent += text;
              } else if ('value' in target) {
                const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
                const nextValue = replace ? text : String(target.value ?? '') + text;
                if (setter) setter.call(target, nextValue); else target.value = nextValue;
              } else throw new Error('目标元素不可输入');
              target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              if (submit) target.closest('form')?.requestSubmit();
              return { ok: true, action: 'type', submitted: submit, value: target.type === 'password' ? '[password omitted]' : ('value' in target ? String(target.value ?? '') : target.textContent) };
            })()`, true);
          case "browser_select":
            return executeInPage(`(() => {
              ${buildTargetPrelude(args)}
              if (!(target instanceof HTMLSelectElement)) throw new Error('目标不是下拉选择框');
              const requested = ${JSON.stringify(getStringArg(args, "value"))};
              const option = Array.from(target.options).find((item) => item.value === requested || item.text.trim() === requested);
              if (!option) throw new Error('下拉框中找不到选项：' + requested);
              target.value = option.value;
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true, action: 'select', value: target.value, label: option.text };
            })()`, true);
          case "browser_scroll":
            return executeInPage(`(() => {
              const x = ${Number(args.x ?? 0) || 0};
              const y = ${Number(args.y ?? 600) || 0};
              const selector = ${JSON.stringify(getStringArg(args, "selector"))};
              const ref = ${JSON.stringify(getStringArg(args, "ref"))};
              const target = ref
                ? Array.from(document.querySelectorAll('[data-renge-browser-ref]')).find((element) => element.getAttribute('data-renge-browser-ref') === ref) ?? null
                : selector ? document.querySelector(selector) : window;
              if (!target) throw new Error('找不到要滚动的元素');
              target.scrollBy({ left: x, top: y, behavior: 'instant' });
              return { ok: true, action: 'scroll', x: Math.round(target === window ? scrollX : target.scrollLeft), y: Math.round(target === window ? scrollY : target.scrollTop) };
            })()`);
          case "browser_drag":
            return executeInPage(`(() => {
              ${buildTargetPrelude(args, "sourceSelector", "sourceRef", "source")}
              ${buildTargetPrelude(args, "targetSelector", "targetRef", "destination")}
              const dataTransfer = new DataTransfer();
              source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
              destination.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
              destination.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
              destination.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
              source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
              return { ok: true, action: 'drag' };
            })()`, true);
          case "browser_press_key": {
            const key = getStringArg(args, "key");
            if (!key) throw new Error("key 不能为空");
            const modifiers = Array.isArray(args.modifiers)
              ? args.modifiers.map(String).filter((item) => ["alt", "control", "meta", "shift"].includes(item))
              : [];
            webviewNode.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
            webviewNode.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
            return { ok: true, action: "press_key", key, modifiers, ...readState() };
          }
          case "browser_edit_page": {
            const result = await executeInPage(`(() => {
              ${buildTargetPrelude(args)}
              const operation = ${JSON.stringify(getStringArg(args, "operation"))};
              const name = ${JSON.stringify(getStringArg(args, "name"))};
              const value = ${JSON.stringify(getStringArg(args, "value"))};
              if (operation === 'set_text') target.textContent = value;
              else if (operation === 'set_html') target.innerHTML = value;
              else if (operation === 'set_value') {
                if (!('value' in target)) throw new Error('目标元素没有 value');
                target.value = value;
                target.dispatchEvent(new Event('input', { bubbles: true }));
                target.dispatchEvent(new Event('change', { bubbles: true }));
              } else if (operation === 'set_attribute') {
                if (!name) throw new Error('name 不能为空');
                target.setAttribute(name, value);
              } else if (operation === 'remove_attribute') {
                if (!name) throw new Error('name 不能为空');
                target.removeAttribute(name);
              } else if (operation === 'set_style') {
                if (!name) throw new Error('name 不能为空');
                target.style.setProperty(name, value);
              } else if (operation === 'insert_before') target.insertAdjacentHTML('beforebegin', value);
              else if (operation === 'insert_after') target.insertAdjacentHTML('afterend', value);
              else if (operation === 'remove') target.remove();
              else throw new Error('未知页面编辑操作：' + operation);
              return { ok: true, action: 'edit_page', operation, name, valueLength: value.length };
            })()`, true);
            await refreshDocumentContentState(controllerTabId, webviewNode).catch(() => undefined);
            return result;
          }
          case "browser_execute_script": {
            const script = getStringArg(args, "script");
            if (!script.trim()) throw new Error("script 不能为空");
            type ScriptExecutionOutcome = {
              __rengeBrowserScriptExecution?: boolean;
              ok?: boolean;
              value?: unknown;
              error?: { name?: string; message?: string; stack?: string };
            };
            let outcome: ScriptExecutionOutcome;
            try {
              outcome = await executeInPage<ScriptExecutionOutcome>(
                buildBrowserScriptExecutionWrapper(script),
                true,
              );
            } catch {
              try {
                outcome = await executeInPage<ScriptExecutionOutcome>(
                  buildBrowserScriptExecutionWrapper(script, false),
                  true,
                );
              } catch (statementError) {
                const message = statementError instanceof Error
                  ? statementError.message
                  : String(statementError);
                throw new Error(`页面脚本存在语法错误或无法执行：${message}`);
              }
            }
            if (!outcome?.__rengeBrowserScriptExecution) {
              throw new Error("页面脚本没有返回可识别的执行结果");
            }
            if (!outcome.ok) {
              const name = outcome.error?.name || "Error";
              const message = outcome.error?.message || "页面脚本执行失败";
              throw new Error(`页面脚本抛出 ${name}：${message}`);
            }
            await refreshDocumentContentState(controllerTabId, webviewNode).catch(() => undefined);
            return {
              ok: true,
              action: "execute_script",
              result: outcome.value,
              ...readState(),
            };
          }
          default:
            throw new Error(`未知浏览器工具：${toolName}`);
        }
      },
    };
  }, [activeTab?.id, refreshDocumentContentState, webviewNode]);

  useEffect(() => {
    if (!controller) return;
    return registerBrowserSidebarController(controller);
  }, [controller]);

  const openSubmittedAddress = () => {
    if (!address.trim()) return;
    if (electronAvailable) {
      void openAddress(address).catch(() => undefined);
      return;
    }
    if (!androidAvailable) return;
    const url = normalizeBrowserAddress(address);
    if (activeTab) {
      updateBrowserTab(activeTab.id, (tab) => ({
        ...tab,
        address: url,
        url,
        loading: true,
        error: "",
      }));
    }
    if (androidAppShell) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      setAndroidBrowserVisible(true);
    }
    void openAndroidBrowserAddress(
      url,
      window.rengeAndroid,
      window.RengeAndroidNative,
      androidAppShell
        ? (nextUrl) => sendAndroidBrowserCommand("open", nextUrl)
        : undefined,
    ).catch(reportFeatureError);
  };

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    openSubmittedAddress();
  };

  const handleAddressKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    openSubmittedAddress();
  };

  return (
    <section className="right-tool-content browser-sidebar-panel" aria-label="浏览器面板">
      <header className="browser-sidebar-header">
        <button
          className="browser-sidebar-back"
          onClick={() => {
            if (androidAppShell) sendAndroidBrowserCommand("close");
            onBack();
          }}
          type="button"
        >
          <ArrowLeft size={16} />
          <span>浏览器</span>
        </button>
        <div
          className="browser-sidebar-ai-status"
          title={
            electronAvailable
              ? "AI 可读取并控制当前页面"
              : androidAvailable
                ? "网页将在 Android 原生浏览器中打开"
                : "请在 Electron 桌面版中使用"
          }
        >
          <Bot size={13} />
          {electronAvailable ? "AI 已连接" : androidAvailable ? "安卓浏览器" : "桌面版可用"}
        </div>
        <button
          aria-label="关闭右侧栏"
          onClick={() => {
            if (androidAppShell) sendAndroidBrowserCommand("close");
            onClose();
          }}
          title="关闭右侧栏"
          type="button"
        >
          <X size={16} />
        </button>
      </header>

      <div aria-label="浏览器标签页" className="browser-sidebar-tabs" role="tablist">
        {tabs.map((tab) => {
          const label = getBrowserTabLabel(tab);
          const active = tab.id === activeTabId;
          return (
            <div
              className={`browser-sidebar-tab ${active ? "is-active" : ""}`}
              key={tab.id}
              role="presentation"
            >
              <button
                aria-selected={active}
                className="browser-sidebar-tab-main"
                onClick={() => selectBrowserTab(tab.id)}
                role="tab"
                title={label}
                type="button"
              >
                <Globe
                  aria-hidden="true"
                  className={tab.loading ? "is-loading" : undefined}
                  size={12}
                />
                <span>{label}</span>
              </button>
              <button
                aria-label={`关闭标签页：${label}`}
                className="browser-sidebar-tab-close"
                onClick={() => closeBrowserTab(tab.id)}
                title="关闭标签页"
                type="button"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
        <button
          aria-label="新建标签页"
          className="browser-sidebar-new-tab"
          disabled={tabs.length >= MAX_BROWSER_TABS}
          onClick={() => createNewBrowserTab()}
          title={tabs.length >= MAX_BROWSER_TABS ? `最多 ${MAX_BROWSER_TABS} 个标签页` : "新建标签页"}
          type="button"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="browser-sidebar-toolbar-shell" ref={popoverRootRef}>
        <div className="browser-sidebar-toolbar">
          <button
            aria-label="后退"
            disabled={(!electronAvailable && !androidAppShell) || !pageState.canGoBack}
            onClick={() => {
              if (electronAvailable) webviewNode?.goBack();
              else sendAndroidBrowserCommand("back");
            }}
            title="后退"
            type="button"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            aria-label="前进"
            disabled={(!electronAvailable && !androidAppShell) || !pageState.canGoForward}
            onClick={() => {
              if (electronAvailable) webviewNode?.goForward();
              else sendAndroidBrowserCommand("forward");
            }}
            title="前进"
            type="button"
          >
            <ArrowRight size={15} />
          </button>
          <button
            aria-label={pageState.loading ? "停止加载" : "刷新"}
            disabled={
              (!electronAvailable && !androidAppShell) || pageState.url === "about:blank"
            }
            onClick={() => {
              if (electronAvailable) {
                if (pageState.loading) webviewNode?.stop();
                else webviewNode?.reload();
              } else {
                sendAndroidBrowserCommand(pageState.loading ? "stop" : "reload");
              }
            }}
            title={pageState.loading ? "停止加载" : "刷新"}
            type="button"
          >
            {pageState.loading ? <X size={14} /> : <RefreshCw size={15} />}
          </button>
          <form className="browser-address-form" onSubmit={submitAddress}>
            <Globe aria-hidden="true" size={14} />
            <input
              aria-label="浏览器地址"
              autoCapitalize="none"
              disabled={!addressInputAvailable}
              enterKeyHint="go"
              inputMode="url"
              onChange={(event) => {
                if (!activeTab) return;
                const nextAddress = event.target.value;
                updateBrowserTab(activeTab.id, (tab) => ({ ...tab, address: nextAddress }));
              }}
              onFocus={(event) => {
                if (androidAvailable) event.currentTarget.select();
              }}
              onKeyDown={handleAddressKeyDown}
              placeholder="输入网址或搜索内容"
              spellCheck={false}
              value={address}
            />
            <button
              aria-label="打开"
              disabled={!addressInputAvailable || !address.trim()}
              onClick={openSubmittedAddress}
              title="打开"
              type="button"
            >
              <Search size={14} />
            </button>
          </form>
          <button
            aria-expanded={popoverView === "downloads"}
            aria-label="下载"
            className={`browser-sidebar-toolbar-action ${popoverView === "downloads" ? "is-active" : ""}`}
            disabled={!electronAvailable}
            onClick={() => openPopover("downloads")}
            title="下载"
            type="button"
          >
            <Download size={16} />
            {activeDownloadCount > 0 ? <small>{Math.min(activeDownloadCount, 9)}</small> : null}
          </button>
          <button
            aria-expanded={popoverView !== null && popoverView !== "downloads"}
            aria-label="更多浏览器选项"
            className={`browser-sidebar-toolbar-action ${popoverView && popoverView !== "downloads" ? "is-active" : ""}`}
            disabled={!electronAvailable}
            onClick={() => openPopover("menu")}
            title="更多"
            type="button"
          >
            <EllipsisVertical size={17} />
          </button>
        </div>

        {popoverView ? (
          <div
            aria-label={popoverView === "downloads" ? "下载" : "浏览器菜单"}
            className={`browser-sidebar-popover ${popoverView === "downloads" ? "is-downloads" : ""}`}
            role="dialog"
          >
            {popoverView === "downloads" ? (
              <>
                <header className="browser-popover-header">
                  <strong>下载</strong>
                  <div>
                    {downloads.some((download) => download.state !== "progressing") ? (
                      <button
                        aria-label="清除已完成记录"
                        onClick={() => void runDownloadAction("clear-completed")}
                        title="清除已完成记录"
                        type="button"
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                    <button
                      aria-label="打开下载文件夹"
                      onClick={() => void runDownloadAction("open-folder")}
                      title="打开下载文件夹"
                      type="button"
                    >
                      <FolderOpen size={18} />
                    </button>
                  </div>
                </header>
                <div className="browser-download-list">
                  {downloads.length === 0 ? (
                    <div className="browser-download-empty">
                      <Download size={24} />
                      <span>还没有下载记录</span>
                    </div>
                  ) : downloads.map((download) => (
                    <div className="browser-download-item" key={download.id}>
                      <span className="browser-download-file-icon"><File size={20} /></span>
                      <button
                        className="browser-download-main"
                        disabled={!isDownloadFinished(download)}
                        onClick={() => void runDownloadAction("open", download.id)}
                        title={download.fileName}
                        type="button"
                      >
                        <strong>{download.fileName}</strong>
                        <small>
                          {getDownloadStatus(download)}
                          {formatDownloadTime(download.startedAt) ? ` · ${formatDownloadTime(download.startedAt)}` : ""}
                        </small>
                        {download.state === "progressing" && download.totalBytes > 0 ? (
                          <span className="browser-download-progress">
                            <i style={{ width: `${Math.min(100, (download.receivedBytes / download.totalBytes) * 100)}%` }} />
                          </span>
                        ) : null}
                      </button>
                      <button
                        aria-expanded={downloadActionsId === download.id}
                        aria-label={`下载操作：${download.fileName}`}
                        className="browser-download-more"
                        onClick={() => setDownloadActionsId((current) => current === download.id ? "" : download.id)}
                        title="更多操作"
                        type="button"
                      >
                        <EllipsisVertical size={17} />
                      </button>
                      {downloadActionsId === download.id ? (
                        <div className="browser-download-actions">
                          {isDownloadFinished(download) ? (
                            <>
                              <button onClick={() => void runDownloadAction("open", download.id)} type="button">
                                <ExternalLink size={14} /> 打开
                              </button>
                              <button onClick={() => void runDownloadAction("reveal", download.id)} type="button">
                                <FolderOpen size={14} /> 在文件夹中显示
                              </button>
                            </>
                          ) : download.state === "progressing" ? (
                            <>
                              <button onClick={() => void runDownloadAction(download.paused ? "resume" : "pause", download.id)} type="button">
                                {download.paused ? "继续下载" : "暂停下载"}
                              </button>
                              <button onClick={() => void runDownloadAction("cancel", download.id)} type="button">取消下载</button>
                            </>
                          ) : null}
                          <button onClick={() => void runDownloadAction("remove", download.id)} type="button">
                            <Trash2 size={14} /> 从列表中移除
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : popoverView === "menu" ? (
              <div className="browser-menu-list">
                <button disabled={!pageActionAvailable} onClick={openFindBar} type="button">
                  <span>在页面中查找</span><Search size={16} />
                </button>
                <div className="browser-menu-divider" />
                <div className="browser-menu-zoom-row">
                  <span>缩放</span>
                  <div>
                    <button aria-label="缩小网页" disabled={zoomFactor <= MIN_ZOOM_FACTOR} onClick={() => changeZoom(-ZOOM_STEP)} type="button"><Minus size={15} /></button>
                    <button aria-label="重置网页缩放" onClick={resetZoom} type="button">{Math.round(zoomFactor * 100)}%</button>
                    <button aria-label="放大网页" disabled={zoomFactor >= MAX_ZOOM_FACTOR} onClick={() => changeZoom(ZOOM_STEP)} type="button"><Plus size={16} /></button>
                  </div>
                  <button aria-label="适应侧栏宽度" className={autoFit ? "is-active" : ""} onClick={activateAutoFit} title="适应侧栏宽度" type="button"><RotateCcw size={16} /></button>
                </div>
                <div className="browser-menu-divider" />
                <button disabled={!pageActionAvailable} onClick={() => void toggleDeviceEmulation()} type="button">
                  <span>显示设备工具栏</span>
                  {deviceEmulationEnabled ? <Check size={17} /> : <MonitorSmartphone size={17} />}
                </button>
                <button disabled={!pageActionAvailable} onClick={() => void capturePage()} type="button">
                  <span>截取屏幕截图</span><Camera size={17} />
                </button>
                <div className="browser-menu-divider" />
                <button onClick={() => void importBrowserProfile()} type="button">
                  <span>导入 Cookie 和密码...</span>
                </button>
                <button onClick={() => setPopoverView("passwords")} type="button">
                  <span>密码和自动填充</span><ChevronRight size={18} />
                </button>
                <button onClick={() => setPopoverView("downloads")} type="button">
                  <span>下载</span>{activeDownloadCount > 0 ? <small>{activeDownloadCount}</small> : null}
                </button>
                <button onClick={() => setPopoverView("clear-data")} type="button">
                  <span>清除浏览数据</span><ChevronRight size={18} />
                </button>
                <div className="browser-menu-divider" />
                <button onClick={() => setPopoverView("settings")} type="button">
                  <span>浏览器设置</span><Settings2 size={17} />
                </button>
              </div>
            ) : (
              <>
                <header className="browser-popover-subheader">
                  <button aria-label="返回浏览器菜单" onClick={() => setPopoverView("menu")} type="button"><ChevronLeft size={18} /></button>
                  <strong>
                    {popoverView === "passwords" ? "密码和自动填充" : popoverView === "clear-data" ? "清除浏览数据" : "浏览器设置"}
                  </strong>
                </header>
                {popoverView === "passwords" ? (
                  <div className="browser-popover-settings">
                    <button className="browser-setting-row" onClick={() => void updateAutofillSetting(!profile?.autofillPasswords)} type="button">
                      <span><strong>自动填充已导入密码</strong><small>仅对网址来源完全匹配的站点生效</small></span>
                      <i className={profile?.autofillPasswords ? "is-on" : ""}><b /></i>
                    </button>
                    <button className="browser-setting-action" disabled={!pageActionAvailable || !profile?.passwordCount} onClick={() => webviewNode && void autofillPage(webviewNode, true).catch(reportFeatureError)} type="button">
                      <KeyRound size={16} /> 填充当前页面
                    </button>
                    <button className="browser-setting-action" onClick={() => void importBrowserProfile()} type="button">
                      导入密码文件
                    </button>
                    <button className="browser-setting-action is-danger" disabled={!profile?.passwordCount} onClick={() => void clearBrowserData("passwords")} type="button">
                      删除 {profile?.passwordCount ?? 0} 个已导入密码
                    </button>
                  </div>
                ) : popoverView === "clear-data" ? (
                  <div className="browser-clear-list">
                    <button onClick={() => void clearBrowserData("cache")} type="button"><span>缓存文件</span><small>保留登录状态</small></button>
                    <button onClick={() => void clearBrowserData("cookies")} type="button"><span>Cookie 和网站数据</span><small>会退出已登录的网站</small></button>
                    <button onClick={() => void clearBrowserData("history")} type="button"><span>浏览历史</span><small>清空侧栏标签页历史</small></button>
                    <button className="is-danger" onClick={() => void clearBrowserData("all")} type="button"><span>全部浏览数据</span><small>缓存、Cookie、网站数据和历史</small></button>
                  </div>
                ) : (
                  <div className="browser-popover-settings">
                    <div className="browser-settings-card">
                      <Download size={17} />
                      <span><strong>下载位置</strong><small title={profile?.downloadDirectory}>{profile?.downloadDirectory || "系统下载文件夹"}</small></span>
                      <button aria-label="打开下载文件夹" onClick={() => void runDownloadAction("open-folder")} type="button"><ExternalLink size={15} /></button>
                    </div>
                    <div className="browser-settings-card">
                      <ShieldCheck size={17} />
                      <span><strong>独立浏览器资料</strong><small>Cookie、缓存和登录状态与应用页面隔离</small></span>
                    </div>
                    <button className="browser-setting-row" onClick={() => void updateAutofillSetting(!profile?.autofillPasswords)} type="button">
                      <span><strong>密码自动填充</strong><small>已安全保存 {profile?.passwordCount ?? 0} 个密码</small></span>
                      <i className={profile?.autofillPasswords ? "is-on" : ""}><b /></i>
                    </button>
                    <button className="browser-setting-action" onClick={activateAutoFit} type="button">
                      <Maximize2 size={16} /> 当前页面适应侧栏宽度
                    </button>
                  </div>
                )}
              </>
            )}
            {featureNotice ? <div className="browser-popover-notice">{featureNotice}</div> : null}
          </div>
        ) : null}
      </div>

      {findOpen ? (
        <div className="browser-sidebar-find" role="search">
          <Search aria-hidden="true" size={15} />
          <input
            aria-label="在页面中查找"
            onChange={(event) => setFindQuery(event.target.value)}
            onKeyDown={handleFindKeyDown}
            placeholder="在页面中查找"
            ref={findInputRef}
            value={findQuery}
          />
          <small>{findQuery ? `${findResult.activeMatchOrdinal}/${findResult.matches}` : ""}</small>
          <button aria-label="上一个匹配项" disabled={!findResult.matches} onClick={() => findNext(false)} type="button"><ChevronUp size={16} /></button>
          <button aria-label="下一个匹配项" disabled={!findResult.matches} onClick={() => findNext(true)} type="button"><ChevronDown size={16} /></button>
          <button aria-label="关闭查找" onClick={closeFindBar} type="button"><X size={16} /></button>
        </div>
      ) : null}

      <div className="browser-sidebar-page" ref={pageRef}>
        {electronAvailable
          ? tabs.map((tab) => (
              <BrowserTabWebview
                active={tab.id === activeTabId}
                initialUrl={tab.initialUrl}
                key={tab.id}
                onNode={captureWebviewNode}
                tabId={tab.id}
              />
            ))
          : null}

        {contextMenu ? (
          <div
            aria-label="网页右键菜单"
            className="browser-context-menu"
            onPointerDown={(event) => event.stopPropagation()}
            ref={contextMenuRef}
            role="menu"
            style={{
              left: contextMenu.left,
              top: contextMenu.top,
              maxWidth: contextMenu.maxWidth,
              maxHeight: contextMenu.maxHeight,
            }}
          >
            <button onClick={() => void startBrowserComment()} role="menuitem" type="button">
              <SlidersHorizontal size={16} />
              <span>Quick annotate</span>
            </button>
            <button onClick={() => void startBrowserComment()} role="menuitem" type="button">
              <MessageSquare size={16} />
              <span>评论</span>
            </button>
            {contextMenu.request.selectionText ? (
              <>
                <div />
                <button onClick={() => void copyContextText(contextMenu.request.selectionText)} role="menuitem" type="button">
                  <Copy size={16} />
                  <span>复制所选文本</span>
                </button>
              </>
            ) : null}
            {contextMenu.target.linkUrl ? (
              <>
                <div />
                <button onClick={() => openContextUrlInTab(contextMenu.target.linkUrl)} role="menuitem" type="button">
                  <ExternalLink size={16} />
                  <span>在新标签页中打开链接</span>
                </button>
                <button
                  onClick={() => void runContextAction("open-external", { url: contextMenu.target.linkUrl }).then(() => setContextMenu(null))}
                  role="menuitem"
                  type="button"
                >
                  <ExternalLink size={16} />
                  <span>在外部浏览器中打开</span>
                </button>
                <button onClick={() => saveContextUrl(contextMenu.target.linkUrl)} role="menuitem" type="button">
                  <Save size={16} />
                  <span>链接另存为...</span>
                </button>
                <button onClick={() => void copyContextText(contextMenu.target.linkUrl)} role="menuitem" type="button">
                  <Copy size={16} />
                  <span>复制链接地址</span>
                </button>
              </>
            ) : null}
            {contextMenu.target.imageUrl ? (
              <>
                <div />
                <button onClick={() => openContextUrlInTab(contextMenu.target.imageUrl)} role="menuitem" type="button">
                  <ImageIcon size={16} />
                  <span>在新标签页中打开图片</span>
                </button>
                <button onClick={() => saveContextUrl(contextMenu.target.imageUrl)} role="menuitem" type="button">
                  <Save size={16} />
                  <span>图片另存为...</span>
                </button>
                <button
                  onClick={() => void runContextAction("copy-image", { url: contextMenu.target.imageUrl }).then(() => setContextMenu(null))}
                  role="menuitem"
                  type="button"
                >
                  <Copy size={16} />
                  <span>复制图片</span>
                </button>
                <button onClick={() => void copyContextText(contextMenu.target.imageUrl)} role="menuitem" type="button">
                  <Copy size={16} />
                  <span>复制图片地址</span>
                </button>
              </>
            ) : null}
            <div />
            <button
              onClick={() => void runContextAction("inspect", {
                x: contextMenu.request.x,
                y: contextMenu.request.y,
              }).then(() => setContextMenu(null))}
              role="menuitem"
              type="button"
            >
              <Search size={16} />
              <span>检查</span>
            </button>
          </div>
        ) : null}

        {commentEditor ? (
          <>
            <div
              aria-hidden="true"
              className="browser-comment-highlight"
              style={{
                left: commentEditor.target.rect.x * commentEditor.zoomFactor,
                top: commentEditor.target.rect.y * commentEditor.zoomFactor,
                width: commentEditor.target.rect.width * commentEditor.zoomFactor,
                height: commentEditor.target.rect.height * commentEditor.zoomFactor,
              }}
            >
              <span>1</span>
            </div>
            <form
              className="browser-comment-editor"
              onPointerDown={(event) => event.stopPropagation()}
              onSubmit={(event) => {
                event.preventDefault();
                submitBrowserComment();
              }}
              style={{ left: commentEditor.left, top: commentEditor.top }}
            >
              <SlidersHorizontal aria-hidden="true" size={18} />
              <input
                aria-label="评论网页元素"
                onChange={(event) => setCommentText(event.target.value)}
                onKeyDown={handleCommentKeyDown}
                placeholder="评论"
                ref={commentInputRef}
                value={commentText}
              />
              <button aria-label="添加评论到消息发送区" disabled={!commentText.trim()} type="submit">
                <Check size={21} />
              </button>
            </form>
          </>
        ) : null}

        {!electronAvailable && !androidBrowserVisible ? (
          <div className="browser-sidebar-empty is-unavailable">
            <span><ShieldCheck size={25} /></span>
            <strong>{androidAvailable ? "Android 内嵌浏览器" : "桌面浏览器模块"}</strong>
            <p>
              {androidAvailable
                ? "输入网址或搜索内容，网页会直接显示在当前右侧栏中。"
                : "完整网页控制依赖 Electron 安全隔离容器，请在桌面版中使用。"}
            </p>
          </div>
        ) : pageState.url === "about:blank" && !activeTab?.hasDocumentContent ? (
          <div className="browser-sidebar-empty">
            <span><Globe size={25} /></span>
            <strong>AI 可控制浏览器</strong>
            <p>输入网址开始浏览。AI 可以阅读页面、操作控件、编辑 DOM，并执行页面脚本。</p>
            <div>
              <small><ShieldCheck size={12} /> 隔离网页权限</small>
              <small><Code2 size={12} /> 完整 DOM 工具</small>
            </div>
          </div>
        ) : null}

        {error ? <div className="browser-sidebar-error">{error}</div> : null}
      </div>

      <footer className="browser-sidebar-footer">
        <span
          className={
            !electronAvailable && !androidAvailable
              ? "is-unavailable"
              : pageState.loading ? "is-loading" : undefined
          }
        />
        <strong>
          {!electronAvailable
            ? androidAvailable ? "Android 浏览器可用" : "桌面版可用"
            : pageState.loading ? "正在加载" : pageState.title || "新页面"}
        </strong>
        {electronAvailable ? (
          <div className="browser-sidebar-zoom" aria-label="网页缩放">
            <button
              aria-label="缩小网页"
              disabled={zoomFactor <= MIN_ZOOM_FACTOR}
              onClick={() => changeZoom(-ZOOM_STEP)}
              title="缩小网页"
              type="button"
            >
              <Minus size={12} />
            </button>
            <button
              aria-label={`适应侧栏宽度，当前 ${Math.round(zoomFactor * 100)}%`}
              className={autoFit ? "is-active" : undefined}
              onClick={activateAutoFit}
              title="重新适应侧栏宽度"
              type="button"
            >
              <Maximize2 size={11} />
              {Math.round(zoomFactor * 100)}%
            </button>
            <button
              aria-label="放大网页"
              disabled={zoomFactor >= MAX_ZOOM_FACTOR}
              onClick={() => changeZoom(ZOOM_STEP)}
              title="放大网页"
              type="button"
            >
              <Plus size={12} />
            </button>
          </div>
        ) : (
          <small>{androidAvailable ? "右侧栏内嵌网页" : "仅 Electron 桌面版"}</small>
        )}
      </footer>
    </section>
  );
}
