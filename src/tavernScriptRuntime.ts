import type { TavernScript, TavernScriptButton } from "./tavernScriptUtils";

export type TavernRuntimeMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  variables?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

export type TavernRuntimeWorldBookEntry = {
  id: string;
  comment: string;
  content: string;
  enabled: boolean;
  keys?: string[];
};

export type TavernRuntimeWorldBook = {
  id: string;
  name: string;
  entries: TavernRuntimeWorldBookEntry[];
};

export type TavernRuntimeCharacter = {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  messageExample: string;
  avatarDataUrl: string;
  extensions: Record<string, unknown>;
  worldBook: TavernRuntimeWorldBook | null;
};

export type TavernRuntimeButton = TavernScriptButton & {
  scriptId: string;
  scriptName: string;
};

export type TavernRuntimeLog = {
  id: string;
  level: "log" | "info" | "warn" | "error";
  scriptId: string;
  scriptName: string;
  message: string;
  createdAt: string;
};

export type TavernRuntimeStatus = {
  state: "idle" | "loading" | "ready" | "error";
  message: string;
};

export type TavernScriptRuntimeAdapter = {
  getMessages(): TavernRuntimeMessage[];
  setMessages(messages: TavernRuntimeMessage[]): void;
  getChatVariables(): Record<string, unknown>;
  setChatVariables(variables: Record<string, unknown>): void;
  getCharacterVariables(): Record<string, unknown>;
  setCharacterVariables(variables: Record<string, unknown>): void;
  getGlobalVariables(): Record<string, unknown>;
  setGlobalVariables(variables: Record<string, unknown>): void;
  getScriptData(scriptId: string): Record<string, unknown>;
  setScriptData(scriptId: string, data: Record<string, unknown>): void;
  getCharacter(): TavernRuntimeCharacter | null;
  getWorldBooks(): TavernRuntimeWorldBook[];
  getUserName(): string;
  getChatId(): string;
  getModelId?(): string;
  onButtonsChange?(buttons: TavernRuntimeButton[]): void;
  onLog?(log: TavernRuntimeLog): void;
  onStatus?(status: TavernRuntimeStatus): void;
  onNotice?(
    level: "success" | "info" | "warning" | "error",
    message: string,
    title?: string,
  ): void;
};

type RuntimeWindow = Window &
  typeof globalThis &
  Record<string, unknown> & {
    $?: unknown;
    jQuery?: unknown;
    _?: unknown;
    Vue?: unknown;
    z?: unknown;
    YAML?: unknown;
  };

type VariableOption = {
  type?: string;
  message_id?: number | string;
};

const TAVERN_EVENTS = Object.freeze({
  CHAT_CHANGED: "chat_changed",
  CHAT_CREATED: "chat_created",
  CHAT_DELETED: "chat_deleted",
  MESSAGE_SENT: "message_sent",
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_DELETED: "message_deleted",
  MESSAGE_EDITED: "message_edited",
  MESSAGE_SWIPED: "message_swiped",
  CHARACTER_FIRST_MESSAGE_SELECTED: "character_first_message_selected",
  CHARACTER_MESSAGE_RENDERED: "character_message_rendered",
  USER_MESSAGE_RENDERED: "user_message_rendered",
  MESSAGE_RENDERED: "message_rendered",
  MESSAGE_UPDATED: "message_updated",
  MESSAGE_SENDING: "message_sending",
  MESSAGE_RECEIVING: "message_receiving",
  CHARACTER_SELECTED: "character_selected",
  CHARACTER_EDITED: "character_edited",
  CHARACTER_RENAMED: "character_renamed",
  CHARACTER_DELETED: "character_deleted",
  SETTINGS_UPDATED: "settings_updated",
  OAI_PRESET_CHANGED_AFTER: "oai_preset_changed_after",
  PRESET_RENAMED_BEFORE: "preset_renamed_before",
  GENERATION_STARTED: "generation_started",
  GENERATION_ENDED: "generation_ended",
  STREAM_TOKEN_RECEIVED: "stream_token_received",
  VARIABLE_CHANGED: "variable_changed",
  APP_READY: "app_ready",
});

const JQUERY_SOURCES = [
  "https://testingcf.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js",
  "https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js",
  "https://unpkg.com/jquery@3.7.1/dist/jquery.min.js",
];

const LODASH_SOURCES = [
  "https://testingcf.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js",
  "https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js",
  "https://unpkg.com/lodash@4.17.21/lodash.min.js",
];

const VUE_SOURCES = [
  "https://testingcf.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js",
  "https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js",
  "https://unpkg.com/vue@3.5.13/dist/vue.global.prod.js",
];

const ZOD_SOURCES = [
  "https://testingcf.jsdelivr.net/npm/zod@4.1.5/+esm",
  "https://cdn.jsdelivr.net/npm/zod@4.1.5/+esm",
];

const YAML_SOURCES = [
  "https://testingcf.jsdelivr.net/npm/yaml@2.8.1/+esm",
  "https://cdn.jsdelivr.net/npm/yaml@2.8.1/+esm",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall back to JSON for values crossing the iframe boundary.
    }
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

