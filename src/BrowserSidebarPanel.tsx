import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Code2,
  Globe,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  createElement,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  calculateBrowserFitZoomFactor,
  buildBrowserPageReadScript,
  buildBrowserScriptExecutionWrapper,
  normalizeBrowserAddress,
  registerBrowserSidebarController,
  type BrowserSidebarController,
  type BrowserToolArguments,
} from "./browserSidebarRuntime";
import {
  getBrowserTabAfterClose,
  MAX_BROWSER_TABS,
  parseBrowserOpenTabRequest,
} from "./browserSidebarTabs";
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
  getZoomFactor(): number;
  setZoomFactor(factor: number): void;
  getWebContentsId(): number;
  executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
  sendInputEvent(event: Record<string, unknown>): void;
};

type BrowserSidebarPanelProps = {
  onBack: () => void;
  onClose: () => void;
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
  };
}

function getBrowserTabLabel(tab: BrowserTabState) {
  if (tab.url === "about:blank") return "新标签页";
  if (tab.title && tab.title !== DEFAULT_PAGE_STATE.title) return tab.title;
  try {
    return new URL(tab.url).hostname || "网页";
  } catch {
    return "网页";
  }
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
    allowpopups: true,
    "aria-hidden": active ? undefined : "true",
    className: `browser-sidebar-webview ${active ? "is-active" : ""}`,
    partition: "persist:renge-sidebar-browser",
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

export function BrowserSidebarPanel({ onBack, onClose }: BrowserSidebarPanelProps) {
  const electronAvailable = Boolean(window.rengeDesktop?.isElectron);
  const [tabs, setTabs] = useState<BrowserTabState[]>(() => [createBrowserTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [webviewNodes, setWebviewNodes] = useState(
    () => new Map<string, ElectronWebviewElement>(),
  );
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const webviewNodesRef = useRef(new Map<string, ElectronWebviewElement>());
  const webviewCleanupRef = useRef(new Map<string, () => void>());
  const fitRequestRef = useRef(new Map<string, number>());
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const webviewNode = activeTab ? webviewNodes.get(activeTab.id) ?? null : null;
  const pageState: BrowserPageState = activeTab ?? DEFAULT_PAGE_STATE;
  const address = activeTab?.address ?? "";
  const error = activeTab?.error ?? "";
  const zoomFactor = activeTab?.zoomFactor ?? 1;
  const autoFit = activeTab?.autoFit ?? true;

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

  const selectBrowserTab = useCallback((tabId: string) => {
    if (!tabsRef.current.some((tab) => tab.id === tabId)) return;
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
  }, []);

  const refreshPageState = useCallback(
    (tabId: string, node: ElectronWebviewElement, loading: boolean) => {
      const nextState = getWebviewPageState(node, loading);
      updateBrowserTab(tabId, (tab) => ({
        ...tab,
        ...nextState,
        address: nextState.url === "about:blank" ? "" : nextState.url,
      }));
      return nextState;
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
      node.addEventListener("did-start-loading", startLoading);
      node.addEventListener("did-stop-loading", stopLoading);
      node.addEventListener("did-navigate", navigation);
      node.addEventListener("did-navigate-in-page", navigation);
      node.addEventListener("page-title-updated", titleUpdated);
      node.addEventListener("did-fail-load", failed);

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
      return tab.id;
    },
    [updateBrowserTab],
  );

  const closeBrowserTab = useCallback(
    (tabId: string) => {
      const current = tabsRef.current;
      if (current.length === 1) {
        const node = webviewNodesRef.current.get(tabId);
        updateBrowserTab(tabId, (tab) => ({
          ...createBrowserTab(),
          id: tab.id,
          initialUrl: tab.initialUrl,
        }));
        void node?.loadURL("about:blank").catch(() => undefined);
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
      }
    },
    [updateBrowserTab],
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

  const controller = useMemo<BrowserSidebarController | null>(() => {
    if (!webviewNode) return null;
    const executeInPage = <T,>(script: string, userGesture = false) =>
      webviewNode.executeJavaScript<T>(script, userGesture);
    const readState = () => getWebviewPageState(
      webviewNode,
      tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)?.loading ?? false,
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
          case "browser_edit_page":
            return executeInPage(`(() => {
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
  }, [webviewNode]);

  useEffect(() => {
    if (!controller) return;
    return registerBrowserSidebarController(controller);
  }, [controller]);

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    void openAddress(address).catch(() => undefined);
  };

  return (
    <section className="right-tool-content browser-sidebar-panel" aria-label="浏览器面板">
      <header className="browser-sidebar-header">
        <button className="browser-sidebar-back" onClick={onBack} type="button">
          <ArrowLeft size={16} />
          <span>浏览器</span>
        </button>
        <div
          className="browser-sidebar-ai-status"
          title={electronAvailable ? "AI 可读取并控制当前页面" : "请在 Electron 桌面版中使用"}
        >
          <Bot size={13} />
          {electronAvailable ? "AI 已连接" : "桌面版可用"}
        </div>
        <button aria-label="关闭右侧栏" onClick={onClose} title="关闭右侧栏" type="button">
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

      <div className="browser-sidebar-toolbar">
        <button
          aria-label="后退"
          disabled={!electronAvailable || !pageState.canGoBack}
          onClick={() => webviewNode?.goBack()}
          title="后退"
          type="button"
        >
          <ArrowLeft size={15} />
        </button>
        <button
          aria-label="前进"
          disabled={!electronAvailable || !pageState.canGoForward}
          onClick={() => webviewNode?.goForward()}
          title="前进"
          type="button"
        >
          <ArrowRight size={15} />
        </button>
        <button
          aria-label={pageState.loading ? "停止加载" : "刷新"}
          disabled={!electronAvailable || pageState.url === "about:blank"}
          onClick={() => (pageState.loading ? webviewNode?.stop() : webviewNode?.reload())}
          title={pageState.loading ? "停止加载" : "刷新"}
          type="button"
        >
          {pageState.loading ? <X size={14} /> : <RefreshCw size={15} />}
        </button>
        <form className="browser-address-form" onSubmit={submitAddress}>
          <Globe aria-hidden="true" size={14} />
          <input
            aria-label="浏览器地址"
            disabled={!electronAvailable}
            onChange={(event) => {
              if (!activeTab) return;
              const nextAddress = event.target.value;
              updateBrowserTab(activeTab.id, (tab) => ({ ...tab, address: nextAddress }));
            }}
            placeholder="输入网址或搜索内容"
            spellCheck={false}
            value={address}
          />
          <button aria-label="打开" disabled={!electronAvailable || !address.trim()} title="打开" type="submit">
            <Search size={14} />
          </button>
        </form>
      </div>

      <div className="browser-sidebar-page">
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

        {!electronAvailable ? (
          <div className="browser-sidebar-empty is-unavailable">
            <span><ShieldCheck size={25} /></span>
            <strong>桌面浏览器模块</strong>
            <p>完整网页控制依赖 Electron 安全隔离容器，请在桌面版中使用。</p>
          </div>
        ) : pageState.url === "about:blank" ? (
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
            !electronAvailable ? "is-unavailable" : pageState.loading ? "is-loading" : undefined
          }
        />
        <strong>
          {!electronAvailable ? "桌面版可用" : pageState.loading ? "正在加载" : pageState.title || "新页面"}
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
          <small>仅 Electron 桌面版</small>
        )}
      </footer>
    </section>
  );
}
