import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  session,
  shell,
  webContents,
} from "electron";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { startRengeServer } from "../server.mjs";
import {
  createCommandApprovalSessionStore,
  looksLikePackageManagerOutput,
  normalizeCommandLine,
  splitCommandLine,
} from "./command-policy.mjs";
import {
  createSidebarBrowserWindowOpenHandler,
  isAllowedSidebarBrowserUrl,
  SIDEBAR_BROWSER_PARTITION,
  SIDEBAR_BROWSER_PARTITION_NAME,
} from "./sidebar-browser-navigation.mjs";
import { copyMissingPersistentCookies } from "./sidebar-browser-session.mjs";
import {
  parseSidebarBrowserImport,
  selectCredentialForUrl,
} from "./sidebar-browser-profile.mjs";
import {
  importTemporaryFiles,
  listSidebarFiles,
  readSidebarBinaryFile,
  readSidebarTextFile,
  resolveSidebarFilePath,
} from "./sidebar-files.mjs";
import { createSidebarTerminalManager } from "./sidebar-terminal.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appIconPath = join(
  __dirname,
  "assets",
  process.platform === "win32" ? "renge-agent.ico" : "renge-agent.png",
);
const execFileAsync = promisify(execFile);
let mainWindow = null;
let serverController = null;
let workspaceRoot = null;
let workspaceFullAccessEnabled = false;
let electronRuntimeCacheDir = null;
let persistentBrowserDataFlushed = false;
let desktopProjectPositionsWriteQueue = Promise.resolve();
const desktopServerPort = 5191;
const desktopProjectPositionsFilename = "desktop-project-positions.json";
const sidebarBrowserMigrationMarkerFilename = ".sidebar-browser-global-data-v1";
const sidebarBrowserProfileFilename = "sidebar-browser-profile.json";
const temporaryFilesDirectoryName = "Temporary Files";
const singleInstanceLockAcquired = app.requestSingleInstanceLock();
const highRiskGitCommands = new Set([
  "checkout",
  "clean",
  "commit",
  "merge",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "switch",
]);
const whitelistedCommandNames = ["npm", "pnpm", "yarn", "node", "git"];
const unlistedCommandApprovalSessions = createCommandApprovalSessionStore();
const sidebarBrowserDownloads = new Map();
const removedSidebarBrowserDownloadIds = new Set();
let sidebarBrowserDownloadSequence = 0;
let sidebarBrowserDownloadsConfigured = false;
let sidebarBrowserProfileCache = null;
let sidebarBrowserProfileWriteQueue = Promise.resolve();
const sidebarTerminalManager = createSidebarTerminalManager({
  getMainWindow: () => mainWindow,
  getWorkspaceRoot: () => workspaceRoot,
  getFallbackCwd: () => process.cwd(),
});

function getPersistentDataDir() {
  if (process.env.RENGE_DATA_DIR) return resolve(process.env.RENGE_DATA_DIR);
  if (process.env.APPDATA) return join(process.env.APPDATA, "Renge Agent Lab");
  return join(app.getPath("home"), ".renge-agent-lab");
}

function getDesktopProjectPositionsPath() {
  return join(getPersistentDataDir(), desktopProjectPositionsFilename);
}

function getSidebarBrowserProfilePath() {
  return join(getPersistentDataDir(), sidebarBrowserProfileFilename);
}

function createDefaultSidebarBrowserProfile() {
  return {
    version: 1,
    settings: { autofillPasswords: true },
    credentials: [],
  };
}

async function loadSidebarBrowserProfile() {
  if (sidebarBrowserProfileCache) return sidebarBrowserProfileCache;
  let profile;
  try {
    profile = JSON.parse(await readFile(getSidebarBrowserProfilePath(), "utf8"));
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      console.warn("[sidebar-browser] failed to load profile", error);
    }
    profile = createDefaultSidebarBrowserProfile();
  }
  sidebarBrowserProfileCache = {
    version: 1,
    settings: {
      autofillPasswords: profile?.settings?.autofillPasswords !== false,
    },
    credentials: Array.isArray(profile?.credentials) ? profile.credentials : [],
  };
  return sidebarBrowserProfileCache;
}

async function saveSidebarBrowserProfile(profile) {
  sidebarBrowserProfileCache = profile;
  const serialized = JSON.stringify(profile, null, 2);
  sidebarBrowserProfileWriteQueue = sidebarBrowserProfileWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(getPersistentDataDir(), { recursive: true });
      await writeFile(getSidebarBrowserProfilePath(), serialized, "utf8");
    });
  await sidebarBrowserProfileWriteQueue;
}

function encryptSidebarBrowserPassword(password) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储当前不可用，无法安全保存导入的密码");
  }
  return safeStorage.encryptString(password).toString("base64");
}

function decryptSidebarBrowserPassword(value) {
  if (!safeStorage.isEncryptionAvailable() || !value) return "";
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return "";
  }
}

function sidebarBrowserProfileSummary(profile) {
  return {
    autofillPasswords: profile.settings.autofillPasswords !== false,
    passwordCount: profile.credentials.length,
    downloadDirectory: app.getPath("downloads"),
  };
}

function assertSidebarBrowserSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error("浏览器操作来源无效");
  }
}

function getSidebarBrowserGuest(event, rawWebContentsId) {
  assertSidebarBrowserSender(event);
  const target = webContents.fromId(Number(rawWebContentsId));
  const browserSession = session.fromPartition(SIDEBAR_BROWSER_PARTITION);
  if (!target || target.isDestroyed() || target.session !== browserSession || target.getType() !== "webview") {
    throw new Error("找不到当前侧栏网页");
  }
  return target;
}

function normalizeSidebarBrowserCaptureRect(rawRect) {
  const numberInRange = (value, minimum, maximum) => Math.min(
    maximum,
    Math.max(minimum, Math.round(Number(value) || 0)),
  );
  return {
    x: numberInRange(rawRect?.x, 0, 100_000),
    y: numberInRange(rawRect?.y, 0, 100_000),
    width: numberInRange(rawRect?.width, 1, 2_048),
    height: numberInRange(rawRect?.height, 1, 2_048),
  };
}

function assertExternalBrowserUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl ?? ""));
  } catch {
    throw new Error("链接地址无效");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("只允许打开 HTTP 或 HTTPS 链接");
  return parsed.href;
}

function serializeSidebarBrowserDownload(record) {
  return {
    id: record.id,
    fileName: record.fileName,
    filePath: record.filePath,
    mimeType: record.mimeType,
    receivedBytes: record.receivedBytes,
    totalBytes: record.totalBytes,
    state: record.state,
    paused: record.paused,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    url: record.url,
  };
}