function formatLogArgument(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pathSegments(path: string) {
  return path
    .replace(/\[(?:"([^"]+)"|'([^']+)'|(\d+))\]/g, (_, double, single, index) =>
      `.${double ?? single ?? index}`,
    )
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getPath(root: unknown, path: string, fallback?: unknown) {
  let value = root;
  for (const segment of pathSegments(path)) {
    if (!isRecord(value) && !Array.isArray(value)) return fallback;
    value = (value as Record<string, unknown>)[segment];
  }
  return value === undefined ? fallback : value;
}

function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const segments = pathSegments(path);
  if (segments.length === 0) return root;
  let cursor: Record<string, unknown> = root;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }
    if (!isRecord(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  });
  return root;
}

function deletePath(root: Record<string, unknown>, path: string) {
  const segments = pathSegments(path);
  const last = segments.pop();
  if (!last) return false;
  let cursor: Record<string, unknown> = root;
  for (const segment of segments) {
    if (!isRecord(cursor[segment])) return false;
    cursor = cursor[segment] as Record<string, unknown>;
  }
  return delete cursor[last];
}

function normalizeMessageId(value: unknown, messages: TavernRuntimeMessage[]) {
  if (value === "latest" || value === -1 || value === "-1" || value == null) {
    return messages.length - 1;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return messages.length - 1;
  return parsed < 0 ? messages.length + parsed : parsed;
}

function isFrameworkScript(script: TavernScript) {
  return (
    /\bMVU\b/i.test(script.name) ||
    /MagVarUpdate|\bMvu\b|registerMvuSchema/i.test(script.content)
  );
}

export class TavernScriptRuntime {
  private readonly scripts: TavernScript[];
  private readonly adapter: TavernScriptRuntimeAdapter;
  private iframe: HTMLIFrameElement | null = null;
  private runtimeWindow: RuntimeWindow | null = null;
  private currentScriptId = "";
  private lastScriptId = "";
  private destroyed = false;
  private ready = false;
  private executedScriptIds = new Set<string>();
  private eventHandlers = new Map<string, Set<(...args: unknown[]) => unknown>>();
  private scriptButtons = new Map<string, TavernScriptButton[]>();

  constructor(scripts: TavernScript[], adapter: TavernScriptRuntimeAdapter) {
    this.scripts = scripts.map((script) => cloneValue(script));
    this.adapter = adapter;
    this.scripts.forEach((script) => {
      this.scriptButtons.set(script.id, cloneValue(script.buttons));
    });
  }

  isReady() {
    return this.ready && !this.destroyed;
  }

  async initialize() {
    if (this.destroyed) throw new Error("脚本运行时已销毁。");
    this.reportStatus("loading", "正在初始化酒馆脚本运行环境...");
    await this.createIframe();
    this.installCompatibilityApi();
    await this.loadDependencies();
    this.publishButtons();

    const startupScripts = this.scripts
      .filter(
        (script) =>
          script.enabled && script.autoRun && script.runOn === "startup" && script.content.trim(),
      )
      .sort((left, right) => Number(isFrameworkScript(right)) - Number(isFrameworkScript(left)));
    for (const script of startupScripts) {
      await this.executeScript(script.id);
      if (isFrameworkScript(script)) {
        await this.waitForGlobal("Mvu", 15000);
      }
    }
    if (this.destroyed) return;
    this.ready = true;
    await this.emit(TAVERN_EVENTS.APP_READY);
    await this.emit(TAVERN_EVENTS.CHAT_CHANGED, this.adapter.getChatId());
    const character = this.adapter.getCharacter();
    if (character) {
      await this.emit(TAVERN_EVENTS.CHARACTER_SELECTED, {
        characterId: character.id,
        character,
      });
    }
    this.reportStatus(
      "ready",
      startupScripts.length > 0
        ? `${startupScripts.length} 个酒馆脚本已运行。`
        : "酒馆脚本运行环境已就绪。",
    );
  }

  async executeScript(scriptId: string) {
    const script = this.scripts.find((candidate) => candidate.id === scriptId);
    if (!script) throw new Error("没有找到要运行的脚本。");
    if (!script.enabled) throw new Error(`脚本「${script.name}」未启用。`);
    if (!script.content.trim()) throw new Error(`脚本「${script.name}」没有可执行内容。`);
    if (!this.runtimeWindow || !this.iframe) throw new Error("酒馆脚本运行环境尚未初始化。");
    if (this.executedScriptIds.has(script.id) && isFrameworkScript(script)) {
      this.writeLog("info", script, "脚本已经在当前会话中运行，无需重复加载。");
      return;
    }

    this.currentScriptId = script.id;
    this.lastScriptId = script.id;
    this.ensureScriptMarker(script.id);
    this.writeLog("info", script, "开始运行脚本。");
    try {
      await this.appendExecutableScript(script);
      this.executedScriptIds.add(script.id);
      this.writeLog("info", script, "脚本运行完成。");
    } catch (error) {
      const message = toErrorMessage(error);
      this.writeLog("error", script, message);
      this.reportStatus("error", `脚本「${script.name}」运行失败：${message}`);
      throw error;
    } finally {
      if (this.currentScriptId === script.id) this.currentScriptId = "";
    }
  }

  async emit(eventName: string, ...args: unknown[]) {
    if (this.destroyed) return [];
    if (
      eventName === TAVERN_EVENTS.MESSAGE_SENT ||
      eventName === TAVERN_EVENTS.MESSAGE_RECEIVED
    ) {
      for (const script of this.scripts.filter(
        (candidate) =>
          candidate.enabled &&
          candidate.autoRun &&
          candidate.runOn === "message" &&
          !this.executedScriptIds.has(candidate.id),
      )) {
        await this.executeScript(script.id);
      }
    }
    const handlers = Array.from(this.eventHandlers.get(eventName) ?? []);
    const results: unknown[] = [];
    for (const handler of handlers) {
      try {
        results.push(await handler(...args));
      } catch (error) {
        this.writeRuntimeLog("error", `事件 ${eventName} 处理失败：${toErrorMessage(error)}`);
      }
    }
    return results;
  }

  async triggerButton(button: TavernRuntimeButton) {
    const eventName = this.getButtonEventName(button.scriptId, button.name);
    const results = await this.emit(eventName, {
      name: button.name,
      scriptId: button.scriptId,
      messageId: this.adapter.getMessages().length - 1,
    });
    if (results.length === 0) {
      throw new Error(`按钮「${button.name}」尚未注册可执行事件。`);
    }
    return results;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ready = false;
    this.eventHandlers.clear();
    this.scriptButtons.clear();
    this.adapter.onButtonsChange?.([]);
    const parentWindow = window as Window & { Mvu?: unknown };
    if (parentWindow.Mvu) delete parentWindow.Mvu;
    this.iframe?.remove();
    this.iframe = null;
    this.runtimeWindow = null;
    this.reportStatus("idle", "");
  }

  private async createIframe() {
    const iframe = document.createElement("iframe");
    iframe.title = "酒馆脚本运行环境";
    iframe.style.display = "none";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-modals allow-downloads");
    iframe.srcdoc = [
      "<!doctype html>",
      '<html lang="zh-CN"><head><meta charset="utf-8"><title>Renge Tavern Script Runtime</title></head>',
      '<body><div id="chat"></div><div id="extensions_settings2"></div>',
      '<div id="tavern_helper"></div></body></html>',
    ].join("");
    document.body.appendChild(iframe);
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("酒馆脚本 iframe 初始化超时。")),
        10000,
      );
      iframe.addEventListener(
        "load",
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      iframe.addEventListener(
        "error",
        () => {
          window.clearTimeout(timeout);
          reject(new Error("酒馆脚本 iframe 无法加载。"));
        },
        { once: true },
      );
    });
    if (this.destroyed) return;
    this.iframe = iframe;
    this.runtimeWindow = iframe.contentWindow as RuntimeWindow | null;
    if (!this.runtimeWindow) throw new Error("无法访问酒馆脚本 iframe。 ");
    this.runtimeWindow.addEventListener("error", (event: ErrorEvent) => {
      this.writeRuntimeLog("error", event.message || "脚本运行时发生错误。");
    });
    this.runtimeWindow.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
      this.writeRuntimeLog("error", `未处理的 Promise：${toErrorMessage(event.reason)}`);
    });
    this.wrapConsole();
  }

  private wrapConsole() {
    const win = this.runtimeWindow;
    if (!win) return;
    (["log", "info", "warn", "error"] as const).forEach((level) => {
      const original = win.console[level].bind(win.console);
      win.console[level] = (...args: unknown[]) => {
        original(...args);
        const message = args.map(formatLogArgument).join(" ");
        if (
          message.includes("function tools are not supported") ||
          message.includes("MVU: function tools")
        ) {
          return;
        }
        this.writeRuntimeLog(level, message);
      };
    });
  }

  private async loadDependencies() {
    const win = this.runtimeWindow;
    if (!win) throw new Error("酒馆脚本运行环境不存在。");
    await this.loadClassicDependency(JQUERY_SOURCES, "jQuery", "jQuery");
    win.$ = win.jQuery;
    await this.loadClassicDependency(LODASH_SOURCES, "_", "Lodash");
    await this.loadClassicDependency(VUE_SOURCES, "Vue", "Vue");
    let zodModule: Record<string, unknown> | null = null;
    let lastError: unknown = null;
    const importer = win.Function("url", "return import(url)") as (
      url: string,
    ) => Promise<Record<string, unknown>>;
    for (const source of ZOD_SOURCES) {
      try {
        zodModule = await importer(source);
        if (zodModule) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!zodModule) {
      throw new Error(`Zod 4 加载失败：${toErrorMessage(lastError)}`);
    }
    win.z = isRecord(zodModule.default) ? zodModule.default : zodModule;
    let yamlModule: Record<string, unknown> | null = null;
    lastError = null;
    for (const source of YAML_SOURCES) {
      try {
        yamlModule = await importer(source);
        if (yamlModule) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!yamlModule) {
      throw new Error(`YAML 加载失败：${toErrorMessage(lastError)}`);
    }
    win.YAML = yamlModule;
  }

  private async loadClassicDependency(
    sources: string[],
    globalName: string,
    displayName: string,
  ) {
    const win = this.runtimeWindow;
    const document = win?.document;
    if (!win || !document) throw new Error("酒馆脚本运行环境不存在。");
    if (win[globalName] != null) return;
    let lastError: unknown = null;
    for (const source of sources) {
      try {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = source;
          script.crossOrigin = "anonymous";
          script.addEventListener("load", () => resolve(), { once: true });
          script.addEventListener(
            "error",
            () => reject(new Error(`${displayName} 资源加载失败：${source}`)),
            { once: true },
          );
          document.head.appendChild(script);
        });
        if (win[globalName] != null) return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`${displayName} 加载失败：${toErrorMessage(lastError)}`);
  }

  private installCompatibilityApi() {
    const win = this.runtimeWindow;
    if (!win) throw new Error("酒馆脚本运行环境不存在。");
    const nativeFetch = win.fetch.bind(win);
    win.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (/^\/?version(?:\?|$)/.test(url)) {
        return Promise.resolve(
          new Response(JSON.stringify({ pkgVersion: "3.5.0", agent: "Renge" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    const eventOn = (eventName: unknown, callback: unknown) => {
      if (typeof callback !== "function") return callback;
      const key = String(eventName);
      const callbacks = this.eventHandlers.get(key) ?? new Set();
      callbacks.add(callback as (...args: unknown[]) => unknown);
      this.eventHandlers.set(key, callbacks);
      return callback;
    };
    const eventRemoveListener = (eventName: unknown, callback: unknown) => {
      const callbacks = this.eventHandlers.get(String(eventName));
      if (!callbacks) return false;
      if (typeof callback === "function") callbacks.delete(callback as (...args: unknown[]) => unknown);
      if (callbacks.size === 0) this.eventHandlers.delete(String(eventName));
      return true;
    };
    const eventOnce = (eventName: unknown, callback: unknown) => {
      if (typeof callback !== "function") return callback;
      const once = async (...args: unknown[]) => {
        eventRemoveListener(eventName, once);
        return await (callback as (...callbackArgs: unknown[]) => unknown)(...args);
      };
      eventOn(eventName, once);
      return once;
    };
    const eventSource = {
      on: eventOn,
      once: eventOnce,
      emit: (eventName: string, ...args: unknown[]) => this.emit(eventName, ...args),
      removeListener: eventRemoveListener,
      makeFirst: (eventName: string, callback: (...args: unknown[]) => unknown) => {
        eventOn(eventName, callback);
        return { stop: () => eventRemoveListener(eventName, callback) };
      },
      makeLast: (eventName: string, callback: (...args: unknown[]) => unknown) => {
        eventOn(eventName, callback);
        return { stop: () => eventRemoveListener(eventName, callback) };
      },
    };

    const getScriptId = () =>
      this.currentScriptId || this.lastScriptId || this.scripts[0]?.id || "renge-script";
    const getScript = () =>
      this.scripts.find((script) => script.id === getScriptId()) ?? this.scripts[0];
    const getScriptButtons = () => cloneValue(this.scriptButtons.get(getScriptId()) ?? []);
    const replaceScriptButtons = (buttons: unknown) => {
      if (!Array.isArray(buttons)) return;
      const script = getScript();
      if (!script) return;
      const normalized = this.normalizeRuntimeButtons(buttons, script.id);
      this.scriptButtons.set(script.id, normalized);
      this.publishButtons();
    };
    const appendInexistentScriptButtons = (buttons: unknown) => {
      if (!Array.isArray(buttons)) return;
      const script = getScript();
      if (!script) return;
      const existing = this.scriptButtons.get(script.id) ?? [];
      const names = new Set(existing.map((button) => button.name));
      const additions = this.normalizeRuntimeButtons(buttons, script.id).filter(
        (button) => !names.has(button.name),
      );
      if (additions.length > 0) {
        this.scriptButtons.set(script.id, [...existing, ...additions]);
        this.publishButtons();
      }
    };

    const getChatMessages = (range: unknown = null, options: unknown = {}) => {
      const messages = this.adapter.getMessages();
      const formatted = messages.map((message, index) => this.formatHelperMessage(message, index));
      const filter = (items: ReturnType<typeof this.formatHelperMessage>[]) => {
        if (!isRecord(options) || options.role == null || options.role === "all") return items;
        return items.filter((item) => item.role === options.role);
      };
      if (range == null || range === "") return filter(formatted);
      if (typeof range === "number") {
        const index = normalizeMessageId(range, messages);
        return filter(formatted[index] ? [formatted[index]] : []);
      }
      const value = String(range).trim();
      if (/^-?\d+$/.test(value)) {
        const index = normalizeMessageId(value, messages);
        return filter(formatted[index] ? [formatted[index]] : []);
      }
      const match = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(value);
      if (match) {
        const start = normalizeMessageId(match[1], messages);
        const end = normalizeMessageId(match[2], messages);
        return filter(formatted.slice(Math.max(0, start), Math.max(0, end) + 1));
      }
      return [];
    };

    const setChatMessages = async (updates: unknown) => {
      if (!Array.isArray(updates)) return false;
      const messages = this.adapter.getMessages().map((message) => cloneValue(message));
      updates.forEach((update) => {
        if (!isRecord(update)) return;
        const index = normalizeMessageId(update.message_id, messages);
        const message = messages[index];
        if (!message) return;
        if (typeof update.message === "string") message.content = update.message;
        else if (typeof update.content === "string") message.content = update.content;
        const swipeIndex = Number.isInteger(Number(update.swipe_id))
          ? Math.max(0, Number(update.swipe_id))
          : 0;
        if (Array.isArray(update.swipes) && typeof update.swipes[swipeIndex] === "string") {
          message.content = update.swipes[swipeIndex];
        }
        if (update.role === "user" || update.role === "assistant") message.role = update.role;
        if (isRecord(update.data)) message.variables = cloneValue(update.data);
        else if (
          Array.isArray(update.swipes_data) &&
          isRecord(update.swipes_data[swipeIndex])
        ) {
          message.variables = cloneValue(update.swipes_data[swipeIndex]);
        } else if (Array.isArray(update.variables) && isRecord(update.variables[swipeIndex])) {
          message.variables = cloneValue(update.variables[swipeIndex]);
        } else if (isRecord(update.variables)) {
          message.variables = cloneValue(update.variables);
        }
        if (isRecord(update.extra)) message.extra = cloneValue(update.extra);
        else if (
          Array.isArray(update.swipes_info) &&
          isRecord(update.swipes_info[swipeIndex])
        ) {
          message.extra = cloneValue(update.swipes_info[swipeIndex]);
        }
      });
      this.adapter.setMessages(messages);
      return true;
    };

    const createChatMessages = async (values: unknown, position = -1) => {
      if (!Array.isArray(values)) return false;
      const messages = this.adapter.getMessages().map((message) => cloneValue(message));
      const created = values
        .filter(isRecord)
        .map((value): TavernRuntimeMessage => ({
          id: crypto.randomUUID(),
          role: value.role === "assistant" ? "assistant" : "user",
          content: String(value.message ?? value.content ?? ""),
          createdAt: new Date().toISOString(),
          ...(isRecord(value.data) ? { variables: cloneValue(value.data) } : {}),
        }));
      if (position < 0 || position >= messages.length) messages.push(...created);
      else messages.splice(position, 0, ...created);
      this.adapter.setMessages(messages);
      return true;
    };

    const deleteChatMessages = async (ids: unknown) => {
      const values = Array.isArray(ids) ? ids : [ids];
      const indexes = new Set(values.map((id) => Number(id)).filter(Number.isInteger));
      this.adapter.setMessages(
        this.adapter.getMessages().filter((_, index) => !indexes.has(index)),
      );
      return true;
    };

    const getVariables = (option?: unknown) => {
      const resolved = this.resolveVariables(option, getScriptId());
      return cloneValue(resolved);
    };
    const replaceVariables = async (variables: unknown, option?: unknown) => {
      const next = isRecord(variables) ? cloneValue(variables) : {};
      this.saveVariables(option, getScriptId(), next);
      return next;
    };
    const updateVariablesWith = async (updater: unknown, option?: unknown) => {
      const current = getVariables(option);
      let next = current;
      if (typeof updater === "function") {
        const result = await (updater as (value: Record<string, unknown>) => unknown)(current);
        if (isRecord(result)) next = result;
      } else if (isRecord(updater)) {
        next = { ...current, ...cloneValue(updater) };
      }
      this.saveVariables(option, getScriptId(), next);
      await this.emit("variables_updated", next, option);
      return next;
    };
    const insertOrAssignVariables = async (variables: unknown, option?: unknown) => {
      const current = getVariables(option);
      const next = isRecord(variables) ? { ...current, ...cloneValue(variables) } : current;
      this.saveVariables(option, getScriptId(), next);
      return next;
    };
    const deleteVariable = async (path: unknown, option?: unknown) => {
      const current = getVariables(option);
      const deleted = deletePath(current, String(path));
      this.saveVariables(option, getScriptId(), current);
      return deleted;
    };

    const getCharacter = () => this.adapter.getCharacter();
    const getWorldBooks = () => {
      const books = this.adapter.getWorldBooks();
      const characterBook = getCharacter()?.worldBook;
      return characterBook ? [...books, characterBook] : books;
    };
    const getLorebookEntries = async (name: unknown) =>
      cloneValue(
        getWorldBooks().find((book) => book.name === String(name))?.entries ?? [],
      );
    const getCharWorldbookNames = () => ({
      primary: getCharacter()?.worldBook?.name ?? null,
      additional: [] as string[],
    });
    const getCharLorebooks = async () => getCharWorldbookNames();
    const getLorebookSettings = async () => ({
      selected_global_lorebooks: this.adapter.getWorldBooks().map((book) => book.name),
      selected_world_info: this.adapter.getWorldBooks().map((book) => book.name),
      scan_depth: 10,
      context_percentage: 50,
      budget_cap: 0,
      min_activations: 1,
      max_depth: 0,
      max_recursion_steps: 5,
      insertion_strategy: "evenly",
      include_names: true,
      recursive: true,
      case_sensitive: false,
      match_whole_words: false,
      use_group_scoring: false,
      overflow_alert: true,
    });

    const substitudeMacros = (value: unknown) =>
      String(value ?? "")
        .replace(/{{\s*user\s*}}/gi, this.adapter.getUserName() || "用户")
        .replace(/{{\s*char\s*}}/gi, getCharacter()?.name || "角色")
        .replace(/<USER>/gi, this.adapter.getUserName() || "用户")
        .replace(/<BOT>/gi, getCharacter()?.name || "角色");
    const getContext = () => ({
      chat: this.getSillyTavernChat(),
      characters: this.getSillyTavernCharacters(),
      characterId: getCharacter() ? "0" : undefined,
      name1: this.adapter.getUserName() || "User",
      name2: getCharacter()?.name || "Assistant",
      chatId: this.adapter.getChatId(),
      eventSource,
      saveChat: async () => true,
      getRequestHeaders: () => ({ "Content-Type": "application/json" }),
    });

    const toastr = {
      success: (message: unknown, title?: unknown) =>
        this.adapter.onNotice?.("success", String(message), String(title ?? "")),
      info: (message: unknown, title?: unknown) =>
        this.adapter.onNotice?.("info", String(message), String(title ?? "")),
      warning: (message: unknown, title?: unknown) =>
        this.adapter.onNotice?.("warning", String(message), String(title ?? "")),
      error: (message: unknown, title?: unknown) =>
        this.adapter.onNotice?.("error", String(message), String(title ?? "")),
      clear: () => undefined,
    };

    const extensionSettingsVariableKey = "__sillytavern_extension_settings__";
    const storedExtensionSettings = getPath(
      this.adapter.getGlobalVariables(),
      extensionSettingsVariableKey,
      {},
    );
    const extensionSettings = isRecord(storedExtensionSettings)
      ? cloneValue(storedExtensionSettings)
      : {};
    const saveSettingsDebounced = () => {
      const variables = cloneValue(this.adapter.getGlobalVariables());
      variables[extensionSettingsVariableKey] = cloneValue(extensionSettings);
      this.adapter.setGlobalVariables(variables);
    };

    const sillyTavern: Record<string, unknown> = {
      version: "3.5.0",
      versionInfo: {
        agent: "Renge",
        pkgVersion: "3.5.0",
        gitRevision: "renge-compat",
        gitBranch: "main",
      },
      getContext,
      eventSource,
      saveChat: async () => true,
      getCurrentChatId: () => this.adapter.getChatId(),
      getRequestHeaders: () => ({ "Content-Type": "application/json" }),
      getChatCompletionModel: () => this.adapter.getModelId?.() ?? "",
      registerMacro: () => true,
      unregisterMacro: () => true,
      unregisterFunctionTool: () => true,
      extensionSettings,
      saveSettingsDebounced,
      callGenericPopup: async (
        _content: unknown,
        popupType: unknown,
        defaultValue: unknown,
      ) => (popupType === 1 || popupType === "input" ? String(defaultValue ?? "") : true),
      POPUP_TYPE: { TEXT: 0, INPUT: 1, CONFIRM: 2 },
      POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0, CUSTOM1: 2 },
      ToolManager: {
        isToolCallingSupported: () => true,
        getTools: () => [],
      },
      chatCompletionSettings: {
        function_calling: true,
        tool_calling: true,
        temperature: 1,
        max_tokens: 4096,
      },
    };
    Object.defineProperties(sillyTavern, {
      chat: { get: () => this.getSillyTavernChat(), configurable: true },
      characters: { get: () => this.getSillyTavernCharacters(), configurable: true },
      characterId: { get: () => (getCharacter() ? "0" : undefined), configurable: true },
      name1: { get: () => this.adapter.getUserName() || "User", configurable: true },
      name2: { get: () => getCharacter()?.name || "Assistant", configurable: true },
    });

    const waitGlobalInitialized = async (name = "Mvu", timeout = 30000) =>
      await this.waitForGlobal(String(name), Number(timeout) || 30000);
    const unsupportedGenerate = async () => {
      throw new Error("当前酒馆脚本运行环境尚未启用脚本内独立模型请求。");
    };
    const api = {
      getChatMessages,
      setChatMessages,
      createChatMessages,
      deleteChatMessages,
      getLastMessageId: () => this.adapter.getMessages().length - 1,
      getCurrentMessageId: () => this.adapter.getMessages().length - 1,
      getVariables,
      setVariables: replaceVariables,
      replaceVariables,
      updateVariablesWith,
      insertOrAssignVariables,
      deleteVariable,
      eventOn,
      eventOnce,
      eventEmit: (eventName: string, ...args: unknown[]) => this.emit(eventName, ...args),
      eventRemoveListener,
      getCharData: () => this.getSillyTavernCharacters()[0]?.data ?? null,
      getCharLorebooks,
      getCharWorldbookNames,
      getCurrentCharPrimaryLorebook: () => getCharacter()?.worldBook?.name ?? null,
      getLorebookEntries,
      getLorebookSettings,
      setLorebookSettings: async () => true,
      substitudeMacros,
      getScriptId,
      getScriptButtons,
      replaceScriptButtons,
      appendInexistentScriptButtons,
      getButtonEvent: (name: unknown) => this.getButtonEventName(getScriptId(), String(name)),
      waitGlobalInitialized,
      getTavernHelperVersion: async () => "3.5.0",
      getVersion: () => sillyTavern.versionInfo,
      getContext,
      generate: unsupportedGenerate,
      generateRaw: unsupportedGenerate,
      toastr,
      tavern_events: TAVERN_EVENTS,
      eventSource,
      SillyTavern: sillyTavern,
    };
    Object.assign(win, api);
    win.TavernHelper = api;
    win.tavernHelper = api;
    win.tavernHelperAPI = api;
    win.th = api;
    win.setChatMessage = async (messageOrId: unknown, idOrContent: unknown) => {
      if (isRecord(messageOrId)) {
        return await setChatMessages([
          {
            ...cloneValue(messageOrId),
            message_id: idOrContent,
          },
        ]);
      }
      return await setChatMessages([
        { message_id: messageOrId, message: String(idOrContent ?? "") },
      ]);
    };
    win.getvar = (path: unknown, fallback?: unknown) =>
      getPath(getVariables(), String(path), fallback);
    win.setvar = async (path: unknown, value: unknown) => {
      const variables = getVariables();
      setPath(variables, String(path), value);
      return await replaceVariables(variables);
    };
    win.getPresetNames = () => [];
    win.getPreset = () => null;
    win.formatAsDisplayedMessage = (message: unknown) =>
      isRecord(message) ? String(message.message ?? message.content ?? "") : String(message ?? "");
    win.retrieveDisplayedMessage = (messageId: unknown) =>
      getChatMessages(messageId)[0] ?? null;
  }

  private resolveVariables(option: unknown, scriptId: string) {
    const messages = this.adapter.getMessages();
    const normalized: VariableOption = isRecord(option)
      ? option
      : typeof option === "number" || typeof option === "string"
        ? { type: "message", message_id: option }
        : { type: "message", message_id: "latest" };
    const type = String(normalized.type ?? "message").toLowerCase();
    if (type === "global") return this.adapter.getGlobalVariables();
    if (type === "chat") return this.adapter.getChatVariables();
    if (type === "character" || type === "char") {
      return this.adapter.getCharacterVariables();
    }
    if (type === "script" || type === "local") return this.adapter.getScriptData(scriptId);
    const index = normalizeMessageId(normalized.message_id, messages);
    return messages[index]?.variables ?? {};
  }

  private saveVariables(
    option: unknown,
    scriptId: string,
    variables: Record<string, unknown>,
  ) {
    const next = cloneValue(variables);
    const messages = this.adapter.getMessages();
    const normalized: VariableOption = isRecord(option)
      ? option
      : typeof option === "number" || typeof option === "string"
        ? { type: "message", message_id: option }
        : { type: "message", message_id: "latest" };
    const type = String(normalized.type ?? "message").toLowerCase();
    if (type === "global") {
      this.adapter.setGlobalVariables(next);
      return;
    }
    if (type === "chat") {
      this.adapter.setChatVariables(next);
      return;
    }
    if (type === "character" || type === "char") {
      this.adapter.setCharacterVariables(next);
      return;
    }
    if (type === "script" || type === "local") {
      this.adapter.setScriptData(scriptId, next);
      return;
    }
    const index = normalizeMessageId(normalized.message_id, messages);
    if (!messages[index]) return;
    const updated = messages.map((message, messageIndex) =>
      messageIndex === index ? { ...message, variables: next } : message,
    );
    this.adapter.setMessages(updated);
  }

  private formatHelperMessage(message: TavernRuntimeMessage, index: number) {
    const character = this.adapter.getCharacter();
    return {
      message_id: index,
      mesid: index,
      id: index,
      name:
        message.role === "user"
          ? this.adapter.getUserName() || "User"
          : character?.name || "Assistant",
      role: message.role,
      is_user: message.role === "user",
      is_system: false,
      is_hidden: false,
      message: message.content,
      mes: message.content,
      data: cloneValue(message.variables ?? {}),
      variables: cloneValue(message.variables ?? {}),
      extra: cloneValue(message.extra ?? {}),
      swipe_id: 0,
      swipes: [message.content],
      swipes_data: [cloneValue(message.variables ?? {})],
      swipes_info: [cloneValue(message.extra ?? {})],
    };
  }

  private getSillyTavernChat() {
    return this.adapter.getMessages().map((message, index) => {
      const formatted = this.formatHelperMessage(message, index);
      return {
        ...formatted,
        variables: [cloneValue(message.variables ?? {})],
      };
    });
  }

  private getSillyTavernCharacters() {
    const character = this.adapter.getCharacter();
    if (!character) return [];
    return [
      {
        name: character.name,
        avatar: character.avatarDataUrl,
        data: {
          name: character.name,
          description: character.description,
          personality: character.personality,
          scenario: character.scenario,
          first_mes: character.firstMessage,
          mes_example: character.messageExample,
          extensions: {
            ...cloneValue(character.extensions),
            ...(character.worldBook ? { world: character.worldBook.name } : {}),
          },
          character_book: character.worldBook,
        },
      },
    ];
  }

  private normalizeRuntimeButtons(values: unknown[], scriptId: string) {
    return values
      .map((value, index): TavernScriptButton | null => {
        if (!isRecord(value)) return null;
        const name = String(value.name ?? value.label ?? "").trim();
        if (!name) return null;
        return {
          id: String(value.id ?? `${scriptId}-runtime-button-${index + 1}`),
          name,
          visible: typeof value.visible === "boolean" ? value.visible : true,
        };
      })
      .filter((button): button is TavernScriptButton => Boolean(button));
  }

  private publishButtons() {
    const buttons = this.scripts.flatMap((script) =>
      script.enabled && script.buttonEnabled
        ? (this.scriptButtons.get(script.id) ?? [])
            .filter((button) => button.visible)
            .map((button) => ({
              ...cloneValue(button),
              scriptId: script.id,
              scriptName: script.name,
            }))
        : [],
    );
    this.adapter.onButtonsChange?.(buttons);
  }

  private getButtonEventName(scriptId: string, buttonName: string) {
    return `tavern_script_button:${scriptId}:${buttonName}`;
  }

  private ensureScriptMarker(scriptId: string) {
    const document = this.runtimeWindow?.document;
    if (!document) return;
    const container = document.querySelector("#tavern_helper");
    if (!container || container.querySelector(`[data-script-id="${CSS.escape(scriptId)}"]`)) return;
    const marker = document.createElement("div");
    marker.dataset.scriptId = scriptId;
    container.appendChild(marker);
  }

  private appendExecutableScript(script: TavernScript) {
    const document = this.runtimeWindow?.document;
    if (!document) return Promise.reject(new Error("酒馆脚本文档不存在。"));
    const usesModuleSyntax =
      /(^|\n)\s*(?:import\s+(?:[\s\S]*?\s+from\s+)?["']|export\s+)/m.test(script.content);
    return new Promise<void>((resolve, reject) => {
      const element = document.createElement("script");
      if (usesModuleSyntax) element.type = "module";
      element.dataset.rengeTavernScriptId = script.id;
      const completionEventName = `renge-tavern-script-loaded:${script.id}:${crypto.randomUUID()}`;
      element.textContent = usesModuleSyntax
        ? `${script.content}\n;window.dispatchEvent(new Event(${JSON.stringify(completionEventName)}));\n//# sourceURL=renge-tavern-script-${encodeURIComponent(script.name)}.js`
        : `${script.content}\n//# sourceURL=renge-tavern-script-${encodeURIComponent(script.name)}.js`;
      let settled = false;
      const timeoutId = usesModuleSyntax
        ? window.setTimeout(
            () => finish(new Error(`脚本「${script.name}」的模块加载超时。`)),
            30000,
          )
        : undefined;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        this.runtimeWindow?.removeEventListener("error", handleError);
        this.runtimeWindow?.removeEventListener(completionEventName, handleComplete);
        if (error) reject(error);
        else resolve();
      };
      const handleComplete = () => finish();
      const handleError = (event: ErrorEvent) => {
        event.preventDefault();
        finish(new Error(event.message || `脚本「${script.name}」执行失败。`));
      };
      this.runtimeWindow?.addEventListener("error", handleError);
      if (usesModuleSyntax) {
        this.runtimeWindow?.addEventListener(completionEventName, handleComplete, { once: true });
        element.addEventListener(
          "error",
          () => finish(new Error(`脚本「${script.name}」的模块或依赖加载失败。`)),
          { once: true },
        );
      }
      document.body.appendChild(element);
      if (!usesModuleSyntax) window.setTimeout(() => finish(), 0);
    });
  }

  private waitForGlobal(name: string, timeout: number) {
    const startedAt = Date.now();
    return new Promise<unknown>((resolve, reject) => {
      const check = () => {
        if (this.destroyed) {
          reject(new Error("脚本运行时已销毁。"));
          return;
        }
        const runtimeValue = this.runtimeWindow?.[name];
        const parentValue = (window as unknown as Window & Record<string, unknown>)[name];
        if (runtimeValue != null || parentValue != null) {
          resolve(runtimeValue ?? parentValue);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          reject(new Error(`等待 ${name} 初始化超时。`));
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  private writeLog(
    level: TavernRuntimeLog["level"],
    script: TavernScript,
    message: string,
  ) {
    this.adapter.onLog?.({
      id: crypto.randomUUID(),
      level,
      scriptId: script.id,
      scriptName: script.name,
      message,
      createdAt: new Date().toISOString(),
    });
  }

  private writeRuntimeLog(level: TavernRuntimeLog["level"], message: string) {
    const script =
      this.scripts.find(
        (candidate) => candidate.id === (this.currentScriptId || this.lastScriptId),
      ) ?? this.scripts[0];
    if (script) this.writeLog(level, script, message);
  }

  private reportStatus(state: TavernRuntimeStatus["state"], message: string) {
    this.adapter.onStatus?.({ state, message });
  }
}

export { TAVERN_EVENTS };
