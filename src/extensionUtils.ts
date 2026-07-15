export const ST_PROMPT_TEMPLATE_EXTENSION_ID = "st-prompt-template";
export const ST_PROMPT_TEMPLATE_SOURCE_URL =
  "https://github.com/zonde306/ST-Prompt-Template";

export type PromptTemplateExtensionSettings = {
  processGeneratedPrompts: boolean;
  injectGenerateWorldBookEntries: boolean;
  injectPromptWorldBookEntries: boolean;
  processRenderedMessages: boolean;
  injectRenderWorldBookEntries: boolean;
  processRawMessages: boolean;
  preloadWorldBooks: boolean;
  depthLimit: number;
  debug: boolean;
};

export type InstalledExtension = {
  id: string;
  packageName: string;
  displayName: string;
  description: string;
  author: string;
  version: string;
  sourceUrl: string;
  homePage: string;
  license: string;
  enabled: boolean;
  compatibility: "native" | "web";
  status: "installed" | "error";
  statusMessage: string;
  capabilities: string[];
  settings: PromptTemplateExtensionSettings;
  loadingOrder: number;
  requires: string[];
  optional: string[];
  jsFiles: string[];
  cssFiles: string[];
  assetBaseUrl: string;
  installedAt: string;
  updatedAt: string;
};

export const DEFAULT_PROMPT_TEMPLATE_SETTINGS: PromptTemplateExtensionSettings = {
  processGeneratedPrompts: true,
  injectGenerateWorldBookEntries: true,
  injectPromptWorldBookEntries: false,
  processRenderedMessages: true,
  injectRenderWorldBookEntries: true,
  processRawMessages: true,
  preloadWorldBooks: true,
  depthLimit: -1,
  debug: false,
};

const ST_PROMPT_TEMPLATE_CAPABILITIES = [
  "EJS 提示词模板",
  "全局 / 会话 /消息变量",
  "角色卡与世界书上下文",
  "[GENERATE] / [RENDER] 世界书注入",
  "@INJECT 消息注入",
  "生成前与回复后处理",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeDepthLimit(value: unknown) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(-1, parsed) : -1;
}

export function normalizePromptTemplateSettings(
  value: unknown,
): PromptTemplateExtensionSettings {
  const raw = isRecord(value) ? value : {};
  return {
    processGeneratedPrompts: normalizeBoolean(
      raw.processGeneratedPrompts,
      DEFAULT_PROMPT_TEMPLATE_SETTINGS.processGeneratedPrompts,
    ),
    injectGenerateWorldBookEntries: normalizeBoolean(
      raw.injectGenerateWorldBookEntries,
      DEFAULT_PROMPT_TEMPLATE_SETTINGS.injectGenerateWorldBookEntries,
    ),
    injectPromptWorldBookEntries: normalizeBoolean(
      raw.injectPromptWorldBookEntries,
      DEFAULT_PROMPT_TEMPLATE_SETTINGS.injectPromptWorldBookEntries,
    ),
    processRenderedMessages: normalizeBoolean(
      raw.processRenderedMessages,
      DEFAULT_PROMPT_TEMPLATE_SETTINGS.processRenderedMessages,
    ),
    injectRenderWorldBookEntries: normalizeBoolean(
      raw.injectRenderWorldBookEntries,
      DEFAULT_PROMPT_TEMPLATE_SETTINGS.injectRenderWorldBookEntries,
    ),
    processRawMessages: normalizeBoolean(
      raw.processRawMessages,
      DEFAULT_PROMPT_TEMPLATE_SETTINGS.processRawMessages,
    ),
    preloadWorldBooks: normalizeBoolean(
      raw.preloadWorldBooks,
      DEFAULT_PROMPT_TEMPLATE_SETTINGS.preloadWorldBooks,
    ),
    depthLimit: normalizeDepthLimit(raw.depthLimit),
    debug: normalizeBoolean(raw.debug, DEFAULT_PROMPT_TEMPLATE_SETTINGS.debug),
  };
}

export function createPromptTemplateExtension(
  installedAt = new Date().toISOString(),
): InstalledExtension {
  return {
    id: ST_PROMPT_TEMPLATE_EXTENSION_ID,
    packageName: "zonde306/ST-Prompt-Template",
    displayName: "Prompt Template / 提示词模板",
    description:
      "原生兼容 ST-Prompt-Template：在提示词、角色卡、世界书和消息中执行 EJS 模板，并提供酒馆变量与注入接口。",
    author: "zonde306",
    version: "1.17.4.1",
    sourceUrl: ST_PROMPT_TEMPLATE_SOURCE_URL,
    homePage: ST_PROMPT_TEMPLATE_SOURCE_URL,
    license: "AGPL-3.0",
    enabled: true,
    compatibility: "native",
    status: "installed",
    statusMessage: "已安装 Renge 原生兼容层",
    capabilities: [...ST_PROMPT_TEMPLATE_CAPABILITIES],
    settings: { ...DEFAULT_PROMPT_TEMPLATE_SETTINGS },
    loadingOrder: 1,
    requires: [],
    optional: [],
    jsFiles: [],
    cssFiles: [],
    assetBaseUrl: "",
    installedAt,
    updatedAt: installedAt,
  };
}

