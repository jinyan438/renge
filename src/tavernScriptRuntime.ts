import type { TavernScript, TavernScriptButton } from "./tavernScriptUtils";
import fontAwesomeCss from "@fortawesome/fontawesome-free/css/all.min.css?raw";
import fontAwesomeBrandsUrl from "@fortawesome/fontawesome-free/webfonts/fa-brands-400.woff2?url";
import fontAwesomeRegularUrl from "@fortawesome/fontawesome-free/webfonts/fa-regular-400.woff2?url";
import fontAwesomeSolidUrl from "@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2?url";
import fontAwesomeV4CompatibilityUrl from "@fortawesome/fontawesome-free/webfonts/fa-v4compatibility.woff2?url";

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
  uid: string;
  comment: string;
  content: string;
  enabled: boolean;
  keys: string[];
  secondaryKeys: string[];
  constant: boolean;
  selective: boolean;
  selectiveLogic: number;
  position: "before_char" | "after_char" | "before_an" | "after_an" | "at_depth";
  depth: number;
  scanDepth: number | null;
  order: number;
  probability: number;
  useProbability: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useRegex: boolean;
};

export type TavernRuntimeWorldBook = {
  id: string;
  name: string;
  description: string;
  entries: TavernRuntimeWorldBookEntry[];
  scope: "global" | "character";
  active: boolean;
  sourceFormat?: "renge" | "sillytavern";
  sourceFileName?: string;
  createdAt?: string;
  updatedAt?: string;
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
  getPresetVariables?(): Record<string, unknown>;
  setPresetVariables?(variables: Record<string, unknown>): void;
  getExtensionSettings?(): Record<string, unknown>;
  setExtensionSettings?(settings: Record<string, unknown>): void;
  getChatMetadata?(): Record<string, unknown>;
  setChatMetadata?(metadata: Record<string, unknown>): void;
  getScriptData(scriptId: string): Record<string, unknown>;
  setScriptData(scriptId: string, data: Record<string, unknown>): void;
  getCharacter(): TavernRuntimeCharacter | null;
  getWorldBooks(): TavernRuntimeWorldBook[];
  setWorldBook(worldBook: TavernRuntimeWorldBook): void;
  getRegexes(): Array<Record<string, unknown>>;
  setRegexes(regexes: Array<Record<string, unknown>>): void;
  getUserName(): string;
  getChatId(): string;
  getModelId?(): string;
  getInput?(): string;
  setInput?(value: string): unknown;
  appendInput?(value: string): unknown;
  sendMessage?(value?: string): Promise<unknown> | unknown;
  triggerSlash?(command: string): Promise<unknown> | unknown;
  generate?(config?: unknown): Promise<string>;
  stopGeneration?(): Promise<unknown> | unknown;
  isGenerating?(): boolean;
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
  script_id?: string;
  extension_id?: string;
};

type RuntimeEventHandler = {
  callback: (...args: unknown[]) => unknown;
  scriptId: string;
  priority: -1 | 0 | 1;
  sequence: number;
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
  GENERATION_AFTER_COMMANDS: "generation_after_commands",
  GENERATION_ENDED: "generation_ended",
  CHAT_COMPLETION_SETTINGS_READY: "chat_completion_settings_ready",
  CHAT_COMPLETION_PROMPT_READY: "chat_completion_prompt_ready",
  STREAM_TOKEN_RECEIVED: "stream_token_received",
  VARIABLE_CHANGED: "variable_changed",
  APP_READY: "app_ready",
});

const TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY = "__sillytavern_extension_settings__";

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

function buildZodGlobal(zodModule: Record<string, unknown>) {
  const zodApi = isRecord(zodModule.z)
    ? zodModule.z
    : isRecord(zodModule.default)
      ? zodModule.default
      : zodModule;

  // Tavern scripts use both the normal `z.object()` API and the Zod 4
  // module namespace shape (`z.z.ZodObject`). Keep both views available.
  return {
    ...zodModule,
    ...zodApi,
    default: zodApi,
    z: zodApi,
  };
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

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        valuesEqual(left[key], right[key]),
    )
  );
}

function mergeVariableRecords(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
) {
  const result = cloneValue(base);
  Object.entries(overlay).forEach(([key, value]) => {
    const current = result[key];
    result[key] =
      isRecord(current) && isRecord(value)
        ? mergeVariableRecords(current, value)
        : cloneValue(value);
  });
  return result;
}

function buildLocalTavernPlaceholderImage(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    url.hostname.toLowerCase() !== "via.placeholder.com"
  ) {
    return value;
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  const sizeMatch = /^(\d{1,4})(?:x(\d{1,4}))?$/i.exec(pathSegments[0] ?? "");
  if (!sizeMatch) return value;
  const width = Math.min(4096, Math.max(1, Number(sizeMatch[1])));
  const height = Math.min(4096, Math.max(1, Number(sizeMatch[2] ?? sizeMatch[1])));
  const normalizeColor = (color: string | undefined, fallback: string) =>
    color && /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)
      ? `#${color}`
      : fallback;
  const background = normalizeColor(pathSegments[1], "#e5e7eb");
  const foreground = normalizeColor(pathSegments[2], "#94a3b8");
  const label = (url.searchParams.get("text") ?? "").trim().slice(0, 40);
  const escapeXml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const scale = Math.min(width, height);
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const graphic = label
    ? `<text x="${centerX}" y="${centerY}" fill="${foreground}" font-family="system-ui,sans-serif" font-size="${Math.max(10, Math.round(scale * 0.16))}" text-anchor="middle" dominant-baseline="central">${escapeXml(label)}</text>`
    : [
        `<circle cx="${centerX}" cy="${Math.round(centerY - scale * 0.12)}" r="${Math.max(2, Math.round(scale * 0.14))}" fill="${foreground}"/>`,
        `<ellipse cx="${centerX}" cy="${Math.round(centerY + scale * 0.2)}" rx="${Math.max(4, Math.round(scale * 0.28))}" ry="${Math.max(3, Math.round(scale * 0.18))}" fill="${foreground}"/>`,
      ].join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/>${graphic}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mapTavernVariableStrings<T>(
  value: T,
  mapper: (text: string) => string,
  seen = new WeakMap<object, unknown>(),
): T {
  if (typeof value === "string") return mapper(value) as T;
  if (!value || typeof value !== "object") return value;
  const objectValue = value as object;
  const existing = seen.get(objectValue);
  if (existing !== undefined) return existing as T;
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(objectValue, output);
    value.forEach((item) => output.push(mapTavernVariableStrings(item, mapper, seen)));
    return output as T;
  }
  if (!isRecord(value) || Object.prototype.toString.call(value) !== "[object Object]") {
    return value;
  }
  const output: Record<string, unknown> = {};
  seen.set(objectValue, output);
  Object.entries(value).forEach(([key, item]) => {
    output[key] = mapTavernVariableStrings(item, mapper, seen);
  });
  return output as T;
}

function toTavernStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[,，\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toTavernBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function toTavernNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTavernWorldBookPosition(
  value: unknown,
  fallback: TavernRuntimeWorldBookEntry["position"] = "after_char",
) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "before_char" || normalized === "0") return "before_char";
  if (normalized === "after_char" || normalized === "1") return "after_char";
  if (normalized === "before_an" || normalized === "2" || normalized === "5") {
    return "before_an";
  }
  if (normalized === "after_an" || normalized === "3" || normalized === "6") {
    return "after_an";
  }
  if (normalized === "at_depth" || normalized === "4") return "at_depth";
  return fallback;
}

