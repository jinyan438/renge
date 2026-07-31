type TerminalToolArguments = Record<string, unknown>;

export type SidebarTerminalSession = {
  id: string;
  workspaceKey: string;
  title: string;
  shell: string;
  cwd: string;
  createdAt: number;
  exited: boolean;
  exitCode: number | null;
  buffer: string;
  outputOffset: number;
};

export type SidebarTerminalReadResult = Omit<SidebarTerminalSession, "buffer"> & {
  output: string;
  cursor: number;
  nextCursor: number;
  truncated: boolean;
  hasMore: boolean;
};

export type SidebarTerminalApi = {
  listSidebarTerminals(options?: {
    includeBuffer?: boolean;
    workspaceKey?: string;
  }): Promise<SidebarTerminalSession[]>;
  createSidebarTerminal(options?: {
    cols?: number;
    rows?: number;
    title?: string;
    workspaceKey?: string;
    cwd?: string;
  }): Promise<SidebarTerminalSession>;
  writeSidebarTerminal(options: {
    id: string;
    workspaceKey?: string;
    data: string;
  }): Promise<{ ok: boolean }>;
  resizeSidebarTerminal(options: {
    id: string;
    workspaceKey?: string;
    cols: number;
    rows: number;
  }): Promise<{ ok: boolean }>;
  readSidebarTerminal(options: {
    id: string;
    workspaceKey?: string;
    from?: number;
    maxChars?: number;
  }): Promise<SidebarTerminalReadResult>;
  restartSidebarTerminal(options: {
    id: string;
    workspaceKey?: string;
    cols?: number;
    rows?: number;
  }): Promise<SidebarTerminalSession>;
  closeSidebarTerminal(options: {
    id: string;
    workspaceKey?: string;
  }): Promise<{ ok: boolean; id: string }>;
  onSidebarTerminalData?(listener: (payload: {
    id: string;
    workspaceKey: string;
    data: string;
  }) => void): () => void;
  onSidebarTerminalExit?(listener: (payload: {
    id: string;
    workspaceKey: string;
    exitCode: number;
    signal: number;
  }) => void): () => void;
  onSidebarTerminalRestarted?(listener: (payload: SidebarTerminalSession) => void): () => void;
  onSidebarTerminalCreated?(listener: (payload: SidebarTerminalSession) => void): () => void;
  onSidebarTerminalClosed?(listener: (payload: {
    id: string;
    workspaceKey: string;
  }) => void): () => void;
};

export type TerminalWorkspaceContext = {
  workspaceKey: string;
  cwd?: string;
};

let terminalWorkspaceContext: TerminalWorkspaceContext = { workspaceKey: "default" };

export function setTerminalWorkspaceContext(context: TerminalWorkspaceContext) {
  terminalWorkspaceContext = {
    workspaceKey: String(context.workspaceKey || "default").trim() || "default",
    ...(context.cwd?.trim() ? { cwd: context.cwd.trim() } : {}),
  };
}

export function getTerminalWorkspaceContext() {
  return terminalWorkspaceContext;
}

function hasTerminalContract(value: Partial<SidebarTerminalApi>) {
  return (
    typeof value.listSidebarTerminals === "function"
    && typeof value.createSidebarTerminal === "function"
    && typeof value.readSidebarTerminal === "function"
    && typeof value.writeSidebarTerminal === "function"
    && typeof value.resizeSidebarTerminal === "function"
    && typeof value.restartSidebarTerminal === "function"
    && typeof value.closeSidebarTerminal === "function"
  );
}

export function getTerminalSidebarApi(): SidebarTerminalApi | null {
  const desktop = window.rengeDesktop as (Partial<SidebarTerminalApi> & {
    isElectron?: boolean;
  }) | undefined;
  if (desktop?.isElectron && hasTerminalContract(desktop)) return desktop as SidebarTerminalApi;

  const android = window.rengeAndroid as (Partial<SidebarTerminalApi> & {
    isAndroid?: boolean;
  }) | undefined;
  if (android?.isAndroid && hasTerminalContract(android)) return android as SidebarTerminalApi;
  return null;
}

export function isTerminalSidebarAvailable() {
  return getTerminalSidebarApi() !== null;
}

const TERMINAL_TOOL_NAMES = new Set([
  "terminal_list",
  "terminal_create",
  "terminal_read",
  "terminal_write",
  "terminal_run",
  "terminal_resize",
  "terminal_restart",
  "terminal_close",
]);

let terminalSidebarOpener: ((terminalId?: string) => void) | null = null;

