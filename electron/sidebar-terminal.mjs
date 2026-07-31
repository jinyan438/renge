import { randomUUID } from "node:crypto";
import process from "node:process";
import * as pty from "node-pty";

const MAX_TERMINAL_BUFFER = 2 * 1024 * 1024;
const MAX_TERMINAL_SESSIONS = 12;
const MAX_TERMINAL_READ = 100_000;
const DEFAULT_TERMINAL_WORKSPACE_KEY = "default";

function clampDimension(value, fallback, maximum) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, parsed)) : fallback;
}

export function getDefaultTerminalShell(platform = process.platform, env = process.env) {
  if (platform === "win32") {
    return {
      command: env.RENGE_TERMINAL_SHELL || "powershell.exe",
      args: env.RENGE_TERMINAL_SHELL ? [] : ["-NoLogo"],
      label: env.RENGE_TERMINAL_SHELL ? "Shell" : "PowerShell",
    };
  }
  const command = env.RENGE_TERMINAL_SHELL || env.SHELL || "/bin/sh";
  return {
    command,
    args: [],
    label: command.split("/").filter(Boolean).at(-1) || "Shell",
  };
}

function appendToBuffer(buffer, data) {
  const next = buffer + data;
  return next.length > MAX_TERMINAL_BUFFER ? next.slice(-MAX_TERMINAL_BUFFER) : next;
}

function getWorkspaceKey(options = {}) {
  return String(options.workspaceKey ?? "").trim()
    || DEFAULT_TERMINAL_WORKSPACE_KEY;
}