function listSidebarBrowserDownloads() {
  return [...sidebarBrowserDownloads.values()]
    .sort((left, right) => right.startedAt - left.startedAt)
    .map(serializeSidebarBrowserDownload);
}

function notifySidebarBrowserDownloads() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("sidebar-browser:downloads-updated", listSidebarBrowserDownloads());
}

function refreshSidebarBrowserDownload(record) {
  const item = record.item;
  record.fileName = item.getFilename() || record.fileName;
  record.filePath = item.getSavePath() || record.filePath;
  record.receivedBytes = item.getReceivedBytes();
  record.totalBytes = item.getTotalBytes();
  record.paused = item.isPaused();
  record.updatedAt = Date.now();
}

function configureSidebarBrowserDownloads() {
  if (sidebarBrowserDownloadsConfigured) return;
  sidebarBrowserDownloadsConfigured = true;
  const browserSession = session.fromPartition(SIDEBAR_BROWSER_PARTITION);
  browserSession.on("will-download", (_event, item) => {
    sidebarBrowserDownloadSequence += 1;
    const id = `download-${Date.now()}-${sidebarBrowserDownloadSequence}`;
    const record = {
      id,
      item,
      fileName: item.getFilename() || "download",
      filePath: item.getSavePath() || "",
      mimeType: item.getMimeType() || "application/octet-stream",
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      state: "progressing",
      paused: item.isPaused(),
      startedAt: Math.round(item.getStartTime() * 1000) || Date.now(),
      updatedAt: Date.now(),
      url: item.getURL() || "",
    };
    sidebarBrowserDownloads.set(id, record);
    while (sidebarBrowserDownloads.size > 100) {
      const oldestId = sidebarBrowserDownloads.keys().next().value;
      sidebarBrowserDownloads.delete(oldestId);
    }
    notifySidebarBrowserDownloads();
    item.on("updated", (_downloadEvent, state) => {
      if (removedSidebarBrowserDownloadIds.has(id)) return;
      refreshSidebarBrowserDownload(record);
      record.state = state || "progressing";
      notifySidebarBrowserDownloads();
    });
    item.once("done", (_downloadEvent, state) => {
      if (removedSidebarBrowserDownloadIds.has(id)) return;
      refreshSidebarBrowserDownload(record);
      record.state = state || "completed";
      notifySidebarBrowserDownloads();
    });
  });
}

function getTemporaryFilesRoot() {
  return join(app.getPath("temp"), "Renge Agent Lab", temporaryFilesDirectoryName);
}

async function getSidebarFilesRoot(scope) {
  if (scope === "workspace") {
    assertWorkspace();
    return workspaceRoot;
  }
  if (scope !== "temporary") throw new Error("未知的文件浏览范围");
  const temporaryRoot = getTemporaryFilesRoot();
  await mkdir(temporaryRoot, { recursive: true });
  return temporaryRoot;
}