function normalizeString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : typeof value === "string" && value.trim()
      ? [value.trim()]
      : [];
}

function normalizeAssetList(value: unknown) {
  return normalizeStringList(value)
    .map((item) => item.replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter(
      (item) =>
        Boolean(item) &&
        !item.startsWith("/") &&
        !item.split("/").some((segment) => segment === ".."),
    );
}

function normalizeWebUrl(value: unknown, fallback = "") {
  for (const candidate of [value, fallback]) {
    try {
      const parsed = new URL(String(candidate ?? "").trim());
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href;
    } catch {
      // Try the fallback below.
    }
  }
  return "";
}

export function normalizeInstalledExtension(value: unknown): InstalledExtension | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const packageName =
    typeof value.packageName === "string" ? value.packageName.trim() : "";
  const sourceUrl = typeof value.sourceUrl === "string" ? value.sourceUrl.trim() : "";
  const isPromptTemplate =
    id.toLowerCase() === ST_PROMPT_TEMPLATE_EXTENSION_ID ||
    packageName.toLowerCase() === "zonde306/st-prompt-template" ||
    sourceUrl.toLowerCase().includes("zonde306/st-prompt-template");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !packageName || !sourceUrl) return null;

  const defaults = isPromptTemplate
    ? createPromptTemplateExtension()
    : {
        id,
        packageName,
        displayName: packageName.split("/").at(-1) || packageName,
        description: "通过 Git 仓库安装的酒馆 Web 扩展。",
        author: packageName.split("/")[0] || "未知作者",
        version: "0.0.0",
        sourceUrl,
        homePage: sourceUrl,
        license: "未声明",
        enabled: true,
        compatibility: "web" as const,
        status: "installed" as const,
        statusMessage: "已安装酒馆 Web 兼容扩展",
        capabilities: ["酒馆 manifest 加载", "JavaScript / CSS 资源", "Renge 酒馆 API 兼容层"],
        settings: { ...DEFAULT_PROMPT_TEMPLATE_SETTINGS },
        loadingOrder: 100,
        requires: [],
        optional: [],
        jsFiles: [],
        cssFiles: [],
        assetBaseUrl: "",
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
  return {
    ...defaults,
    id,
    packageName,
    displayName: normalizeString(value.displayName, defaults.displayName),
    description: normalizeString(value.description, defaults.description),
    author: normalizeString(value.author, defaults.author),
    version: normalizeString(value.version, defaults.version),
    sourceUrl,
    homePage: normalizeWebUrl(value.homePage, sourceUrl),
    license: normalizeString(value.license, defaults.license),
    enabled: value.enabled !== false,
    compatibility: isPromptTemplate ? "native" : "web",
    status: value.status === "error" ? "error" : "installed",
    statusMessage:
      typeof value.statusMessage === "string" && value.statusMessage.trim()
        ? value.statusMessage
        : defaults.statusMessage,
    capabilities:
      normalizeStringList(value.capabilities).length > 0
        ? normalizeStringList(value.capabilities)
        : defaults.capabilities,
    settings: normalizePromptTemplateSettings(value.settings),
    loadingOrder: Number.isFinite(Number(value.loadingOrder))
      ? Number(value.loadingOrder)
      : defaults.loadingOrder,
    requires: normalizeStringList(value.requires),
    optional: normalizeStringList(value.optional),
    jsFiles: normalizeAssetList(value.jsFiles),
    cssFiles: normalizeAssetList(value.cssFiles),
    assetBaseUrl: isPromptTemplate
      ? ""
      : `/api/extensions/${encodeURIComponent(id)}/files`,
    installedAt:
      typeof value.installedAt === "string" ? value.installedAt : defaults.installedAt,
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : defaults.updatedAt,
  };
}

export function normalizeInstalledExtensions(value: unknown): InstalledExtension[] {
  const normalized = Array.isArray(value)
    ? value
        .map(normalizeInstalledExtension)
        .filter((extension): extension is InstalledExtension => Boolean(extension))
    : [];
  return normalized.filter(
    (extension, index) =>
      normalized.findIndex((candidate) => candidate.id === extension.id) === index,
  );
}

export function loadInstalledExtensions(storageKey: string): InstalledExtension[] {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === null
      ? [createPromptTemplateExtension()]
      : normalizeInstalledExtensions(JSON.parse(stored));
  } catch {
    return [createPromptTemplateExtension()];
  }
}
