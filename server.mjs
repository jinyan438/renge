import { createServer } from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, networkInterfaces, tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(__dirname, "dist");
const defaultPort = Number(process.env.PORT ?? 5190);
const appDataFileName = "app-data.json";
const appDataBackupCount = 3;
const appDataWriteQueues = new Map();
const mcpClientCache = new Map();

const mimeTypes = {
  ".html": "text/html;charset=utf-8",
  ".js": "text/javascript;charset=utf-8",
  ".mjs": "text/javascript;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".json": "application/json;charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const tavernCompatModulePaths = new Set([
  "/script.js",
  "/lib.js",
  "/scripts/world-info.js",
  "/scripts/st-context.js",
  "/scripts/extensions.js",
  "/scripts/extensions/regex/engine.js",
  "/scripts/power-user.js",
  "/scripts/utils.js",
  "/scripts/group-chats.js",
  "/scripts/openai.js",
  "/scripts/tokenizers.js",
  "/scripts/reasoning.js",
  "/scripts/events.js",
  "/scripts/popup.js",
  "/scripts/slash-commands.js",
  "/scripts/slash-commands/SlashCommand.js",
  "/scripts/slash-commands/SlashCommandArgument.js",
  "/scripts/slash-commands/SlashCommandParser.js",
  "/api/st-context.js",
  "/api/world-info.js",
  "/api/extensions.js",
  "/api/power-user.js",
  "/api/utils.js",
  "/api/group-chats.js",
  "/api/openai.js",
  "/api/tokenizers.js",
  "/api/reasoning.js",
  "/api/events.js",
  "/api/popup.js",
  "/api/slash-commands.js",
  "/api/slash-commands/SlashCommand.js",
  "/api/slash-commands/SlashCommandArgument.js",
  "/api/slash-commands/SlashCommandParser.js",
]);

const tavernCompatModuleSource = `
const compat = globalThis.__rengeTavernCompat ?? {};
export const getContext = (...args) => compat.getContext?.(...args) ?? globalThis.SillyTavern?.getContext?.(...args);
export const eventSource = globalThis.eventSource ?? compat.eventSource;
export const event_types = globalThis.event_types ?? compat.event_types ?? {};
export const extension_settings = globalThis.extension_settings ?? compat.extension_settings ?? {};
export const saveSettingsDebounced = (...args) => globalThis.saveSettingsDebounced?.(...args);
export const saveChatDebounced = (...args) => globalThis.saveChatDebounced?.(...args);
export const getRequestHeaders = (...args) => globalThis.getRequestHeaders?.(...args) ?? { "Content-Type": "application/json" };
export const oai_settings = globalThis.chatCompletionSettings
  ?? globalThis.chat_completion_settings
  ?? globalThis.SillyTavern?.chatCompletionSettings
  ?? {};
export const chatCompletionSettings = oai_settings;
export const chat_completion_settings = oai_settings;
export const getChatCompletionModel = (...args) => globalThis.SillyTavern?.getChatCompletionModel?.(...args)
  ?? oai_settings.custom_model
  ?? oai_settings.model
  ?? oai_settings.openai_model
  ?? oai_settings.model_openai
  ?? "";
export const getWorldInfo = (...args) => compat.getWorldInfo?.(...args);
export let world_info_data = globalThis.world_info_data ?? compat.world_info_data ?? {};
export const worldInfoData = world_info_data;
export const world_info = globalThis.world_info ?? compat.world_info ?? { worldInfoData: world_info_data, world_info: world_info_data };
export const worldInfo = world_info;
export const world_names = globalThis.world_names ?? compat.world_names ?? [];
export const loadWorldInfo = async (name) => {
  const loaded = await compat.loadWorldInfo?.(name);
  if (loaded && typeof loaded === "object") {
    Object.keys(world_info_data).forEach((key) => delete world_info_data[key]);
    Object.assign(world_info_data, loaded);
  }
  return loaded;
};
const createContextArray = (property) => new Proxy([], {
  get: (_target, key) => {
    const current = Array.isArray(getContext()?.[property]) ? getContext()[property] : [];
    const value = Reflect.get(current, key, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
});
export const chat = createContextArray("chat");
export const characters = createContextArray("characters");
export const groups = createContextArray("groups");
export const this_chid = getContext()?.characterId;
export const name1 = getContext()?.name1 ?? "User";
export const name2 = getContext()?.name2 ?? "Assistant";
export const power_user = globalThis.power_user ?? {};
export const extension_prompt_types = globalThis.extension_prompt_types ?? {};
export const extension_prompt_roles = globalThis.extension_prompt_roles ?? {};
export const substituteParams = (value) => String(value ?? "")
  .replaceAll("{{user}}", String(getContext()?.name1 ?? "User"))
  .replaceAll("{{char}}", String(getContext()?.name2 ?? "Assistant"));
export const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, Number(milliseconds) || 0));
export const debounce = (callback, milliseconds = 0) => globalThis._?.debounce
  ? globalThis._.debounce(callback, milliseconds)
  : (...args) => setTimeout(() => callback(...args), milliseconds);
export const uuidv4 = () => globalThis.crypto?.randomUUID?.() ?? String(Date.now());
export const getThumbnailUrl = (_type, path) => path;
export const getRegexedString = (value) => String(value ?? "");
export const regex_placement = {};
export const callPopup = async (content) => globalThis.confirm?.(String(content ?? ""));
export const callGenericPopup = callPopup;
export const POPUP_TYPE = { TEXT: "text", CONFIRM: "confirm", INPUT: "input", DISPLAY: "display" };
export class Popup {
  constructor(content = "", type = POPUP_TYPE.TEXT, options = {}) {
    this.content = content;
    this.type = type;
    this.options = options;
  }
  async show() { return callPopup(this.content); }
}
export class SlashCommand {
  constructor(properties = {}) { Object.assign(this, properties); }
  static fromProps(properties = {}) { return new SlashCommand(properties); }
}
export class SlashCommandArgument {
  constructor(properties = {}) { Object.assign(this, properties); }
  static fromProps(properties = {}) { return new SlashCommandArgument(properties); }
}
export const ARGUMENT_TYPE = { STRING: "string", NUMBER: "number", BOOLEAN: "boolean", LIST: "list" };
export const SlashCommandParser = {
  addCommandObject: (command) => compat.registerSlashCommand?.(command) ?? command,
};
export const executeSlashCommandsWithOptions = (command) => compat.TavernHelper?.triggerSlash?.(command);
export const getTokenCountAsync = async (value) => Math.ceil(String(value ?? "").length / 4);
export default compat;
`;

function sendTavernCompatModule(response) {
  response.writeHead(200, {
    "Content-Type": "text/javascript;charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(tavernCompatModuleSource);
}

function sendJson(response, statusCode, payload) {
  if (response.headersSent) {
    if (!response.writableEnded) response.end();
    return;
  }
  response.writeHead(statusCode, {
    "Content-Type": "application/json;charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept",
  });
  response.end(JSON.stringify(payload));
}

function sendOptions(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept",
    "Access-Control-Max-Age": "86400",
  });
  response.end();
}

function getContentDispositionFileName(path) {
  const name = String(path ?? "").split(/[\\/]/).filter(Boolean).at(-1) || "download";
  return encodeURIComponent(name).replace(/['()]/g, (match) =>
    `%${match.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function getAsciiDownloadFileName(path) {
  const name = String(path ?? "").split(/[\\/]/).filter(Boolean).at(-1) || "download";
  const fallback = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_").trim();
  return fallback || "download";
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

function compactError(error) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function shortHash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function sanitizeToolNamePart(value, fallback = "tool") {
  const sanitized = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || fallback;
}

function buildMcpToolAlias(serverName, toolName) {
  const serverPart = sanitizeToolNamePart(serverName, "server");
  const toolPart = sanitizeToolNamePart(toolName, "tool");
  const rawAlias = `mcp_${serverPart}_${toolPart}`;
  if (rawAlias.length <= 64) return rawAlias;
  const suffix = shortHash(`${serverName}:${toolName}`);
  return `${rawAlias.slice(0, 55)}_${suffix}`;
}

function normalizeStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, mapValue]) => mapValue !== undefined && mapValue !== null)
      .map(([key, mapValue]) => [String(key), String(mapValue)]),
  );
}

function normalizeMcpServerConfig(rawServer, fallbackName = "mcp") {
  const source = rawServer && typeof rawServer === "object" ? rawServer : {};
  const name = String(source.name ?? fallbackName).trim() || fallbackName;
  const url = String(source.url ?? source.baseUrl ?? "").trim();
  const command = String(source.command ?? "").trim();
  const rawTransport = String(source.transport ?? source.type ?? "").toLowerCase();
  const transport =
    rawTransport === "http" ||
    rawTransport === "streamablehttp" ||
    rawTransport === "streamable_http" ||
    rawTransport === "sse" ||
    (url && !command)
      ? "http"
      : "stdio";

  return {
    id: String(source.id ?? name),
    name,
    enabled: source.disabled === true ? false : source.enabled !== false,
    transport,
    command,
    args: Array.isArray(source.args) ? source.args.map(String) : [],
    cwd: source.cwd ? String(source.cwd) : "",
    env: normalizeStringMap(source.env),
    url,
    headers: normalizeStringMap(source.headers),
  };
}

function normalizeMcpServerConfigs(rawServers) {
  const source = rawServers && typeof rawServers === "object" && "mcpServers" in rawServers
    ? rawServers.mcpServers
    : rawServers;

  if (Array.isArray(source)) {
    return source.map((server, index) => normalizeMcpServerConfig(server, `server_${index + 1}`));
  }

  if (source && typeof source === "object") {
    return Object.entries(source).map(([name, server]) => {
      const rawServer = server && typeof server === "object" ? server : {};
      return normalizeMcpServerConfig({ name, ...rawServer }, name);
    });
  }

  return [];
}

function getMcpClientCacheKey(server) {
  return JSON.stringify({
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    env: server.env,
    url: server.url,
    headers: server.headers,
  });
}

function parseSseJsonPayload(text) {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  if (dataLines.length === 0) return null;
  return JSON.parse(dataLines.join("\n"));
}

function quoteWindowsCommandArg(value) {
  const arg = String(value ?? "");
  if (arg.length === 0) return '""';
  if (!/[\s"&|<>^]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function getStdioSpawnInvocation(command, args) {
  if (process.platform !== "win32") {
    return {
      command,
      args,
      shell: false,
    };
  }

  const commandLine = [command, ...args].map(quoteWindowsCommandArg).join(" ");
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", commandLine],
    shell: false,
  };
}

class HttpMcpClient {
  constructor(server) {
    this.server = server;
    this.nextId = 1;
    this.sessionId = "";
    this.initialized = false;
  }

  async connect() {
    if (this.initialized) return;
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "Renge Agent Lab",
        version: "0.1.0",
      },
    });
    await this.notify("notifications/initialized", {});
    this.initialized = true;
  }

  async post(message, expectResponse) {
    const response = await fetch(this.server.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...this.server.headers,
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      },
      body: JSON.stringify(message),
    });
    const responseSessionId = response.headers.get("mcp-session-id");
    if (responseSessionId) this.sessionId = responseSessionId;
    const text = await response.text();

    if (!response.ok) {
      throw new Error(text || `HTTP MCP request failed: ${response.status}`);
    }

    if (!expectResponse || !text.trim()) return {};

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("text/event-stream")
      ? parseSseJsonPayload(text)
      : JSON.parse(text);

    if (!payload) return {};
    if (payload.error) {
      throw new Error(payload.error.message || JSON.stringify(payload.error));
    }
    return payload.result ?? {};
  }

  request(method, params = {}) {
    return this.post(
      {
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        params,
      },
      true,
    );
  }

  notify(method, params = {}) {
    return this.post(
      {
        jsonrpc: "2.0",
        method,
        params,
      },
      false,
    );
  }

  isMissingSessionError(error) {
    return error instanceof Error && /Session not found/i.test(error.message);
  }

  async resetSessionAndRetry(operation) {
    this.sessionId = "";
    this.initialized = false;
    await this.connect();
    return operation();
  }

  async listTools(retryOnMissingSession = true) {
    await this.connect();
    try {
      const tools = [];
      let cursor;
      do {
        const result = await this.request("tools/list", cursor ? { cursor } : {});
        tools.push(...(Array.isArray(result.tools) ? result.tools : []));
        cursor = result.nextCursor;
      } while (cursor);
      return tools;
    } catch (error) {
      if (retryOnMissingSession && this.isMissingSessionError(error)) {
        return this.resetSessionAndRetry(() => this.listTools(false));
      }
      throw error;
    }
  }

  async callTool(name, args, retryOnMissingSession = true) {
    await this.connect();
    try {
      return await this.request("tools/call", {
        name,
        arguments: args && typeof args === "object" ? args : {},
      });
    } catch (error) {
      if (retryOnMissingSession && this.isMissingSessionError(error)) {
        return this.resetSessionAndRetry(() => this.callTool(name, args, false));
      }
      throw error;
    }
  }

  close() {
    this.initialized = false;
  }
}

class StdioMcpClient {
  constructor(server) {
    this.server = server;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = Buffer.alloc(0);
    this.stderrText = "";
    this.child = null;
    this.initialized = false;
  }

  async connect() {
    if (this.initialized && this.child && !this.child.killed) return;
    if (!this.server.command) throw new Error(`MCP 服务器「${this.server.name}」缺少 command`);

    const invocation = getStdioSpawnInvocation(this.server.command, this.server.args);

    this.child = spawn(invocation.command, invocation.args, {
      cwd: this.server.cwd || undefined,
      env: {
        ...process.env,
        ...this.server.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: invocation.shell,
    });

    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderrText = `${this.stderrText}${Buffer.from(chunk).toString("utf8")}`.slice(-4000);
    });
    this.child.once("error", (error) => {
      this.rejectAll(error);
    });
    this.child.once("exit", (code, signal) => {
      if (!this.initialized) return;
      this.initialized = false;
      this.rejectAll(new Error(`MCP 服务器已退出：code=${code ?? "null"} signal=${signal ?? "null"}`));
    });

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "Renge Agent Lab",
        version: "0.1.0",
      },
    });
    this.notify("notifications/initialized", {});
    this.initialized = true;
  }

  rejectAll(error) {
    for (const { reject, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    this.pending.clear();
  }

  handleStdout(chunk) {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, Buffer.from(chunk)]);

    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
      const lineEnd = this.stdoutBuffer.indexOf("\n");

      if (headerEnd >= 0 && (lineEnd < 0 || headerEnd < lineEnd)) {
        const headerText = this.stdoutBuffer.slice(0, headerEnd).toString("utf8");
        const lengthMatch = /content-length:\s*(\d+)/i.exec(headerText);
        if (!lengthMatch) {
          this.stdoutBuffer = this.stdoutBuffer.slice(headerEnd + 4);
          continue;
        }

        const contentLength = Number(lengthMatch[1]);
        const messageStart = headerEnd + 4;
        const messageEnd = messageStart + contentLength;
        if (this.stdoutBuffer.length < messageEnd) return;

        const messageText = this.stdoutBuffer.slice(messageStart, messageEnd).toString("utf8");
        this.stdoutBuffer = this.stdoutBuffer.slice(messageEnd);

        try {
          this.handleMessage(JSON.parse(messageText));
        } catch {
          // Ignore malformed protocol frames.
        }
        continue;
      }

      if (lineEnd < 0) return;

      const messageText = this.stdoutBuffer.slice(0, lineEnd).toString("utf8").replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(lineEnd + 1);
      if (!messageText.trim()) continue;

      try {
        this.handleMessage(JSON.parse(messageText));
      } catch {
        // Ignore malformed protocol frames.
      }
    }
  }

  handleMessage(message) {
    if (!message || typeof message !== "object" || !("id" in message)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      return;
    }

    pending.resolve(message.result ?? {});
  }

  writeMessage(message) {
    if (!this.child?.stdin || this.child.stdin.destroyed) {
      throw new Error(`MCP 服务器「${this.server.name}」未运行`);
    }
    const payload = JSON.stringify(message);
    this.child.stdin.write(`${payload}\n`);
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(
          new Error(
            `MCP 请求超时：${this.server.name}/${method}${
              this.stderrText.trim() ? `\n${this.stderrText.trim()}` : ""
            }`,
          ),
        );
      }, 30000);
      this.pending.set(id, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timeout,
      });

      try {
        this.writeMessage(message);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        rejectRequest(error);
      }
    });
  }

  notify(method, params = {}) {
    this.writeMessage({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  async listTools() {
    await this.connect();
    const tools = [];
    let cursor;
    do {
      const result = await this.request("tools/list", cursor ? { cursor } : {});
      tools.push(...(Array.isArray(result.tools) ? result.tools : []));
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name, args) {
    await this.connect();
    return this.request("tools/call", {
      name,
      arguments: args && typeof args === "object" ? args : {},
    });
  }

  close() {
    this.initialized = false;
    this.rejectAll(new Error("MCP client closed"));
    this.child?.kill();
  }
}

function getMcpClient(server) {
  const key = getMcpClientCacheKey(server);
  const cachedClient = mcpClientCache.get(key);
  if (cachedClient) return cachedClient;

  const client = server.transport === "http"
    ? new HttpMcpClient(server)
    : new StdioMcpClient(server);
  mcpClientCache.set(key, client);
  return client;
}

function normalizeMcpToolSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  return schema;
}

async function listMcpTools(rawServers) {
  const servers = normalizeMcpServerConfigs(rawServers).filter((server) => server.enabled);
  const tools = [];
  const errors = [];

  for (const server of servers) {
    try {
      const client = getMcpClient(server);
      const serverTools = await client.listTools();
      for (const tool of serverTools) {
        const originalName = String(tool.name ?? "").trim();
        if (!originalName) continue;
        tools.push({
          type: "function",
          function: {
            name: buildMcpToolAlias(server.name, originalName),
            description: `[MCP:${server.name}] ${String(tool.description ?? originalName)}`,
            parameters: normalizeMcpToolSchema(tool.inputSchema),
          },
          serverId: server.id,
          serverName: server.name,
          originalName,
        });
      }
    } catch (error) {
      errors.push({
        serverId: server.id,
        serverName: server.name,
        error: compactError(error),
      });
    }
  }

  return { tools, errors };
}

async function callMcpTool(rawServers, toolName, args) {
  const servers = normalizeMcpServerConfigs(rawServers).filter((server) => server.enabled);

  for (const server of servers) {
    const client = getMcpClient(server);
    const serverTools = await client.listTools();
    const tool = serverTools.find((candidate) => {
      const originalName = String(candidate.name ?? "").trim();
      return originalName && buildMcpToolAlias(server.name, originalName) === toolName;
    });
    if (!tool) continue;

    return {
      ok: true,
      serverId: server.id,
      serverName: server.name,
      toolName: tool.name,
      result: await client.callTool(tool.name, args),
    };
  }

  throw new Error(`没有找到启用的 MCP 工具：${toolName}`);
}

function getDefaultDataDir() {
  if (process.env.RENGE_DATA_DIR) return resolve(process.env.RENGE_DATA_DIR);
  if (process.env.APPDATA) return join(process.env.APPDATA, "Renge Agent Lab");
  return join(homedir(), ".renge-agent-lab");
}

function isMissingFileError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function parseAppDataContent(content) {
  if (!content.trim()) throw new Error("应用数据文件为空");
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("应用数据必须是 JSON 对象");
  }
  return parsed;
}

function getAppDataBackupPath(dataFilePath, index) {
  return join(dirname(dataFilePath), `app-data.backup-${index}.json`);
}

async function readAppDataFile(dataFilePath) {
  return parseAppDataContent(await readFile(dataFilePath, "utf8"));
}

async function writeAppDataFileAtomically(dataFilePath, payload) {
  const serialized = JSON.stringify(payload, null, 2);
  parseAppDataContent(serialized);
  await mkdir(dirname(dataFilePath), { recursive: true });
  const temporaryPath = `${dataFilePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporaryPath, serialized, "utf8");
    await readAppDataFile(temporaryPath);
    await rename(temporaryPath, dataFilePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function rotateAppDataBackups(dataFilePath) {
  for (let index = appDataBackupCount; index >= 2; index -= 1) {
    try {
      const previous = await readAppDataFile(getAppDataBackupPath(dataFilePath, index - 1));
      await writeAppDataFileAtomically(getAppDataBackupPath(dataFilePath, index), previous);
    } catch (error) {
      if (!isMissingFileError(error)) {
        // A broken backup is skipped so it cannot replace an older valid generation.
      }
    }
  }
  try {
    const current = await readAppDataFile(dataFilePath);
    await writeAppDataFileAtomically(getAppDataBackupPath(dataFilePath, 1), current);
  } catch (error) {
    if (!isMissingFileError(error)) {
      // Never copy a truncated or malformed primary file into the backup chain.
    }
  }
}

async function readAppData(dataFilePath) {
  let primaryError = null;
  try {
    return await readAppDataFile(dataFilePath);
  } catch (error) {
    primaryError = error;
  }

  for (let index = 1; index <= appDataBackupCount; index += 1) {
    try {
      const backup = await readAppDataFile(getAppDataBackupPath(dataFilePath, index));
      await writeAppDataFileAtomically(dataFilePath, backup).catch(() => undefined);
      return backup;
    } catch {
      // Try the next backup generation.
    }
  }

  if (isMissingFileError(primaryError)) return {};
  throw primaryError;
}

async function writeAppData(dataFilePath, payload) {
  const previousWrite = appDataWriteQueues.get(dataFilePath) ?? Promise.resolve();
  const operation = previousWrite
    .catch(() => undefined)
    .then(async () => {
      await rotateAppDataBackups(dataFilePath);
      await writeAppDataFileAtomically(dataFilePath, payload);
    });
  appDataWriteQueues.set(dataFilePath, operation);
  try {
    await operation;
  } finally {
    if (appDataWriteQueues.get(dataFilePath) === operation) {
      appDataWriteQueues.delete(dataFilePath);
    }
  }
}

async function clearAppData(dataFilePath) {
  const previousWrite = appDataWriteQueues.get(dataFilePath) ?? Promise.resolve();
  const operation = previousWrite
    .catch(() => undefined)
    .then(async () => {
      const dataDirectory = dirname(dataFilePath);
      const ownedFiles = [
        dataFilePath,
        ...Array.from({ length: appDataBackupCount }, (_, index) =>
          getAppDataBackupPath(dataFilePath, index + 1),
        ),
        join(dataDirectory, "app-data.previous.json"),
        join(dataDirectory, "app-data.previous.json.bak"),
        `${dataFilePath}.bak`,
        join(dataDirectory, "desktop-project-positions.json"),
      ];
      const dataDirectoryEntries = await readdir(dataDirectory).catch(() => []);
      dataDirectoryEntries
        .filter((name) => name.startsWith("app-data") && name.includes(".tmp-"))
        .forEach((name) => ownedFiles.push(join(dataDirectory, name)));
      await Promise.all(
        ownedFiles.map((filePath) => rm(filePath, { force: true })),
      );
      await Promise.all(
        ["extensions", "generated-images", "session-images", "skills"].map((name) =>
          rm(join(dataDirectory, name), { recursive: true, force: true }),
        ),
      );
    });
  appDataWriteQueues.set(dataFilePath, operation);
  try {
    await operation;
  } finally {
    if (appDataWriteQueues.get(dataFilePath) === operation) {
      appDataWriteQueues.delete(dataFilePath);
    }
  }
}

function getSkillsDir(dataFilePath) {
  return join(dirname(dataFilePath), "skills");
}

function getExtensionsRoot(dataFilePath) {
  return join(dirname(dataFilePath), "extensions");
}

function getExtensionDirectory(dataFilePath, extensionId) {
  const id = String(extensionId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  const root = resolve(getExtensionsRoot(dataFilePath));
  const directory = resolve(root, id);
  const rel = relative(root, directory);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return directory;
}

async function serveInstalledExtensionFile(
  response,
  dataFilePath,
  extensionId,
  fileParts,
) {
  const extensionDirectory = getExtensionDirectory(dataFilePath, extensionId);
  if (!extensionDirectory) {
    sendJson(response, 400, { error: "非法扩展 ID" });
    return;
  }
  if (!Array.isArray(fileParts) || fileParts.length === 0) {
    sendJson(response, 404, { error: "扩展文件不存在" });
    return;
  }
  const filePath = resolve(extensionDirectory, ...fileParts);
  const rel = relative(extensionDirectory, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    sendJson(response, 400, { error: "扩展文件路径越界" });
    return;
  }
  try {
    const realExtensionDirectory = await realpath(extensionDirectory);
    const realFilePath = await realpath(filePath);
    const realRel = relative(realExtensionDirectory, realFilePath);
    if (realRel.startsWith("..") || isAbsolute(realRel)) {
      sendJson(response, 400, { error: "扩展文件不能指向安装目录之外" });
      return;
    }
    const fileInfo = await stat(realFilePath);
    if (!fileInfo.isFile()) throw new Error("Not a file");
    const content = await readFile(realFilePath);
    const extension = extname(realFilePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: "扩展文件不存在" });
  }
}

function normalizeExtensionGitUrl(value) {
  let sourceUrl = String(value ?? "").trim();
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(sourceUrl)) {
    sourceUrl = `https://github.com/${sourceUrl.replace(/\.git$/i, "")}`;
  }
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error("扩展地址不是有效的 Git 仓库网址。");
  }
  if (!["https:", "http:", "git:"].includes(parsed.protocol)) {
    throw new Error("扩展安装仅支持 HTTPS、HTTP 或 git:// 仓库地址。");
  }
  parsed.hash = "";
  parsed.search = "";
  const pathname = parsed.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("Git 仓库地址缺少所有者或仓库名。");
  const repository = parts.at(-1);
  const owner = parts.at(-2);
  const packageName = `${owner}/${repository}`;
  return {
    cloneUrl: `${parsed.origin === "null" ? `${parsed.protocol}//${parsed.host}` : parsed.origin}${pathname}`,
    sourceUrl: `${parsed.protocol}//${parsed.host}${pathname}`,
    packageName,
    owner,
    repository,
  };
}

function normalizeExtensionHomePage(value, fallback) {
  for (const candidate of [value, fallback]) {
    try {
      const parsed = new URL(String(candidate ?? "").trim());
      if (["https:", "http:"].includes(parsed.protocol)) return parsed.href;
    } catch {
      // Try the fallback below.
    }
  }
  return "";
}

async function runExtensionGitClone(sourceUrl, targetPath) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "git",
      ["clone", "--depth", "1", "--single-branch", sourceUrl, targetPath],
      {
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
    let output = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const appendOutput = (chunk) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-8000);
    };
    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.on("error", (error) => finish(new Error(`无法启动 git：${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(output.trim() || `git clone 失败：退出码 ${code}`));
    });
    const timeoutId = setTimeout(() => {
      child.kill();
      finish(new Error("git clone 超时，请检查网络或仓库地址。"));
    }, 120000);
  });
}

async function readJsonFileIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function findTavernExtensionManifest(repositoryRoot) {
  const direct = await readJsonFileIfPresent(join(repositoryRoot, "manifest.json"));
  if (direct) return { root: repositoryRoot, manifest: direct };
  const entries = await readdir(repositoryRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || [".git", "node_modules"].includes(entry.name)) continue;
    const nestedRoot = join(repositoryRoot, entry.name);
    const nested = await readJsonFileIfPresent(join(nestedRoot, "manifest.json"));
    if (nested) return { root: nestedRoot, manifest: nested };
  }
  throw new Error("仓库中没有找到酒馆扩展 manifest.json。");
}

function normalizeManifestFileList(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

async function validateExtensionAssets(extensionRoot, values, label) {
  const result = [];
  const realExtensionRoot = await realpath(extensionRoot);
  for (const rawPath of normalizeManifestFileList(values)) {
    const normalizedPath = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const filePath = resolve(extensionRoot, normalizedPath);
    const rel = relative(extensionRoot, filePath);
    if (!normalizedPath || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`${label} 入口路径越界：${rawPath}`);
    }
    const realFilePath = await realpath(filePath).catch(() => null);
    const realRel = realFilePath ? relative(realExtensionRoot, realFilePath) : "..";
    if (!realFilePath || realRel.startsWith("..") || isAbsolute(realRel)) {
      throw new Error(`${label} 入口不能指向扩展目录之外：${rawPath}`);
    }
    const fileInfo = await stat(realFilePath).catch(() => null);
    if (!fileInfo?.isFile()) throw new Error(`${label} 入口文件不存在：${rawPath}`);
    result.push(rel.replace(/\\/g, "/"));
  }
  return result;
}

async function installTavernExtensionFromGit(dataFilePath, sourceValue) {
  const source = normalizeExtensionGitUrl(sourceValue);
  const stagingRoot = await mkdtemp(join(tmpdir(), "renge-extension-"));
  const repositoryRoot = join(stagingRoot, "repository");
  try {
    await runExtensionGitClone(source.cloneUrl, repositoryRoot);
    const found = await findTavernExtensionManifest(repositoryRoot);
    const manifest = found.manifest && typeof found.manifest === "object" ? found.manifest : {};
    const jsFiles = await validateExtensionAssets(found.root, manifest.js, "JavaScript");
    const cssFiles = await validateExtensionAssets(found.root, manifest.css, "CSS");
    if (jsFiles.length === 0 && cssFiles.length === 0) {
      throw new Error("manifest.json 没有声明可加载的 js 或 css 文件。");
    }
    const packageJson = (await readJsonFileIfPresent(join(repositoryRoot, "package.json"))) ?? {};
    const knownPromptTemplate = source.packageName.toLowerCase() === "zonde306/st-prompt-template";
    const id = knownPromptTemplate
      ? "st-prompt-template"
      : `${sanitizePathName(source.repository, "extension").toLowerCase()}-${shortHash(source.sourceUrl)}`
          .replace(/[^a-z0-9_-]+/g, "-")
          .slice(0, 128);
    const targetDirectory = getExtensionDirectory(dataFilePath, id);
    if (!targetDirectory) throw new Error("无法生成安全的扩展安装目录。");
    await mkdir(getExtensionsRoot(dataFilePath), { recursive: true });
    await rm(targetDirectory, { recursive: true, force: true });
    await cp(found.root, targetDirectory, {
      recursive: true,
      force: false,
      filter: (sourcePath) => {
        const normalized = sourcePath.replace(/\\/g, "/");
        return !/(^|\/)(\.git|node_modules)(\/|$)/.test(normalized);
      },
    });
    const timestamp = new Date().toISOString();
    const displayName = String(manifest.display_name ?? packageJson.displayName ?? source.repository).trim();
    const description = String(
      manifest.description ?? packageJson.description ?? "通过 Git 仓库安装的酒馆扩展。",
    ).trim();
    const authorValue = manifest.author ?? packageJson.author ?? source.owner;
    const author =
      authorValue && typeof authorValue === "object"
        ? String(authorValue.name ?? source.owner)
        : String(authorValue ?? source.owner);
    const licenseValue = packageJson.license;
    const license =
      licenseValue && typeof licenseValue === "object"
        ? String(licenseValue.type ?? "未声明")
        : String(licenseValue ?? "未声明");
    return {
      id,
      packageName: source.packageName,
      displayName: displayName || source.repository,
      description,
      author,
      version: String(manifest.version ?? packageJson.version ?? "0.0.0"),
      sourceUrl: source.sourceUrl,
      homePage: normalizeExtensionHomePage(
        manifest.homePage ?? packageJson.homepage,
        source.sourceUrl,
      ),
      license,
      enabled: true,
      compatibility: knownPromptTemplate ? "native" : "web",
      status: "installed",
      statusMessage: knownPromptTemplate
        ? "已安装 Renge 原生兼容层"
        : "已安装酒馆 Web 兼容扩展",
      capabilities: knownPromptTemplate
        ? [
            "EJS 提示词模板",
            "全局 / 会话 / 消息变量",
            "角色卡与世界书上下文",
            "生成前与回复后处理",
          ]
        : ["酒馆 manifest 加载", "JavaScript / CSS 资源", "Renge 酒馆 API 兼容层"],
      settings: {},
      loadingOrder: Number.isFinite(Number(manifest.loading_order))
        ? Number(manifest.loading_order)
        : 100,
      requires: normalizeManifestFileList(manifest.requires),
      optional: normalizeManifestFileList(manifest.optional),
      jsFiles,
      cssFiles,
      assetBaseUrl: `/scripts/extensions/third-party/${encodeURIComponent(id)}`,
      installedAt: timestamp,
      updatedAt: timestamp,
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function getSessionImagesRoot(dataFilePath) {
  return join(dirname(dataFilePath), "session-images");
}

// 返回某个会话的图片目录绝对路径；如果 sessionId 非法或越界，返回 null
function getSessionImagesDir(dataFilePath, sessionId) {
  if (typeof sessionId !== "string") return null;
  const trimmed = sessionId.trim();
  if (!trimmed) return null;
  // 只允许 uuid / 字母数字 / 短横线 / 下划线
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(trimmed)) return null;
  const root = getSessionImagesRoot(dataFilePath);
  const dir = resolve(root, trimmed);
  // 防穿越：必须落在 root 内
  const rel = relative(root, dir);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return dir;
}

function resolveSessionImageApiPath(dataFilePath, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let pathname = raw;
  try {
    pathname = new URL(raw, "http://localhost").pathname;
  } catch {
    // Keep raw relative path.
  }
  if (!pathname.startsWith("/api/session-images/")) return "";

  const rest = pathname.slice("/api/session-images/".length);
  const [rawId, ...fileParts] = rest.split("/");
  if (fileParts.length !== 1) return "";
  const sessionId = decodeURIComponent(rawId || "");
  const fileName = decodeURIComponent(fileParts[0] || "");
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(fileName)) return "";
  const dir = getSessionImagesDir(dataFilePath, sessionId);
  if (!dir) return "";
  const filePath = resolve(dir, fileName);
  const rel = relative(dir, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) return "";
  return filePath;
}

async function resolveImageReferenceForUpstream(dataFilePath, referenceImage) {
  const raw = String(referenceImage ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  if (/^https?:\/\//i.test(raw) && !raw.includes("/api/session-images/")) {
    const { response, buffer } = await downloadBinaryWithTimeout(raw, 15000);
    if (!response.ok || !buffer) throw new Error(`下载参考图失败：${response.status}`);
    const contentType = response.headers.get("content-type") || "image/png";
    const mime = /^image\//i.test(contentType) ? contentType.split(";")[0] : "image/png";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }

  const localSessionPath = resolveSessionImageApiPath(dataFilePath, raw);
  const localPath = localSessionPath || raw;
  const buf = await readFile(localPath);
  const extL = (extname(localPath) || ".png").toLowerCase().replace(/^\./, "");
  const mime =
    extL === "jpg" || extL === "jpeg"
      ? "image/jpeg"
      : extL === "webp"
        ? "image/webp"
        : extL === "gif"
          ? "image/gif"
          : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function sanitizePathName(value, fallback = "skill") {
  const sanitized = String(value ?? "")
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return sanitized || fallback;
}

function createServerId(prefix = "skill") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isMarkdownEntryFile(fileName) {
  return /^(skill|readme)\.md$/i.test(fileName) || /\.md$/i.test(fileName);
}

async function findSkillEntryFile(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const directMatch =
    files.find((name) => /^skill\.md$/i.test(name)) ??
    files.find((name) => /^readme\.md$/i.test(name)) ??
    files.find((name) => /\.md$/i.test(name));

  if (directMatch) {
    return {
      rootPath,
      entryFile: directMatch,
      content: await readFile(join(rootPath, directMatch), "utf8"),
    };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if ([".git", "node_modules", "__MACOSX"].includes(entry.name)) continue;
    const childPath = join(rootPath, entry.name);
    const childEntries = await readdir(childPath, { withFileTypes: true });
    const childFile = childEntries
      .filter((childEntry) => childEntry.isFile())
      .map((childEntry) => childEntry.name)
      .find(isMarkdownEntryFile);
    if (childFile) {
      return {
        rootPath: childPath,
        entryFile: childFile,
        content: await readFile(join(childPath, childFile), "utf8"),
      };
    }
  }

  throw new Error("没有找到 SKILL.md、README.md 或 Markdown 技能说明文件。");
}

function parseSkillMetadata(content, fallbackName) {
  const normalizedContent = String(content ?? "").replace(/\r\n/g, "\n");
  const lines = normalizedContent.split("\n");
  const titleLine = lines.find((line) => /^#\s+/.test(line.trim()));
  const name = (titleLine ? titleLine.replace(/^#\s+/, "") : fallbackName).trim() || fallbackName;
  const descriptionLines = [];
  let afterTitle = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!afterTitle) {
      if (titleLine && line === titleLine) afterTitle = true;
      if (!titleLine && trimmed) afterTitle = true;
      continue;
    }
    if (!trimmed) {
      if (descriptionLines.length > 0) break;
      continue;
    }
    if (trimmed.startsWith("#")) {
      if (descriptionLines.length > 0) break;
      continue;
    }
    descriptionLines.push(trimmed);
    if (descriptionLines.join(" ").length > 220) break;
  }

  return {
    name,
    description: descriptionLines.join(" ").slice(0, 260),
  };
}

async function importSkillDirectory(dataFilePath, sourcePath) {
  const sourceRoot = resolve(String(sourcePath ?? ""));
  const sourceInfo = await stat(sourceRoot);
  if (!sourceInfo.isDirectory()) {
    throw new Error("导入路径不是文件夹。");
  }

  const found = await findSkillEntryFile(sourceRoot);
  const metadata = parseSkillMetadata(found.content, basename(found.rootPath));
  const id = createServerId("skill");
  const targetPath = join(getSkillsDir(dataFilePath), `${sanitizePathName(metadata.name)}-${id}`);
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(found.rootPath, targetPath, {
    recursive: true,
    force: false,
    filter: (source) => {
      const normalized = source.replace(/\\/g, "/");
      return !/(^|\/)(\.git|node_modules|dist|build)(\/|$)/.test(normalized);
    },
  });

  return {
    id,
    name: metadata.name,
    description: metadata.description,
    enabled: true,
    sourceType: "folder",
    path: targetPath,
    entryFile: found.entryFile,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function extractZipArchive(zipPath, targetDir) {
  try {
    const module = await import("@electron-internal/extract-zip");
    await module.default(zipPath, { dir: targetDir });
    return;
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      zipPath,
      targetDir,
    ], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(stderr.trim() || `zip 解压失败：退出码 ${code}`));
    });
  });
}

async function importSkillZip(dataFilePath, body) {
  const id = createServerId("skill");
  const stagingDir = await mkdtemp(join(tmpdir(), "renge-skill-"));
  const skillsDir = getSkillsDir(dataFilePath);
  await mkdir(skillsDir, { recursive: true });

  try {
    let zipPath = "";
    if (body.sourcePath) {
      zipPath = resolve(String(body.sourcePath));
      const sourceInfo = await stat(zipPath);
      if (!sourceInfo.isFile()) throw new Error("ZIP 路径不是文件。");
    } else {
      const base64 = String(body.base64 ?? "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
      if (!base64) throw new Error("缺少 ZIP 文件内容。");
      zipPath = join(stagingDir, sanitizePathName(body.name ?? "skill.zip", "skill") + ".zip");
      await writeFile(zipPath, Buffer.from(base64, "base64"));
    }

    const extractedDir = join(stagingDir, "extracted");
    await mkdir(extractedDir, { recursive: true });
    await extractZipArchive(zipPath, extractedDir);
    const found = await findSkillEntryFile(extractedDir);
    const metadata = parseSkillMetadata(found.content, sanitizePathName(body.name ?? basename(zipPath), "skill"));
    const targetPath = join(skillsDir, `${sanitizePathName(metadata.name)}-${id}`);
    await cp(found.rootPath, targetPath, {
      recursive: true,
      force: false,
      filter: (source) => {
        const normalized = source.replace(/\\/g, "/");
        return !/(^|\/)(\.git|node_modules|dist|build|__MACOSX)(\/|$)/.test(normalized);
      },
    });

    return {
      id,
      name: metadata.name,
      description: metadata.description,
      enabled: true,
      sourceType: "zip",
      path: targetPath,
      entryFile: found.entryFile,
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

function normalizeSkillConfig(rawSkill) {
  const source = rawSkill && typeof rawSkill === "object" ? rawSkill : {};
  return {
    id: String(source.id ?? createServerId("skill")),
    name: String(source.name ?? "未命名技能"),
    description: String(source.description ?? ""),
    enabled: source.enabled !== false,
    sourceType: source.sourceType === "zip" ? "zip" : "folder",
    path: String(source.path ?? ""),
    entryFile: String(source.entryFile ?? "SKILL.md"),
    importedAt: String(source.importedAt ?? new Date().toISOString()),
    updatedAt: String(source.updatedAt ?? new Date().toISOString()),
  };
}

function buildSkillContextPrompt(skillContexts) {
  const availableSkills = skillContexts.filter((skill) => skill.content.trim());
  if (availableSkills.length === 0) return "";

  return [
    "启用技能（Skills）：",
    "你必须在理解用户请求时自动判断是否匹配以下技能。若匹配，按技能说明执行；若不匹配，不要强行使用。使用某个技能时，先用一句话说明正在使用哪个技能及原因。",
    ...availableSkills.map((skill, index) =>
      [
        `## 技能 ${index + 1}: ${skill.name}`,
        skill.description ? `描述：${skill.description}` : "",
        `来源：${skill.path}`,
        "说明：",
        skill.content,
      ].filter(Boolean).join("\n"),
    ),
  ].join("\n\n");
}

async function readSkillContexts(rawSkills) {
  const skills = Array.isArray(rawSkills) ? rawSkills.map(normalizeSkillConfig) : [];
  const contexts = [];

  for (const skill of skills.filter((item) => item.enabled)) {
    try {
      const rootPath = resolve(skill.path);
      const entryPath = resolve(rootPath, skill.entryFile || "SKILL.md");
      const relativeEntry = relative(rootPath, entryPath);
      if (relativeEntry.startsWith("..") || relativeEntry === ".." || relativeEntry === "") {
        throw new Error("技能入口文件路径无效。");
      }
      const content = (await readFile(entryPath, "utf8")).slice(0, 24000);
      contexts.push({ ...skill, content });
    } catch (error) {
      contexts.push({
        ...skill,
        content: `技能文件读取失败：${compactError(error)}`,
      });
    }
  }

  return {
    skills: contexts.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      path: skill.path,
      entryFile: skill.entryFile,
      ok: !skill.content.startsWith("技能文件读取失败："),
    })),
    prompt: buildSkillContextPrompt(contexts),
  };
}

