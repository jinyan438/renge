import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Electron's Node entrypoint can exit while tsx is still importing the adapter.
// A live desktop window normally owns this event-loop lifetime.
const keepAlive = setInterval(() => {}, 1_000);
let agentDir;
let extension;
const context = { cwd: process.cwd(), hasUI: false };
try {
  const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const { createPiMcpAdapter } = await import("../../pi/pi-mcp-adapter-bridge.mjs");
  agentDir = await mkdtemp(join(tmpdir(), "renge-electron-mcp-"));
  const factory = await createPiMcpAdapter({
    mcpServers: {
      fixture: {
        command: process.execPath,
        args: [fileURLToPath(new URL("mcp-stdio-server.mjs", import.meta.url))],
        lifecycle: "lazy",
      },
    },
  }, { agentDir });
  const resourceLoader = new DefaultResourceLoader({
    cwd: context.cwd,
    agentDir,
    settingsManager: SettingsManager.create(context.cwd, agentDir),
    extensionFactories: [factory],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  extension = resourceLoader.getExtensions().extensions[0];
  assert.ok(extension);
  await extension.handlers.get("session_start")[0]({}, context);
  const mcpTool = extension.tools.get("mcp").definition;
  const connected = await mcpTool.execute("connect", { connect: "fixture" }, undefined, undefined, context);
  assert.deepEqual(connected.details.tools, ["fixture_echo"]);
  const called = await mcpTool.execute("echo", {
    tool: "fixture_echo",
    args: { text: "Electron native MCP" },
  }, undefined, undefined, context);
  assert.equal(called.content[0].text, "Electron native MCP");
  console.log(JSON.stringify({ electronVersion: process.versions.electron, text: called.content[0].text }));
} finally {
  try {
    if (extension) await extension.handlers.get("session_shutdown")[0]({}, context);
  } finally {
    if (agentDir) await rm(agentDir, { recursive: true, force: true });
    clearInterval(keepAlive);
  }
}
