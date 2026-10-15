type ProgressEvent = {
  type: string;
  toolCallId?: string;
  toolName?: string;
};

const toolLabels: Record<string, string> = {
  read: "读取文件",
  local_read_file: "读取文件",
  write: "写入文件",
  local_write_file: "写入文件",
  edit: "编辑文件",
  local_edit_file: "编辑文件",
  grep: "搜索内容",
  find: "查找文件",
  ls: "查看目录",
  bash: "运行命令",
  powershell: "运行命令",
  shell_status: "等待命令结果",
  shell_stop: "停止命令",
  local_run_command: "运行命令",
  multi_agent_delegate_task: "安排 Agent 协作",
  chat_present_options: "准备选项",
  chat_update_heartbeat: "更新心跳",
};

export function getComposerToolLabel(name = "") {
  return toolLabels[name] || name || "工具";
}

// Observe the same ordered events as the message timeline, including tool rounds
// and retries. A new request starts in waiting; reasoning is never inferred.
export function createChatProgressTracker(
  publish: (message: string) => void,
  signal?: AbortSignal,
  actor = "AI",
) {
  const activeTools = new Map<string, string>();
  const pendingTools = new Map<string, string>();
  let lastMessage = "";
  const update = (message: string) => {
    if (signal?.aborted || message === lastMessage) return;
    lastMessage = message;
    publish(message);
  };
  const showActiveTools = () => {
    const names = [...new Set(activeTools.values())].map(getComposerToolLabel);
    update(`${actor} 正在执行工具：${names.join("、")}${activeTools.size > 1 ? `（${activeTools.size} 个）` : ""}…`);
  };

  return {
    waiting() {
      update(`等待 ${actor} 响应…`);
    },
    content(delta: string) {
      if (!delta.trim() || activeTools.size > 0) return;
      update(`${actor} 正在回复…`);
    },
    reasoning(delta: string) {
      if (!delta.trim() || activeTools.size > 0) return;
      update(`${actor} 正在思考…`);
    },
    preparingTool(name?: string) {
      update(`${actor} 正在准备调用${name ? `：${getComposerToolLabel(name)}` : "工具"}…`);
    },
    piEvent(event: ProgressEvent) {
      if (event.type === "run_start") {
        update(`等待 ${actor} 响应…`);
      } else if (event.type === "tool_call_start" || event.type === "tool_call_delta") {
        const key = event.toolCallId || "tool";
        const name = event.toolName || pendingTools.get(key) || "";
        pendingTools.set(key, name);
        if (activeTools.size === 0) this.preparingTool(name);
      } else if (event.type === "tool_start" || event.type === "tool_request") {
        if (event.toolCallId) pendingTools.delete(event.toolCallId);
        activeTools.set(event.toolCallId || event.toolName || "tool", event.toolName || "");
        showActiveTools();
      } else if (event.type === "tool_end") {
        activeTools.delete(event.toolCallId || event.toolName || "tool");
        if (activeTools.size > 0) showActiveTools();
        else update(`${actor} 正在处理工具结果…`);
      } else if (event.type === "tool_call_incomplete") {
        if (event.toolCallId) pendingTools.delete(event.toolCallId);
        update(`工具调用未完成，等待 ${actor} 继续…`);
      } else if (event.type === "auto_retry_start" || event.type === "compaction_start") {
        // The caller supplies the detailed runtime notice. Allow the next real
        // delta to restore its phase even if it matches the pre-retry phase.
        lastMessage = "";
        activeTools.clear();
        pendingTools.clear();
      }
    },
  };
}

export function formatComposerElapsed(seconds: number) {
  const elapsed = Math.max(0, Math.floor(seconds));
  return `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
}