function assertPcFileAccessEnabled() {
  if (process.env.RENGE_PC_FILES === "0") {
    throw new Error("电脑文件服务已禁用。设置 RENGE_PC_FILES=1 后重启服务。");
  }
}

function normalizePcPath(rawPath = "") {
  const path = String(rawPath ?? "").trim();
  if (!path) return "";
  return resolve(path);
}

async function listPcRoots() {
  if (process.platform === "win32") {
    const roots = [];
    for (let code = 65; code <= 90; code += 1) {
      const root = `${String.fromCharCode(code)}:\\`;
      try {
        await stat(root);
        roots.push({ name: root, path: root, kind: "directory" });
      } catch {
        // Drive letter is not mounted or accessible.
      }
    }
    return roots;
  }

  return [
    { name: "/", path: "/", kind: "directory" },
    { name: "Home", path: homedir(), kind: "directory" },
  ];
}

async function listPcDirectory(path) {
  const targetPath = normalizePcPath(path);
  if (!targetPath) return listPcRoots();

  const entries = await readdir(targetPath, { withFileTypes: true });
  const results = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(targetPath, entry.name);
      let size = 0;
      let modifiedAt = "";
      try {
        const info = await stat(entryPath);
        size = info.size;
        modifiedAt = info.mtime.toISOString();
      } catch {
        // Keep inaccessible metadata blank while still showing the entry.
      }

      return {
        name: entry.name,
        path: entryPath,
        kind: entry.isDirectory() ? "directory" : "file",
        size,
        modifiedAt,
      };
    }),
  );

  return results.sort((first, second) => {
    if (first.kind !== second.kind) return first.kind === "directory" ? -1 : 1;
    return first.name.localeCompare(second.name, "zh-CN");
  });
}

