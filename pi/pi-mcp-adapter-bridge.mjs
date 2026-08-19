import { tsImport } from "tsx/esm/api";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let adapterModulePromise;
let managerModulePromise;
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringMap(value) {
  const source = objectRecord(value);
  return Object.fromEntries(
    Object.entries(source)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .map(([key, entry]) => [String(key), String(entry)]),
  );
}

function rawServerEntries(rawConfig) {
  const source = objectRecord(rawConfig);
  const rawServers = source.mcpServers ?? source.servers ?? source;
  if (Array.isArray(rawServers)) {
    return rawServers.map((server, index) => {
      const definition = objectRecord(server);
      const name = String(definition.name ?? `server_${index + 1}`).trim() || `server_${index + 1}`;
      return [name, definition];
    });
  }
  return Object.entries(objectRecord(rawServers))
    .filter(([name]) => name !== "settings" && name !== "imports" && name !== "$schema")
    .map(([name, server]) => [name, objectRecord(server)]);
}

function serverIdMap(rawConfig) {
  return new Map(rawServerEntries(rawConfig).map(([name, server]) => [
    name,
    String(server.id ?? name).trim() || name,
  ]));
}

function normalizeServer(raw, fallbackName = "mcp") {
  const source = objectRecord(raw);
  const url = String(source.url ?? source.baseUrl ?? "").trim();
  const command = String(source.command ?? "").trim();
  const socket = String(source.socket ?? "").trim();
  const declaredTransport = String(source.transport ?? source.type ?? "").trim().toLowerCase();
  const normalized = {
    ...source,
    ...(command ? { command } : {}),
    ...(url ? { url } : {}),
    ...(socket ? { socket } : {}),
    ...(Array.isArray(source.args) ? { args: source.args.map(String) } : {}),
    ...(source.env !== undefined ? { env: stringMap(source.env) } : {}),
    ...(source.headers !== undefined ? { headers: stringMap(source.headers) } : {}),
  };
  delete normalized.id;
  delete normalized.name;
  delete normalized.enabled;
  delete normalized.transport;
  delete normalized.type;
  delete normalized.baseUrl;
  delete normalized.updatedAt;
  if (!command) delete normalized.command;
  if (!url) delete normalized.url;
  if (!socket) delete normalized.socket;

  // Renge keeps both transport form fields in UI state. Pi treats a present
  // `url` as an HTTP server even when it is empty, so only pass the transport
  // selected by the user to the adapter.
  if (declaredTransport === "stdio") {
    delete normalized.url;
    delete normalized.socket;
    delete normalized.headers;
  } else if (
    declaredTransport === "http" ||
    declaredTransport === "sse" ||
    declaredTransport === "streamablehttp" ||
    declaredTransport === "streamable_http"
  ) {
    delete normalized.command;
    delete normalized.args;
    delete normalized.cwd;
    delete normalized.env;
    delete normalized.socket;
  }
  if (source.enabled === false || source.disabled === true) normalized.disabled = true;
  else delete normalized.disabled;
  if (!normalized.command && !normalized.url && !normalized.socket) {
    return { name: fallbackName, definition: normalized };
  }
  return { name: fallbackName, definition: normalized };
}

export function normalizePiMcpConfig(rawConfig) {
  const source = objectRecord(rawConfig);
  const mcpServers = {};
  for (const [name, server] of rawServerEntries(rawConfig)) {
    mcpServers[name] = normalizeServer(server, name).definition;
  }
  const settings = objectRecord(source.settings);
  return {
    ...(source.imports ? { imports: Array.isArray(source.imports) ? source.imports.map(String) : [] } : {}),
    mcpServers,
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
  };
}

async function loadAdapterModule() {
  adapterModulePromise ??= tsImport("pi-mcp-adapter", import.meta.url);
  return adapterModulePromise;
}

async function loadManagerModule() {
  managerModulePromise ??= (async () => {
    const packageRoot = resolve(projectRoot, "node_modules", "pi-mcp-adapter");
    return tsImport(pathToFileURL(resolve(packageRoot, "server-manager.ts")).href, import.meta.url);
  })();
  return managerModulePromise;
}

export async function createPiMcpAdapter(config) {
  const module = await loadAdapterModule();
  return module.createMcpAdapter({ config: normalizePiMcpConfig(config) });
}

function toToolDefinition(serverName, serverId, tool) {
  const originalName = String(tool?.name ?? "").trim();
  if (!originalName) return null;
  return {
    type: "function",
    function: {
      name: `mcp_${serverName}_${originalName}`.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64),
      description: `[MCP:${serverName}] ${String(tool.description ?? originalName)}`,
      parameters: tool.inputSchema && typeof tool.inputSchema === "object"
        ? tool.inputSchema
        : { type: "object", properties: {} },
    },
    serverId,
    serverName,
    originalName,
  };
}

export async function discoverPiMcpTools(rawConfig, { cwd = process.cwd(), signal } = {}) {
  const config = normalizePiMcpConfig(rawConfig);
  const serverIds = serverIdMap(rawConfig);
  const { McpServerManager } = await loadManagerModule();
  const manager = new McpServerManager(cwd);
  const tools = [];
  const errors = [];
  try {
    for (const [serverName, definition] of Object.entries(config.mcpServers)) {
      if (definition.disabled === true) continue;
      try {
        const connection = await manager.connect(serverName, definition, signal);
        for (const tool of connection.tools ?? []) {
          const normalized = toToolDefinition(serverName, serverIds.get(serverName) ?? serverName, tool);
          if (normalized) tools.push(normalized);
        }
      } catch (error) {
        errors.push({
          serverId: serverIds.get(serverName) ?? serverName,
          serverName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { tools, errors };
  } finally {
    await manager.closeAll().catch(() => undefined);
  }
}

export async function callPiMcpTool(rawConfig, toolName, args, { cwd = process.cwd(), signal } = {}) {
  const config = normalizePiMcpConfig(rawConfig);
  const { McpServerManager } = await loadManagerModule();
  const manager = new McpServerManager(cwd);
  try {
    for (const [serverName, definition] of Object.entries(config.mcpServers)) {
      if (definition.disabled === true) continue;
      const connection = await manager.connect(serverName, definition, signal);
      const tool = (connection.tools ?? []).find((candidate) => {
        const candidateName = String(candidate?.name ?? "").trim();
        return candidateName && `mcp_${serverName}_${candidateName}`.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64) === toolName;
      });
      if (!tool) continue;
      const result = await connection.client.callTool(
        { name: tool.name, arguments: args && typeof args === "object" ? args : {} },
        manager.getRequestOptions?.(serverName, signal),
      );
      return { ok: true, serverId: serverName, serverName, toolName: tool.name, result };
    }
  } finally {
    await manager.closeAll().catch(() => undefined);
  }
  throw new Error(`没有找到启用的 MCP 工具：${toolName}`);
}
