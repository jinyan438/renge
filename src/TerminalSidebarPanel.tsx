import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ArrowLeft,
  Copy,
  Eraser,
  Plus,
  RefreshCw,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type SidebarTerminalSession = {
  id: string;
  title: string;
  shell: string;
  cwd: string;
  createdAt: number;
  exited: boolean;
  exitCode: number | null;
  buffer: string;
  outputOffset: number;
};

type TerminalPaneProps = {
  active: boolean;
  session: SidebarTerminalSession;
  onReady: (id: string, terminal: Terminal, fitAddon: FitAddon) => void;
  onDispose: (id: string) => void;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "终端操作失败");
}

function TerminalPane({ active, session, onReady, onDispose }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const desktopApi = window.rengeDesktop;
    if (!host || !desktopApi?.writeSidebarTerminal) return;

    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 10_000,
      smoothScrollDuration: 80,
      theme: {
        background: "#171717",
        foreground: "#d6d6d6",
        cursor: "#e8e8e8",
        cursorAccent: "#171717",
        selectionBackground: "#385a7c",
        black: "#1e1e1e",
        red: "#f44747",
        green: "#6a9955",
        yellow: "#dcdcaa",
        blue: "#569cd6",
        magenta: "#c586c0",
        cyan: "#4ec9b0",
        white: "#d4d4d4",
        brightBlack: "#808080",
        brightRed: "#f14c4c",
        brightGreen: "#73c991",
        brightYellow: "#f9f1a5",
        brightBlue: "#3794ff",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e7e7e7",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon((_event, uri) => {
      window.open(uri, "_blank", "noopener,noreferrer");
    }));
    terminal.open(host);
    if (session.buffer) terminal.write(session.buffer);

    const inputDisposable = terminal.onData((data) => {
      void desktopApi.writeSidebarTerminal?.({ id: session.id, data }).catch(() => undefined);
    });
    terminal.attachCustomKeyEventHandler((event) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.shiftKey && event.code === "KeyC") {
        if (event.type === "keydown" && terminal.hasSelection()) {
          void navigator.clipboard.writeText(terminal.getSelection());
        }
        return false;
      }
      if (modifier && event.shiftKey && event.code === "KeyV") {
        if (event.type === "keydown") {
          void navigator.clipboard.readText().then((text) => terminal.paste(text));
        }
        return false;
      }
      if (modifier && event.code === "KeyC" && terminal.hasSelection()) {
        if (event.type === "keydown") void navigator.clipboard.writeText(terminal.getSelection());
        return false;
      }
      return true;
    });

    const fit = () => {
      if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fitAddon.fit();
        void desktopApi.resizeSidebarTerminal?.({
          id: session.id,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch(() => undefined);
      } catch {
        // A resize can race with the terminal being removed.
      }
    };
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(host);
    const frame = window.requestAnimationFrame(fit);
    onReady(session.id, terminal, fitAddon);

    const openContextMenu = (event: globalThis.MouseEvent) => {
      event.preventDefault();
      if (terminal.hasSelection()) void navigator.clipboard.writeText(terminal.getSelection());
      else void navigator.clipboard.readText().then((text) => terminal.paste(text));
    };
    host.addEventListener("contextmenu", openContextMenu);
    return () => {
      window.cancelAnimationFrame(frame);
      host.removeEventListener("contextmenu", openContextMenu);
      resizeObserver.disconnect();
      inputDisposable.dispose();
      onDispose(session.id);
      terminal.dispose();
    };
  }, [onDispose, onReady, session.id]);

  return (
    <div
      aria-hidden={active ? undefined : "true"}
      className={"sidebar-terminal-pane " + (active ? "is-active" : "")}
      ref={hostRef}
    />
  );
}