async function loadDesktopProjectPositions() {
  try {
    return JSON.parse(await readFile(getDesktopProjectPositionsPath(), "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

async function saveDesktopProjectPositions(positions) {
  if (!positions || typeof positions !== "object" || Array.isArray(positions)) {
    throw new Error("桌面图标位置格式无效");
  }
  const serialized = JSON.stringify(positions);
  if (Buffer.byteLength(serialized, "utf8") > 64 * 1024) {
    throw new Error("桌面图标位置数据过大");
  }
  await mkdir(getPersistentDataDir(), { recursive: true });
  await writeFile(getDesktopProjectPositionsPath(), serialized, "utf8");
  return { ok: true };
}

function getElectronCacheRootDir() {
  if (process.env.RENGE_ELECTRON_CACHE_DIR) {
    return resolve(process.env.RENGE_ELECTRON_CACHE_DIR);
  }

  if (process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "Renge Agent Lab", "ElectronCache");
  }

  return join(getPersistentDataDir(), "ElectronCache");
}

function getElectronSessionDataDir() {
  if (process.env.RENGE_ELECTRON_SESSION_DATA_DIR) {
    return resolve(process.env.RENGE_ELECTRON_SESSION_DATA_DIR);
  }

  if (process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "Renge Agent Lab", "ElectronSessionData");
  }

  return join(getPersistentDataDir(), "ElectronSessionData");
}

function configureElectronStorage() {
  const cacheRootDir = getElectronCacheRootDir();
  const sessionDataDir = getElectronSessionDataDir();
  electronRuntimeCacheDir = join(cacheRootDir, `run-${process.pid}`);
  mkdirSync(sessionDataDir, { recursive: true });
  mkdirSync(electronRuntimeCacheDir, { recursive: true });

  // Session data contains cookies, localStorage, IndexedDB, and service workers.
  // Keep it independent from the per-run cache directory that is removed on exit.
  app.setPath("sessionData", sessionDataDir);
  app.setPath("cache", electronRuntimeCacheDir);
  app.commandLine.appendSwitch("disk-cache-dir", electronRuntimeCacheDir);
  app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
}

if (singleInstanceLockAcquired) configureElectronStorage();

async function flushPersistentSidebarBrowserData() {
  if (!app.isReady()) return;
  const browserSession = session.fromPartition(SIDEBAR_BROWSER_PARTITION);
  browserSession.flushStorageData();
  await browserSession.cookies.flushStore();
}

async function findLegacySidebarBrowserPartitionPaths() {
  const cacheRootDir = getElectronCacheRootDir();
  let runDirectories;
  try {
    runDirectories = await readdir(cacheRootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];
  for (const runDirectory of runDirectories) {
    if (!runDirectory.isDirectory() || !runDirectory.name.startsWith("run-")) continue;
    const runPath = join(cacheRootDir, runDirectory.name);
    let profileDirectories;
    try {
      profileDirectories = await readdir(runPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const profileDirectory of profileDirectories) {
      if (!profileDirectory.isDirectory()) continue;
      const partitionPath = join(
        runPath,
        profileDirectory.name,
        "Partitions",
        SIDEBAR_BROWSER_PARTITION_NAME,
      );
      try {
        const cookieStoreStat = await stat(join(partitionPath, "Network", "Cookies"));
        candidates.push({ path: partitionPath, modifiedAt: cookieStoreStat.mtimeMs });
      } catch {
        // This legacy run did not create a sidebar-browser cookie store.
      }
    }
  }

  return candidates
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .map((candidate) => candidate.path);
}

async function migrateLegacySidebarBrowserCookies() {
  const sessionDataDir = getElectronSessionDataDir();
  const markerPath = join(sessionDataDir, sidebarBrowserMigrationMarkerFilename);
  try {
    await stat(markerPath);
    return;
  } catch {
    // Continue until a legacy store has been migrated successfully.
  }

  const targetSession = session.fromPartition(SIDEBAR_BROWSER_PARTITION);
  const legacyPartitionPaths = await findLegacySidebarBrowserPartitionPaths();
  let copied = 0;
  let foundUsableLegacyStore = false;
  for (const legacyPartitionPath of legacyPartitionPaths) {
    try {
      const sourceSession = session.fromPath(legacyPartitionPath);
      const result = await copyMissingPersistentCookies(
        sourceSession.cookies,
        targetSession.cookies,
      );
      if (result.eligible === 0 || result.eligible === result.failed) continue;
      foundUsableLegacyStore = true;
      copied += result.copied;
    } catch {
      // Try an older complete legacy store when the newest one cannot be opened.
    }
  }
  if (!foundUsableLegacyStore) return;

  targetSession.flushStorageData();
  await targetSession.cookies.flushStore();
  await writeFile(
    markerPath,
    JSON.stringify({ migratedAt: new Date().toISOString(), copied }),
    "utf8",
  );
}

function assertWorkspace() {
  if (!workspaceRoot) {
    throw new Error("尚未选择工作区");
  }
}

function resolveWorkspacePath(inputPath = "") {
  assertWorkspace();
  const rawInput = String(inputPath ?? "").trim();
  if (workspaceFullAccessEnabled) {
    return rawInput ? resolve(workspaceRoot, rawInput) : workspaceRoot;
  }

  const normalizedInput = rawInput.replace(/\\/g, "/").replace(/^\/+/, "");
  const targetPath = resolve(workspaceRoot, normalizedInput);
  const relativePath = relative(workspaceRoot, targetPath);

  if (relativePath.startsWith("..") || relativePath === ".." || targetPath === workspaceRoot) {
    if (targetPath === workspaceRoot) return targetPath;
    throw new Error("路径超出授权工作区");
  }

  return targetPath;
}

function normalizeScriptArgs(args = []) {
  if (!Array.isArray(args)) return [];
  return args.map((arg) => String(arg)).filter((arg) => arg.length > 0);
}

function getNpmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function getGitExecutable() {
  return process.platform === "win32" ? "git.exe" : "git";
}

async function setWorkspaceRoot(nextWorkspaceRoot) {
  const resolvedWorkspaceRoot = resolve(String(nextWorkspaceRoot ?? ""));
  const workspaceStat = await stat(resolvedWorkspaceRoot);
  if (!workspaceStat.isDirectory()) {
    throw new Error("保存的工作区路径不是文件夹");
  }

  workspaceRoot = resolvedWorkspaceRoot;
  return {
    kind: "electron",
    name: workspaceRoot.split(/[\\/]/).pop() || workspaceRoot,
    path: workspaceRoot,
  };
}

function getWhitelistedCommandExecutable(command) {
  const normalizedCommand = String(command ?? "").trim().toLowerCase();
  const executableMap = {
    npm: process.platform === "win32" ? "npm.cmd" : "npm",
    pnpm: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    yarn: process.platform === "win32" ? "yarn.cmd" : "yarn",
    node: process.platform === "win32" ? "node.exe" : "node",
    git: getGitExecutable(),
  };

  return Object.prototype.hasOwnProperty.call(executableMap, normalizedCommand)
    ? executableMap[normalizedCommand]
    : null;
}

function isLikelyTextPath(path) {
  return /\.(cjs|css|csv|env|html|js|json|jsx|md|mjs|scss|ts|tsx|txt|xml|yaml|yml)$/i.test(path);
}

function quoteWindowsCommandArg(arg) {
  const value = String(arg);
  if (!/[ \t&()^|<>"]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function quotePosixCommandArg(arg) {
  const value = String(arg);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function joinShellCommand(command, args) {
  const quoteArg = process.platform === "win32" ? quoteWindowsCommandArg : quotePosixCommandArg;
  return [command, ...args].map(quoteArg).join(" ");
}

function hasShellSyntax(commandLine) {
  return process.platform === "win32"
    ? /(?:&&|\|\||[|<>])/.test(commandLine)
    : /(?:&&|\|\||[|<>;])/.test(commandLine);
}

function getWorkspaceCommandInvocation(command, args) {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args };
  }

  const commandLine = [command, ...args].map(quoteWindowsCommandArg).join(" ");
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", commandLine],
  };
}

async function execWorkspaceFile(command, args, options = {}) {
  assertWorkspace();
  const invocation = getWorkspaceCommandInvocation(command, args);
  const { stdout, stderr } = await execFileAsync(invocation.command, invocation.args, {
    cwd: workspaceRoot,
    timeout: options.timeout ?? 60000,
    windowsHide: true,
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 3,
  });
  return { stdout, stderr };
}

async function execWorkspaceShell(commandLine, options = {}) {
  const invocation = process.platform === "win32"
    ? {
        command: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", String(commandLine)],
      }
    : {
        command: process.env.SHELL || "/bin/sh",
        args: ["-lc", String(commandLine)],
      };
  return execWorkspaceFile(invocation.command, invocation.args, options);
}

async function listFiles(inputPath = "", recursive = true, limit = 500) {
  const startPath = resolveWorkspacePath(inputPath);
  const results = [];

  async function visit(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= limit) return;

      const absolutePath = join(currentPath, entry.name);
      const path = relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
      const kind = entry.isDirectory() ? "directory" : "file";
      results.push({ path, kind });

      if (entry.isDirectory() && recursive) {
        await visit(absolutePath);
      }
    }
  }

  await visit(startPath);
  return results;
}

async function fileInfo(inputPath = "") {
  const targetPath = resolveWorkspacePath(inputPath);
  const targetStat = await stat(targetPath);

  return {
    path: inputPath,
    kind: targetStat.isDirectory() ? "directory" : "file",
    size: targetStat.size,
    createdAt: targetStat.birthtime.toISOString(),
    modifiedAt: targetStat.mtime.toISOString(),
  };
}

async function readFileRange({ path, startLine = 1, endLine }) {
  const content = await readFile(resolveWorkspacePath(path), "utf8");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const safeStartLine = Math.max(1, Math.floor(Number(startLine) || 1));
  const safeEndLine = Math.min(
    lines.length,
    Math.max(safeStartLine, Math.floor(Number(endLine) || safeStartLine + 120)),
  );

  return {
    path,
    startLine: safeStartLine,
    endLine: safeEndLine,
    totalLines: lines.length,
    content: lines.slice(safeStartLine - 1, safeEndLine).join("\n"),
  };
}

async function searchFiles({ query, path = "", includeContent = true }) {
  const normalizedQuery = String(query ?? "").toLowerCase();
  if (!normalizedQuery) throw new Error("query 不能为空");

  const entries = await listFiles(path, true, 700);
  const matches = [];

  for (const entry of entries) {
    if (entry.kind !== "file") continue;

    if (entry.path.toLowerCase().includes(normalizedQuery)) {
      matches.push({ path: entry.path, match: "name" });
      continue;
    }

    if (!includeContent) continue;

    try {
      const content = await readFile(resolveWorkspacePath(entry.path), "utf8");
      const index = content.toLowerCase().indexOf(normalizedQuery);
      if (index >= 0) {
        matches.push({
          path: entry.path,
          match: "content",
          preview: content.slice(Math.max(0, index - 60), index + normalizedQuery.length + 120),
        });
      }
    } catch {
      // Skip binary or unreadable files for content search.
    }

    if (matches.length >= 120) break;
  }

  return matches;
}

async function readPackageJson() {
  const content = await readFile(resolveWorkspacePath("package.json"), "utf8");
  const packageJson = JSON.parse(content);
  return {
    name: packageJson.name,
    scripts: packageJson.scripts ?? {},
    dependencies: packageJson.dependencies ?? {},
    devDependencies: packageJson.devDependencies ?? {},
  };
}

async function detectStack() {
  const entries = await listFiles("", true, 1200);
  const filePaths = new Set(entries.map((entry) => entry.path));
  let packageJson = null;

  try {
    packageJson = await readPackageJson();
  } catch {
    packageJson = null;
  }

  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };
  const dependencyNames = new Set(Object.keys(dependencies));
  const frameworks = [
    dependencyNames.has("react") ? "React" : "",
    dependencyNames.has("vite") ? "Vite" : "",
    dependencyNames.has("electron") ? "Electron" : "",
    dependencyNames.has("next") ? "Next.js" : "",
    dependencyNames.has("vue") ? "Vue" : "",
    dependencyNames.has("svelte") ? "Svelte" : "",
    dependencyNames.has("typescript") || filePaths.has("tsconfig.json") ? "TypeScript" : "",
  ].filter(Boolean);
  const packageManager = filePaths.has("pnpm-lock.yaml")
    ? "pnpm"
    : filePaths.has("yarn.lock")
      ? "yarn"
      : filePaths.has("package-lock.json")
        ? "npm"
        : "unknown";

  return {
    packageManager,
    frameworks,
    scripts: packageJson?.scripts ?? {},
    configFiles: Array.from(filePaths).filter((path) =>
      /^(package\.json|tsconfig.*\.json|vite\.config\.[cm]?[jt]s|next\.config\.[cm]?[jt]s|electron\/|src\/)/.test(path),
    ).slice(0, 160),
  };
}

async function searchRegex({ pattern, path = "", flags = "", maxMatches = 80 }) {
  const rawPattern = String(pattern ?? "");
  if (!rawPattern.trim()) throw new Error("pattern 不能为空");

  const safeFlags = Array.from(new Set(`${String(flags ?? "").replace(/[^imsu]/g, "")}g`)).join("");
  const regex = new RegExp(rawPattern, safeFlags);
  const entries = await listFiles(path, true, 1000);
  const matches = [];

  for (const entry of entries) {
    if (entry.kind !== "file" || !isLikelyTextPath(entry.path)) continue;

    try {
      const content = await readFile(resolveWorkspacePath(entry.path), "utf8");
      const lines = content.replace(/\r\n/g, "\n").split("\n");
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        regex.lastIndex = 0;
        const match = regex.exec(lines[lineIndex]);
        if (!match) continue;
        matches.push({
          path: entry.path,
          line: lineIndex + 1,
          column: match.index + 1,
          text: lines[lineIndex].slice(0, 240),
        });
        if (matches.length >= Number(maxMatches || 80)) return matches;
      }
    } catch {
      // Skip binary or unreadable files.
    }
  }

  return matches;
}

