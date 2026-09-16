import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  DefaultPackageManager,
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const PI_RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"];

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringList(value) {
  return (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function npmPackageName(specifier) {
  const value = String(specifier ?? "").trim();
  if (value.startsWith("@")) {
    const separator = value.indexOf("@", 1);
    return separator === -1 ? value : value.slice(0, separator);
  }
  const separator = value.indexOf("@");
  return separator === -1 ? value : value.slice(0, separator);
}

function isBareNpmSpecifier(value) {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:@[^\s/]+)?$/i.test(
    value,
  );
}

export function isPiPackageSource(value) {
  const source = String(value ?? "").trim();
  return source.startsWith("pi:") || source.startsWith("npm:") || isBareNpmSpecifier(source);
}

export function normalizePiPackageSource(value) {
  let source = String(value ?? "").trim();
  if (!source) throw new Error("请提供 Pi 插件包名或包源。");
  if (source.startsWith("pi:")) source = source.slice(3).trim();
  if (!source) throw new Error("Pi 插件包源不能为空。");
  if (source.startsWith("npm:")) {
    const specifier = source.slice(4).trim();
    if (!isBareNpmSpecifier(specifier)) {
      throw new Error("无效的 npm Pi 插件包名。");
    }
    return `npm:${specifier}`;
  }
  if (isBareNpmSpecifier(source)) return `npm:${source}`;
  return source;
}

function packageIdentity(source) {
  const normalized = normalizePiPackageSource(source);
  if (normalized.startsWith("npm:")) {
    return `npm:${npmPackageName(normalized.slice(4)).toLowerCase()}`;
  }
  return normalized;
}

function packageSource(entry) {
  return typeof entry === "string" ? entry : String(entry?.source ?? "");
}

function packageAuthor(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value.name ?? "").trim();
  return "";
}

function packageRepositoryUrl(value) {
  const raw = typeof value === "string" ? value : value?.url;
  return String(raw ?? "")
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "");
}

function safeIdPart(value, fallback = "plugin") {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function shortHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 10);
}

async function hasDirectory(path) {
  return (await stat(path).catch(() => null))?.isDirectory() === true;
}

async function getDeclaredResources(packageRoot, packageJson) {
  const piManifest = objectRecord(packageJson.pi);
  const resources = {};
  for (const resourceType of PI_RESOURCE_TYPES) {
    const declared = stringList(piManifest[resourceType]);
    resources[resourceType] = declared.length > 0
      ? declared
      : await hasDirectory(join(packageRoot, resourceType))
        ? [resourceType]
        : [];
  }
  return resources;
}