export function createSidebarTerminalManager({
  getMainWindow,
  getWorkspaceRoot,
  getFallbackCwd = () => process.cwd(),
  ptyModule = pty,
} = {}) {
  const sessions = new Map();

  function assertSender(event) {
    const mainWindow = getMainWindow?.();
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      throw new Error("终端操作来源无效");
    }
  }

  function send(channel, payload) {
    const mainWindow = getMainWindow?.();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  }

  function serialize(session, includeBuffer = false) {
    return {
      id: session.id,
      workspaceKey: session.workspaceKey,
      title: session.title,
      shell: session.shell,
      cwd: session.cwd,
      createdAt: session.createdAt,
      exited: session.exited,
      exitCode: session.exitCode,
      outputOffset: session.outputOffset,
      ...(includeBuffer ? { buffer: session.buffer } : {}),
    };
  }

  function getSession(options = {}) {
    const id = String(options.id ?? "");
    const session = sessions.get(id);
    if (!session) throw new Error("找不到这个终端会话");
    if (session.workspaceKey !== getWorkspaceKey(options)) {
      throw new Error("这个终端属于其他工作区");
    }
    return session;
  }

  function spawnProcess(session, options = {}) {
    const shell = getDefaultTerminalShell();
    const cols = clampDimension(options.cols, 80, 500);
    const rows = clampDimension(options.rows, 24, 300);
    session.generation += 1;
    const generation = session.generation;
    session.shell = shell.label;
    session.exited = false;
    session.exitCode = null;
    session.buffer = "";
    session.outputOffset = 0;
    session.process = ptyModule.spawn(shell.command, shell.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: session.cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "Renge",
      },
      useConpty: process.platform === "win32",
    });
    session.process.onData((data) => {
      if (session.generation !== generation) return;
      session.buffer = appendToBuffer(session.buffer, data);
      session.outputOffset += data.length;
      send("sidebar-terminal:data", {
        id: session.id,
        workspaceKey: session.workspaceKey,
        data,
      });
    });
    session.process.onExit(({ exitCode, signal }) => {
      if (session.generation !== generation) return;
      session.process = null;
      session.exited = true;
      session.exitCode = exitCode;
      send("sidebar-terminal:exit", {
        id: session.id,
        workspaceKey: session.workspaceKey,
        exitCode,
        signal,
      });
    });
  }

  function create(options = {}) {
    if (sessions.size >= MAX_TERMINAL_SESSIONS) {
      throw new Error("最多同时打开 " + MAX_TERMINAL_SESSIONS + " 个终端");
    }
    const workspaceKey = getWorkspaceKey(options);
    const cwd = workspaceKey === DEFAULT_TERMINAL_WORKSPACE_KEY
      ? getFallbackCwd()
      : String(options.cwd ?? "").trim() || getWorkspaceRoot?.() || getFallbackCwd();
    const id = randomUUID();
    const session = {
      id,
      workspaceKey,
      title: String(options.title ?? "").trim().slice(0, 80) || "终端 " + (sessions.size + 1),
      shell: "Shell",
      cwd,
      createdAt: Date.now(),
      exited: false,
      exitCode: null,
      buffer: "",
      outputOffset: 0,
      process: null,
      generation: 0,
    };
    sessions.set(id, session);
    try {
      spawnProcess(session, options);
    } catch (error) {
      sessions.delete(id);
      throw error;
    }
    const serialized = serialize(session, true);
    send("sidebar-terminal:created", serialized);
    return serialized;
  }

  function disposeSession(session) {
    session.generation += 1;
    const terminalProcess = session.process;
    session.process = null;
    if (terminalProcess) {
      try {
        terminalProcess.kill();
      } catch {
        // The process may already have exited between lookup and disposal.
      }
    }
  }

  return {
    list(event, options = {}) {
      assertSender(event);
      const workspaceKey = getWorkspaceKey(options);
      return [...sessions.values()]
        .filter((session) => session.workspaceKey === workspaceKey)
        .map((session) => serialize(session, options.includeBuffer !== false));
    },
    create(event, options) {
      assertSender(event);
      return create(options);
    },
    write(event, options = {}) {
      assertSender(event);
      const session = getSession(options);
      if (!session.process || session.exited) throw new Error("终端进程已经退出");
      const data = String(options.data ?? "");
      if (data.length > 1024 * 1024) throw new Error("单次终端输入过长");
      session.process.write(data);
      return { ok: true };
    },
    resize(event, options = {}) {
      assertSender(event);
      const session = getSession(options);
      if (session.process && !session.exited) {
        session.process.resize(
          clampDimension(options.cols, 80, 500),
          clampDimension(options.rows, 24, 300),
        );
      }
      return { ok: true };
    },
    read(event, options = {}) {
      assertSender(event);
      const session = getSession(options);
      const maxChars = clampDimension(options.maxChars, 20_000, MAX_TERMINAL_READ);
      const bufferStart = Math.max(0, session.outputOffset - session.buffer.length);
      const requestedFrom = Number(options.from);
      const hasRequestedFrom = Number.isFinite(requestedFrom) && requestedFrom >= 0;
      const start = hasRequestedFrom
        ? Math.min(session.outputOffset, Math.max(bufferStart, Math.floor(requestedFrom)))
        : Math.max(bufferStart, session.outputOffset - maxChars);
      const bufferIndex = Math.max(0, start - bufferStart);
      const output = session.buffer.slice(bufferIndex, bufferIndex + maxChars);
      return {
        ...serialize(session),
        output,
        cursor: start,
        nextCursor: start + output.length,
        truncated: hasRequestedFrom && requestedFrom < bufferStart,
        hasMore: start + output.length < session.outputOffset,
      };
    },
    restart(event, options = {}) {
      assertSender(event);
      const session = getSession(options);
      disposeSession(session);
      spawnProcess(session, options);
      send("sidebar-terminal:restarted", serialize(session, true));
      return serialize(session, true);
    },
    close(event, options = {}) {
      assertSender(event);
      const session = getSession(options);
      sessions.delete(session.id);
      disposeSession(session);
      send("sidebar-terminal:closed", {
        id: session.id,
        workspaceKey: session.workspaceKey,
      });
      return { ok: true, id: session.id };
    },
    disposeAll() {
      for (const session of sessions.values()) disposeSession(session);
      sessions.clear();
    },
  };
}