export const terminalToolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "terminal_list",
      description: "仅在任务确实需要命令行操作时，列出当前工作区的交互式终端；不要把它用于一般问答、写作、绘图或内容生成。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "terminal_create",
      description: "仅在确实需要运行命令且没有合适终端时，在当前工作区新建交互式终端。可同时创建多个终端。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "可选终端标签名称。" },
          cols: { type: "number", description: "初始列数，默认 80。" },
          rows: { type: "number", description: "初始行数，默认 24。" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "terminal_read",
      description: "读取指定终端的最近输出或从 cursor 开始的增量输出，同时返回下一次读取使用的 nextCursor。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "terminal_list 或 terminal_create 返回的终端 ID。" },
          cursor: { type: "number", description: "可选增量读取位置；省略时读取最近输出。" },
          maxChars: { type: "number", description: "最大读取字符数，默认 20000，最大 100000。" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "terminal_write",
      description: "向指定交互式终端原样发送键盘输入。可发送文本、回车或控制字符，例如用 \\u0003 发送 Ctrl+C。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "终端 ID。" },
          data: { type: "string", description: "原样写入 PTY 的数据；回车使用 \\r，Ctrl+C 使用 \\u0003。" },
        },
        required: ["id", "data"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "terminal_run",
      description: "在指定终端输入一条命令并发送回车，等待输出暂时稳定后返回本次新增输出。长时间任务会继续在终端后台运行。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "终端 ID。" },
          command: { type: "string", description: "要在当前 Shell 中原样执行的命令。" },
          waitMs: { type: "number", description: "等待输出的最长时间，默认 1500，最大 30000。" },
        },
        required: ["id", "command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "terminal_resize",
      description: "调整指定终端的 PTY 行列数。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "终端 ID。" },
          cols: { type: "number", description: "列数。" },
          rows: { type: "number", description: "行数。" },
        },
        required: ["id", "cols", "rows"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "terminal_restart",
      description: "终止并重新启动指定终端的 Shell，终端标签和工作目录保持不变。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "终端 ID。" },
          cols: { type: "number", description: "重启后的列数，默认 80。" },
          rows: { type: "number", description: "重启后的行数，默认 24。" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "terminal_close",
      description: "关闭指定终端标签并终止其中运行的进程。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "要关闭的终端 ID。" },
        },
        required: ["id"],
      },
    },
  },
];

export function isTerminalToolName(toolName: string) {
  return TERMINAL_TOOL_NAMES.has(toolName);
}

export function buildTerminalToolsSystemPrompt() {
  return [
    "右侧栏终端是严格按需使用的执行工具，不是开始任务时默认检查的环境。",
    "只有用户明确要求操作终端/运行命令，或软件工程任务确实必须执行测试、构建、开发服务器、版本控制、进程管理或命令行诊断时，才允许调用任何 terminal_* 工具。",
    "绘图、生成 SVG/HTML、写作、翻译、一般问答、方案设计、普通代码输出，以及可由浏览器或文件工具直接完成的任务，不得调用 terminal_list、terminal_create 或 terminal_run 来查看目录、探索环境或创建内容。能够直接回答时直接回答。",
    "确认确实需要终端后，先调用 terminal_list；没有当前工作区的合适终端时调用 terminal_create，并在后续调用中使用返回的准确 id。不得复用其他工作区的终端。",
    "执行普通命令优先调用 terminal_run，它会返回本次新增输出；持续运行的任务可稍后用 terminal_read 增量读取。",
    "需要回答交互式提示、发送控制键或终止前台任务时调用 terminal_write；Ctrl+C 的 data 为 \\u0003，回车为 \\r。",
    "terminal_close 会终止其中的进程。用户要求关闭终端时直接调用，不要只描述操作。",
    "终端输出可能包含命令自身回显和 Shell 提示符；根据 exit 状态和实际输出判断结果，不要虚构成功。",
  ].join("\n");
}

export function registerTerminalSidebarOpener(opener: (terminalId?: string) => void) {
  terminalSidebarOpener = opener;
  return () => {
    if (terminalSidebarOpener === opener) terminalSidebarOpener = null;
  };
}

function parseTerminalToolArguments(rawArguments: string) {
  if (!rawArguments.trim()) return {};
  try {
    const parsed = JSON.parse(rawArguments);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("终端工具参数必须是 JSON object");
    }
    return parsed as TerminalToolArguments;
  } catch (error) {
    if (error instanceof Error && error.message === "终端工具参数必须是 JSON object") {
      throw error;
    }
    throw new Error("终端工具参数不是有效 JSON");
  }
}

