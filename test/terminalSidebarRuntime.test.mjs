import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTerminalToolsSystemPrompt,
  executeTerminalTool,
  getTerminalSidebarApi,
  isTerminalSidebarAvailable,
  isTerminalToolName,
  registerTerminalSidebarOpener,
  setTerminalWorkspaceContext,
  stripTerminalControlSequences,
  terminalToolDefinitions,
} from "../src/terminalSidebarRuntime.ts";

test("exposes the complete terminal control tool set", () => {
  const names = terminalToolDefinitions.map((tool) => tool.function.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, [
    "terminal_list",
    "terminal_create",
    "terminal_read",
    "terminal_write",
    "terminal_run",
    "terminal_resize",
    "terminal_restart",
    "terminal_close",
  ]);
  assert.equal(names.every(isTerminalToolName), true);
  assert.match(buildTerminalToolsSystemPrompt(), /严格按需/);
  assert.match(buildTerminalToolsSystemPrompt(), /生成 SVG\/HTML/);
  assert.match(buildTerminalToolsSystemPrompt(), /不得调用 terminal_list/);
  assert.match(buildTerminalToolsSystemPrompt(), /terminal_close/);
});

test("removes terminal control sequences while preserving readable output", () => {
  const raw = "\u001b[32mREADY\u001b[0m\r\n\u001b]0;PowerShell\u0007PS> ";
  assert.equal(stripTerminalControlSequences(raw), "READY\nPS> ");
});

test("selects the Android terminal contract when Electron is unavailable", async () => {
  const androidApi = {
    isAndroid: true,
    async listSidebarTerminals() { return []; },
    async createSidebarTerminal() { return {}; },
    async readSidebarTerminal() { return {}; },
    async writeSidebarTerminal() { return { ok: true }; },
    async resizeSidebarTerminal() { return { ok: true }; },
    async restartSidebarTerminal() { return {}; },
    async closeSidebarTerminal({ id }) { return { ok: true, id }; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = { rengeAndroid: androidApi };
  try {
    assert.equal(getTerminalSidebarApi(), androidApi);
    assert.equal(isTerminalSidebarAvailable(), true);
    assert.deepEqual(await executeTerminalTool("terminal_list", "{}"), []);
    assert.deepEqual(
      await executeTerminalTool("terminal_close", JSON.stringify({ id: "android-1" })),
      { ok: true, id: "android-1" },
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("routes AI terminal tools through the Electron bridge and opens the sidebar", async () => {
  const calls = [];
  let output = "\u001b[32mPS>\u001b[0m ";
  const session = {
    id: "terminal-1",
    workspaceKey: "electron:E:\\workspace",
    title: "AI 终端",
    shell: "PowerShell",
    cwd: "E:\\workspace",
    createdAt: 1,
    exited: false,
    exitCode: null,
    buffer: output,
    outputOffset: output.length,
  };
  const desktopApi = {
    isElectron: true,
    async listSidebarTerminals() {
      calls.push("list");
      return [session];
    },
    async createSidebarTerminal(options) {
      calls.push(["create", options]);
      return session;
    },
    async readSidebarTerminal(options) {
      calls.push(["read", options]);
      const from = Number(options.from ?? Math.max(0, output.length - Number(options.maxChars ?? 20_000)));
      const chunk = output.slice(from, from + Number(options.maxChars ?? 20_000));
      return {
        ...session,
        output: chunk,
        cursor: from,
        nextCursor: from + chunk.length,
        truncated: false,
        hasMore: from + chunk.length < output.length,
        outputOffset: output.length,
      };
    },
    async writeSidebarTerminal(options) {
      calls.push(["write", options]);
      output += options.data + "\u001b[33mDONE\u001b[0m\r\n";
      return { ok: true };
    },
    async resizeSidebarTerminal(options) {
      calls.push(["resize", options]);
      return { ok: true };
    },
    async restartSidebarTerminal(options) {
      calls.push(["restart", options]);
      return session;
    },
    async closeSidebarTerminal(options) {
      calls.push(["close", options]);
      return { ok: true, id: options.id };
    },
  };
  const previousWindow = globalThis.window;
  globalThis.window = {
    rengeDesktop: desktopApi,
    setTimeout,
    clearTimeout,
  };
  let opened = 0;
  const unregister = registerTerminalSidebarOpener(() => {
    opened += 1;
  });
  setTerminalWorkspaceContext({
    workspaceKey: "electron:E:\\workspace",
    cwd: "E:\\workspace",
  });

  try {
    const listed = await executeTerminalTool("terminal_list", "{}");
    assert.equal(listed[0].buffer, undefined);
    assert.equal(opened, 1);

    const created = await executeTerminalTool("terminal_create", JSON.stringify({ title: "AI 终端" }));
    assert.equal(created.id, "terminal-1");
    assert.deepEqual(calls.find((call) => Array.isArray(call) && call[0] === "create"), [
      "create",
      {
        title: "AI 终端",
        workspaceKey: "electron:E:\\workspace",
        cwd: "E:\\workspace",
        cols: 80,
        rows: 24,
      },
    ]);

    const read = await executeTerminalTool("terminal_read", JSON.stringify({ id: "terminal-1" }));
    assert.equal(read.output, "PS> ");

    const run = await executeTerminalTool(
      "terminal_run",
      JSON.stringify({ id: "terminal-1", command: "echo ok", waitMs: 800 }),
    );
    assert.match(run.output, /DONE/);
    assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "write"), true);

    await executeTerminalTool("terminal_close", JSON.stringify({ id: "terminal-1" }));
    assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "close"), true);
  } finally {
    setTerminalWorkspaceContext({ workspaceKey: "default" });
    unregister();
    globalThis.window = previousWindow;
  }
});