export function TerminalSidebarPanel({
  onBack,
  onClose,
  requestedSessionId = "",
}: {
  onBack: () => void;
  onClose: () => void;
  requestedSessionId?: string;
}) {
  const [sessions, setSessions] = useState<SidebarTerminalSession[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const terminalRefs = useRef(new Map<string, { terminal: Terminal; fitAddon: FitAddon }>());
  const pendingDataRef = useRef(new Map<string, string>());
  const creatingRef = useRef(false);

  const registerTerminal = useCallback((id: string, terminal: Terminal, fitAddon: FitAddon) => {
    terminalRefs.current.set(id, { terminal, fitAddon });
    const pending = pendingDataRef.current.get(id);
    if (pending) {
      terminal.write(pending);
      pendingDataRef.current.delete(id);
    }
  }, []);
  const unregisterTerminal = useCallback((id: string) => {
    terminalRefs.current.delete(id);
  }, []);

  const createTerminal = useCallback(async () => {
    const desktopApi = window.rengeDesktop;
    if (!desktopApi?.createSidebarTerminal || creatingRef.current) return;
    creatingRef.current = true;
    setError("");
    try {
      const session = await desktopApi.createSidebarTerminal({ cols: 80, rows: 24 });
      setSessions((current) => current.some((item) => item.id === session.id)
        ? current.map((item) => item.id === session.id ? session : item)
        : [...current, session]);
      setActiveId(session.id);
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const desktopApi = window.rengeDesktop;
    if (!desktopApi?.listSidebarTerminals) {
      setLoading(false);
      setError("交互式终端仅支持 Electron 桌面版");
      return;
    }
    let cancelled = false;
    void desktopApi.listSidebarTerminals()
      .then((current) => {
        if (cancelled) return;
        if (current.length === 0) return createTerminal();
        setSessions(current);
        setActiveId(current[0].id);
        setLoading(false);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(getErrorMessage(loadError));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [createTerminal]);

  useEffect(() => {
    const desktopApi = window.rengeDesktop;
    const stopData = desktopApi?.onSidebarTerminalData?.((payload) => {
      const terminal = terminalRefs.current.get(payload.id)?.terminal;
      if (terminal) terminal.write(payload.data);
      else pendingDataRef.current.set(
        payload.id,
        (pendingDataRef.current.get(payload.id) || "") + payload.data,
      );
    });
    const stopRestart = desktopApi?.onSidebarTerminalRestarted?.((payload) => {
      const current = terminalRefs.current.get(payload.id);
      pendingDataRef.current.delete(payload.id);
      if (current) {
        current.terminal.reset();
        if (payload.buffer) current.terminal.write(payload.buffer);
        window.requestAnimationFrame(() => current.fitAddon.fit());
      }
    });
    const stopExit = desktopApi?.onSidebarTerminalExit?.((payload) => {
      setSessions((current) => current.map((session) =>
        session.id === payload.id
          ? { ...session, exited: true, exitCode: payload.exitCode }
          : session));
    });
    const stopCreated = desktopApi?.onSidebarTerminalCreated?.((payload) => {
      setSessions((current) => current.some((session) => session.id === payload.id)
        ? current.map((session) => session.id === payload.id ? payload : session)
        : [...current, payload]);
      setActiveId(payload.id);
    });
    const stopClosed = desktopApi?.onSidebarTerminalClosed?.((payload) => {
      pendingDataRef.current.delete(payload.id);
      setSessions((current) => {
        const next = current.filter((session) => session.id !== payload.id);
        setActiveId((currentId) => currentId === payload.id ? next[0]?.id ?? "" : currentId);
        return next;
      });
    });
    return () => {
      stopData?.();
      stopRestart?.();
      stopExit?.();
      stopCreated?.();
      stopClosed?.();
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.code !== "Backquote") return;
      event.preventDefault();
      void createTerminal();
    };
    window.addEventListener("keydown", handleShortcut, true);
    return () => window.removeEventListener("keydown", handleShortcut, true);
  }, [createTerminal]);

  useEffect(() => {
    const current = terminalRefs.current.get(activeId);
    if (!current) return;
    const frame = window.requestAnimationFrame(() => {
      try {
        current.fitAddon.fit();
        current.terminal.focus();
      } catch {
        // The terminal may be switching tabs during this frame.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, sessions.length]);

  useEffect(() => {
    if (
      requestedSessionId
      && sessions.some((session) => session.id === requestedSessionId)
    ) {
      setActiveId(requestedSessionId);
    }
  }, [requestedSessionId, sessions]);

  const closeTerminal = async (id: string) => {
    const sessionIndex = sessions.findIndex((session) => session.id === id);
    setError("");
    try {
      await window.rengeDesktop?.closeSidebarTerminal?.({ id });
      pendingDataRef.current.delete(id);
      const next = sessions.filter((session) => session.id !== id);
      setSessions(next);
      if (activeId === id) {
        setActiveId(next[Math.min(sessionIndex, Math.max(0, next.length - 1))]?.id ?? "");
      }
    } catch (closeError) {
      setError(getErrorMessage(closeError));
    }
  };

  const restartActive = async () => {
    const current = terminalRefs.current.get(activeId);
    setError("");
    try {
      const session = await window.rengeDesktop?.restartSidebarTerminal?.({
        id: activeId,
        cols: current?.terminal.cols ?? 80,
        rows: current?.terminal.rows ?? 24,
      });
      if (session) {
        setSessions((items) => items.map((item) => item.id === session.id ? session : item));
      }
    } catch (restartError) {
      setError(getErrorMessage(restartError));
    }
  };

  const copySelection = () => {
    const terminal = terminalRefs.current.get(activeId)?.terminal;
    if (terminal?.hasSelection()) void navigator.clipboard.writeText(terminal.getSelection());
  };

  const activeSession = sessions.find((session) => session.id === activeId);
  return (
    <section className="right-tool-content sidebar-terminal" aria-label="终端">
      <header className="sidebar-terminal-header">
        <button aria-label="返回工作区工具" onClick={onBack} title="返回工作区工具" type="button">
          <ArrowLeft size={16} />
        </button>
        <div className="sidebar-terminal-heading">
          <span>TERMINAL</span>
          <strong>{activeSession?.shell || "终端"}</strong>
        </div>
        <div className="sidebar-terminal-actions">
          <button aria-label="复制选中内容" onClick={copySelection} title="复制选中内容" type="button">
            <Copy size={15} />
          </button>
          <button aria-label="清空终端" onClick={() => terminalRefs.current.get(activeId)?.terminal.clear()} title="清空终端" type="button">
            <Eraser size={15} />
          </button>
          <button aria-label="重启终端" disabled={!activeId} onClick={() => void restartActive()} title="重启终端" type="button">
            <RefreshCw size={15} />
          </button>
          <button aria-label="关闭右侧栏" onClick={onClose} title="关闭右侧栏" type="button">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="sidebar-terminal-tabs" role="tablist">
        {sessions.map((session) => (
          <div className={session.id === activeId ? "is-active" : ""} key={session.id}>
            <button
              aria-selected={session.id === activeId}
              onClick={() => setActiveId(session.id)}
              role="tab"
              title={session.cwd}
              type="button"
            >
              <span className={session.exited ? "terminal-status-dot is-exited" : "terminal-status-dot"} />
              <span>{session.title}</span>
            </button>
            <button aria-label={"关闭 " + session.title} onClick={() => void closeTerminal(session.id)} title="关闭终端" type="button">
              <X size={12} />
            </button>
          </div>
        ))}
        <button className="sidebar-terminal-new" aria-label="新建终端" onClick={() => void createTerminal()} title="新建终端 (Ctrl+Shift+`)" type="button">
          <Plus size={14} />
        </button>
      </div>

      <div className="sidebar-terminal-stage">
        {sessions.map((session) => (
          <TerminalPane
            active={session.id === activeId}
            key={session.id}
            onDispose={unregisterTerminal}
            onReady={registerTerminal}
            session={session}
          />
        ))}
        {!loading && sessions.length === 0 ? (
          <div className="sidebar-terminal-empty">
            <SquareTerminal size={30} />
            <strong>没有正在运行的终端</strong>
            <button onClick={() => void createTerminal()} type="button"><Plus size={14} />新建终端</button>
          </div>
        ) : null}
        {loading ? <div className="sidebar-terminal-loading">正在启动终端…</div> : null}
      </div>

      <footer className="sidebar-terminal-footer">
        <span title={activeSession?.cwd}>{activeSession?.cwd || "未选择工作区"}</span>
        {activeSession?.exited ? (
          <button onClick={() => void restartActive()} type="button">
            <RefreshCw size={12} />进程已退出 ({activeSession.exitCode ?? "?"})，重新启动
          </button>
        ) : <span>{sessions.length} 个终端</span>}
      </footer>
      {error ? <div className="sidebar-terminal-error" role="alert">{error}</div> : null}
    </section>
  );
}