function requireString(args: TerminalToolArguments, key: string) {
  const value = String(args[key] ?? "");
  if (!value) throw new Error(`${key} 不能为空`);
  return value;
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function stripTerminalControlSequences(value: string) {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r(?!\n)/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, "");
}

function waitForPoll(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new DOMException("操作已停止", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("操作已停止", "AbortError"));
    };
    const timeoutId = window.setTimeout(finish, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function runTerminalCommand(
  api: SidebarTerminalApi,
  args: TerminalToolArguments,
  workspaceKey: string,
  signal?: AbortSignal,
) {
  const id = requireString(args, "id");
  const command = requireString(args, "command");
  const waitMs = clampNumber(args.waitMs, 1500, 250, 30_000);
  const before = await api.readSidebarTerminal({ id, workspaceKey, maxChars: 1 });
  let cursor = before.nextCursor;
  let output = "";
  let sawOutput = false;
  let lastChangeAt = Date.now();
  const startedAt = Date.now();
  await api.writeSidebarTerminal({
    id,
    workspaceKey,
    data: /[\r\n]$/.test(command) ? command : `${command}\r`,
  });

  while (Date.now() - startedAt < waitMs) {
    await waitForPoll(100, signal);
    const page = await api.readSidebarTerminal({
      id,
      workspaceKey,
      from: cursor,
      maxChars: 100_000,
    });
    if (page.output) {
      output += page.output;
      cursor = page.nextCursor;
      sawOutput = true;
      lastChangeAt = Date.now();
    }
    if (page.exited || (sawOutput && !page.hasMore && Date.now() - lastChangeAt >= 300)) {
      return {
        ...page,
        output: stripTerminalControlSequences(output),
        rawOutputLength: output.length,
        timedOut: false,
      };
    }
  }

  const state = await api.readSidebarTerminal({
    id,
    workspaceKey,
    from: cursor,
    maxChars: 100_000,
  });
  if (state.output) output += state.output;
  return {
    ...state,
    output: stripTerminalControlSequences(output),
    rawOutputLength: output.length,
    timedOut: true,
  };
}

export async function executeTerminalTool(
  toolName: string,
  rawArguments: string,
  signal?: AbortSignal,
) {
  if (!isTerminalToolName(toolName)) throw new Error(`未知终端工具：${toolName}`);
  if (signal?.aborted) throw new DOMException("操作已停止", "AbortError");
  const api = getTerminalSidebarApi();
  if (!api) throw new Error("当前平台未提供右侧栏交互式终端");
  const terminalContext = getTerminalWorkspaceContext();
  const { workspaceKey } = terminalContext;
  const args = parseTerminalToolArguments(rawArguments);
  terminalSidebarOpener?.(
    typeof args.id === "string" && args.id ? args.id : undefined,
  );

  switch (toolName) {
    case "terminal_list": {
      const sessions = await api.listSidebarTerminals({
        includeBuffer: false,
        workspaceKey,
      });
      return sessions.map(({ buffer: _buffer, ...session }) => session);
    }
    case "terminal_create":
      return api.createSidebarTerminal({
        title: String(args.title ?? ""),
        ...terminalContext,
        cols: clampNumber(args.cols, 80, 1, 500),
        rows: clampNumber(args.rows, 24, 1, 300),
      });
    case "terminal_read": {
      const result = await api.readSidebarTerminal({
        id: requireString(args, "id"),
        workspaceKey,
        ...(args.cursor === undefined ? {} : { from: Number(args.cursor) }),
        maxChars: clampNumber(args.maxChars, 20_000, 1, 100_000),
      });
      return {
        ...result,
        output: stripTerminalControlSequences(result.output),
      };
    }
    case "terminal_write":
      return api.writeSidebarTerminal({
        id: requireString(args, "id"),
        workspaceKey,
        data: requireString(args, "data"),
      });
    case "terminal_run":
      return runTerminalCommand(api, args, workspaceKey, signal);
    case "terminal_resize":
      return api.resizeSidebarTerminal({
        id: requireString(args, "id"),
        workspaceKey,
        cols: clampNumber(args.cols, 80, 1, 500),
        rows: clampNumber(args.rows, 24, 1, 300),
      });
    case "terminal_restart":
      return api.restartSidebarTerminal({
        id: requireString(args, "id"),
        workspaceKey,
        cols: clampNumber(args.cols, 80, 1, 500),
        rows: clampNumber(args.rows, 24, 1, 300),
      });
    case "terminal_close":
      return api.closeSidebarTerminal({
        id: requireString(args, "id"),
        workspaceKey,
      });
    default:
      throw new Error(`未知终端工具：${toolName}`);
  }
}
