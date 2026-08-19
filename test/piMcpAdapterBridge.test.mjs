import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  callPiMcpTool,
  createPiMcpAdapter,
  discoverPiMcpTools,
  normalizePiMcpConfig,
} from "../pi/pi-mcp-adapter-bridge.mjs";

test("normalizes Renge MCP servers without dropping Pi adapter fields", () => {
  const config = normalizePiMcpConfig({
    mcpServers: [{
      id: "ui-only",
      name: "docs",
      enabled: true,
      transport: "http",
      url: "https://example.test/mcp",
      lifecycle: "keep-alive",
      directTools: ["search"],
      includeTools: ["search", "read"],
      bearerTokenEnv: "DOCS_TOKEN",
      updatedAt: "2026-08-20T00:00:00.000Z",
    }],
    settings: { toolPrefix: "mcp", freezeDirectTools: true },
  });

  assert.deepEqual(config, {
    mcpServers: {
      docs: {
        url: "https://example.test/mcp",
        lifecycle: "keep-alive",
        directTools: ["search"],
        includeTools: ["search", "read"],
        bearerTokenEnv: "DOCS_TOKEN",
      },
    },
    settings: { toolPrefix: "mcp", freezeDirectTools: true },
  });
});

test("discovers and calls stdio tools through the adapter server manager", async () => {
  const config = {
    mcpServers: {
      fixture: {
        command: process.execPath,
        args: [join(process.cwd(), "test", "fixtures", "mcp-stdio-server.mjs")],
      },
    },
  };
  const discovered = await discoverPiMcpTools(config);
  assert.deepEqual(discovered.errors, []);
  assert.equal(discovered.tools.length, 1);
  assert.equal(discovered.tools[0].function.name, "mcp_fixture_echo");

  const called = await callPiMcpTool(config, "mcp_fixture_echo", { text: "Pi native MCP" });
  assert.equal(called.result.content[0].text, "Pi native MCP");
});

test("loads pi-mcp-adapter as a native Pi extension", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "renge-pi-mcp-adapter-"));
  try {
    const factory = await createPiMcpAdapter({
      mcpServers: {
        lazy: { url: "http://127.0.0.1:1/mcp", lifecycle: "lazy" },
      },
    });
    const settingsManager = SettingsManager.create(process.cwd(), agentDir);
    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir,
      settingsManager,
      extensionFactories: [factory],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });

    await resourceLoader.reload();
    const tools = resourceLoader.getExtensions().extensions.flatMap((extension) => [
      ...extension.tools.keys(),
    ]);
    assert.ok(tools.includes("mcp"));
    assert.ok(tools.includes("mcpScript"));
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});