async function listPcFilesRecursive(rootPath, recursive, limit = 240) {
  const normalizedRoot = normalizePcPath(rootPath);
  const basePath = normalizedRoot || "";
  const results = [];

  async function visit(directoryPath) {
    if (results.length >= limit) return;
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= limit) return;
      const entryPath = join(directoryPath, entry.name);
      const relativePath = basePath
        ? entryPath.slice(basePath.length).replace(/^[/\\]+/, "").replace(/\\/g, "/")
        : entryPath;
      const kind = entry.isDirectory() ? "directory" : "file";
      results.push({ path: relativePath, absolutePath: entryPath, kind });
      if (kind === "directory" && recursive) {
        try {
          await visit(entryPath);
        } catch {
          // Skip inaccessible directories.
        }
      }
    }
  }

  await visit(basePath);
  return results;
}

function resolvePcWorkspacePath(workspacePath, relativePath = "") {
  const rootPath = normalizePcPath(workspacePath);
  if (!rootPath) throw new Error("缺少电脑工作区路径");
  const targetPath = resolve(rootPath, String(relativePath ?? ""));
  if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath.replace(/[\\/]$/, "")}\\`) && !targetPath.startsWith(`${rootPath.replace(/[\\/]$/, "")}/`)) {
    throw new Error("路径不能越出电脑工作区");
  }
  return targetPath;
}

async function handlePcFiles(request, response, pathname) {
  assertPcFileAccessEnabled();
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (pathname === "/api/pc/roots") {
    sendJson(response, 200, { roots: await listPcRoots() });
    return;
  }

  if (pathname === "/api/pc/download-file") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    const workspacePath = String(requestUrl.searchParams.get("workspacePath") ?? "");
    const relativePath = String(requestUrl.searchParams.get("path") ?? "");
    const downloadName = String(requestUrl.searchParams.get("downloadName") ?? "") || relativePath;
    const targetPath = resolvePcWorkspacePath(workspacePath, relativePath);
    const info = await stat(targetPath);
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${getAsciiDownloadFileName(downloadName)}"; filename*=UTF-8''${getContentDispositionFileName(downloadName)}`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    try {
      await pipeline(createReadStream(targetPath), response);
    } catch (error) {
      if (request.destroyed || response.destroyed || response.writableEnded) return;
      throw error;
    }
    return;
  }

  if (pathname === "/api/pc/upload-file") {
    if (request.method !== "PUT" && request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    const workspacePath = String(requestUrl.searchParams.get("workspacePath") ?? "");
    const relativePath = String(requestUrl.searchParams.get("path") ?? "");
    const targetPath = resolvePcWorkspacePath(workspacePath, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await pipeline(request, createWriteStream(targetPath));
    const info = await stat(targetPath);
    sendJson(response, 200, {
      ok: true,
      path: relativePath,
      operation: "transferUpload",
      bytes: info.size,
    });
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const body = await readJsonBody(request);

  if (pathname === "/api/pc/browse") {
    sendJson(response, 200, {
      path: normalizePcPath(body.path ?? ""),
      entries: await listPcDirectory(body.path ?? ""),
    });
    return;
  }

  const workspacePath = String(body.workspacePath ?? "");
  const relativePath = String(body.path ?? "");
  const targetPath = resolvePcWorkspacePath(workspacePath, relativePath);

  if (pathname === "/api/pc/list-files") {
    const entries = await listPcFilesRecursive(targetPath, body.recursive !== false, 240);
    sendJson(response, 200, entries.map(({ path, kind }) => ({ path, kind })));
    return;
  }

  if (pathname === "/api/pc/read-file") {
    sendJson(response, 200, {
      path: relativePath,
      content: await readFile(targetPath, "utf8"),
    });
    return;
  }

  if (pathname === "/api/pc/read-binary-file") {
    const content = await readFile(targetPath);
    sendJson(response, 200, {
      path: relativePath,
      size: content.length,
      base64: content.toString("base64"),
    });
    return;
  }

  if (pathname === "/api/pc/read-file-range") {
    const content = await readFile(targetPath, "utf8");
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const startLine = Math.max(1, Math.floor(Number(body.startLine ?? 1)));
    const endLine = Math.min(lines.length, Math.max(startLine, Math.floor(Number(body.endLine ?? startLine + 120))));
    sendJson(response, 200, {
      path: relativePath,
      startLine,
      endLine,
      totalLines: lines.length,
      content: lines.slice(startLine - 1, endLine).join("\n"),
    });
    return;
  }

  if (pathname === "/api/pc/file-info") {
    const info = await stat(targetPath);
    sendJson(response, 200, {
      path: relativePath,
      kind: info.isDirectory() ? "directory" : "file",
      name: targetPath.split(/[\\/]/).filter(Boolean).at(-1) ?? targetPath,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
    });
    return;
  }

  if (pathname === "/api/pc/search-files") {
    const query = String(body.query ?? "").toLowerCase();
    if (!query.trim()) throw new Error("query 不能为空");
    const includeContent = body.includeContent !== false;
    const files = await listPcFilesRecursive(targetPath, true, 360);
    const matches = [];
    for (const file of files) {
      if (matches.length >= 80) break;
      if (file.kind !== "file") continue;
      if (file.path.toLowerCase().includes(query)) {
        matches.push({ path: file.path, match: "name" });
        continue;
      }
      if (!includeContent || !/\.(cjs|css|csv|env|html|js|json|jsx|md|mjs|scss|ts|tsx|txt|xml|yaml|yml)$/i.test(file.path)) continue;
      try {
        const content = await readFile(file.absolutePath, "utf8");
        const index = content.toLowerCase().indexOf(query);
        if (index >= 0) {
          matches.push({
            path: file.path,
            match: "content",
            preview: content.slice(Math.max(0, index - 60), index + query.length + 120),
          });
        }
      } catch {
        // Skip unreadable or binary-like files.
      }
    }
    sendJson(response, 200, matches);
    return;
  }

  if (pathname === "/api/pc/create-directory") {
    await mkdir(targetPath, { recursive: true });
    sendJson(response, 200, { ok: true, path: relativePath, operation: "mkdir" });
    return;
  }

  if (pathname === "/api/pc/write-file") {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, String(body.content ?? ""), "utf8");
    sendJson(response, 200, { ok: true, path: relativePath, operation: "write" });
    return;
  }

  if (pathname === "/api/pc/write-binary-file") {
    const base64 = String(body.base64 ?? "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    const content = Buffer.from(base64, "base64");
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
    sendJson(response, 200, {
      ok: true,
      path: relativePath,
      operation: "writeBinary",
      bytes: content.length,
    });
    return;
  }

  if (pathname === "/api/pc/delete-path") {
    await rm(targetPath, { recursive: Boolean(body.recursive), force: false });
    sendJson(response, 200, { ok: true, path: relativePath, operation: "delete" });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function getProviderTarget(body) {
  const apiBaseUrl = String(body.apiBaseUrl ?? "").trim().replace(/\/+$/, "");
  const apiKey = String(body.apiKey ?? "");

  if (!apiBaseUrl) {
    throw new Error("缺少 apiBaseUrl");
  }

  return { apiBaseUrl, apiKey };
}

const unsafeObjectKeys = new Set(["__proto__", "constructor", "prototype"]);
const forbiddenProxyHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const openAiRequestKeys = new Set([
  "audio",
  "frequency_penalty",
  "logit_bias",
  "logprobs",
  "max_completion_tokens",
  "max_tokens",
  "messages",
  "metadata",
  "min_p",
  "modalities",
  "model",
  "n",
  "parallel_tool_calls",
  "prediction",
  "presence_penalty",
  "reasoning",
  "reasoning_effort",
  "repetition_penalty",
  "response_format",
  "seed",
  "service_tier",
  "stop",
  "store",
  "stream",
  "stream_options",
  "temperature",
  "tool_choice",
  "tools",
  "top_a",
  "top_k",
  "top_logprobs",
  "top_p",
  "user",
  "verbosity",
  "web_search_options",
]);

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toSafeJsonValue(value) {
  if (Array.isArray(value)) return value.map(toSafeJsonValue);
  if (!isObjectRecord(value)) return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (unsafeObjectKeys.has(key)) continue;
    output[key] = toSafeJsonValue(item);
  }
  return output;
}

function mergeRequestObjects(base, overlay) {
  const output = toSafeJsonValue(isObjectRecord(base) ? base : {});
  if (!isObjectRecord(overlay)) return output;
  for (const [key, value] of Object.entries(overlay)) {
    if (unsafeObjectKeys.has(key)) continue;
    output[key] = isObjectRecord(output[key]) && isObjectRecord(value)
      ? mergeRequestObjects(output[key], value)
      : toSafeJsonValue(value);
  }
  return output;
}

function parseTavernObject(value, label) {
  if (value == null || value === "") return {};
  if (isObjectRecord(value)) return toSafeJsonValue(value);
  if (Array.isArray(value)) {
    return value
      .filter(isObjectRecord)
      .reduce((result, item) => mergeRequestObjects(result, item), {});
  }
  if (typeof value !== "string" || !value.trim()) return {};
  let parsed;
  try {
    parsed = parseYaml(value);
  } catch (error) {
    throw new Error(`${label}不是合法 YAML：${compactError(error)}`);
  }
  if (isObjectRecord(parsed)) return toSafeJsonValue(parsed);
  if (Array.isArray(parsed)) {
    return parsed
      .filter(isObjectRecord)
      .reduce((result, item) => mergeRequestObjects(result, item), {});
  }
  throw new Error(`${label}必须是 YAML object`);
}

function parseTavernExcludedPaths(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (isObjectRecord(value)) return Object.keys(value).filter((key) => Boolean(value[key]));
  const text = String(value).trim();
  if (!text) return [];
  try {
    const parsed = parseYaml(text);
    if (Array.isArray(parsed)) {
      return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    }
    if (isObjectRecord(parsed)) return Object.keys(parsed).filter((key) => Boolean(parsed[key]));
  } catch {}
  return text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function deleteRequestPath(target, path) {
  const segments = String(path)
    .replace(/\[(?:"([^"]+)"|'([^']+)'|(\d+))\]/g, ".$1$2$3")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => unsafeObjectKeys.has(segment))) return;
  let parent = target;
  for (const segment of segments.slice(0, -1)) {
    if (!isObjectRecord(parent) && !Array.isArray(parent)) return;
    parent = parent[segment];
  }
  if (isObjectRecord(parent) || Array.isArray(parent)) delete parent[segments.at(-1)];
}

function parseTavernProxyHeaders(value) {
  const parsed = parseTavernObject(value, "附加请求头");
  const headers = {};
  for (const [name, rawValue] of Object.entries(parsed)) {
    const normalizedName = name.trim();
    if (!normalizedName || forbiddenProxyHeaders.has(normalizedName.toLowerCase())) continue;
    if (!["string", "number", "boolean"].includes(typeof rawValue)) continue;
    headers[normalizedName] = String(rawValue);
  }
  return headers;
}

function normalizeCompatibleApiBaseUrl(value) {
  const normalized = String(value ?? "").trim().replace(/\/+$/, "");
  if (!normalized) return "";
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("第三方供应商 API 地址无效");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("第三方供应商 API 地址只支持 HTTP 或 HTTPS");
  }
  return normalized.replace(/\/(?:chat\/completions|models)$/i, "");
}

function getTavernProviderTarget(body) {
  const apiBaseUrl = normalizeCompatibleApiBaseUrl(
    body.reverse_proxy ?? body.custom_url ?? body.apiBaseUrl ?? body.apiurl,
  );
  if (!apiBaseUrl) {
    throw new Error("第三方插件没有提供可接管的供应商 API 地址");
  }
  const apiKey = String(
    body.proxy_password ?? body.apiKey ?? body.api_key ?? body.key ?? "",
  );
  return { apiBaseUrl, apiKey };
}

function buildTavernChatCompletionRequest(body) {
  const source = isObjectRecord(body.request) ? body.request : body;
  let requestBody = {};
  for (const key of openAiRequestKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (value === undefined || value === "unset") continue;
    requestBody[key] = toSafeJsonValue(value);
  }
  if (!requestBody.response_format && isObjectRecord(source.json_schema)) {
    requestBody.response_format = {
      type: "json_schema",
      json_schema: {
        name: String(source.json_schema.name ?? "response"),
        strict: source.json_schema.strict !== false,
        schema: toSafeJsonValue(source.json_schema.value ?? source.json_schema.schema ?? {}),
      },
    };
  }
  return applyTavernRequestOverrides(requestBody, body, source);
}

function applyTavernRequestOverrides(requestBody, body, source = requestBody) {
  let prepared = mergeRequestObjects({}, requestBody);
  prepared = mergeRequestObjects(
    prepared,
    parseTavernObject(
      body.customIncludeBody ?? body.custom_include_body ?? source.custom_include_body,
      "附加主体参数",
    ),
  );
  for (const path of parseTavernExcludedPaths(
    body.customExcludeBody ?? body.custom_exclude_body ?? source.custom_exclude_body,
  )) {
    deleteRequestPath(prepared, path);
  }
  return prepared;
}

function getTavernProxyHeaders(body) {
  const source = isObjectRecord(body.request) ? body.request : body;
  return parseTavernProxyHeaders(
    body.customIncludeHeaders ?? body.custom_include_headers ?? source.custom_include_headers,
  );
}

function getCompatibleApiEndpoint(apiBaseUrl, endpoint) {
  const suffix = String(endpoint).replace(/^\/+/, "");
  return `${String(apiBaseUrl).replace(/\/+$/, "")}/${suffix}`;
}

function modelSupportsSmallerImageSize(model) {
  const modelId = String(model ?? "").toLowerCase();
  return (
    modelId.includes("gpt-image-2-1k") ||
    (modelId.includes("image") && /(?:^|[-_])1k(?:$|[-_])/.test(modelId))
  );
}

function pickDefaultImageSize(model, prompt, requestedSize) {
  if (requestedSize) return requestedSize;
  const promptText = String(prompt ?? "");
  if (modelSupportsSmallerImageSize(model) && promptText.length >= 40) {
    return "512x512";
  }
  return "1024x1024";
}

function getImageGenerationPayloadError(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.error === "string") return payload.error.trim();
  if (payload.error && typeof payload.error === "object") {
    const message = String(payload.error.message ?? "").trim();
    if (message) return message;
    const code = String(payload.error.code ?? "").trim();
    if (code) return code;
  }
  return "";
}

function isRelayInputImageUrl(url) {
  return /relay-image-inputs/i.test(String(url ?? ""));
}

function isRetriableImageGenerationPayloadError(payload) {
  const message = getImageGenerationPayloadError(payload).toLowerCase();
  const type = String(payload?.error?.type ?? "").toLowerCase();
  return (
    type === "internal_error" ||
    message.includes("service unavailable") ||
    message.includes("temporarily unavailable")
  );
}

function shouldRetryImageGenerationWithSmallerSize(upstream, imageRequestBody, requestedSize) {
  if (requestedSize) return false;
  const currentSize = String(imageRequestBody?.size ?? "");
  if (!currentSize || currentSize === "512x512") return false;
  if (!modelSupportsSmallerImageSize(imageRequestBody?.model)) return false;
  if (!upstream || upstream.ok || upstream.status !== 504) return false;
  const message = String(upstream.payload?.error?.message ?? "");
  return /timeout/i.test(message);
}

async function proxyJson({ url, apiKey, method = "GET", body, timeoutMs, headers = {} }) {
  const ac = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ac.abort(new Error(`upstream timeout after ${timeoutMs}ms`)), timeoutMs) : null;
  let upstreamResponse;
  try {
    upstreamResponse = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    return {
      ok: false,
      status: 504,
      payload: { error: { message: err && err.message ? err.message : "upstream request failed" } },
    };
  }
  if (timer) clearTimeout(timer);
  const text = await upstreamResponse.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {
      error: text || upstreamResponse.statusText || "Upstream returned non-JSON response",
    };
  }

  if (!upstreamResponse.ok) {
    return {
      ok: false,
      status: upstreamResponse.status,
      payload,
    };
  }

  return {
    ok: true,
    status: upstreamResponse.status,
    payload,
  };
}

async function proxyForm({ url, apiKey, method = "POST", form, timeoutMs }) {
  const ac = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ac.abort(new Error(`upstream timeout after ${timeoutMs}ms`)), timeoutMs) : null;
  let upstreamResponse;
  try {
    upstreamResponse = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: form,
      signal: ac.signal,
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    return {
      ok: false,
      status: 504,
      payload: { error: { message: err && err.message ? err.message : "upstream request failed" } },
    };
  }
  if (timer) clearTimeout(timer);

  const text = await upstreamResponse.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {
      error: text || upstreamResponse.statusText || "Upstream returned non-JSON response",
    };
  }

  if (!upstreamResponse.ok) {
    return {
      ok: false,
      status: upstreamResponse.status,
      payload,
    };
  }

  return {
    ok: true,
    status: upstreamResponse.status,
    payload,
  };
}