async function scanTodos({ path = "", maxMatches = 120 }) {
  return searchRegex({
    pattern: "\\b(TODO|FIXME|BUG|HACK)\\b[:：]?.*",
    path,
    flags: "i",
    maxMatches,
  });
}

async function gitStatus() {
  const { stdout, stderr } = await execWorkspaceFile(getGitExecutable(), [
    "status",
    "--short",
    "--branch",
  ]);
  return { ok: true, stdout, stderr };
}

async function gitDiff({ path = "", staged = false } = {}) {
  const args = ["diff", ...(staged ? ["--cached"] : [])];
  const normalizedPath = String(path ?? "").trim();
  if (normalizedPath) {
    resolveWorkspacePath(normalizedPath);
    args.push("--", normalizedPath.replace(/\\/g, "/").replace(/^\/+/, ""));
  }

  const { stdout, stderr } = await execWorkspaceFile(getGitExecutable(), args, {
    maxBuffer: 1024 * 1024 * 5,
  });
  return { ok: true, staged: Boolean(staged), path: normalizedPath, stdout, stderr };
}

async function confirmHighRiskGitCommand(command, args) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["授权执行", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: "授权高风险 Git 命令",
    message: "AI 请求执行高风险 Git 命令",
    detail: [
      `工作区：${workspaceRoot}`,
      "",
      `命令：${[command, ...args].join(" ")}`,
      "",
      "该操作可能修改分支、提交历史、工作区文件或远程仓库状态。只有确认这是你想要的操作时才授权。",
    ].join("\n"),
  });

  return result.response === 0;
}

async function confirmUnlistedWorkspaceCommand(commandLine, sessionId) {
  const hasSessionId = Boolean(String(sessionId ?? "").trim());
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: [hasSessionId ? "授权当前会话" : "允许本次运行", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: "批准非白名单命令",
    message: "AI 请求运行非白名单命令",
    detail: [
      `工作目录：${workspaceRoot}`,
      ...(hasSessionId ? [`会话：${sessionId}`] : []),
      "",
      `命令：${commandLine}`,
      "",
      hasSessionId
        ? "批准后，本次应用运行期间，该聊天会话中的非白名单命令将不再重复询问；切换到其他会话仍需单独授权。命令可能读取、修改或删除文件、启动程序或访问网络。"
        : "批准后，该命令会通过系统 Shell 运行，并可能读取、修改或删除文件、启动程序或访问网络。请只批准你理解并信任的命令。",
    ].join("\n"),
  });

  return result.response === 0;
}

