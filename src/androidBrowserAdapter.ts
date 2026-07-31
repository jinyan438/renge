export const ANDROID_BROWSER_EVENT_NAME = "renge-android-browser-event";

export type AndroidBrowserBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type AndroidBrowserEventDetail = {
  type: string;
  tabId?: string;
  url?: string;
  title?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  loading?: boolean;
  visible?: boolean;
  zoomFactor?: number;
  activeMatchOrdinal?: number;
  matches?: number;
  finalUpdate?: boolean;
  [key: string]: unknown;
};

type AndroidBrowserState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  visible: boolean;
  zoomFactor: number;
};

type AndroidBrowserBridgeWindow = Window & {
  rengeAndroid?: {
    browserCommand?(options: Record<string, unknown>): Promise<unknown>;
    browserRequest?(options: Record<string, unknown>): Promise<unknown>;
  };
  RengeAndroidNative?: {
    browserCommand?(optionsJson: string): string;
    browserRequest?(requestId: string, optionsJson: string): void;
  };
  __rengeAndroidPending?: Record<
    string,
    { resolve(value: unknown): void; reject(error: Error): void }
  >;
  __rengeAndroidResolve?(requestId: string, payload: unknown): void;
  __rengeAndroidReject?(requestId: string, message?: string): void;
};

export type AndroidBrowserAdapterOptions = {
  tabId: string;
  getBounds: () => AndroidBrowserBounds | undefined;
  getClientRect: () => DOMRect;
};

let adapterSequence = 0;

function parseNativeResult(rawResult: string) {
  let result: unknown;
  try {
    result = JSON.parse(rawResult);
  } catch {
    throw new Error("Android 浏览器接口返回了无效结果");
  }
  if (!result || typeof result !== "object") {
    throw new Error("Android 浏览器接口返回了无效结果");
  }
  const error = (result as { error?: unknown }).error;
  if (typeof error === "string" && error) throw new Error(error);
  return result;
}

async function runNativeCommand(options: Record<string, unknown>) {
  const host = window as AndroidBrowserBridgeWindow;
  if (host.rengeAndroid?.browserCommand) {
    return host.rengeAndroid.browserCommand(options);
  }
  if (!host.RengeAndroidNative?.browserCommand) {
    throw new Error("Android 浏览器控制接口尚未准备好");
  }
  return parseNativeResult(host.RengeAndroidNative.browserCommand(JSON.stringify(options)));
}