async function downloadBinaryWithTimeout(url, timeoutMs = 15000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`download timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(url, { signal: ac.signal });
    const buffer = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
    return { response, buffer };
  } finally {
    clearTimeout(timer);
  }
}

function parseImageDataUrl(dataUrl) {
  const m = String(dataUrl ?? "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!m) return null;
  return {
    mime: m[1],
    buffer: Buffer.from(m[2], "base64"),
  };
}

function imageExtensionFromMime(mime) {
  if (/jpe?g/i.test(mime)) return "jpg";
  if (/webp/i.test(mime)) return "webp";
  if (/gif/i.test(mime)) return "gif";
  return "png";
}

async function createImageEditForm(imageRequestBody, referenceDataUrls) {
  const dataUrls = Array.isArray(referenceDataUrls) ? referenceDataUrls : [referenceDataUrls];
  const parsedImages = dataUrls
    .map((dataUrl) => parseImageDataUrl(dataUrl))
    .filter(Boolean);
  if (parsedImages.length === 0) throw new Error("参考图不是可上传的 data URL");

  const form = new FormData();
  form.append("model", String(imageRequestBody.model ?? ""));
  form.append("prompt", String(imageRequestBody.prompt ?? ""));
  form.append("n", String(imageRequestBody.n ?? 1));
  if (imageRequestBody.size) form.append("size", String(imageRequestBody.size));
  if (imageRequestBody.quality) form.append("quality", String(imageRequestBody.quality));
  if (imageRequestBody.style) form.append("style", String(imageRequestBody.style));
  parsedImages.forEach((parsed, index) => {
    const ext = imageExtensionFromMime(parsed.mime);
    form.append("image", new Blob([parsed.buffer], { type: parsed.mime }), `reference-${index + 1}.${ext}`);
  });
  return form;
}

function stripImageMessageMetadata(text) {
  return String(text ?? "")
    .replace(/<!--\s*(?:local-image-path|source-url)\s*:[\s\S]*?-->/gi, "\n")
    .replace(/!\[[^\]]*\]\((?:https?:\/\/[^)\s]+|data:image\/[^)\s]+|\/api\/session-images\/[^)\s]+)\)/gi, "[图片]")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildImageConversationPrompt(messages, extractText, fallbackPrompt) {
  const lines = [];
  let lastUserText = "";
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const raw = extractText(m);
    const text = stripImageMessageMetadata(raw);
    const hasImage = /!\[[^\]]*\]\((?:https?:\/\/[^)\s]+|data:image\/[^)\s]+|\/api\/session-images\/[^)\s]+)\)/i.test(raw) ||
      /<!--\s*(?:local-image-path|source-url)\s*:/i.test(raw) ||
      extractImageRefsFromMessageContent(m).length > 0;
    if (!text && !hasImage) continue;
    if (m.role === "user" && text) lastUserText = text;
    const label = m.role === "user" ? "用户" : "助手";
    lines.push(`${label}: ${text || "[图片]"}`);
  }

  const finalInstruction = lastUserText || String(fallbackPrompt ?? "").trim();
  if (lines.length === 0) return finalInstruction;
  return [
    "这是一个连续图片生成/编辑对话。请像正常改图对话一样，结合下面完整历史文字上下文，以及按时间顺序上传的所有历史图片来执行最后用户要求。",
    "较早图片是原始或中间参考，较晚图片通常是最近一次结果；不要忽略先前用户对主体、颜色、构图、风格和修正方向的要求。",
    "如果历史指令之间有冲突，以最后一条用户要求为准，但保留没有被最后要求覆盖的历史约束。",
    "",
    "历史文字上下文：",
    lines.join("\n"),
    "",
    `最后用户要求：${finalInstruction}`,
  ].join("\n");
}

function extractImageRefsFromMessageContent(m) {
  const refs = [];
  if (!m || !Array.isArray(m.content)) return refs;
  for (const item of m.content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "image_url") {
      if (typeof item.image_url === "string") refs.push(item.image_url);
      else if (item.image_url && typeof item.image_url.url === "string") refs.push(item.image_url.url);
    } else if (item.type === "input_image") {
      if (typeof item.image_url === "string") refs.push(item.image_url);
      else if (item.image_url && typeof item.image_url.url === "string") refs.push(item.image_url.url);
      else if (typeof item.image === "string") refs.push(item.image);
    }
  }
  return refs;
}

function shouldFallbackImageEditToGeneration(upstream) {
  if (!upstream) return true;
  if ([400, 404, 405, 415, 422].includes(upstream.status)) return true;
  const message = getImageGenerationPayloadError(upstream.payload).toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("unsupported") ||
    message.includes("not support") ||
    message.includes("invalid endpoint") ||
    message.includes("unknown endpoint") ||
    message.includes("multipart") ||
    message.includes("formdata") ||
    message.includes("form data")
  );
}

function getModelIdFromItem(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  if (typeof item !== "object") return "";
  return String(item.id ?? item.name ?? item.model ?? "").trim();
}

function getModelItems(payload) {
  return [
    ...(Array.isArray(payload?.data) ? payload.data : []),
    ...(Array.isArray(payload?.models) ? payload.models : []),
  ].filter((item) => getModelIdFromItem(item));
}

function hasMoreModels(payload, collectedCount) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.has_more === true || payload.hasMore === true) return true;
  if (payload.has_more === false || payload.hasMore === false) return false;

  const total = Number(payload.total ?? payload.total_count ?? payload.totalCount);
  return Number.isFinite(total) && total > collectedCount;
}

function getNextModelsUrl(payload, currentUrl, collectedCount) {
  if (!payload || typeof payload !== "object") return "";

  const explicitNext =
    payload.next ??
    payload.next_url ??
    payload.nextUrl ??
    payload.links?.next ??
    payload.pagination?.next;
  if (typeof explicitNext === "string" && explicitNext.trim()) {
    return new URL(explicitNext.trim(), currentUrl).toString();
  }

  const current = new URL(currentUrl);
  const cursor = payload.next_cursor ?? payload.nextCursor ?? payload.next_page_token ?? payload.nextPageToken;
  if (cursor) {
    current.searchParams.set("cursor", String(cursor));
    return current.toString();
  }

  if (hasMoreModels(payload, collectedCount)) {
    const lastId = payload.last_id ?? getModelIdFromItem(getModelItems(payload).at(-1));
    if (lastId) {
      current.searchParams.set("after", String(lastId));
      current.searchParams.set("limit", current.searchParams.get("limit") ?? "200");
      return current.toString();
    }

    const page = Number(
      payload.page ??
        payload.current_page ??
        payload.currentPage ??
        current.searchParams.get("page") ??
        current.searchParams.get("page_number"),
    );
    if (Number.isFinite(page)) {
      const nextPage = String(page + 1);
      if (current.searchParams.has("page_number")) {
        current.searchParams.set("page_number", nextPage);
      } else {
        current.searchParams.set("page", nextPage);
      }
      if (!current.searchParams.has("page_size") && !current.searchParams.has("limit")) {
        const pageSize = payload.page_size ?? payload.pageSize ?? payload.limit ?? getModelItems(payload).length;
        if (pageSize) current.searchParams.set("page_size", String(pageSize));
      }
      return current.toString();
    }
  }

  return "";
}

async function listProviderModels({ apiBaseUrl, apiKey, headers = {} }) {
  const maxPages = 30;
  const maxModels = 10000;
  const seenUrls = new Set();
  const modelItems = [];
  const seenModelIds = new Set();
  let nextUrl = `${apiBaseUrl}/models`;
  let lastPayload = {};
  let lastStatus = 200;
  let truncated = false;

  for (let page = 0; page < maxPages && nextUrl; page += 1) {
    if (seenUrls.has(nextUrl)) break;
    seenUrls.add(nextUrl);

    const upstream = await proxyJson({ url: nextUrl, apiKey, headers });
    lastPayload = upstream.payload;
    lastStatus = upstream.status;
    if (!upstream.ok) return upstream;

    const pageItems = getModelItems(upstream.payload);
    let addedOnPage = 0;
    for (const item of pageItems) {
      const modelId = getModelIdFromItem(item);
      if (!modelId || seenModelIds.has(modelId)) continue;
      seenModelIds.add(modelId);
      modelItems.push(item);
      addedOnPage += 1;
      if (modelItems.length >= maxModels) {
        truncated = true;
        break;
      }
    }

    if (truncated) break;
    const candidateNextUrl = getNextModelsUrl(upstream.payload, nextUrl, seenModelIds.size);
    if (!candidateNextUrl || addedOnPage === 0) break;
    nextUrl = candidateNextUrl;
  }

  const hasObjectItems = modelItems.some((item) => item && typeof item === "object");
  return {
    ok: true,
    status: lastStatus,
    payload: {
      ...lastPayload,
      data: hasObjectItems
        ? modelItems.map((item) =>
            typeof item === "string"
              ? { id: item, object: "model" }
              : item,
          )
        : modelItems.map((item) => ({ id: getModelIdFromItem(item), object: "model" })),
      models: modelItems.map((item) => getModelIdFromItem(item)),
      _pagination: {
        pages: seenUrls.size,
        truncated,
      },
    },
  };
}

async function proxyStream({ url, apiKey, body, response, headers = {} }) {
  const ac = new AbortController();
  const abortUpstream = () => {
    if (!ac.signal.aborted) ac.abort(new Error("client aborted"));
  };
  response.once("close", abortUpstream);

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (error) {
    response.off("close", abortUpstream);
    if (ac.signal.aborted && response.destroyed) return;
    throw error;
  }

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    response.off("close", abortUpstream);
    const text = await upstreamResponse.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text || upstreamResponse.statusText };
    }
    sendJson(response, upstreamResponse.status, payload);
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream;charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const reader = upstreamResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (response.destroyed || response.writableEnded) {
        abortUpstream();
        break;
      }
      response.write(Buffer.from(value));
    }
  } finally {
    response.off("close", abortUpstream);
    try {
      await reader.cancel();
    } catch {}
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

async function handleApi(request, response, pathname, dataFilePath) {
  try {
    if (request.method === "OPTIONS") {
      sendOptions(response);
      return;
    }

    if (pathname === "/api/settings/get" || pathname === "/api/settings/save") {
      sendJson(response, 503, {
        error: "Renge 扩展设置通过 SillyTavern.getContext().extensionSettings 保存",
      });
      return;
    }

    if (pathname === "/api/backends/chat-completions/status") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const { apiBaseUrl, apiKey } = getTavernProviderTarget(body);
      const headers = getTavernProxyHeaders(body);
      const upstream = await listProviderModels({ apiBaseUrl, apiKey, headers });
      sendJson(response, upstream.ok ? 200 : upstream.status, upstream.payload);
      return;
    }

    if (pathname === "/api/backends/chat-completions/generate") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const { apiBaseUrl, apiKey } = getTavernProviderTarget(body);
      const headers = getTavernProxyHeaders(body);
      const requestBody = buildTavernChatCompletionRequest(body);
      if (!requestBody.model || !Array.isArray(requestBody.messages)) {
        sendJson(response, 400, { error: "第三方生成请求缺少 model 或 messages" });
        return;
      }
      const url = getCompatibleApiEndpoint(apiBaseUrl, "chat/completions");
      if (requestBody.stream === true) {
        await proxyStream({ url, apiKey, body: requestBody, response, headers });
        return;
      }
      const upstream = await proxyJson({
        url,
        apiKey,
        method: "POST",
        body: requestBody,
        headers,
      });
      sendJson(response, upstream.ok ? 200 : upstream.status, upstream.payload);
      return;
    }

    if (pathname.startsWith("/api/pc/")) {
      await handlePcFiles(request, response, pathname);
      return;
    }

    if (pathname.startsWith("/api/session-images/")) {
      const rest = pathname.slice("/api/session-images/".length);
      const [rawId, ...fileParts] = rest.split("/");
      const sessionId = decodeURIComponent(rawId || "");
      const dir = getSessionImagesDir(dataFilePath, sessionId);
      if (!dir) {
        sendJson(response, 400, { error: "非法 sessionId" });
        return;
      }
      if (request.method === "DELETE" && fileParts.length === 0) {
        try { await rm(dir, { recursive: true, force: true }); } catch (e) { console.log("[session-images] rm fail: " + (e && e.message)); }
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && fileParts.length === 1) {
        const fileName = decodeURIComponent(fileParts[0]);
        if (!/^[A-Za-z0-9._-]{1,200}$/.test(fileName)) {
          sendJson(response, 400, { error: "非法文件名" });
          return;
        }
        const filePath = resolve(dir, fileName);
        const rel = relative(dir, filePath);
        if (rel.startsWith("..") || isAbsolute(rel)) {
          sendJson(response, 400, { error: "路径越界" });
          return;
        }
        try {
          const buf = await readFile(filePath);
          const ext = extname(filePath).toLowerCase();
          const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/png";
          response.writeHead(200, {
            "Content-Type": mime,
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          });
          response.end(buf);
        } catch (e) {
          sendJson(response, 404, { error: "图片不存在" });
        }
        return;
      }
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    if (pathname === "/api/extensions/install") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const extension = await installTavernExtensionFromGit(dataFilePath, body.sourceUrl);
      sendJson(response, 200, { extension });
      return;
    }

    if (pathname.startsWith("/api/extensions/")) {
      const rest = pathname.slice("/api/extensions/".length);
      const [rawId, operation, ...rawFileParts] = rest.split("/");
      const extensionId = decodeURIComponent(rawId || "");
      const extensionDirectory = getExtensionDirectory(dataFilePath, extensionId);
      if (!extensionDirectory) {
        sendJson(response, 400, { error: "非法扩展 ID" });
        return;
      }

      if (request.method === "DELETE" && !operation) {
        await rm(extensionDirectory, { recursive: true, force: true });
        sendJson(response, 200, { ok: true, id: extensionId });
        return;
      }

      if (request.method === "GET" && operation === "files" && rawFileParts.length > 0) {
        const decodedParts = rawFileParts.map((part) => decodeURIComponent(part));
        await serveInstalledExtensionFile(
          response,
          dataFilePath,
          extensionId,
          decodedParts,
        );
        return;
      }

      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    if (pathname === "/api/app-data") {
      if (request.method === "GET") {
        sendJson(response, 200, {
          dataDir: dirname(dataFilePath),
          dataFile: dataFilePath,
          data: await readAppData(dataFilePath),
        });
        return;
      }

      if (request.method === "PUT" || request.method === "POST") {
        const body = await readJsonBody(request);
        const payload = body && typeof body === "object" && "data" in body ? body.data : body;
        await writeAppData(dataFilePath, payload ?? {});
        sendJson(response, 200, {
          ok: true,
          dataDir: dirname(dataFilePath),
          dataFile: dataFilePath,
        });
        return;
      }

      if (request.method === "DELETE") {
        await clearAppData(dataFilePath);
        sendJson(response, 200, {
          ok: true,
          dataDir: dirname(dataFilePath),
          dataFile: dataFilePath,
        });
        return;
      }

      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    const body = await readJsonBody(request);

    if (pathname === "/api/skills/import-folder") {
      const skill = await importSkillDirectory(dataFilePath, body.path);
      sendJson(response, 200, { skill });
      return;
    }

    if (pathname === "/api/skills/import-zip") {
      const skill = await importSkillZip(dataFilePath, body);
      sendJson(response, 200, { skill });
      return;
    }

    if (pathname === "/api/skills/context") {
      const result = await readSkillContexts(body.skills ?? []);
      sendJson(response, 200, result);
      return;
    }

    if (pathname === "/api/mcp/tools") {
      const result = await listMcpTools(body.servers ?? body.mcpServers ?? body);
      sendJson(response, 200, result);
      return;
    }

    if (pathname === "/api/mcp/call-tool") {
      const toolName = String(body.toolName ?? "");
      if (!toolName) {
        sendJson(response, 400, { error: "缺少 toolName" });
        return;
      }
      const args = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
      const result = await callMcpTool(body.servers ?? body.mcpServers ?? {}, toolName, args);
      sendJson(response, 200, result);
      return;
    }

    const { apiBaseUrl, apiKey } = getProviderTarget(body);
    const providerHeaders = getTavernProxyHeaders(body);

    if (pathname === "/api/providers/models") {
      const upstream = await listProviderModels({
        apiBaseUrl,
        apiKey,
        headers: providerHeaders,
      });
      sendJson(response, upstream.ok ? 200 : upstream.status, upstream.payload);
      return;
    }

    if (pathname === "/api/chat/completions") {
      if (!isObjectRecord(body.request)) {
        sendJson(response, 400, { error: "缺少 request" });
        return;
      }
      const requestBody = applyTavernRequestOverrides(body.request, body);

      // 检查是否是图片生成模型
      const model = String(requestBody.model ?? "").toLowerCase();
      const isImageModel = 
        model.includes("dall-e") || 
        model.includes("image") || 
        model.includes("gpt-image") ||
        model.includes("stable-diffusion") || 
        model.includes("sd-") ||
        model.includes("midjourney") ||
        model.includes("mj-") ||
        model.includes("flux") ||
        model.includes("civitai");

      console.log("[chat/completions] model=" + JSON.stringify(requestBody.model) + " isImageModel=" + isImageModel + " stream=" + (requestBody.stream === true));
      if (isImageModel) {
        try {
          const extractText = (m) => {
            if (!m) return "";
            if (typeof m.content === "string") return m.content;
            if (Array.isArray(m.content)) {
              return m.content
                .map((item) => (item && item.type === "text" ? item.text : ""))
                .filter(Boolean)
                .join(" ");
            }
            return "";
          };
          const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
          const lastUserMessage = [...messages].reverse().find((m) => m && m.role === "user");
          const lastUserPrompt = stripImageMessageMetadata(extractText(lastUserMessage)).trim();
          let prompt = buildImageConversationPrompt(messages, extractText, lastUserPrompt);
          if (!prompt) {
            prompt = messages
              .filter((m) => m && (m.role === "user" || m.role === "assistant"))
              .map(extractText)
              .map(stripImageMessageMetadata)
              .filter(Boolean)
              .join("\n")
              .trim();
          }

          // 收集完整历史图片。对每条消息优先使用本地缓存或会话图片路由；
          // 如果没有本地缓存，再使用外链/data URL。保持时间顺序，让上游能看到完整改图链路。
          const referenceCandidates = [];
          const addReferenceCandidate = (value) => {
            const normalized = String(value ?? "").trim();
            if (!normalized) return;
            if (!referenceCandidates.includes(normalized)) referenceCandidates.push(normalized);
          };
          for (const m of messages) {
            if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
            for (const ref of extractImageRefsFromMessageContent(m)) addReferenceCandidate(ref);
            const t = extractText(m);
            if (!t) continue;
            const localPathRefs = [...t.matchAll(/<!--\s*local-image-path:\s*([^>]+?)\s*-->/gi)].map((match) => match[1]);
            if (localPathRefs.length > 0) {
              localPathRefs.forEach(addReferenceCandidate);
              continue;
            }
            const localSessionRefs = [...t.matchAll(/!\[[^\]]*\]\((\/api\/session-images\/[^)\s]+)\)/gi)].map((match) => match[1]);
            if (localSessionRefs.length > 0) {
              localSessionRefs.forEach(addReferenceCandidate);
              continue;
            }
            [
              ...[...t.matchAll(/<!--\s*source-url:\s*([^>]+?)\s*-->/gi)].map((match) => match[1]),
              ...[...t.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+|data:image\/[^)\s]+)\)/gi)].map((match) => match[1]),
            ].forEach(addReferenceCandidate);
          }

          // 如果参考图是本地路径或 /api/session-images/...，转成 data URL 以便上游能取到字节。
          // 某个候选失败时继续尝试下一个；成功的所有历史图片都会一起传给 edits。
          const referenceImages = [];
          const referenceDataUrls = [];
          const seenResolvedReferences = new Set();
          for (const candidate of referenceCandidates) {
            try {
              const resolvedReference = await resolveImageReferenceForUpstream(dataFilePath, candidate);
              if (!resolvedReference) continue;
              if (seenResolvedReferences.has(resolvedReference)) continue;
              seenResolvedReferences.add(resolvedReference);
              referenceImages.push(candidate);
              referenceDataUrls.push(resolvedReference);
            } catch (e) {
              console.log("[images/generations] referenceImage candidate load fail: " + String(candidate).slice(0, 120) + " err=" + (e && e.message));
            }
          }
          if (referenceImages.length > 0) {
            console.log("[images/generations] referenceImages count=" + referenceImages.length + " latest=" + String(referenceImages[referenceImages.length - 1]).slice(0, 160));
          }

          console.log("[images/generations] prompt=" + JSON.stringify(prompt.slice(0, 180)) + " referenceCount=" + referenceDataUrls.length);

          if (!prompt) {
            sendJson(response, 400, { error: "图片生成提示词不能为空" });
            return;
          }

          // 构造图片生成请求
          const requestedImageSize = typeof requestBody.size === "string" ? requestBody.size : "";
          const imageRequestBody = {
            prompt,
            model: requestBody.model,
            n: 1,
            size: pickDefaultImageSize(requestBody.model, prompt, requestedImageSize),
            response_format: "url"
          };

          // 支持用户自定义参数
          imageRequestBody.n = 1;
          if (requestBody.quality) imageRequestBody.quality = requestBody.quality;
          if (requestBody.style) imageRequestBody.style = requestBody.style;

          let upstream;
          if (referenceDataUrls.length > 0) {
            console.log("[images/edits] upload references count=" + referenceDataUrls.length + " totalSize=" + referenceDataUrls.reduce((sum, item) => sum + item.length, 0));
            upstream = await proxyForm({
              url: `${apiBaseUrl}/images/edits`,
              apiKey,
              method: "POST",
              form: await createImageEditForm(imageRequestBody, referenceDataUrls),
              timeoutMs: 180_000,
            });
            if (!upstream.ok || getImageGenerationPayloadError(upstream.payload)) {
              console.log("[images/edits] result status=" + upstream.status + " payload=" + JSON.stringify(upstream.payload).slice(0, 300));
            }
          }

          if (!upstream || shouldFallbackImageEditToGeneration(upstream)) {
            // 兼容旧上游：有些 OpenAI-compatible 服务没有 /images/edits，只接受
            // /images/generations 里额外带 image 字段。这个路径作为回退，优先用 edits。
            const latestReferenceDataUrl = referenceDataUrls[referenceDataUrls.length - 1] ?? "";
            if (latestReferenceDataUrl) {
              imageRequestBody.image = latestReferenceDataUrl;
              console.log("[images/generations] fallback inject latest reference size=" + latestReferenceDataUrl.length + " allReferenceCount=" + referenceDataUrls.length);
            }
            upstream = await proxyJson({
              url: `${apiBaseUrl}/images/generations`,
              apiKey,
              method: "POST",
              body: imageRequestBody,
              timeoutMs: 180_000, // 给生图上游 3 分钟，比它内部的 120s 阈值多一些
            });
          }

          if (upstream.ok && isRetriableImageGenerationPayloadError(upstream.payload)) {
            console.log("[images/generations] retry after upstream payload error model=" + JSON.stringify(requestBody.model) + " error=" + JSON.stringify(getImageGenerationPayloadError(upstream.payload)));
            if (referenceDataUrls.length > 0) {
              upstream = await proxyForm({
                url: `${apiBaseUrl}/images/edits`,
                apiKey,
                method: "POST",
                form: await createImageEditForm(imageRequestBody, referenceDataUrls),
                timeoutMs: 180_000,
              });
            } else {
              upstream = await proxyJson({
                url: `${apiBaseUrl}/images/generations`,
                apiKey,
                method: "POST",
                body: imageRequestBody,
                timeoutMs: 180_000,
              });
            }
          }

          if (shouldRetryImageGenerationWithSmallerSize(upstream, imageRequestBody, requestedImageSize)) {
            const retryBody = { ...imageRequestBody, size: "512x512" };
            console.log("[images/generations] retry with smaller size after timeout model=" + JSON.stringify(requestBody.model) + " originalSize=" + JSON.stringify(imageRequestBody.size));
            upstream = await proxyJson({
              url: `${apiBaseUrl}/images/generations`,
              apiKey,
              method: "POST",
              body: retryBody,
              timeoutMs: 90_000,
            });
          }

          const payloadErrorMessage = upstream.ok ? getImageGenerationPayloadError(upstream.payload) : "";

          if (upstream.ok && !payloadErrorMessage) {
            // 转换为聊天 completion 格式
            const images = (upstream.payload.data ?? []).slice(0, 1);
            try { const first = images[0]; const sample = first ? Object.fromEntries(Object.entries(first).map(([k,v]) => [k, typeof v === "string" ? v.slice(0, 80) : typeof v])) : null; console.log("[images/generations] ok count=" + images.length + " keys=" + (first ? Object.keys(first).join(",") : "-") + " sample=" + JSON.stringify(sample)); } catch {}
            if (images.length === 0) {
              sendJson(response, 200, {
                id: "img_" + Date.now(),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: requestBody.model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: "图片生成失败，没有返回任何图片结果"
                    },
                    finish_reason: "stop"
                  }
                ],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
              });
              return;
            }

            // 支持多张图片和base64格式；外链图片落盘以便本地识图 MCP 可读。
            // 优先按 sessionId 分目录持久化，会话删除时一并清理；缺 sessionId 时退化到公共目录。
            const sessionImagesDir = getSessionImagesDir(dataFilePath, body.sessionId);
            const imagesDir = sessionImagesDir || join(dirname(dataFilePath), "generated-images");
            try { await mkdir(imagesDir, { recursive: true }); } catch (e) { console.log("[images/generations] mkdir fail: " + (e && e.message)); }
            const parts = await Promise.all(images.map(async (img, idx) => {
              let imageUrl = "";
              if (typeof img.url === "string" && img.url) {
                imageUrl = img.url;
              } else if (typeof img.b64_json === "string" && img.b64_json) {
                imageUrl = `data:image/png;base64,${img.b64_json}`;
              } else if (typeof img.image_url === "string" && img.image_url) {
                imageUrl = img.image_url;
              } else if (img.image_url && typeof img.image_url === "object" && typeof img.image_url.url === "string") {
                imageUrl = img.image_url.url;
              } else if (typeof img.base64 === "string" && img.base64) {
                imageUrl = `data:image/png;base64,${img.base64}`;
              }
              if (!imageUrl) {
                return "图片生成失败：上游未返回 url 或 b64_json 字段";
              }
              // 落盘：外链/dataURL 缓存到本地，便于本地视觉模型识图
              let localPath = "";
              try {
                const stamp = Date.now();
                const rand = Math.random().toString(36).slice(2, 8);
                if (imageUrl.startsWith("data:")) {
                  const m = imageUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/);
                  if (m) {
                    const ext = (m[1] || "png").toLowerCase().replace("jpeg", "jpg");
                    const fname = `${stamp}-${rand}-${idx}.${ext}`;
                    const fpath = join(imagesDir, fname);
                    await writeFile(fpath, Buffer.from(m[2], "base64"));
                    localPath = fpath;
                  }
                } else if (/^https?:\/\//i.test(imageUrl)) {
                  const { response: resp, buffer: buf } = await downloadBinaryWithTimeout(imageUrl, 15000);
                  if (resp.ok && buf) {
                    const ct = resp.headers.get("content-type") || "";
                    let ext = "png";
                    if (/jpeg|jpg/i.test(ct)) ext = "jpg";
                    else if (/webp/i.test(ct)) ext = "webp";
                    else if (/gif/i.test(ct)) ext = "gif";
                    else if (/png/i.test(ct)) ext = "png";
                    else {
                      try {
                        const urlExt = extname(new URL(imageUrl).pathname).replace(/^\./, "").toLowerCase();
                        if (urlExt) ext = urlExt.replace("jpeg", "jpg");
                      } catch {}
                    }
                    const fname = `${stamp}-${rand}-${idx}.${ext}`;
                    const fpath = join(imagesDir, fname);
                    await writeFile(fpath, buf);
                    localPath = fpath;
                  } else {
                    console.log("[images/generations] download fail status=" + resp.status + " url=" + imageUrl.slice(0, 120));
                  }
                }
              } catch (e) {
                console.log("[images/generations] cache fail: " + (e && e.message));
              }
              // 若已落到会话目录，markdown 改指向本地服务路由，做到会话级可持久化展示
              let displayUrl = imageUrl;
              let fileName = "";
              if (localPath && sessionImagesDir && localPath.startsWith(sessionImagesDir)) {
                fileName = basename(localPath);
                displayUrl = `/api/session-images/${encodeURIComponent(body.sessionId)}/${encodeURIComponent(fileName)}`;
              }
              const md = `![生成的图片](${displayUrl})`;
              // 原始外链（如果有）保留下来，便于下一轮图生图直接给上游传外链而不是塞 base64
              const isHttpOrigin = typeof imageUrl === "string" && /^https?:\/\//i.test(imageUrl);
              const annotations = [];
              if (localPath) annotations.push(`<!-- local-image-path: ${localPath} -->`);
              if (isHttpOrigin && imageUrl !== displayUrl) annotations.push(`<!-- source-url: ${imageUrl} -->`);
              if (annotations.length === 0) return md;
              return `${md}\n\n${annotations.join("\n")}`;
            }));
            const content = parts.join("\n\n");

            sendJson(response, 200, {
              id: "img_" + Date.now(),
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: requestBody.model,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content },
                  finish_reason: "stop"
                }
              ],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            });
          } else {
            // 处理上游错误，给出更友好的提示
            console.log("[images/generations] upstream FAIL status=" + upstream.status + " payload=" + JSON.stringify(upstream.payload).slice(0, 300));
            const errorMsg =
              payloadErrorMessage ||
              upstream.payload?.error?.message ||
              JSON.stringify(upstream.payload);
            sendJson(response, upstream.ok ? 502 : upstream.status, {
              error: `图片生成失败: ${errorMsg}`
            });
          }
        } catch (error) {
          sendJson(response, 500, {
            error: `图片生成出错: ${error.message}`
          });
        }
        return;
      }
      if (requestBody.stream === true) {
        await proxyStream({
          url: `${apiBaseUrl}/chat/completions`,
          apiKey,
          body: requestBody,
          response,
          headers: providerHeaders,
        });
        return;
      }

      const upstream = await proxyJson({
        url: `${apiBaseUrl}/chat/completions`,
        apiKey,
        method: "POST",
        body: requestBody,
        headers: providerHeaders,
      });
      sendJson(response, upstream.ok ? 200 : upstream.status, upstream.payload);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    if (response.destroyed) {
      return;
    }
    if (response.headersSent) {
      if (!response.writableEnded) response.end();
      return;
    }
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

async function serveStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(distDir, normalizedPath));

  if (!filePath.startsWith(distDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    const extension = extname(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] ?? "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    });
    response.end(content);
  } catch {
    const indexContent = await readFile(join(distDir, "index.html"));
    response.writeHead(200, {
      "Content-Type": "text/html;charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(indexContent);
  }
}

export function startRengeServer(options = {}) {
  const host = options.host ?? "::";
  const port = options.port ?? defaultPort;
  const dataDir = resolve(options.dataDir ?? getDefaultDataDir());
  const dataFilePath = resolve(dataDir, appDataFileName);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname === "/csrf-token") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      sendJson(response, 200, { token: "renge-local-extension" });
      return;
    }

    if (tavernCompatModulePaths.has(url.pathname)) {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      sendTavernCompatModule(response);
      return;
    }

    if (url.pathname.startsWith("/scripts/extensions/third-party/")) {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      try {
        const rest = url.pathname.slice("/scripts/extensions/third-party/".length);
        const [rawId, ...rawFileParts] = rest.split("/");
        const extensionId = decodeURIComponent(rawId || "");
        const decodedParts = rawFileParts.map((part) => decodeURIComponent(part));
        await serveInstalledExtensionFile(response, dataFilePath, extensionId, decodedParts);
      } catch {
        sendJson(response, 400, { error: "非法扩展文件路径" });
      }
      return;
    }

    if (url.pathname.startsWith("/scripts/extensions/")) {
      sendJson(response, 404, { error: "扩展资源不存在" });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname, dataFilePath);
      return;
    }

    await serveStatic(request, response, url.pathname);
  });

  return new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(port, host, () => {
      server.off("error", rejectServer);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolveServer({
        server,
        host,
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}`,
        dataDir,
        dataFile: dataFilePath,
      });
    });
  });
}

function formatNetworkUrl(address, port) {
  if (!address) return "";
  if (address.family === "IPv6") {
    const scopedAddress = address.address.includes("%")
      ? address.address.slice(0, address.address.indexOf("%"))
      : address.address;
    return `http://[${scopedAddress}]:${port}`;
  }
  return `http://${address.address}:${port}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startRengeServer({ host: "::", port: defaultPort }).then(({ port, dataFile }) => {
    console.log(`Renge Agent Lab server running at http://localhost:${port}`);
    const networkUrls = Object.values(networkInterfaces())
      .flat()
      .filter((address) => address && !address.internal && (address.family === "IPv4" || address.family === "IPv6"))
      .map((address) => formatNetworkUrl(address, port))
      .filter(Boolean);
    if (networkUrls.length > 0) {
      console.log(`Network access: ${networkUrls.join("  ")}`);
    }
    console.log("External IPv6 access uses the global IPv6 address above, if your firewall and ISP allow inbound connections.");
    console.log(`Persistent data: ${dataFile}`);
  });
}


