import { app, BrowserWindow, dialog, ipcMain, Menu, session } from "electron";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { startRengeServer } from "../server.mjs";
import {
  looksLikePackageManagerOutput,
  normalizeCommandLine,
  splitCommandLine,
} from "./command-policy.mjs";

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
let desktopProjectPositionsWriteQueue = Promise.resolve();
const desktopServerPort = 5191;
const desktopProjectPositionsFilename = "desktop-project-positions.json";
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

function getPersistentDataDir() {
  if (process.env.RENGE_DATA_DIR) return resolve(process.env.RENGE_DATA_DIR);
  if (process.env.APPDATA) return join(process.env.APPDATA, "Renge Agent Lab");
  return join(app.getPath("home"), ".renge-agent-lab");
}

function getDesktopProjectPositionsPath() {
  return join(getPersistentDataDir(), desktopProjectPositionsFilename);
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

function configureElectronCache() {
  const cacheRootDir = getElectronCacheRootDir();
  electronRuntimeCacheDir = join(cacheRootDir, `run-${process.pid}`);
  mkdirSync(electronRuntimeCacheDir, { recursive: true });

  app.setPath("cache", electronRuntimeCacheDir);
  app.commandLine.appendSwitch("disk-cache-dir", electronRuntimeCacheDir);
  app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
}

if (singleInstanceLockAcquired) configureElectronCache();

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

async function confirmUnlistedWorkspaceCommand(commandLine) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["允许本次运行", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: "批准非白名单命令",
    message: "AI 请求运行非白名单命令",
    detail: [
      `工作目录：${workspaceRoot}`,
      "",
      `命令：${commandLine}`,
      "",
      "批准后，该命令会通过系统 Shell 运行，并可能读取、修改或删除文件、启动程序或访问网络。请只批准你理解并信任的命令。",
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

async function runWorkspaceCommand({ command, args = [], timeoutMs = 60000 }) {
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

  if (requiresShell && !workspaceFullAccessEnabled) {
    const authorized = await confirmUnlistedWorkspaceCommand(shellCommandLine);
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
    },
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

  app.whenReady().then(() => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.renge.agentlab");
    }
    return createMainWindow();
  });

  app.on("window-all-closed", () => {
    serverController?.server.close();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    if (!electronRuntimeCacheDir) return;
    void rm(electronRuntimeCacheDir, { recursive: true, force: true }).catch(() => undefined);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}
