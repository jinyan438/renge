import assert from "node:assert/strict";
import test from "node:test";
import {
  createSidebarTerminalManager,
  getDefaultTerminalShell,
} from "../electron/sidebar-terminal.mjs";

test("selects a platform-appropriate interactive shell", () => {
  assert.deepEqual(getDefaultTerminalShell("win32", {}), {
    command: "powershell.exe",
    args: ["-NoLogo"],
    label: "PowerShell",
  });
  assert.deepEqual(getDefaultTerminalShell("linux", { SHELL: "/bin/bash" }), {
    command: "/bin/bash",
    args: [],
    label: "bash",
  });
});

test("creates, lists, resizes, writes to, restarts, and closes a PTY session", () => {
  const messages = [];
  const processes = [];
  const ptyModule = {
    spawn() {
      const dataListeners = [];
      const terminalProcess = {
        killed: false,
        resizeCalls: [],
        writes: [],
        kill() {
          this.killed = true;
        },
        onData(listener) {
          dataListeners.push(listener);
        },
        onExit() {},
        resize(cols, rows) {
          this.resizeCalls.push({ cols, rows });
        },
        write(data) {
          this.writes.push(data);
          for (const listener of dataListeners) listener(data);
        },
      };
      processes.push(terminalProcess);
      return terminalProcess;
    },
  };
  const webContents = { send: (channel, payload) => messages.push({ channel, payload }) };
  const mainWindow = { isDestroyed: () => false, webContents };
  const event = { sender: webContents };
  const manager = createSidebarTerminalManager({
    getMainWindow: () => mainWindow,
    getWorkspaceRoot: () => process.cwd(),
    ptyModule,
  });

  try {
    const created = manager.create(event, { cols: 96, rows: 30, title: "测试终端" });
    assert.equal(created.title, "测试终端");
    assert.equal(created.cwd, process.cwd());
    assert.equal(manager.list(event).length, 1);
    assert.equal(messages.some((message) => message.channel === "sidebar-terminal:created"), true);
    assert.deepEqual(manager.resize(event, { id: created.id, cols: 100, rows: 32 }), { ok: true });

    const command = process.platform === "win32"
      ? "Write-Output __RENGE_PTY_OK__\r"
      : "printf '__RENGE_PTY_OK__\n'\r";
    assert.deepEqual(manager.write(event, { id: created.id, data: command }), { ok: true });
    assert.equal(messages.some((message) =>
      message.channel === "sidebar-terminal:data"
      && message.payload.data.includes("__RENGE_PTY_OK__")), true);
    const readResult = manager.read(event, { id: created.id, from: 0, maxChars: 1000 });
    assert.equal(readResult.output, command);
    assert.equal(readResult.nextCursor, command.length);
    assert.equal(readResult.hasMore, false);
    const futureRead = manager.read(event, { id: created.id, from: 999, maxChars: 1000 });
    assert.equal(futureRead.output, "");
    assert.equal(futureRead.nextCursor, command.length);
    const restarted = manager.restart(event, { id: created.id, cols: 80, rows: 24 });
    assert.equal(restarted.exited, false);
    assert.equal(processes[0].killed, true);
    assert.equal(messages.some((message) => message.channel === "sidebar-terminal:restarted"), true);
    assert.deepEqual(manager.close(event, { id: created.id }), { ok: true, id: created.id });
    assert.equal(processes[1].killed, true);
    assert.equal(messages.some((message) => message.channel === "sidebar-terminal:closed"), true);
    assert.equal(manager.list(event).length, 0);
  } finally {
    manager.disposeAll();
  }
});

test("isolates terminals by workspace and uses the fallback directory for default workspace", () => {
  const spawnCalls = [];
  const ptyModule = {
    spawn(_command, _args, options) {
      spawnCalls.push(options);
      return {
        kill() {},
        onData() {},
        onExit() {},
        resize() {},
        write() {},
      };
    },
  };
  const webContents = { send() {} };
  const event = { sender: webContents };
  const manager = createSidebarTerminalManager({
    getMainWindow: () => ({ isDestroyed: () => false, webContents }),
    getWorkspaceRoot: () => "E:\\projects\\other",
    getFallbackCwd: () => "C:\\Users\\tester",
    ptyModule,
  });

  try {
    const defaultTerminal = manager.create(event, { workspaceKey: "default" });
    const projectTerminal = manager.create(event, {
      workspaceKey: "electron:E:\\projects\\current",
      cwd: "E:\\projects\\current",
    });

    assert.equal(defaultTerminal.cwd, "C:\\Users\\tester");
    assert.equal(spawnCalls[0].cwd, "C:\\Users\\tester");
    assert.equal(projectTerminal.cwd, "E:\\projects\\current");
    assert.equal(manager.list(event, { workspaceKey: "default" }).length, 1);
    assert.equal(
      manager.list(event, { workspaceKey: "electron:E:\\projects\\current" }).length,
      1,
    );
    assert.throws(
      () => manager.read(event, {
        id: projectTerminal.id,
        workspaceKey: "default",
      }),
      /其他工作区/,
    );
  } finally {
    manager.disposeAll();
  }
});