async function validateWorkspaceCommand(command, args, alreadyAuthorized = false) {
  const normalizedCommand = String(command ?? "").trim().toLowerCase();
  const firstArg = String(args[0] ?? "").toLowerCase();

  if (!workspaceFullAccessEnabled && !alreadyAuthorized && normalizedCommand === "git") {
    if (highRiskGitCommands.has(firstArg)) {
      const authorized = await confirmHighRiskGitCommand(normalizedCommand, args);
      if (!authorized) {
        return {
          ok: false,
          canceled: true,
          stderr: `用户取消授权高风险 Git 命令：git ${firstArg}`,
        };
      }
    }
  }

  if (normalizedCommand === "node" && args[0] && !String(args[0]).startsWith("-")) {
    resolveWorkspacePath(String(args[0]));
  }

  return { ok: true };
}

async function runWorkspaceCommand({ command, args = [], timeoutMs = 60000, sessionId = "" }) {
  const rawCommandLine = normalizeCommandLine(command, whitelistedCommandNames);
  const hasExplicitArgs = Array.isArray(args) && args.length > 0;
  const commandTokens = hasExplicitArgs
    ? [rawCommandLine, ...args.map((arg) => String(arg))]
    : splitCommandLine(rawCommandLine);
  const rawCommand = commandTokens.shift();
  if (!rawCommand) throw new Error("command 不能为空");

  const whitelistedExecutable = getWhitelistedCommandExecutable(rawCommand);
  const resemblesCommandOutput = looksLikePackageManagerOutput(rawCommand, commandTokens);
  const requiresShell =
    !whitelistedExecutable ||
    resemblesCommandOutput ||
    (!hasExplicitArgs && hasShellSyntax(rawCommandLine));
  const shellCommandLine = hasExplicitArgs
    ? joinShellCommand(rawCommand, commandTokens)
    : rawCommandLine;

  const sessionAlreadyApproved = unlistedCommandApprovalSessions.has(sessionId);
  if (requiresShell && !workspaceFullAccessEnabled && !sessionAlreadyApproved) {
    const authorized = await confirmUnlistedWorkspaceCommand(shellCommandLine, sessionId);
    if (!authorized) {
      return {
        ok: false,
        command: rawCommand,
        args: commandTokens,
        canceled: true,
        stdout: "",
        stderr: `用户取消运行非白名单命令：${shellCommandLine}`,
      };
    }
    unlistedCommandApprovalSessions.approve(sessionId);
  }

  const validation = await validateWorkspaceCommand(rawCommand, commandTokens, requiresShell);
  if (!validation.ok) {
    return {
      ok: false,
      command: rawCommand,
      args: commandTokens,
      canceled: Boolean(validation.canceled),
      stdout: "",
      stderr: validation.stderr ?? "命令未授权执行。",
    };
  }
  const timeout = Math.min(120000, Math.max(1000, Number(timeoutMs) || 60000));

  try {
    const executionOptions = { timeout, maxBuffer: 1024 * 1024 * 4 };
    const { stdout, stderr } = requiresShell
      ? await execWorkspaceShell(shellCommandLine, executionOptions)
      : await execWorkspaceFile(whitelistedExecutable, commandTokens, executionOptions);
    return {
      ok: true,
      command: rawCommand,
      args: commandTokens,
      stdout,
      stderr,
    };
  } catch (error) {
    return {
      ok: false,
      command: rawCommand,
      args: commandTokens,
      exitCode: error?.code ?? null,
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? error?.message ?? "",
    };
  }
}

async function findSymbols({ query = "", path = "", maxMatches = 120 }) {
  const entries = await listFiles(path, true, 1200);
  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  const symbolPattern =
    /^\s*(?:export\s+)?(?:default\s+)?(?:(async)\s+)?(?:(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)|(const|let|var)\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function\s*)?\()/;
  const symbols = [];

  for (const entry of entries) {
    if (entry.kind !== "file" || !isLikelyTextPath(entry.path)) continue;

    try {
      const content = await readFile(resolveWorkspacePath(entry.path), "utf8");
      const lines = content.replace(/\r\n/g, "\n").split("\n");

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const match = symbolPattern.exec(line);
        if (!match) continue;

        const kind = match[2] ?? match[4] ?? "function";
        const name = match[3] ?? match[5] ?? match[6] ?? "";
        if (!name) continue;

        if (
          normalizedQuery &&
          !name.toLowerCase().includes(normalizedQuery) &&
          !line.toLowerCase().includes(normalizedQuery)
        ) {
          continue;
        }

        symbols.push({
          path: entry.path,
          line: lineIndex + 1,
          kind,
          name,
          text: line.trim().slice(0, 240),
        });
        if (symbols.length >= Number(maxMatches || 120)) return symbols;
      }
    } catch {
      // Skip binary or unreadable files.
    }
  }

  return symbols;
}