function formatTavernWorldBookEntry(entry: TavernRuntimeWorldBookEntry) {
  const keys = cloneValue(entry.keys);
  const secondaryKeys = cloneValue(entry.secondaryKeys);
  return {
    id: entry.id,
    uid: entry.uid || entry.id,
    name: entry.comment,
    comment: entry.comment,
    content: entry.content,
    enabled: entry.enabled,
    disabled: !entry.enabled,
    keys,
    key: cloneValue(keys),
    secondaryKeys,
    secondary_keys: cloneValue(secondaryKeys),
    keysecondary: cloneValue(secondaryKeys),
    constant: entry.constant,
    selective: entry.selective,
    selective_logic: entry.selectiveLogic,
    insertion_order: entry.order,
    order: entry.order,
    priority: entry.order,
    depth: entry.depth,
    scan_depth: entry.scanDepth,
    probability: entry.probability,
    use_probability: entry.useProbability,
    case_sensitive: entry.caseSensitive,
    match_whole_words: entry.matchWholeWords,
    use_regex: entry.useRegex,
    strategy: {
      type: entry.constant ? "constant" : "selective",
      keys: cloneValue(keys),
      keys_secondary: cloneValue(secondaryKeys),
      selective_logic: entry.selectiveLogic,
      scan_depth: entry.scanDepth,
      probability: entry.probability,
      use_probability: entry.useProbability,
      case_sensitive: entry.caseSensitive,
      match_whole_words: entry.matchWholeWords,
      use_regex: entry.useRegex,
    },
    position: {
      type: entry.position,
      role: "system",
      depth: entry.depth,
      order: entry.order,
    },
  };
}

function normalizeTavernWorldBookEntry(
  value: unknown,
  index: number,
  fallback?: TavernRuntimeWorldBookEntry,
): TavernRuntimeWorldBookEntry {
  const raw = isRecord(value) ? value : {};
  const strategy = isRecord(raw.strategy) ? raw.strategy : {};
  const position = isRecord(raw.position) ? raw.position : {};
  const fallbackId = fallback?.id ?? `worldbook-entry-${crypto.randomUUID()}`;
  const id = String(raw.id ?? raw.uid ?? fallbackId);
  const strategyType = String(strategy.type ?? "").toLowerCase();
  const rawEnabled = raw.enabled ?? (raw.disabled === undefined ? undefined : !raw.disabled);
  return {
    id,
    uid: String(raw.uid ?? raw.id ?? fallback?.uid ?? id),
    comment: String(raw.name ?? raw.comment ?? raw.memo ?? fallback?.comment ?? `条目 ${index + 1}`),
    content: String(raw.content ?? fallback?.content ?? ""),
    enabled: toTavernBoolean(rawEnabled, fallback?.enabled ?? true),
    keys: toTavernStringArray(raw.keys ?? raw.key ?? strategy.keys ?? fallback?.keys),
    secondaryKeys: toTavernStringArray(
      raw.secondaryKeys ??
        raw.secondary_keys ??
        raw.keysecondary ??
        strategy.keys_secondary ??
        fallback?.secondaryKeys,
    ),
    constant: toTavernBoolean(
      raw.constant,
      strategyType === "constant" || (fallback?.constant ?? false),
    ),
    selective: toTavernBoolean(
      raw.selective,
      strategyType === "selective" || (fallback?.selective ?? false),
    ),
    selectiveLogic: Math.max(
      0,
      Math.round(
        toTavernNumber(
          raw.selectiveLogic ?? raw.selective_logic ?? strategy.selective_logic,
          fallback?.selectiveLogic ?? 0,
        ),
      ),
    ),
    position: normalizeTavernWorldBookPosition(
      isRecord(raw.position) ? raw.position.type : raw.position,
      fallback?.position,
    ),
    depth: Math.max(
      0,
      Math.round(toTavernNumber(raw.depth ?? position.depth, fallback?.depth ?? 4)),
    ),
    scanDepth: (() => {
      const scanDepth =
        raw.scanDepth ?? raw.scan_depth ?? strategy.scan_depth ?? fallback?.scanDepth ?? null;
      return scanDepth === null
        ? null
        : Math.max(1, Math.round(toTavernNumber(scanDepth, fallback?.scanDepth ?? 8)));
    })(),
    order: Math.round(
      toTavernNumber(
        raw.order ?? raw.insertion_order ?? raw.priority ?? position.order,
        fallback?.order ?? 100,
      ),
    ),
    probability: Math.min(
      100,
      Math.max(
        0,
        toTavernNumber(raw.probability ?? strategy.probability, fallback?.probability ?? 100),
      ),
    ),
    useProbability: toTavernBoolean(
      raw.useProbability ?? raw.use_probability ?? strategy.use_probability,
      fallback?.useProbability ?? false,
    ),
    caseSensitive: toTavernBoolean(
      raw.caseSensitive ?? raw.case_sensitive ?? strategy.case_sensitive,
      fallback?.caseSensitive ?? false,
    ),
    matchWholeWords: toTavernBoolean(
      raw.matchWholeWords ?? raw.match_whole_words ?? strategy.match_whole_words,
      fallback?.matchWholeWords ?? false,
    ),
    useRegex: toTavernBoolean(
      raw.useRegex ?? raw.use_regex ?? strategy.use_regex,
      fallback?.useRegex ?? false,
    ),
  };
}

function normalizeTavernRegexRecord(
  value: unknown,
  fallbackScope = "global",
): Record<string, unknown> {
  const raw = isRecord(value) ? cloneValue(value) : {};
  const disabled =
    typeof raw.disabled === "boolean"
      ? raw.disabled
      : typeof raw.enabled === "boolean"
        ? !raw.enabled
        : false;
  const placement = Array.isArray(raw.placement)
    ? raw.placement.map(Number).filter(Number.isFinite)
    : [2];
  const scriptName = String(raw.script_name ?? raw.scriptName ?? raw.name ?? "Unnamed Regex");
  const findRegex = String(raw.find_regex ?? raw.findRegex ?? "");
  const replaceString = String(raw.replace_string ?? raw.replaceString ?? "");
  const rawTrimStrings = raw.trim_strings ?? raw.trimStrings;
  const trimStrings = Array.isArray(rawTrimStrings)
    ? rawTrimStrings.map(String)
    : [];
  const markdownOnly = Boolean(raw.markdown_only ?? raw.markdownOnly ?? true);
  const promptOnly = Boolean(raw.prompt_only ?? raw.promptOnly ?? false);
  const scope = ["global", "character", "preset"].includes(String(raw.scope))
    ? String(raw.scope)
    : fallbackScope;

  return {
    ...raw,
    id: String(raw.id ?? `regex-${crypto.randomUUID()}`),
    scope,
    script_name: scriptName,
    scriptName,
    find_regex: findRegex,
    findRegex,
    replace_string: replaceString,
    replaceString,
    trim_strings: trimStrings,
    trimStrings,
    placement,
    disabled,
    enabled: !disabled,
    markdown_only: markdownOnly,
    markdownOnly,
    prompt_only: promptOnly,
    promptOnly,
    run_on_edit: Boolean(raw.run_on_edit ?? raw.runOnEdit ?? true),
    runOnEdit: Boolean(raw.run_on_edit ?? raw.runOnEdit ?? true),
    substitute_regex: Number(raw.substitute_regex ?? raw.substituteRegex ?? 0) || 0,
    substituteRegex: Number(raw.substitute_regex ?? raw.substituteRegex ?? 0) || 0,
    min_depth: raw.min_depth ?? raw.minDepth ?? null,
    minDepth: raw.min_depth ?? raw.minDepth ?? null,
    max_depth: raw.max_depth ?? raw.maxDepth ?? null,
    maxDepth: raw.max_depth ?? raw.maxDepth ?? null,
    source: isRecord(raw.source)
      ? raw.source
      : {
          user_input: placement.includes(1),
          ai_output: placement.includes(2),
          slash_command: placement.includes(3),
          world_info: placement.includes(5),
        },
    destination: isRecord(raw.destination)
      ? raw.destination
      : {
          display: !promptOnly,
          prompt: !markdownOnly,
        },
  };
}

