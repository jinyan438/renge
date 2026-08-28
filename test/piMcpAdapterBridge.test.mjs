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

test("removes inactive UI transport fields before loading the Pi adapter", () => {
  const config = normalizePiMcpConfig({
    mcpServers: [{
      id: "ui-server-id",
      name: "stdio-fixture",
      enabled: true,
      transport: "stdio",
      command: process.execPath,
      args: ["server.mjs"],
      cwd: process.cwd(),
      env: {},
      url: "",
      headers: {},
    }],
  });

  assert.deepEqual(config, {
    mcpServers: {
      "stdio-fixture": {
        command: process.execPath,
        args: ["server.mjs"],
        cwd: process.cwd(),
        env: {},
      },
    },
  });
});

test("discovers and calls stdio tools through the adapter server manager", async () => {
  const config = {
    mcpServers: [
      {
        id: "fixture-ui-id",
        name: "fixture",
        enabled: true,
        transport: "stdio",
        command: process.execPath,
        args: [join(process.cwd(), "test", "fixtures", "mcp-stdio-server.mjs")],
        url: "",
        headers: {},
      },
    ],
  };
  // The HTTP API unwraps `servers` before calling the bridge, so the bridge
  // must also accept the UI array as its root value.
  const discovered = await discoverPiMcpTools(config.mcpServers);
  assert.deepEqual(discovered.errors, []);
  assert.equal(discovered.tools.length, 1);
  assert.equal(discovered.tools[0].serverId, "fixture-ui-id");
  assert.equal(discovered.tools[0].function.name, "mcp_fixture_echo");

  const called = await callPiMcpTool(config.mcpServers, "mcp_fixture_echo", { text: "Pi native MCP" });
  assert.equal(called.result.content[0].text, "Pi native MCP");
});

test("discovers tools through a Windows batch stdio entrypoint", {
  skip: process.platform !== "win32",
}, async () => {
  const config = {
    mcpServers: [{
      id: "batch-ui-id",
      name: "batch-fixture",
      enabled: true,
      transport: "stdio",
      command: join(process.cwd(), "test", "fixtures", "mcp-stdio-server.bat"),
      args: ["--client"],
      url: "",
      headers: {},
    }],
  };

  const discovered = await discoverPiMcpTools(config);
  assert.deepEqual(discovered.errors, []);
  assert.equal(discovered.tools.length, 1);
  assert.equal(discovered.tools[0].serverId, "batch-ui-id");
  assert.equal(discovered.tools[0].function.name, "mcp_batch-fixture_echo");
});

test("connects a UI-shaped stdio server through Pi's native mcp tool", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "renge-pi-native-mcp-"));
  let extension;
  const context = {
    cwd: process.cwd(),
    hasUI: false,
    signal: undefined,
    model: undefined,
    modelRegistry: undefined,
  };
  try {
    const factory = await createPiMcpAdapter({
      mcpServers: [{
        id: "native-ui-id",
        name: "native-fixture",
        enabled: true,
        transport: "stdio",
        command: process.execPath,
        args: [join(process.cwd(), "test", "fixtures", "mcp-stdio-server.mjs")],
        url: "",
        headers: {},
        lifecycle: "lazy",
      }],
    }, { agentDir });
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
    extension = resourceLoader.getExtensions().extensions[0];
    await extension.handlers.get("session_start")[0]({}, context);
    const mcpTool = extension.tools.get("mcp").definition;
    const connected = await mcpTool.execute(
      "connect-call",
      { connect: "native-fixture" },
      undefined,
      undefined,
      context,
    );
    assert.equal(connected.details.count, 1);
    assert.deepEqual(connected.details.tools, ["native-fixture_echo"]);

    const called = await mcpTool.execute(
      "tool-call",
      { tool: "native-fixture_echo", args: { text: "Pi native gateway" } },
      undefined,
      undefined,
      context,
    );
    assert.equal(called.content[0].text, "Pi native gateway");
  } finally {
    if (extension) {
      await extension.handlers.get("session_shutdown")[0]({}, context);
    }
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("loads pi-mcp-adapter as a native Pi extension", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "renge-pi-mcp-adapter-"));
  try {
    const factory = await createPiMcpAdapter({
      mcpServers: {
        lazy: { url: "http://127.0.0.1:1/mcp", lifecycle: "lazy" },
      },
    }, { agentDir });
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
