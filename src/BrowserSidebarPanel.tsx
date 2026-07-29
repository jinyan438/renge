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
  normalizeBrowserAddress,
  registerBrowserSidebarController,
  type BrowserSidebarController,
  type BrowserToolArguments,
} from "./browserSidebarRuntime";
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

function sleep(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function getStringArg(args: BrowserToolArguments, key: string) {
  const value = args[key];
  return value === undefined || value === null ? "" : String(value);
}

function clampPageTextLimit(value: unknown) {
  const parsed = Number(value ?? 18000);
  return Math.min(50000, Math.max(1000, Number.isFinite(parsed) ? Math.round(parsed) : 18000));
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

function buildPageReadScript(args: BrowserToolArguments) {
  const mode = ["snapshot", "interactive", "text", "html"].includes(getStringArg(args, "mode"))
    ? getStringArg(args, "mode")
    : "snapshot";
  const selector = getStringArg(args, "selector");
  const maxChars = clampPageTextLimit(args.maxChars);
  return `(() => {
    const mode = ${JSON.stringify(mode)};
    const selector = ${JSON.stringify(selector)};
    const maxChars = ${maxChars};
    const root = selector ? document.querySelector(selector) : document.body;
    if (!root) throw new Error('页面中找不到读取区域：' + selector);
    const cleanText = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const trim = (value) => {
      const text = String(value ?? '');
      return { content: text.slice(0, maxChars), truncated: text.length > maxChars, totalChars: text.length };
    };
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const interactiveSelector = [
      'a[href]', 'button', 'input', 'textarea', 'select', 'summary',
      '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
      '[role="tab"]', '[role="menuitem"]', '[contenteditable="true"]', '[tabindex]'
    ].join(',');
    document.querySelectorAll('[data-renge-browser-ref]').forEach((element) => element.removeAttribute('data-renge-browser-ref'));
    const interactives = Array.from(root.querySelectorAll(interactiveSelector))
      .filter((element) => isVisible(element) && !element.hasAttribute('disabled'))
      .slice(0, 300)
      .map((element, index) => {
        const ref = 'e' + (index + 1);
        element.setAttribute('data-renge-browser-ref', ref);
        const tag = element.tagName.toLowerCase();
        const type = element.getAttribute('type') || '';
        const isPassword = tag === 'input' && type.toLowerCase() === 'password';
        const labels = element.labels ? Array.from(element.labels).map((label) => cleanText(label.innerText)).filter(Boolean) : [];
        const label = element.getAttribute('aria-label') || labels[0] || element.getAttribute('alt') || element.getAttribute('title') || element.getAttribute('placeholder') || cleanText(element.innerText).slice(0, 160);
        const rect = element.getBoundingClientRect();
        return {
          ref,
          tag,
          type,
          role: element.getAttribute('role') || '',
          label,
          text: cleanText(element.innerText).slice(0, 240),
          value: isPassword ? '[password omitted]' : 'value' in element ? String(element.value ?? '').slice(0, 500) : '',
          href: element.href || '',
          checked: 'checked' in element ? Boolean(element.checked) : undefined,
          disabled: 'disabled' in element ? Boolean(element.disabled) : undefined,
          box: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        };
      });
    const result = {
      ok: true,
      url: location.href,
      title: document.title,
      mode,
      scroll: { x: Math.round(scrollX), y: Math.round(scrollY), maxY: Math.max(0, document.documentElement.scrollHeight - innerHeight) },
      viewport: { width: innerWidth, height: innerHeight },
    };
    if (mode === 'interactive') return { ...result, interactive: interactives };
    if (mode === 'html') {
      const clone = root.cloneNode(true);
      clone.querySelectorAll?.('input[type="password"]').forEach((element) => element.setAttribute('value', '[password omitted]'));
      return { ...result, html: trim(clone.outerHTML || '') };
    }
    const text = trim(cleanText(root.innerText || root.textContent || ''));
    if (mode === 'text') return { ...result, text };
    return { ...result, text, interactive: interactives };
  })()`;
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
  const [webviewNode, setWebviewNode] = useState<ElectronWebviewElement | null>(null);
  const [pageState, setPageState] = useState(DEFAULT_PAGE_STATE);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [zoomFactor, setZoomFactor] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const pageStateRef = useRef(pageState);
  const zoomFactorRef = useRef(zoomFactor);
  const autoFitRef = useRef(autoFit);
  const fitRequestRef = useRef(0);
  pageStateRef.current = pageState;
  zoomFactorRef.current = zoomFactor;
  autoFitRef.current = autoFit;
  const captureWebviewNode = useCallback(
    (node: HTMLElement | null) => setWebviewNode(node as ElectronWebviewElement | null),
    [],
  );

  const refreshPageState = (loading = pageStateRef.current.loading) => {
    if (!webviewNode) return DEFAULT_PAGE_STATE;
    const nextState = getWebviewPageState(webviewNode, loading);
    setPageState(nextState);
    setAddress(nextState.url === "about:blank" ? "" : nextState.url);
    return nextState;
  };

  const openAddress = async (rawAddress: string) => {
    if (!webviewNode) throw new Error("浏览器页面容器尚未准备好");
    const url = normalizeBrowserAddress(rawAddress);
    setError("");
    setAddress(url === "about:blank" ? "" : url);
    setPageState((current) => ({ ...current, url, loading: true }));
    await webviewNode.loadURL(url);
    return refreshPageState(false);
  };

  const applyZoomFactor = (value: number) => {
    if (!webviewNode) return;
    const nextZoom = Math.min(
      MAX_ZOOM_FACTOR,
      Math.max(MIN_ZOOM_FACTOR, Math.round(value * 100) / 100),
    );
    webviewNode.setZoomFactor(nextZoom);
    zoomFactorRef.current = nextZoom;
    setZoomFactor(nextZoom);
  };

  const fitPageToWidth = async (force = false) => {
    if (!webviewNode || (!force && !autoFitRef.current)) return;
    const containerWidth = webviewNode.getBoundingClientRect().width;
    const pageUrl = webviewNode.getURL();
    if (containerWidth < 80 || !pageUrl || pageUrl === "about:blank") return;

    const requestId = ++fitRequestRef.current;
    const previousZoom = zoomFactorRef.current;
    webviewNode.setZoomFactor(1);
    await sleep(40);
    let metrics: { contentWidth: number; viewportWidth: number };
    try {
      metrics = await webviewNode.executeJavaScript(`(() => {
        const root = document.documentElement;
        const body = document.body;
        const viewportWidth = Math.max(root?.clientWidth || 0, innerWidth || 0);
        const contentWidth = Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0, viewportWidth);
        return { viewportWidth, contentWidth };
      })()`);
    } catch (fitError) {
      if (requestId === fitRequestRef.current) applyZoomFactor(previousZoom);
      throw fitError;
    }
    if (requestId !== fitRequestRef.current || webviewNode.getURL() !== pageUrl) return;

    applyZoomFactor(
      calculateBrowserFitZoomFactor(metrics.viewportWidth, metrics.contentWidth),
    );
  };

  const changeZoom = (delta: number) => {
    fitRequestRef.current += 1;
    autoFitRef.current = false;
    setAutoFit(false);
    applyZoomFactor(zoomFactorRef.current + delta);
  };

  const activateAutoFit = () => {
    autoFitRef.current = true;
    setAutoFit(true);
    void fitPageToWidth(true).catch(() => undefined);
  };

  useEffect(() => {
    if (!webviewNode) return;
    const startLoading = () => {
      fitRequestRef.current += 1;
      if (autoFitRef.current) applyZoomFactor(1);
      refreshPageState(true);
    };
    const stopLoading = () => {
      refreshPageState(false);
      void fitPageToWidth().catch(() => undefined);
    };
    const navigation = () => refreshPageState(pageStateRef.current.loading);
    const titleUpdated = (event: Event) => {
      const title = String((event as Event & { title?: string }).title ?? "");
      setPageState((current) => ({ ...current, title: title || current.title }));
    };
    const failed = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
        validatedURL?: string;
      };
      if (detail.isMainFrame === false || detail.errorCode === -3) return;
      setError(detail.errorDescription || "页面加载失败");
      refreshPageState(false);
    };
    webviewNode.addEventListener("did-start-loading", startLoading);
    webviewNode.addEventListener("did-stop-loading", stopLoading);
    webviewNode.addEventListener("did-navigate", navigation);
    webviewNode.addEventListener("did-navigate-in-page", navigation);
    webviewNode.addEventListener("page-title-updated", titleUpdated);
    webviewNode.addEventListener("did-fail-load", failed);
    return () => {
      webviewNode.removeEventListener("did-start-loading", startLoading);
      webviewNode.removeEventListener("did-stop-loading", stopLoading);
      webviewNode.removeEventListener("did-navigate", navigation);
      webviewNode.removeEventListener("did-navigate-in-page", navigation);
      webviewNode.removeEventListener("page-title-updated", titleUpdated);
      webviewNode.removeEventListener("did-fail-load", failed);
    };
  }, [webviewNode]);

  useEffect(() => {
    if (!webviewNode) return;
    let resizeTimer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        void fitPageToWidth().catch(() => undefined);
      }, 160);
    });
    observer.observe(webviewNode);
    return () => {
      window.clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, [webviewNode]);

  const controller = useMemo<BrowserSidebarController | null>(() => {
    if (!webviewNode) return null;
    const executeInPage = <T,>(script: string, userGesture = false) =>
      webviewNode.executeJavaScript<T>(script, userGesture);
    const readState = () => getWebviewPageState(webviewNode, pageStateRef.current.loading);
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
            return executeInPage(buildPageReadScript(args));
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
            return {
              ok: true,
              action: "execute_script",
              result: await executeInPage(script, true),
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
    void openAddress(address).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "页面加载失败");
    });
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
            onChange={(event) => setAddress(event.target.value)}
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
          ? createElement("webview", {
              ref: captureWebviewNode,
              className: "browser-sidebar-webview",
              partition: "persist:renge-sidebar-browser",
              src: "about:blank",
              webpreferences: "contextIsolation=yes,nodeIntegration=no,sandbox=yes",
            })
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