function buildLocalFontAwesomeCss(baseUrl: string) {
  const withoutTrueTypeFallbacks = fontAwesomeCss.replace(
    /,url\(\.\.\/webfonts\/fa-(?:brands-400|regular-400|solid-900|v4compatibility)\.ttf\) format\("truetype"\)/g,
    "",
  );
  const fontAssets = [
    ["../webfonts/fa-brands-400.woff2", fontAwesomeBrandsUrl],
    ["../webfonts/fa-regular-400.woff2", fontAwesomeRegularUrl],
    ["../webfonts/fa-solid-900.woff2", fontAwesomeSolidUrl],
    ["../webfonts/fa-v4compatibility.woff2", fontAwesomeV4CompatibilityUrl],
  ] as const;
  return fontAssets.reduce(
    (css, [source, assetUrl]) => css.replaceAll(source, new URL(assetUrl, baseUrl).href),
    withoutTrueTypeFallbacks,
  );
}

export function getTavernFontAwesomeCss(baseUrl = window.location.href) {
  return buildLocalFontAwesomeCss(baseUrl);
}

function installLocalFontAwesomeShadowSupport(
  targetWindow: Window & typeof globalThis,
  assetBaseUrl: string,
) {
  const { document } = targetWindow;
  const elementPrototype = targetWindow.Element.prototype;
  const originalAttachShadow = elementPrototype.attachShadow;
  const css = buildLocalFontAwesomeCss(assetBaseUrl);
  const solidUrl = new URL(fontAwesomeSolidUrl, assetBaseUrl).href;
  const regularUrl = new URL(fontAwesomeRegularUrl, assetBaseUrl).href;
  const brandsUrl = new URL(fontAwesomeBrandsUrl, assetBaseUrl).href;
  const fontFaces = [
    new targetWindow.FontFace("Font Awesome 6 Free", `url("${solidUrl}") format("woff2")`, {
      style: "normal",
      weight: "900",
    }),
    new targetWindow.FontFace("Font Awesome 6 Free", `url("${regularUrl}") format("woff2")`, {
      style: "normal",
      weight: "400",
    }),
    new targetWindow.FontFace("Font Awesome 6 Brands", `url("${brandsUrl}") format("woff2")`, {
      style: "normal",
      weight: "400",
    }),
  ];
  fontFaces.forEach((fontFace) => document.fonts.add(fontFace));
  const ready = Promise.all(fontFaces.map((fontFace) => fontFace.load())).then(() => undefined);
  const links = new Set<HTMLLinkElement>();
  const styles = new Set<HTMLStyleElement>();
  const documentStyle = document.createElement("style");
  documentStyle.dataset.rengeFontawesome = "true";
  documentStyle.textContent = css;
  document.head.appendChild(documentStyle);

  const inject = (root: ShadowRoot) => {
    if (root.querySelector('[data-renge-fontawesome="true"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "data:text/css;charset=utf-8,/*renge-fontawesome*/";
    link.dataset.rengeFontawesome = "true";
    const style = document.createElement("style");
    style.dataset.rengeFontawesomeStyle = "true";
    style.textContent = css;
    root.prepend(style);
    root.prepend(link);
    links.add(link);
    styles.add(style);
  };

  const patchedAttachShadow: typeof Element.prototype.attachShadow = function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = originalAttachShadow.call(this, init);
    inject(root);
    return root;
  };
  elementPrototype.attachShadow = patchedAttachShadow;
  document.querySelectorAll("*").forEach((element) => {
    if (element.shadowRoot) inject(element.shadowRoot);
  });

  return {
    ready,
    cleanup: () => {
      if (elementPrototype.attachShadow === patchedAttachShadow) {
        elementPrototype.attachShadow = originalAttachShadow;
      }
      links.forEach((link) => link.remove());
      links.clear();
      styles.forEach((style) => style.remove());
      styles.clear();
      documentStyle.remove();
      fontFaces.forEach((fontFace) => document.fonts.delete(fontFace));
    },
  };
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
  private eventHandlers = new Map<string, RuntimeEventHandler[]>();
  private eventHandlerSequence = 0;
  private scriptButtons = new Map<string, TavernScriptButton[]>();
  private variableSchemas = new Map<string, unknown>();
  private sillyTavernChatCache: Array<Record<string, unknown>> = [];
  private fontAwesomeCleanups: Array<() => void> = [];
  private localPlaceholderImageSources = new Map<string, string>();

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

  syncChat() {
    if (this.destroyed) return;
    this.refreshSillyTavernChatCache();
  }

  async initialize() {
    if (this.destroyed) throw new Error("脚本运行时已销毁。");
    this.reportStatus("loading", "正在初始化酒馆脚本运行环境...");
    await this.createIframe();
    this.refreshSillyTavernChatCache();
    const fontAwesomeSupports = [
      installLocalFontAwesomeShadowSupport(window, window.location.href),
    ];
    if (this.runtimeWindow) {
      fontAwesomeSupports.push(
        installLocalFontAwesomeShadowSupport(this.runtimeWindow, window.location.href),
      );
    }
    this.fontAwesomeCleanups.push(...fontAwesomeSupports.map((support) => support.cleanup));
    await Promise.all(fontAwesomeSupports.map((support) => support.ready));
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
    const character = this.localizePlaceholderImages(this.adapter.getCharacter());
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
    const handlers = [...(this.eventHandlers.get(eventName) ?? [])].sort(
      (left, right) => left.priority - right.priority || left.sequence - right.sequence,
    );
    const results: unknown[] = [];
    for (const handler of handlers) {
      const previousScriptId = this.currentScriptId;
      this.currentScriptId = handler.scriptId || previousScriptId;
      try {
        results.push(await handler.callback(...args));
      } catch (error) {
        this.writeRuntimeLog("error", `事件 ${eventName} 处理失败：${toErrorMessage(error)}`);
      } finally {
        this.currentScriptId = previousScriptId;
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
    this.variableSchemas.clear();
    this.sillyTavernChatCache.splice(0);
    this.adapter.onButtonsChange?.([]);
    const parentWindow = window as Window & { Mvu?: unknown };
    if (parentWindow.Mvu) delete parentWindow.Mvu;
    this.iframe?.remove();
    this.fontAwesomeCleanups
      .splice(0)
      .reverse()
      .forEach((cleanup) => cleanup());
    this.localPlaceholderImageSources.clear();
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
    win.z = buildZodGlobal(zodModule);
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

    const registerEventHandler = (
      eventName: unknown,
      callback: unknown,
      priority: RuntimeEventHandler["priority"] = 0,
    ) => {
      if (typeof callback !== "function") return callback;
      const key = String(eventName);
      const callbacks = this.eventHandlers.get(key) ?? [];
      const typedCallback = callback as (...args: unknown[]) => unknown;
      if (!callbacks.some((handler) => handler.callback === typedCallback)) {
        callbacks.push({
          callback: typedCallback,
          scriptId: this.currentScriptId || this.lastScriptId,
          priority,
          sequence: this.eventHandlerSequence++,
        });
      }
      this.eventHandlers.set(key, callbacks);
      return callback;
    };
    const eventOn = (eventName: unknown, callback: unknown) =>
      registerEventHandler(eventName, callback, 0);
    const eventRemoveListener = (eventName: unknown, callback: unknown) => {
      const callbacks = this.eventHandlers.get(String(eventName));
      if (!callbacks) return false;
      if (typeof callback === "function") {
        const index = callbacks.findIndex((handler) => handler.callback === callback);
        if (index >= 0) callbacks.splice(index, 1);
      }
      if (callbacks.length === 0) this.eventHandlers.delete(String(eventName));
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
    const eventClearListener = (callback: unknown) => {
      if (typeof callback !== "function") return false;
      let removed = false;
      this.eventHandlers.forEach((handlers, eventName) => {
        const remaining = handlers.filter((handler) => handler.callback !== callback);
        removed ||= remaining.length !== handlers.length;
        if (remaining.length > 0) this.eventHandlers.set(eventName, remaining);
        else this.eventHandlers.delete(eventName);
      });
      return removed;
    };
    const emitFromScript = (eventName: unknown, ...args: unknown[]) => {
      const normalizedEventName = String(eventName);
      if (
        [
          TAVERN_EVENTS.MESSAGE_UPDATED,
          TAVERN_EVENTS.MESSAGE_EDITED,
          TAVERN_EVENTS.MESSAGE_DELETED,
          TAVERN_EVENTS.MESSAGE_SWIPED,
          "MESSAGE_UPDATED",
          "MESSAGE_EDITED",
          "MESSAGE_DELETED",
          "MESSAGE_SWIPED",
        ].includes(normalizedEventName)
      ) {
        this.persistSillyTavernChatCache();
      }
      return this.emit(normalizedEventName, ...args);
    };
    const eventSource = {
      on: eventOn,
      once: eventOnce,
      emit: emitFromScript,
      emitAndWait: emitFromScript,
      removeListener: eventRemoveListener,
      makeFirst: (eventName: string, callback: (...args: unknown[]) => unknown) => {
        registerEventHandler(eventName, callback, -1);
        return { stop: () => eventRemoveListener(eventName, callback) };
      },
      makeLast: (eventName: string, callback: (...args: unknown[]) => unknown) => {
        registerEventHandler(eventName, callback, 1);
        return { stop: () => eventRemoveListener(eventName, callback) };
      },
      clearEvent: (eventName: unknown) => this.eventHandlers.delete(String(eventName)),
      clearListener: eventClearListener,
      clearAll: () => this.eventHandlers.clear(),
    };

    const getScriptId = () =>
      this.currentScriptId || this.lastScriptId || this.scripts[0]?.id || "renge-script";
    const getScript = () =>
      this.scripts.find((script) => script.id === getScriptId()) ?? this.scripts[0];
    const runWithScriptContext = <T>(scriptId: string, callback: () => T) => {
      const previousScriptId = this.currentScriptId;
      this.currentScriptId = scriptId || previousScriptId;
      try {
        return callback();
      } finally {
        this.currentScriptId = previousScriptId;
      }
    };
    const nativeSetTimeout = win.setTimeout.bind(win);
    const nativeSetInterval = win.setInterval.bind(win);
    const nativeRequestAnimationFrame = win.requestAnimationFrame?.bind(win);
    win.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const ownerScriptId = this.currentScriptId;
      return nativeSetTimeout(
        typeof handler === "function" && ownerScriptId
          ? (...callbackArgs: unknown[]) =>
              runWithScriptContext(ownerScriptId, () => handler(...callbackArgs))
          : handler,
        timeout,
        ...args,
      );
    }) as typeof win.setTimeout;
    win.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const ownerScriptId = this.currentScriptId;
      return nativeSetInterval(
        typeof handler === "function" && ownerScriptId
          ? (...callbackArgs: unknown[]) =>
              runWithScriptContext(ownerScriptId, () => handler(...callbackArgs))
          : handler,
        timeout,
        ...args,
      );
    }) as typeof win.setInterval;
    if (nativeRequestAnimationFrame) {
      win.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        const ownerScriptId = this.currentScriptId;
        return nativeRequestAnimationFrame((time) =>
          runWithScriptContext(ownerScriptId, () => callback(time)),
        );
      }) as typeof win.requestAnimationFrame;
    }
    const eventTargetPrototype = win.EventTarget?.prototype;
    if (eventTargetPrototype) {
      const nativeAddEventListener = eventTargetPrototype.addEventListener;
      const nativeRemoveEventListener = eventTargetPrototype.removeEventListener;
      const listenerWrappers = new WeakMap<object, EventListenerOrEventListenerObject>();
      eventTargetPrototype.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        const ownerScriptId = getScriptId();
        if (!listener || !ownerScriptId) {
          return nativeAddEventListener.call(this, type, listener, options);
        }
        const listenerKey = listener as object;
        let wrapped = listenerWrappers.get(listenerKey);
        if (!wrapped) {
          wrapped = typeof listener === "function"
            ? function (this: EventTarget, event: Event) {
                return runWithScriptContext(ownerScriptId, () => listener.call(this, event));
              }
            : {
                handleEvent: (event: Event) =>
                  runWithScriptContext(ownerScriptId, () => listener.handleEvent(event)),
              };
          listenerWrappers.set(listenerKey, wrapped);
        }
        return nativeAddEventListener.call(this, type, wrapped, options);
      };
      eventTargetPrototype.removeEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) {
        const wrapped = listener ? listenerWrappers.get(listener as object) ?? listener : listener;
        return nativeRemoveEventListener.call(this, type, wrapped, options);
      };
    }
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
      const value = String(range)
        .trim()
        .replace(/\{\{\s*lastMessageId\s*\}\}/gi, String(messages.length - 1))
        .replace(/\{\{\s*currentMessageId\s*\}\}/gi, String(messages.length - 1));
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
      const reservedUpdateKeys = new Set([
        "message_id", "mesid", "id", "name", "role", "is_user", "is_system",
        "is_hidden", "message", "mes", "content", "data", "variables", "extra",
        "swipe_id", "swipes", "swipes_data", "swipes_info",
      ]);
      updates.forEach((update) => {
        if (!isRecord(update)) return;
        const index = normalizeMessageId(update.message_id, messages);
        const message = messages[index];
        if (!message) return;
        if (typeof update.mes === "string") message.content = update.mes;
        else if (typeof update.message === "string") message.content = update.message;
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
        const nextExtra = isRecord(message.extra) ? cloneValue(message.extra) : {};
        Object.entries(update).forEach(([key, value]) => {
          if (!reservedUpdateKeys.has(key)) nextExtra[key] = cloneValue(value);
        });
        if (Object.keys(nextExtra).length > 0) message.extra = nextExtra;
      });
      this.adapter.setMessages(messages);
      this.refreshSillyTavernChatCache();
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
      this.refreshSillyTavernChatCache();
      return true;
    };

    const deleteChatMessages = async (ids: unknown) => {
      const values = Array.isArray(ids) ? ids : [ids];
      const indexes = new Set(values.map((id) => Number(id)).filter(Number.isInteger));
      this.adapter.setMessages(
        this.adapter.getMessages().filter((_, index) => !indexes.has(index)),
      );
      this.refreshSillyTavernChatCache();
      return true;
    };

    const resolveVariableScriptId = (option?: unknown) =>
      isRecord(option) && typeof option.script_id === "string" && option.script_id.trim()
        ? option.script_id.trim()
        : getScriptId();
    const getVariables = (option?: unknown) => {
      const resolved = this.resolveVariables(option, resolveVariableScriptId(option));
      return this.localizePlaceholderImages(cloneValue(resolved));
    };
    const getAllVariables = () =>
      this.localizePlaceholderImages(
        mergeVariableRecords(
          mergeVariableRecords(
            mergeVariableRecords(
              cloneValue(this.adapter.getGlobalVariables()),
              cloneValue(this.adapter.getCharacterVariables()),
            ),
            cloneValue(this.adapter.getScriptData(getScriptId())),
          ),
          cloneValue(this.adapter.getChatVariables()),
        ),
      );
    const publishVariableChange = async (variables: Record<string, unknown>, option?: unknown) => {
      await this.emit(TAVERN_EVENTS.VARIABLE_CHANGED, cloneValue(variables), cloneValue(option));
      await this.emit("mag_variable_update_ended", cloneValue(variables), cloneValue(option));
      return variables;
    };
    const replaceVariables = async (variables: unknown, option?: unknown) => {
      const next = isRecord(variables) ? cloneValue(variables) : {};
      this.saveVariables(option, resolveVariableScriptId(option), next);
      return await publishVariableChange(next, option);
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
      this.saveVariables(option, resolveVariableScriptId(option), next);
      await this.emit("variables_updated", cloneValue(next), cloneValue(option));
      return await publishVariableChange(next, option);
    };
    const insertOrAssignVariables = async (variables: unknown, option?: unknown) => {
      const current = getVariables(option);
      const next = isRecord(variables)
        ? mergeVariableRecords(current, cloneValue(variables))
        : current;
      this.saveVariables(option, resolveVariableScriptId(option), next);
      return await publishVariableChange(next, option);
    };
    const insertVariables = async (variables: unknown, option?: unknown) => {
      const current = getVariables(option);
      const next = isRecord(variables)
        ? mergeVariableRecords(cloneValue(variables), current)
        : current;
      this.saveVariables(option, resolveVariableScriptId(option), next);
      return await publishVariableChange(next, option);
    };
    const deleteVariable = async (path: unknown, option?: unknown) => {
      const current = getVariables(option);
      const deleted = deletePath(current, String(path));
      this.saveVariables(option, resolveVariableScriptId(option), current);
      await publishVariableChange(current, option);
      return { variables: current, delete_occurred: deleted };
    };
    const registerVariableSchema = (schema: unknown, name = getScriptId()) => {
      this.variableSchemas.set(String(name || getScriptId()), schema);
      return () => this.variableSchemas.delete(String(name || getScriptId()));
    };

    const getCharacter = () => this.localizePlaceholderImages(this.adapter.getCharacter());
    const getGlobalWorldBooks = () =>
      this.adapter.getWorldBooks().filter((book) => book.scope === "global");
    const getCharacterWorldBook = () => getCharacter()?.worldBook ?? null;
    const getWorldBooks = () => {
      const characterBook = getCharacterWorldBook();
      const globalBooks = getGlobalWorldBooks();
      if (!characterBook) return globalBooks;
      return [
        characterBook,
        ...globalBooks.filter(
          (book) => book.id !== characterBook.id || book.name !== characterBook.name,
        ),
      ];
    };
    const findWorldBook = (name: unknown) => {
      const normalizedName = String(name ?? "").trim();
      if (!normalizedName) return null;
      const characterBook = getCharacterWorldBook();
      if (characterBook?.name === normalizedName) return characterBook;
      return getGlobalWorldBooks().find((book) => book.name === normalizedName) ?? null;
    };
    const getWorldbookNames = () =>
      Array.from(new Set(getWorldBooks().map((book) => book.name)));
    const getGlobalWorldbookNames = () => getGlobalWorldBooks().map((book) => book.name);
    const getWorldbook = (name: unknown) =>
      cloneValue(findWorldBook(name)?.entries.map(formatTavernWorldBookEntry) ?? []);
    const getLorebooks = () =>
      getWorldBooks().map((book) => ({
        id: book.id,
        name: book.name,
        description: book.description,
        global: book.scope === "global",
        active: book.active,
        entries: getWorldbook(book.name),
      }));
    const getLorebookEntries = async (name: unknown) => getWorldbook(name);
    const getCharWorldbookNames = () => {
      const primary = getCharacterWorldBook()?.name ?? null;
      const additional = getGlobalWorldBooks()
        .filter((book) => book.active && book.name !== primary)
        .map((book) => book.name);
      return { primary, additional };
    };
    const getCharLorebooks = async () => getCharWorldbookNames();
    const getCurrentCharPrimaryLorebook = () => getCharacterWorldBook()?.name ?? null;
    const persistWorldBookEntries = (
      book: TavernRuntimeWorldBook,
      values: unknown[],
    ) => {
      const fallbackEntries = new Map(
        book.entries.flatMap((entry) => [
          [entry.id, entry],
          [entry.uid, entry],
        ]),
      );
      const entries = values.map((value, index) => {
        const raw = isRecord(value) ? value : {};
        const fallback = fallbackEntries.get(String(raw.id ?? raw.uid ?? ""));
        return normalizeTavernWorldBookEntry(value, index, fallback);
      });
      const nextBook: TavernRuntimeWorldBook = {
        ...book,
        entries,
        updatedAt: new Date().toISOString(),
      };
      this.adapter.setWorldBook(nextBook);
      return entries.map(formatTavernWorldBookEntry);
    };
    const setLorebookEntries = async (name: unknown, entries: unknown) => {
      const book = findWorldBook(name);
      if (!book || !Array.isArray(entries)) return false;
      persistWorldBookEntries(book, entries);
      return true;
    };
    const updateWorldbookWith = async (name: unknown, updater: unknown) => {
      const book = findWorldBook(name);
      if (!book || typeof updater !== "function") return [];
      const currentEntries = getWorldbook(book.name);
      const result = await (updater as (entries: Array<Record<string, unknown>>) => unknown)(
        currentEntries,
      );
      const nextEntries = Array.isArray(result)
        ? result
        : isRecord(result) && Array.isArray(result.entries)
          ? result.entries
          : currentEntries;
      return cloneValue(persistWorldBookEntries(book, nextEntries));
    };
    const createWorldbookEntries = async (name: unknown, entries: unknown) => {
      const book = findWorldBook(name);
      if (!book || !Array.isArray(entries)) return [];
      const additions = entries.map((entry, index) =>
        normalizeTavernWorldBookEntry(entry, book.entries.length + index),
      );
      persistWorldBookEntries(book, [...book.entries, ...additions]);
      return cloneValue(additions.map(formatTavernWorldBookEntry));
    };
    const createLorebookEntry = async (name: unknown, entry: unknown) =>
      (await createWorldbookEntries(name, [entry]))[0] ?? null;
    const deleteWorldbookEntries = async (name: unknown, idsOrPredicate: unknown) => {
      const book = findWorldBook(name);
      if (!book) return false;
      const formattedEntries = book.entries.map(formatTavernWorldBookEntry);
      let retainedEntries: TavernRuntimeWorldBookEntry[];
      if (typeof idsOrPredicate === "function") {
        retainedEntries = book.entries.filter((entry, index) => {
          try {
            return !(idsOrPredicate as (value: Record<string, unknown>, index: number) => unknown)(
              formattedEntries[index],
              index,
            );
          } catch {
            return true;
          }
        });
      } else {
        const values = Array.isArray(idsOrPredicate) ? idsOrPredicate : [idsOrPredicate];
        const ids = new Set(values.map(String));
        retainedEntries = book.entries.filter(
          (entry) => !ids.has(entry.id) && !ids.has(entry.uid),
        );
      }
      persistWorldBookEntries(book, retainedEntries);
      return true;
    };
    const deleteLorebookEntry = async (name: unknown, entryId: unknown) =>
      await deleteWorldbookEntries(name, [entryId]);
    const updateWorldbookEntry = async (
      name: unknown,
      entryId: unknown,
      updates: unknown,
    ) => {
      const book = findWorldBook(name);
      if (!book || !isRecord(updates)) return null;
      const id = String(entryId);
      const currentEntries = book.entries.map(formatTavernWorldBookEntry);
      const index = currentEntries.findIndex(
        (entry) => String(entry.id) === id || String(entry.uid) === id,
      );
      if (index < 0) return null;
      currentEntries[index] = { ...currentEntries[index], ...cloneValue(updates) };
      return persistWorldBookEntries(book, currentEntries)[index] ?? null;
    };
    const getWorldbookEntry = (name: unknown, entryId: unknown) => {
      const id = String(entryId);
      return (
        getWorldbook(name).find(
          (entry) => String(entry.id) === id || String(entry.uid) === id,
        ) ?? null
      );
    };
    const getWorldbookEntryByKey = (name: unknown, key: unknown) => {
      const normalizedKey = String(key ?? "").trim();
      return (
        getWorldbook(name).find(
          (entry) =>
            entry.name === normalizedKey ||
            entry.keys.some((entryKey: string) => entryKey === normalizedKey),
        ) ?? null
      );
    };
    const getLorebookSettings = async () => {
      const activeGlobalNames = getGlobalWorldBooks()
        .filter((book) => book.active)
        .map((book) => book.name);
      return {
      selected_global_lorebooks: activeGlobalNames,
      selected_world_info: activeGlobalNames,
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
      };
    };
    const worldbookManager = {
      getWorldbookNames,
      getGlobalWorldbookNames,
      getWorldbook,
      getLorebooks,
      getLorebookEntries,
      getLorebookSettings,
      setLorebookSettings: async () => true,
      setLorebookEntries,
      createLorebookEntry,
      createLorebookEntries: createWorldbookEntries,
      deleteLorebookEntry,
      getCharWorldbookNames,
      getCharLorebooks,
      getCurrentCharPrimaryLorebook,
      updateWorldbookWith,
      createWorldbookEntries,
      deleteWorldbookEntries,
      deleteLorebookEntries: deleteWorldbookEntries,
      updateWorldbookEntry,
      getWorldbookEntry,
      getWorldbookEntryByKey,
    };

    const substitudeMacros = (value: unknown) =>
      String(value ?? "")
        .replace(/{{\s*user\s*}}/gi, this.adapter.getUserName() || "用户")
        .replace(/{{\s*char\s*}}/gi, getCharacter()?.name || "角色")
        .replace(/<USER>/gi, this.adapter.getUserName() || "用户")
        .replace(/<BOT>/gi, getCharacter()?.name || "角色");
    const getTavernRegexes = (options: unknown = {}) => {
      const normalizedOptions = isRecord(options) ? options : {};
      const scope = String(normalizedOptions.scope ?? "all");
      const enableState = String(normalizedOptions.enable_state ?? "all");
      return this.adapter
        .getRegexes()
        .map((regex) => normalizeTavernRegexRecord(regex))
        .filter((regex) => scope === "all" || regex.scope === scope)
        .filter((regex) => {
          if (enableState === "enabled") return regex.disabled !== true;
          if (enableState === "disabled") return regex.disabled === true;
          return true;
        })
        .map((regex) => cloneValue(regex));
    };
    const replaceTavernRegexes = async (values: unknown, options: unknown = {}) => {
      if (!Array.isArray(values)) return false;
      const normalizedOptions = isRecord(options) ? options : {};
      const scope = String(normalizedOptions.scope ?? "all");
      const incoming = values.map((value) =>
        normalizeTavernRegexRecord(value, scope === "all" ? "global" : scope),
      );
      if (scope === "all") {
        this.adapter.setRegexes(incoming);
        return true;
      }
      const retained = getTavernRegexes({ scope: "all", enable_state: "all" }).filter(
        (regex) => regex.scope !== scope,
      );
      this.adapter.setRegexes([
        ...retained,
        ...incoming.map((regex) => ({ ...regex, scope })),
      ]);
      return true;
    };
    const updateTavernRegexesWith = async (updater: unknown, options: unknown = {}) => {
      const current = getTavernRegexes(options);
      const updated =
        typeof updater === "function"
          ? await (updater as (regexes: Array<Record<string, unknown>>) => unknown)(current)
          : current;
      const next = Array.isArray(updated) ? updated : current;
      await replaceTavernRegexes(next, options);
      return cloneValue(next);
    };
    const importRawTavernRegex = (fileNameOrValue: unknown, rawValue?: unknown) => {
      const sourceFileName = rawValue === undefined ? "" : String(fileNameOrValue ?? "");
      let parsed: unknown = rawValue === undefined ? fileNameOrValue : rawValue;
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      const imported = values.filter(isRecord).map((value) =>
        normalizeTavernRegexRecord(
          {
            ...value,
            scope: value.scope ?? "global",
            sourceFormat: "sillytavern",
            sourceFileName,
          },
          "global",
        ),
      );
      if (imported.length === 0) throw new Error("没有找到可导入的酒馆正则。");
      this.adapter.setRegexes([
        ...getTavernRegexes({ scope: "all", enable_state: "all" }),
        ...imported,
      ]);
      return cloneValue(imported);
    };
    const createTavernRegex = (value: unknown, scope = "global") => {
      const created = normalizeTavernRegexRecord(
        {
          ...(isRecord(value) ? value : {}),
          id: isRecord(value) && value.id ? value.id : `regex-${crypto.randomUUID()}`,
          scope,
        },
        scope,
      );
      this.adapter.setRegexes([
        ...getTavernRegexes({ scope: "all", enable_state: "all" }),
        created,
      ]);
      return cloneValue(created);
    };
    const deleteTavernRegex = (regexId: unknown, scope = "all") => {
      const current = getTavernRegexes({ scope: "all", enable_state: "all" });
      const next = current.filter(
        (regex) =>
          regex.id !== String(regexId) || (scope !== "all" && regex.scope !== scope),
      );
      if (next.length === current.length) return false;
      this.adapter.setRegexes(next);
      return true;
    };
    const formatAsTavernRegexedString = (
      value: unknown,
      source = "ai_output",
      destination = "display",
      options: unknown = {},
    ) => {
      const normalizedOptions = isRecord(options) ? options : {};
      const depth = Number(normalizedOptions.depth ?? 0) || 0;
      return getTavernRegexes({ scope: "all", enable_state: "enabled" }).reduce(
        (result, regex) => {
          const regexSource = isRecord(regex.source) ? regex.source : {};
          const regexDestination = isRecord(regex.destination) ? regex.destination : {};
          if (regexSource[source] === false || regexDestination[destination] === false) {
            return result;
          }
          const minDepth = regex.min_depth == null ? null : Number(regex.min_depth);
          const maxDepth = regex.max_depth == null ? null : Number(regex.max_depth);
          if (minDepth !== null && depth < minDepth) return result;
          if (maxDepth !== null && depth > maxDepth) return result;
          try {
            const findRegex = String(regex.find_regex ?? "");
            const match = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(findRegex);
            const pattern = match ? new RegExp(match[1], match[2]) : new RegExp(findRegex, "g");
            return result.replace(pattern, String(regex.replace_string ?? ""));
          } catch {
            return result;
          }
        },
        substitudeMacros(value),
      );
    };
    const chatMetadata = cloneValue(this.adapter.getChatMetadata?.() ?? {});
    const saveChat = async () => {
      this.adapter.setChatMetadata?.(cloneValue(chatMetadata));
      return this.persistSillyTavernChatCache();
    };
    const updateChatMetadata = async (patch: unknown, reset = false) => {
      const next = reset
        ? isRecord(patch) ? cloneValue(patch) : {}
        : isRecord(patch) ? mergeVariableRecords(chatMetadata, patch) : cloneValue(chatMetadata);
      Object.keys(chatMetadata).forEach((key) => delete chatMetadata[key]);
      Object.assign(chatMetadata, next);
      this.adapter.setChatMetadata?.(cloneValue(chatMetadata));
      return cloneValue(chatMetadata);
    };
    const deleteLastMessage = async () => {
      if (this.sillyTavernChatCache.length === 0) return false;
      this.sillyTavernChatCache.pop();
      this.persistSillyTavernChatCache();
      await this.emit(TAVERN_EVENTS.MESSAGE_DELETED, this.sillyTavernChatCache.length);
      return true;
    };
    const stopGeneration = () => this.adapter.stopGeneration?.();
    const getContext = () => ({
      chat: this.getSillyTavernChat(),
      characters: this.getSillyTavernCharacters(),
      characterId: getCharacter() ? "0" : undefined,
      this_chid: getCharacter() ? 0 : undefined,
      name1: this.adapter.getUserName() || "User",
      name2: getCharacter()?.name || "Assistant",
      chatId: this.adapter.getChatId(),
      eventSource,
      eventTypes: TAVERN_EVENTS,
      event_types: TAVERN_EVENTS,
      chatMetadata,
      chat_metadata: chatMetadata,
      extensionSettings,
      extension_settings: extensionSettings,
      saveChat,
      saveSettingsDebounced,
      setChatMessages,
      deleteLastMessage,
      stopGeneration,
      updateChatMetadata,
      getWorldBooks: getLorebooks,
      powerUserSettings: {},
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

    const storedExtensionSettings = this.adapter.getExtensionSettings?.() ?? getPath(
      this.adapter.getGlobalVariables(),
      TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY,
      {},
    );
    const extensionSettings = isRecord(storedExtensionSettings)
      ? cloneValue(storedExtensionSettings)
      : {};
    const saveSettingsDebounced = () => {
      if (this.adapter.setExtensionSettings) {
        this.adapter.setExtensionSettings(cloneValue(extensionSettings));
        return;
      }
      const variables = cloneValue(this.adapter.getGlobalVariables());
      variables[TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY] = cloneValue(extensionSettings);
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
      eventTypes: TAVERN_EVENTS,
      event_types: TAVERN_EVENTS,
      chatMetadata,
      chat_metadata: chatMetadata,
      extensionSettings,
      extension_settings: extensionSettings,
      saveChat,
      saveSettingsDebounced,
      setChatMessages,
      deleteLastMessage,
      stopGeneration,
      updateChatMetadata,
      getCurrentChatId: () => this.adapter.getChatId(),
      getRequestHeaders: () => ({ "Content-Type": "application/json" }),
      getChatCompletionModel: () => this.adapter.getModelId?.() ?? "",
      getWorldbookNames,
      getWorldBooks: getLorebooks,
      getGlobalWorldbookNames,
      getWorldbook,
      getLorebooks,
      getLorebookEntries,
      getLorebookSettings,
      getCharWorldbookNames,
      getCharLorebooks,
      getCurrentCharPrimaryLorebook,
      worldbookManager,
      lorebookManager: worldbookManager,
      registerMacro: () => true,
      unregisterMacro: () => true,
      unregisterFunctionTool: () => true,
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
      this_chid: { get: () => (getCharacter() ? 0 : undefined), configurable: true },
      name1: { get: () => this.adapter.getUserName() || "User", configurable: true },
      name2: { get: () => getCharacter()?.name || "Assistant", configurable: true },
      chatId: { get: () => this.adapter.getChatId(), configurable: true },
      generating: { get: () => this.adapter.isGenerating?.() ?? false, configurable: true },
    });

    const waitGlobalInitialized = async (name = "Mvu", timeout = 30000) =>
      await this.waitForGlobal(String(name), Number(timeout) || 30000);
    const getInput = () => this.adapter.getInput?.() ?? "";
    const setInput = (value: unknown) => this.adapter.setInput?.(String(value ?? ""));
    const appendInput = (value: unknown) => this.adapter.appendInput?.(String(value ?? ""));
    const sendMessage = async (value: unknown = getInput()) => {
      if (!this.adapter.sendMessage) throw new Error("Renge 会话发送接口尚未初始化。");
      return await this.adapter.sendMessage(String(value ?? ""));
    };
    const triggerSlash = async (command: unknown) => {
      if (!this.adapter.triggerSlash) throw new Error("Renge 斜杠命令接口尚未初始化。");
      return await this.adapter.triggerSlash(String(command ?? ""));
    };
    const generate = async (config?: unknown) => {
      if (!this.adapter.generate) throw new Error("Renge 独立生成接口尚未初始化。");
      return await this.adapter.generate(config);
    };
    const stopAllGeneration = async () => await this.adapter.stopGeneration?.();
    const api = {
      getChatMessages,
      setChatMessages,
      createChatMessages,
      deleteChatMessages,
      getLastMessageId: () => this.adapter.getMessages().length - 1,
      getCurrentMessageId: () => this.adapter.getMessages().length - 1,
      getVariables,
      getAllVariables,
      setVariables: replaceVariables,
      replaceVariables,
      updateVariablesWith,
      insertOrAssignVariables,
      insertVariables,
      deleteVariable,
      registerVariableSchema,
      eventOn,
      eventOnce,
      eventEmit: emitFromScript,
      eventEmitAndWait: emitFromScript,
      eventRemoveListener,
      eventMakeFirst: (eventName: string, callback: (...args: unknown[]) => unknown) =>
        registerEventHandler(eventName, callback, -1),
      eventMakeLast: (eventName: string, callback: (...args: unknown[]) => unknown) =>
        registerEventHandler(eventName, callback, 1),
      eventClearEvent: (eventName: unknown) => this.eventHandlers.delete(String(eventName)),
      eventClearListener,
      eventClearAll: () => this.eventHandlers.clear(),
      getCharData: () => this.getSillyTavernCharacters()[0]?.data ?? null,
      getWorldbookNames,
      getGlobalWorldbookNames,
      getWorldbook,
      getLorebooks,
      getCharLorebooks,
      getCharWorldbookNames,
      getCurrentCharPrimaryLorebook,
      getLorebookEntries,
      getLorebookSettings,
      setLorebookSettings: async () => true,
      setLorebookEntries,
      createLorebookEntry,
      createLorebookEntries: createWorldbookEntries,
      deleteLorebookEntry,
      updateWorldbookWith,
      createWorldbookEntries,
      deleteWorldbookEntries,
      deleteLorebookEntries: deleteWorldbookEntries,
      updateWorldbookEntry,
      getWorldbookEntry,
      getWorldbookEntryByKey,
      getTavernRegexes,
      formatAsTavernRegexedString,
      isCharacterTavernRegexesEnabled: () =>
        getTavernRegexes({ scope: "character", enable_state: "all" }).length > 0,
      importRawTavernRegex,
      createTavernRegex,
      replaceTavernRegexes,
      updateTavernRegexesWith,
      deleteTavernRegex,
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
      saveChat,
      deleteLastMessage,
      updateChatMetadata,
      extension_settings: extensionSettings,
      saveSettingsDebounced,
      getInput,
      setInput,
      appendInput,
      sendMessage,
      triggerSlash,
      triggerSlashWithResult: triggerSlash,
      generate,
      generateRaw: generate,
      stopAllGeneration,
      stopGenerationById: stopAllGeneration,
      toastr,
      tavern_events: TAVERN_EVENTS,
      eventSource,
      SillyTavern: sillyTavern,
    };
    Object.assign(win, api);
    Object.defineProperties(win, {
      chat: { get: () => this.getSillyTavernChat(), configurable: true },
      characters: { get: () => this.getSillyTavernCharacters(), configurable: true },
      this_chid: { get: () => (getCharacter() ? 0 : undefined), configurable: true },
      name1: { get: () => this.adapter.getUserName() || "User", configurable: true },
      name2: { get: () => getCharacter()?.name || "Assistant", configurable: true },
    });
    const promptTemplateApi = (
      globalThis as typeof globalThis & { EjsTemplate?: Record<string, unknown> }
    ).EjsTemplate;
    if (promptTemplateApi) win.EjsTemplate = promptTemplateApi;
    win.worldbookManager = worldbookManager;
    win.lorebookManager = worldbookManager;
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
        : { type: "chat" };
    const type = String(normalized.type ?? "chat").toLowerCase();
    if (type === "global") return this.adapter.getGlobalVariables();
    if (type === "chat") return this.adapter.getChatVariables();
    if (type === "character" || type === "char") {
      return this.adapter.getCharacterVariables();
    }
    if (type === "preset") return this.adapter.getPresetVariables?.() ?? {};
    if (type === "extension") {
      const extensionId = String(normalized.extension_id ?? "").trim();
      const extensionSettings = this.adapter.getExtensionSettings?.() ?? getPath(
        this.adapter.getGlobalVariables(),
        TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY,
        {},
      );
      return extensionId && isRecord(extensionSettings) && isRecord(extensionSettings[extensionId])
        ? extensionSettings[extensionId]
        : {};
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
    const next = this.restorePlaceholderImages(cloneValue(variables));
    const messages = this.adapter.getMessages();
    const normalized: VariableOption = isRecord(option)
      ? option
      : typeof option === "number" || typeof option === "string"
        ? { type: "message", message_id: option }
        : { type: "chat" };
    const type = String(normalized.type ?? "chat").toLowerCase();
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
    if (type === "preset") {
      this.adapter.setPresetVariables?.(next);
      return;
    }
    if (type === "extension") {
      const extensionId = String(normalized.extension_id ?? "").trim();
      if (!extensionId) return;
      if (this.adapter.getExtensionSettings && this.adapter.setExtensionSettings) {
        const extensionSettings = cloneValue(this.adapter.getExtensionSettings());
        extensionSettings[extensionId] = next;
        this.adapter.setExtensionSettings(extensionSettings);
        return;
      }
      const globalVariables = cloneValue(this.adapter.getGlobalVariables());
      const storedSettings = getPath(
        globalVariables,
        TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY,
        {},
      );
      const extensionSettings = isRecord(storedSettings) ? cloneValue(storedSettings) : {};
      extensionSettings[extensionId] = next;
      globalVariables[TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY] = extensionSettings;
      this.adapter.setGlobalVariables(globalVariables);
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
    const extra = cloneValue(message.extra ?? {});
    return {
      ...extra,
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
      data: this.localizePlaceholderImages(cloneValue(message.variables ?? {})),
      variables: this.localizePlaceholderImages(cloneValue(message.variables ?? {})),
      extra,
      swipe_id: 0,
      swipes: [message.content],
      swipes_data: [cloneValue(message.variables ?? {})],
      swipes_info: [cloneValue(message.extra ?? {})],
    };
  }

  private refreshSillyTavernChatCache() {
    const formattedMessages = this.adapter.getMessages().map((message, index) => {
      const formatted = this.formatHelperMessage(message, index);
      return {
        ...formatted,
        variables: [this.localizePlaceholderImages(cloneValue(message.variables ?? {}))],
      };
    });
    this.sillyTavernChatCache.splice(
      0,
      this.sillyTavernChatCache.length,
      ...formattedMessages,
    );
    return this.sillyTavernChatCache;
  }

  private getSillyTavernChat() {
    return this.sillyTavernChatCache;
  }

  private persistSillyTavernChatCache() {
    const previousMessages = this.adapter.getMessages();
    const reservedKeys = new Set([
      "message_id",
      "mesid",
      "id",
      "name",
      "role",
      "is_user",
      "is_system",
      "is_hidden",
      "message",
      "mes",
      "content",
      "data",
      "variables",
      "extra",
      "swipe_id",
      "swipes",
      "swipes_data",
      "swipes_info",
    ]);
    const nextMessages = this.sillyTavernChatCache.map((rawMessage, index) => {
      const previous = previousMessages[index];
      const contentCandidates = [
        rawMessage.mes,
        rawMessage.message,
        rawMessage.content,
        Array.isArray(rawMessage.swipes)
          ? rawMessage.swipes[Number(rawMessage.swipe_id) || 0]
          : undefined,
      ].filter((value): value is string => typeof value === "string");
      const content =
        contentCandidates.find((value) => value !== previous?.content) ??
        contentCandidates[0] ??
        previous?.content ??
        "";
      const previousExtra = isRecord(previous?.extra) ? previous.extra : {};
      const rawExtra = isRecord(rawMessage.extra) ? rawMessage.extra : {};
      const extra: Record<string, unknown> = {};
      Object.entries(rawMessage).forEach(([key, value]) => {
        if (!reservedKeys.has(key)) extra[key] = cloneValue(value);
      });
      const customKeys = new Set([
        ...Object.keys(previousExtra),
        ...Object.keys(rawExtra),
        ...Object.keys(extra),
      ]);
      customKeys.forEach((key) => {
        const previousHas = Object.prototype.hasOwnProperty.call(previousExtra, key);
        const nestedHas = Object.prototype.hasOwnProperty.call(rawExtra, key);
        const topLevelHas = Object.prototype.hasOwnProperty.call(rawMessage, key);
        const nestedChanged =
          nestedHas !== previousHas ||
          (nestedHas && previousHas && !valuesEqual(rawExtra[key], previousExtra[key]));
        const topLevelChanged =
          topLevelHas !== previousHas ||
          (topLevelHas && previousHas && !valuesEqual(rawMessage[key], previousExtra[key]));

        if (nestedChanged && !topLevelChanged) {
          if (nestedHas) extra[key] = cloneValue(rawExtra[key]);
          else delete extra[key];
          return;
        }
        if (topLevelChanged) {
          if (topLevelHas) extra[key] = cloneValue(rawMessage[key]);
          else delete extra[key];
          return;
        }
        if (previousHas) extra[key] = cloneValue(previousExtra[key]);
        else delete extra[key];
      });
      const swipeIndex = Number(rawMessage.swipe_id) || 0;
      const variableValue = Array.isArray(rawMessage.variables)
        ? rawMessage.variables[swipeIndex]
        : isRecord(rawMessage.variables)
          ? rawMessage.variables
          : isRecord(rawMessage.data)
            ? rawMessage.data
            : previous?.variables;
      return {
        id: previous?.id ?? crypto.randomUUID(),
        role:
          rawMessage.is_user === true || rawMessage.role === "user"
            ? ("user" as const)
            : ("assistant" as const),
        content,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        ...(isRecord(variableValue)
          ? { variables: this.restorePlaceholderImages(cloneValue(variableValue)) }
          : {}),
        ...(Object.keys(extra).length > 0 ? { extra } : {}),
      };
    });
    this.adapter.setMessages(nextMessages);
    this.refreshSillyTavernChatCache();
    return true;
  }

  private getSillyTavernCharacters() {
    const character = this.adapter.getCharacter();
    if (!character) return [];
    return [
      {
        name: character.name,
        avatar: this.localizePlaceholderImages(character.avatarDataUrl),
        data: {
          name: character.name,
          description: character.description,
          personality: character.personality,
          scenario: character.scenario,
          first_mes: character.firstMessage,
          mes_example: character.messageExample,
          extensions: {
            ...this.localizePlaceholderImages(cloneValue(character.extensions)),
            ...(character.worldBook ? { world: character.worldBook.name } : {}),
          },
          character_book: character.worldBook,
        },
      },
    ];
  }

  private localizePlaceholderImages<T>(value: T): T {
    return mapTavernVariableStrings(value, (text) => {
      const localized = buildLocalTavernPlaceholderImage(text);
      if (localized !== text) this.localPlaceholderImageSources.set(localized, text);
      return localized;
    });
  }

  private restorePlaceholderImages<T>(value: T): T {
    return mapTavernVariableStrings(
      value,
      (text) => this.localPlaceholderImageSources.get(text) ?? text,
    );
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
            120000,
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
