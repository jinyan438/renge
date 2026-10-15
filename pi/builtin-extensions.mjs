import { join } from "node:path";
import {
  createCodemodeExtension, createMcpExtension, createToolSearchExtension,
} from "@earendil-works/pi-coding-agent";

// Pi 1.2 exports the factories, but its MCP config and credential stores are
// package-local. Keep the pinned integration here so explicit agentDir works
// for embedded hosts too, without changing the process-wide environment.
const sdkFile = (path) => new URL(path, import.meta.resolve("@earendil-works/pi-coding-agent"));

export async function createPiBuiltinExtensions({ agentDir, legacyMcp = false, enableMcp = true }) {
  const factories = [
    { name: "codemode", factory: createCodemodeExtension(), builtin: true, replaceable: true },
    { name: "tool-search", factory: createToolSearchExtension(), builtin: true, replaceable: true },
  ];
  if (enableMcp && !legacyMcp) {
    const [{ loadMcpConfig }, { McpOAuthCredentialStore }, { FileAuthStorageBackend }] = await Promise.all([
      import(sdkFile("extensions/mcp/config.js")),
      import(sdkFile("extensions/mcp/oauth.js")),
      import(sdkFile("core/auth-storage.js")),
    ]);
    factories.push({
      name: "mcp", builtin: true, replaceable: true,
      factory: createMcpExtension({
        loadConfig: (ctx) => loadMcpConfig({ agentDir, cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() }),
        credentials: new McpOAuthCredentialStore(new FileAuthStorageBackend(join(agentDir, "mcp-auth.json")), agentDir),
        logPath: join(agentDir, "mcp.log"),
      }),
    });
  }
  return factories;
}