async function runPackageScript({ script, args = [] }) {
  assertWorkspace();
  const scriptName = String(script ?? "").trim();
  if (!scriptName) throw new Error("script 不能为空");

  const packageJsonPath = resolveWorkspacePath("package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const scripts = packageJson?.scripts ?? {};
  if (!Object.prototype.hasOwnProperty.call(scripts, scriptName)) {
    throw new Error(`package.json 中不存在脚本：${scriptName}`);
  }

  const normalizedArgs = normalizeScriptArgs(args);
  const commandArgs = ["run", scriptName, ...(normalizedArgs.length > 0 ? ["--", ...normalizedArgs] : [])];
  const { stdout, stderr } = await execWorkspaceFile(getNpmExecutable(), commandArgs, {
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 3,
  });

  return {
    ok: true,
    script: scriptName,
    args: normalizedArgs,
    stdout,
    stderr,
  };
}

function registerIpcHandlers() {
  ipcMain.handle("sidebar-terminal:list", (event) => sidebarTerminalManager.list(event));
  ipcMain.handle("sidebar-terminal:create", (event, options = {}) =>
    sidebarTerminalManager.create(event, options));
  ipcMain.handle("sidebar-terminal:write", (event, options = {}) =>
    sidebarTerminalManager.write(event, options));
  ipcMain.handle("sidebar-terminal:resize", (event, options = {}) =>
    sidebarTerminalManager.resize(event, options));
  ipcMain.handle("sidebar-terminal:restart", (event, options = {}) =>
    sidebarTerminalManager.restart(event, options));
  ipcMain.handle("sidebar-terminal:close", (event, options = {}) =>
    sidebarTerminalManager.close(event, options));

  ipcMain.handle("app-data:clear-storage", async () => {
    if (!serverController?.url) throw new Error("应用数据服务尚未启动");
    await session.defaultSession.clearStorageData({
      origin: serverController.url,
      storages: ["localstorage", "indexdb", "cachestorage", "serviceworkers"],
    });
    return { ok: true };
  });

  ipcMain.handle("desktop-layout:load", async () => loadDesktopProjectPositions());

  ipcMain.handle("desktop-layout:save", async (_event, positions = {}) => {
    desktopProjectPositionsWriteQueue = desktopProjectPositionsWriteQueue
      .catch(() => undefined)
      .then(() => saveDesktopProjectPositions(positions));
    return desktopProjectPositionsWriteQueue;
  });

  ipcMain.handle("sidebar-browser:downloads-list", (event) => {
    assertSidebarBrowserSender(event);
    return listSidebarBrowserDownloads();
  });

  ipcMain.handle("sidebar-browser:download-action", async (event, options = {}) => {
    assertSidebarBrowserSender(event);
    const action = String(options.action ?? "");
    if (action === "open-folder") {
      const errorMessage = await shell.openPath(app.getPath("downloads"));
      if (errorMessage) throw new Error(errorMessage);
      return { ok: true };
    }
    if (action === "clear-completed") {
      for (const [id, record] of sidebarBrowserDownloads) {
        if (record.state !== "progressing") {
          removedSidebarBrowserDownloadIds.add(id);
          sidebarBrowserDownloads.delete(id);
        }
      }
      notifySidebarBrowserDownloads();
      return { ok: true };
    }

    const id = String(options.id ?? "");
    const record = sidebarBrowserDownloads.get(id);
    if (!record) throw new Error("找不到这条下载记录");
    if (action === "open") {
      if (!record.filePath) throw new Error("下载文件尚未保存");
      const errorMessage = await shell.openPath(record.filePath);
      if (errorMessage) throw new Error(errorMessage);
    } else if (action === "reveal") {
      if (!record.filePath) throw new Error("下载文件尚未保存");
      shell.showItemInFolder(record.filePath);
    } else if (action === "pause") record.item.pause();
    else if (action === "resume") record.item.resume();
    else if (action === "cancel") record.item.cancel();
    else if (action === "remove") {
      removedSidebarBrowserDownloadIds.add(id);
      sidebarBrowserDownloads.delete(id);
    } else throw new Error("未知的下载操作");
    if (action !== "remove") refreshSidebarBrowserDownload(record);
    notifySidebarBrowserDownloads();
    return { ok: true };
  });

  ipcMain.handle("sidebar-browser:capture", async (event, options = {}) => {
    const target = getSidebarBrowserGuest(event, options.webContentsId);
    const image = await target.capturePage();
    let host = "page";
    try {
      host = new URL(target.getURL()).hostname || "page";
    } catch {
      // Keep the safe fallback name for non-standard pages.
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const defaultName = `${host.replace(/[^a-z0-9._-]+/gi, "-")}-${timestamp}.png`;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: join(app.getPath("pictures"), defaultName),
      filters: [{ name: "PNG 图片", extensions: ["png"] }],
      title: "保存网页截图",
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeFile(result.filePath, image.toPNG());
    return { canceled: false, path: result.filePath };
  });

  ipcMain.handle("sidebar-browser:context-action", async (event, options = {}) => {
    const target = getSidebarBrowserGuest(event, options.webContentsId);
    const action = String(options.action ?? "");
    if (action === "copy-text") {
      const text = String(options.text ?? "").slice(0, 2_000_000);
      clipboard.writeText(text);
      return { ok: true };
    }
    if (action === "open-external") {
      await shell.openExternal(assertExternalBrowserUrl(options.url));
      return { ok: true };
    }
    if (action === "inspect") {
      target.inspectElement(
        Math.max(0, Math.round(Number(options.x) || 0)),
        Math.max(0, Math.round(Number(options.y) || 0)),
      );
      return { ok: true };
    }
    if (action === "capture-element") {
      const image = await target.capturePage(normalizeSidebarBrowserCaptureRect(options.rect));
      return { ok: true, dataUrl: image.toDataURL() };
    }
    if (action === "copy-image") {
      const rawUrl = String(options.url ?? "");
      if (rawUrl.startsWith("data:image/")) {
        if (rawUrl.length > 35 * 1024 * 1024) throw new Error("图片超过 25 MB，无法复制");
        const image = nativeImage.createFromDataURL(rawUrl);
        if (image.isEmpty()) throw new Error("无法解析图片内容");
        clipboard.writeImage(image);
        return { ok: true };
      }
      const url = assertExternalBrowserUrl(rawUrl);
      const response = await target.session.fetch(url, {
        credentials: "include",
        referrer: target.getURL(),
      });
      if (!response.ok) throw new Error(`图片读取失败：${response.status}`);
      const mimeType = String(response.headers.get("content-type") ?? "").toLowerCase();
      if (mimeType && !mimeType.startsWith("image/")) throw new Error("目标地址不是图片");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) throw new Error("图片内容为空");
      if (bytes.length > 25 * 1024 * 1024) throw new Error("图片超过 25 MB，无法复制");
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error("无法解析图片内容");
      clipboard.writeImage(image);
      return { ok: true };
    }
    throw new Error("未知的浏览器右键操作");
  });

  ipcMain.handle("sidebar-browser:device-emulation", (event, options = {}) => {
    const target = getSidebarBrowserGuest(event, options.webContentsId);
    const enabled = Boolean(options.enabled);
    if (enabled) {
      target.enableDeviceEmulation({
        screenPosition: "mobile",
        screenSize: { width: 390, height: 844 },
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 1,
        viewSize: { width: 390, height: 844 },
        scale: 1,
      });
    } else {
      target.disableDeviceEmulation();
    }
    return { enabled };
  });

  ipcMain.handle("sidebar-browser:import-profile", async (event) => {
    assertSidebarBrowserSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [
        { name: "Cookie 或密码文件", extensions: ["json", "csv"] },
      ],
      properties: ["openFile"],
      title: "导入 Cookie 和密码",
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const filePath = result.filePaths[0];
    const fileStat = await stat(filePath);
    if (fileStat.size > 10 * 1024 * 1024) throw new Error("导入文件不能超过 10 MB");
    const parsed = parseSidebarBrowserImport(filePath, await readFile(filePath, "utf8"));
    if (parsed.cookies.length === 0 && parsed.credentials.length === 0) {
      throw new Error("文件中没有可导入的 Cookie 或密码");
    }

    const browserSession = session.fromPartition(SIDEBAR_BROWSER_PARTITION);
    let cookiesImported = 0;
    let cookiesFailed = 0;
    for (const cookie of parsed.cookies) {
      try {
        await browserSession.cookies.set(cookie);
        cookiesImported += 1;
      } catch {
        cookiesFailed += 1;
      }
    }
    if (cookiesImported > 0) await browserSession.cookies.flushStore();

    let passwordsImported = 0;
    if (parsed.credentials.length > 0) {
      const profile = await loadSidebarBrowserProfile();
      const credentials = [...profile.credentials];
      for (const [index, credential] of parsed.credentials.entries()) {
        const storedCredential = {
          id: `credential-${Date.now()}-${index}`,
          name: credential.name,
          origin: credential.origin,
          url: credential.url,
          username: credential.username,
          passwordEncrypted: encryptSidebarBrowserPassword(credential.password),
          updatedAt: Date.now(),
        };
        const existingIndex = credentials.findIndex((candidate) =>
          candidate.origin === storedCredential.origin
          && candidate.username === storedCredential.username);
        if (existingIndex >= 0) credentials[existingIndex] = storedCredential;
        else credentials.push(storedCredential);
        passwordsImported += 1;
      }
      await saveSidebarBrowserProfile({ ...profile, credentials });
    }
    return {
      canceled: false,
      cookiesImported,
      cookiesFailed,
      passwordsImported,
    };
  });

  ipcMain.handle("sidebar-browser:profile", async (event) => {
    assertSidebarBrowserSender(event);
    return sidebarBrowserProfileSummary(await loadSidebarBrowserProfile());
  });

  ipcMain.handle("sidebar-browser:profile-setting", async (event, options = {}) => {
    assertSidebarBrowserSender(event);
    const profile = await loadSidebarBrowserProfile();
    const nextProfile = {
      ...profile,
      settings: {
        ...profile.settings,
        autofillPasswords: options.autofillPasswords !== false,
      },
    };
    await saveSidebarBrowserProfile(nextProfile);
    return sidebarBrowserProfileSummary(nextProfile);
  });

  ipcMain.handle("sidebar-browser:autofill", async (event, options = {}) => {
    const target = getSidebarBrowserGuest(event, options.webContentsId);
    const profile = await loadSidebarBrowserProfile();
    if (!profile.settings.autofillPasswords) return null;
    const credential = selectCredentialForUrl(profile.credentials, target.getURL());
    if (!credential) return null;
    const password = decryptSidebarBrowserPassword(credential.passwordEncrypted);
    if (!password) return null;
    return {
      name: credential.name,
      origin: credential.origin,
      username: credential.username,
      password,
    };
  });

  ipcMain.handle("sidebar-browser:clear-data", async (event, options = {}) => {
    assertSidebarBrowserSender(event);
    const action = String(options.action ?? "all");
    const browserSession = session.fromPartition(SIDEBAR_BROWSER_PARTITION);
    if (action === "cache" || action === "all") await browserSession.clearCache();
    if (action === "cookies" || action === "all") {
      await browserSession.clearStorageData({
        storages: [
          "cookies",
          "filesystem",
          "indexdb",
          "localstorage",
          "serviceworkers",
          "cachestorage",
          "websql",
        ],
      });
    }
    if (action === "passwords") {
      const profile = await loadSidebarBrowserProfile();
      await saveSidebarBrowserProfile({ ...profile, credentials: [] });
    }
    if (action === "history" || action === "all") {
      for (const contents of webContents.getAllWebContents()) {
        if (contents.getType() === "webview" && contents.session === browserSession) {
          contents.navigationHistory?.clear?.();
        }
      }
    }
    browserSession.flushStorageData();
    return sidebarBrowserProfileSummary(await loadSidebarBrowserProfile());
  });

  ipcMain.handle("sidebar-files:list", async (_event, options = {}) => {
    const rootPath = await getSidebarFilesRoot(options.scope ?? "temporary");
    return listSidebarFiles(rootPath, options.path ?? "", {
      recursive: Boolean(options.recursive),
    });
  });

  ipcMain.handle("sidebar-files:read-text", async (_event, options = {}) => {
    const rootPath = await getSidebarFilesRoot(options.scope ?? "temporary");
    return readSidebarTextFile(rootPath, options.path ?? "");
  });

  ipcMain.handle("sidebar-files:read-binary", async (_event, options = {}) => {
    const rootPath = await getSidebarFilesRoot(options.scope ?? "temporary");
    return readSidebarBinaryFile(rootPath, options.path ?? "");
  });

  ipcMain.handle("sidebar-files:import-temporary", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      title: "添加临时文件",
    });
    if (result.canceled || result.filePaths.length === 0) return { imported: [] };
    const rootPath = await getSidebarFilesRoot("temporary");
    return {
      rootPath,
      imported: await importTemporaryFiles(rootPath, result.filePaths),
    };
  });

  ipcMain.handle("sidebar-files:system-action", async (_event, options = {}) => {
    const rootPath = await getSidebarFilesRoot(options.scope ?? "temporary");
    const targetPath = resolveSidebarFilePath(rootPath, options.path ?? "");
    const action = String(options.action ?? "default");
    if (action === "reveal") {
      shell.showItemInFolder(targetPath);
      return { ok: true, path: targetPath };
    }
    if (action === "openWith" && process.platform === "win32") {
      const child = execFile(
        "rundll32.exe",
        ["shell32.dll,OpenAs_RunDLL", targetPath],
        { windowsHide: false },
        () => undefined,
      );
      child.unref();
      return { ok: true, path: targetPath };
    }
    const errorMessage = await shell.openPath(targetPath);
    if (errorMessage) throw new Error(errorMessage);
    return { ok: true, path: targetPath };
  });

  ipcMain.handle("workspace:select", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "选择 AI 可操作的工作区",
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    return setWorkspaceRoot(result.filePaths[0]);
  });

  ipcMain.handle("skill:select-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "选择 Skill 文件夹",
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    return {
      path: result.filePaths[0],
      name: result.filePaths[0].split(/[\\/]/).filter(Boolean).at(-1) || result.filePaths[0],
    };
  });

  ipcMain.handle("workspace:restore", async (_event, options = {}) =>
    setWorkspaceRoot(options.path),
  );

  ipcMain.handle("workspace:set-full-access", async (_event, options = {}) => {
    workspaceFullAccessEnabled = Boolean(options.enabled);
    return { enabled: workspaceFullAccessEnabled };
  });

  ipcMain.handle("workspace:list", async (_event, options = {}) =>
    listFiles(options.path ?? "", options.recursive ?? true),
  );

  ipcMain.handle("workspace:read", async (_event, options = {}) => ({
    path: options.path,
    content: await readFile(resolveWorkspacePath(options.path), "utf8"),
  }));

  ipcMain.handle("workspace:read-binary", async (_event, options = {}) => {
    const targetPath = resolveWorkspacePath(options.path);
    const content = await readFile(targetPath);
    const info = await stat(targetPath);
    return {
      path: options.path,
      size: info.size,
      base64: content.toString("base64"),
    };
  });

  ipcMain.handle("workspace:read-range", async (_event, options = {}) =>
    readFileRange(options),
  );

  ipcMain.handle("workspace:info", async (_event, options = {}) =>
    fileInfo(options.path ?? ""),
  );

  ipcMain.handle("workspace:search", async (_event, options = {}) => searchFiles(options));

  ipcMain.handle("workspace:detect-stack", async () => detectStack());

  ipcMain.handle("workspace:search-regex", async (_event, options = {}) => searchRegex(options));

  ipcMain.handle("workspace:package-json", async () => readPackageJson());

  ipcMain.handle("workspace:todos", async (_event, options = {}) => scanTodos(options));

  ipcMain.handle("workspace:mkdir", async (_event, options = {}) => {
    const targetPath = resolveWorkspacePath(options.path);
    await mkdir(targetPath, { recursive: true });
    return { ok: true, path: options.path, operation: "mkdir" };
  });

  ipcMain.handle("workspace:rename", async (_event, options = {}) => {
    const fromPath = resolveWorkspacePath(options.from);
    const toPath = resolveWorkspacePath(options.to);
    await mkdir(dirname(toPath), { recursive: true });
    await rename(fromPath, toPath);
    return { ok: true, from: options.from, to: options.to, operation: "rename" };
  });

  ipcMain.handle("workspace:write", async (_event, options = {}) => {
    const targetPath = resolveWorkspacePath(options.path);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, String(options.content ?? ""), "utf8");
    return { ok: true, path: options.path, operation: "write" };
  });

  ipcMain.handle("workspace:write-binary", async (_event, options = {}) => {
    const targetPath = resolveWorkspacePath(options.path);
    const base64 = String(options.base64 ?? "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    const content = Buffer.from(base64, "base64");
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
    return { ok: true, path: options.path, operation: "writeBinary", bytes: content.length };
  });

  ipcMain.handle("workspace:edit", async (_event, options = {}) => {
    const targetPath = resolveWorkspacePath(options.path);
    const find = String(options.find ?? "");
    if (!find) throw new Error("find 不能为空");

    const originalContent = await readFile(targetPath, "utf8");
    if (!originalContent.includes(find)) {
      throw new Error("没有找到要替换的文本");
    }

    const nextContent = originalContent.split(find).join(String(options.replace ?? ""));
    await writeFile(targetPath, nextContent, "utf8");
    return {
      ok: true,
      path: options.path,
      operation: "edit",
      replacements: originalContent.split(find).length - 1,
      bytes: Buffer.byteLength(nextContent, "utf8"),
    };
  });

  ipcMain.handle("workspace:delete", async (_event, options = {}) => {
    const targetPath = resolveWorkspacePath(options.path);
    const targetStat = await stat(targetPath);
    await rm(targetPath, {
      recursive: Boolean(options.recursive) && targetStat.isDirectory(),
      force: false,
    });
    return { ok: true, path: options.path, operation: "delete" };
  });

  ipcMain.handle("workspace:run-script", async (_event, options = {}) =>
    runPackageScript(options),
  );

  ipcMain.handle("workspace:run-command", async (_event, options = {}) =>
    runWorkspaceCommand(options),
  );

  ipcMain.handle("workspace:git-status", async () => gitStatus());

  ipcMain.handle("workspace:git-diff", async (_event, options = {}) => gitDiff(options));

  ipcMain.handle("workspace:find-symbols", async (_event, options = {}) => findSymbols(options));
}