async function runNativeRequest(options: Record<string, unknown>) {
  const host = window as AndroidBrowserBridgeWindow;
  if (host.rengeAndroid?.browserRequest) {
    return host.rengeAndroid.browserRequest(options);
  }
  if (!host.RengeAndroidNative?.browserRequest) {
    throw new Error("Android 浏览器页面接口尚未准备好");
  }
  return new Promise<unknown>((resolve, reject) => {
    const requestId = `browser-${Date.now()}-${++adapterSequence}`;
    const pending = host.__rengeAndroidPending ?? {};
    host.__rengeAndroidPending = pending;
    host.__rengeAndroidResolve ??= (id, payload) => {
      const request = host.__rengeAndroidPending?.[id];
      if (!request) return;
      delete host.__rengeAndroidPending?.[id];
      request.resolve(payload);
    };
    host.__rengeAndroidReject ??= (id, message) => {
      const request = host.__rengeAndroidPending?.[id];
      if (!request) return;
      delete host.__rengeAndroidPending?.[id];
      request.reject(new Error(message || "Android 浏览器请求失败"));
    };
    pending[requestId] = { resolve, reject };
    try {
      host.RengeAndroidNative?.browserRequest?.(requestId, JSON.stringify(options));
    } catch (error) {
      delete pending[requestId];
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function getStableWebContentsId(tabId: string) {
  let hash = 5381;
  for (let index = 0; index < tabId.length; index += 1) {
    hash = ((hash << 5) + hash) ^ tabId.charCodeAt(index);
  }
  return Math.max(1, hash >>> 0);
}

function createAdapterEvent(type: string, properties: Record<string, unknown> = {}) {
  const event = new Event(type);
  for (const [key, value] of Object.entries(properties)) {
    if (key === "type") continue;
    Object.defineProperty(event, key, { configurable: true, enumerable: true, value });
  }
  return event;
}

export class AndroidBrowserAdapter extends EventTarget {
  readonly tabId: string;
  private readonly getBounds: () => AndroidBrowserBounds | undefined;
  private readonly getClientRectValue: () => DOMRect;
  private readonly webContentsId: number;
  private findRequestId = 0;
  private destroyed = false;
  private pendingNavigation: {
    resolve(): void;
    reject(error: Error): void;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null = null;
  private state: AndroidBrowserState = {
    url: "about:blank",
    title: "新页面",
    canGoBack: false,
    canGoForward: false,
    loading: false,
    visible: false,
    zoomFactor: 1,
  };

  constructor({ tabId, getBounds, getClientRect }: AndroidBrowserAdapterOptions) {
    super();
    this.tabId = tabId;
    this.getBounds = getBounds;
    this.getClientRectValue = getClientRect;
    this.webContentsId = getStableWebContentsId(tabId);
    window.addEventListener(ANDROID_BROWSER_EVENT_NAME, this.handleNativeEvent);
    void this.command("create").catch((error) => this.dispatchFailure(error));
  }

  private handleNativeEvent = (event: Event) => {
    const detail = (event as CustomEvent<AndroidBrowserEventDetail>).detail;
    if (!detail || detail.tabId !== this.tabId) return;
    if (detail.type === "state") {
      this.state = {
        url: typeof detail.url === "string" ? detail.url : this.state.url,
        title: typeof detail.title === "string" ? detail.title : this.state.title,
        canGoBack: Boolean(detail.canGoBack),
        canGoForward: Boolean(detail.canGoForward),
        loading: Boolean(detail.loading),
        visible: detail.visible !== false,
        zoomFactor: typeof detail.zoomFactor === "number"
          ? detail.zoomFactor
          : this.state.zoomFactor,
      };
      return;
    }
    if (detail.type === "did-start-loading") this.state.loading = true;
    if (detail.type === "did-stop-loading") {
      this.state.loading = false;
      this.finishNavigation();
    }
    if (["did-navigate", "did-navigate-in-page"].includes(detail.type)
        && typeof detail.url === "string") {
      this.state.url = detail.url;
    }
    if (detail.type === "did-fail-load") {
      this.state.loading = false;
      this.finishNavigation(new Error(String(detail.errorDescription || "页面加载失败")));
    }
    if (detail.type === "page-title-updated" && typeof detail.title === "string") {
      this.state.title = detail.title;
    }
    if (detail.type === "found-in-page") {
      this.dispatchEvent(createAdapterEvent("found-in-page", {
        result: {
          requestId: this.findRequestId,
          activeMatchOrdinal: Number(detail.activeMatchOrdinal ?? 0),
          matches: Number(detail.matches ?? 0),
          finalUpdate: Boolean(detail.finalUpdate),
        },
      }));
      return;
    }
    if ([
      "did-start-loading",
      "did-stop-loading",
      "did-navigate",
      "did-navigate-in-page",
      "page-title-updated",
      "did-fail-load",
    ].includes(detail.type)) {
      this.dispatchEvent(createAdapterEvent(detail.type, detail));
    }
  };

  private async command(command: string, options: Record<string, unknown> = {}) {
    if (this.destroyed && command !== "close_tab") return undefined;
    const bounds = ["create", "select", "show", "open", "layout", "context_done"]
      .includes(command)
      ? this.getBounds()
      : undefined;
    return runNativeCommand({ command, tabId: this.tabId, ...bounds, ...options });
  }

  private dispatchFailure(error: unknown) {
    this.dispatchEvent(createAdapterEvent("did-fail-load", {
      errorCode: -1,
      errorDescription: error instanceof Error ? error.message : String(error),
      isMainFrame: true,
    }));
  }

  private finishNavigation(error?: Error) {
    const pending = this.pendingNavigation;
    if (!pending) return;
    this.pendingNavigation = null;
    globalThis.clearTimeout(pending.timeoutId);
    if (error) pending.reject(error);
    else pending.resolve();
  }

  async loadURL(url: string) {
    this.finishNavigation(new Error("页面导航已被新的地址替代"));
    this.state.url = url;
    this.state.loading = true;
    return new Promise<void>((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        this.finishNavigation(new Error("页面加载超时"));
      }, 30_000);
      this.pendingNavigation = { resolve, reject, timeoutId };
      void this.command("open", { url }).catch((error) => {
        this.finishNavigation(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  getURL() {
    return this.state.url;
  }

  getTitle() {
    return this.state.title;
  }

  canGoBack() {
    return this.state.canGoBack;
  }

  canGoForward() {
    return this.state.canGoForward;
  }

  goBack() {
    void this.command("back").catch((error) => this.dispatchFailure(error));
  }

  goForward() {
    void this.command("forward").catch((error) => this.dispatchFailure(error));
  }

  reload() {
    void this.command("reload").catch((error) => this.dispatchFailure(error));
  }

  stop() {
    void this.command("stop").catch((error) => this.dispatchFailure(error));
  }

  downloadURL(url: string) {
    void this.command("download", { url }).catch((error) => this.dispatchFailure(error));
  }

  getZoomFactor() {
    return this.state.zoomFactor;
  }

  setZoomFactor(factor: number) {
    this.state.zoomFactor = factor;
    void this.command("zoom", { factor }).catch((error) => this.dispatchFailure(error));
  }

  getWebContentsId() {
    return this.webContentsId;
  }

  findInPage(text: string, options: { forward?: boolean; findNext?: boolean } = {}) {
    this.findRequestId += 1;
    void this.command("find", { query: text, ...options })
      .catch((error) => this.dispatchFailure(error));
    return this.findRequestId;
  }

  stopFindInPage() {
    void this.command("stop_find").catch((error) => this.dispatchFailure(error));
  }

  async executeJavaScript<T = unknown>(code: string) {
    const result = await runNativeRequest({
      operation: "execute",
      tabId: this.tabId,
      script: code,
    }) as { value?: T };
    return result?.value as T;
  }

  sendInputEvent(event: Record<string, unknown>) {
    void this.command("input", event).catch((error) => this.dispatchFailure(error));
  }

  getBoundingClientRect() {
    return this.getClientRectValue();
  }

  select(show = true) {
    this.state.visible = show;
    return this.command("select", { show });
  }

  layout() {
    return this.command("layout");
  }

  contextDone() {
    return this.command("context_done");
  }

  request<T = unknown>(operation: string, options: Record<string, unknown> = {}) {
    return runNativeRequest({ operation, tabId: this.tabId, ...options }) as Promise<T>;
  }

  runCommand(command: string, options: Record<string, unknown> = {}) {
    return this.command(command, options);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.finishNavigation(new Error("浏览器标签页已关闭"));
    window.removeEventListener(ANDROID_BROWSER_EVENT_NAME, this.handleNativeEvent);
    void this.command("close_tab").catch(() => undefined);
  }
}