async function inspectPiPackage({ source, cwd, agentDir, manager }) {
  const installedPath = manager.getInstalledPath(source, "user");
  if (!installedPath) throw new Error("Pi 插件安装完成后未找到包目录。");
  const packageJsonPath = join(installedPath, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const resources = await getDeclaredResources(installedPath, packageJson);
  if (!PI_RESOURCE_TYPES.some((resourceType) => resources[resourceType].length > 0)) {
    throw new Error("该包没有声明 Pi extensions、skills、prompts 或 themes 资源。");
  }

  const inspectionSettings = SettingsManager.inMemory({ packages: [source] });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: inspectionSettings,
  });
  await resourceLoader.reload();
  const extensionResult = resourceLoader.getExtensions();
  if (extensionResult.errors.length > 0) {
    throw new Error(
      `Pi 插件入口加载失败：${extensionResult.errors.map((entry) => entry.error).join("；")}`,
    );
  }

  const loadedExtensions = extensionResult.extensions.filter(
    (extension) => packageIdentity(extension.sourceInfo?.source ?? source) === packageIdentity(source),
  );
  if (resources.extensions.length > 0 && loadedExtensions.length === 0) {
    throw new Error("Pi 插件清单声明了扩展入口，但没有成功加载任何入口。");
  }

  const tools = [...new Set(loadedExtensions.flatMap((extension) => [...extension.tools.keys()]))];
  const commands = [...new Set(loadedExtensions.flatMap((extension) => [...extension.commands.keys()]))];
  const events = [...new Set(loadedExtensions.flatMap((extension) => [...extension.handlers.keys()]))];
  const packageName = String(packageJson.name ?? basename(installedPath)).trim();
  const resourceSummary = {
    extensions: resources.extensions.length,
    skills: resources.skills.length,
    prompts: resources.prompts.length,
    themes: resources.themes.length,
  };
  const capabilities = [
    resourceSummary.extensions > 0 ? `${resourceSummary.extensions} 个 Pi 扩展入口` : "",
    resourceSummary.extensions > 0 ? "Pi 动态工具与生命周期注册" : "",
    tools.length > 0 ? `工具：${tools.join("、")}` : "",
    commands.length > 0 ? `命令：${commands.join("、")}` : "",
    events.length > 0 ? `${events.length} 类 Pi 生命周期事件` : "",
    resourceSummary.skills > 0 ? `${resourceSummary.skills} 组 Skills` : "",
    resourceSummary.prompts > 0 ? `${resourceSummary.prompts} 个提示词模板` : "",
    resourceSummary.themes > 0 ? `${resourceSummary.themes} 个主题` : "",
  ].filter(Boolean);
  const repositoryUrl = packageRepositoryUrl(packageJson.repository);
  const homepage = String(packageJson.homepage ?? repositoryUrl).trim();
  const timestamp = new Date().toISOString();

  return {
    id: `pi-${safeIdPart(packageName)}-${shortHash(packageName || source)}`.slice(0, 128),
    packageName,
    displayName: String(packageJson.displayName ?? packageJson.name ?? basename(installedPath)).trim(),
    description: String(packageJson.description ?? "通过 Pi 原生包管理器安装的插件。").trim(),
    author: packageAuthor(packageJson.author) || packageName.split("/")[0] || "未知作者",
    version: String(packageJson.version ?? "0.0.0"),
    sourceUrl: source,
    homePage: homepage,
    license: String(packageJson.license ?? "未声明"),
    enabled: true,
    compatibility: "pi",
    status: "installed",
    statusMessage: "已通过 Pi 原生运行时加载",
    capabilities: capabilities.length > 0 ? capabilities : ["Pi 原生扩展协议"],
    settings: {},
    loadingOrder: 50,
    requires: [],
    optional: [],
    jsFiles: [],
    cssFiles: [],
    assetBaseUrl: "",
    piPackageSource: source,
    piResources: resourceSummary,
    installedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createPiPackageManager({ cwd = process.cwd(), agentDir }) {
  const resolvedCwd = resolve(cwd);
  const resolvedAgentDir = resolve(agentDir);
  let mutationQueue = Promise.resolve();

  const withMutation = (operation) => {
    const result = mutationQueue.catch(() => undefined).then(operation);
    mutationQueue = result.catch(() => undefined);
    return result;
  };

  const createManager = () => {
    const settingsManager = SettingsManager.create(resolvedCwd, resolvedAgentDir);
    const manager = new DefaultPackageManager({
      cwd: resolvedCwd,
      agentDir: resolvedAgentDir,
      settingsManager,
    });
    return { manager, settingsManager };
  };

  const setEnabledInSettings = async (source, enabled, settingsManager, manager) => {
    const identity = packageIdentity(source);
    const installedPath = manager.getInstalledPath(source, "user");
    const currentPackages = settingsManager.getGlobalSettings().packages ?? [];
    const matchIndex = currentPackages.findIndex((entry) => {
      const configuredSource = packageSource(entry);
      if (packageIdentity(configuredSource) === identity) return true;
      const configuredPath = manager.getInstalledPath(configuredSource, "user");
      return Boolean(installedPath && configuredPath && resolve(installedPath) === resolve(configuredPath));
    });
    if (matchIndex === -1) throw new Error(`Pi 插件未安装：${source}`);
    const nextPackages = [...currentPackages];
    nextPackages[matchIndex] = enabled
      ? source
      : {
          source,
          extensions: [],
          skills: [],
          prompts: [],
          themes: [],
        };
    settingsManager.setPackages(nextPackages);
    await settingsManager.flush();
  };

  return {
    install(rawSource) {
      return withMutation(async () => {
        const source = normalizePiPackageSource(rawSource);
        const { manager, settingsManager } = createManager();
        const wasInstalled = Boolean(manager.getInstalledPath(source, "user"));
        await manager.install(source);
        let extension;
        try {
          extension = await inspectPiPackage({
            source,
            cwd: resolvedCwd,
            agentDir: resolvedAgentDir,
            manager,
          });
        } catch (error) {
          if (!wasInstalled) await manager.remove(source).catch(() => undefined);
          throw error;
        }
        manager.addSourceToSettings(source);
        await settingsManager.flush();
        await setEnabledInSettings(source, true, settingsManager, manager);
        return extension;
      });
    },

    setEnabled(rawSource, enabled) {
      return withMutation(async () => {
        const source = normalizePiPackageSource(rawSource);
        const { manager, settingsManager } = createManager();
        await setEnabledInSettings(source, enabled === true, settingsManager, manager);
        return { ok: true, source, enabled: enabled === true };
      });
    },

    remove(rawSource) {
      return withMutation(async () => {
        const source = normalizePiPackageSource(rawSource);
        const { manager, settingsManager } = createManager();
        await manager.removeAndPersist(source);
        await settingsManager.flush();
        return { ok: true, source };
      });
    },

    async list() {
      await mutationQueue;
      const { manager } = createManager();
      return manager.listConfiguredPackages();
    },
  };
}