async function createMainWindow() {
  const serverOptions = {
    host: "127.0.0.1",
    dataDir: getPersistentDataDir(),
  };
  try {
    serverController = await startRengeServer({
      ...serverOptions,
      port: desktopServerPort,
    });
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EADDRINUSE") throw error;
    serverController = await startRengeServer({ ...serverOptions, port: 0 });
  }

  Menu.setApplicationMenu(null);
  configureSidebarBrowserDownloads();

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    title: "Renge Agent Lab",
    icon: appIconPath,
    backgroundColor: "#f5f7fa",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    if (!isAllowedSidebarBrowserUrl(params.src)) event.preventDefault();
  });

  mainWindow.webContents.on("did-attach-webview", (_event, guestContents) => {
    guestContents.on("context-menu", (contextEvent, params) => {
      contextEvent.preventDefault();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const cursorPoint = screen.getCursorScreenPoint();
      const contentBounds = mainWindow.getContentBounds();
      const rendererZoomFactor = mainWindow.webContents.getZoomFactor() || 1;
      mainWindow.webContents.send("sidebar-browser:context-menu", {
        sourceWebContentsId: guestContents.id,
        x: params.x,
        y: params.y,
        hostX: (cursorPoint.x - contentBounds.x) / rendererZoomFactor,
        hostY: (cursorPoint.y - contentBounds.y) / rendererZoomFactor,
        pageUrl: params.pageURL,
        frameUrl: params.frameURL,
        linkUrl: params.linkURL,
        sourceUrl: params.srcURL,
        mediaType: params.mediaType,
        selectionText: params.selectionText,
        isEditable: params.isEditable,
      });
    });
    guestContents.setWindowOpenHandler(
      createSidebarBrowserWindowOpenHandler(guestContents.id, (request) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("sidebar-browser:open-tab", {
          sourceWebContentsId: request.sourceWebContentsId,
          url: request.url,
        });
      }),
    );
    const preventDisallowedNavigation = (navigationEvent, url) => {
      if (!isAllowedSidebarBrowserUrl(url)) navigationEvent.preventDefault();
    };
    guestContents.on("will-navigate", preventDisallowedNavigation);
    guestContents.on("will-redirect", preventDisallowedNavigation);
  });

  mainWindow.removeMenu();

  await mainWindow.loadURL(serverController.url);
}

if (!singleInstanceLockAcquired) {
  app.quit();
} else {
  registerIpcHandlers();

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.renge.agentlab");
    }
    await migrateLegacySidebarBrowserCookies().catch(() => undefined);
    return createMainWindow();
  });

  app.on("window-all-closed", () => {
    serverController?.server.close();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (persistentBrowserDataFlushed || !app.isReady()) return;
    event.preventDefault();
    persistentBrowserDataFlushed = true;
    void flushPersistentSidebarBrowserData()
      .catch(() => undefined)
      .finally(() => app.quit());
  });

  app.on("will-quit", () => {
    sidebarTerminalManager.disposeAll();
    if (!electronRuntimeCacheDir) return;
    void rm(electronRuntimeCacheDir, { recursive: true, force: true }).catch(() => undefined);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}
