export type ChatBubbleStatus = "complete" | "incomplete" | "error" | "running";

export const chatBubbleStatusLabels: Record<ChatBubbleStatus, string> = {
  complete: "已完成",
  incomplete: "未正常完成",
  error: "处理异常",
  running: "正在输出或处理",
};

export function normalizeChatOutputStatus(value: unknown, restoreInterrupted = false) {
  if (value !== "complete" && value !== "incomplete" && value !== "error" && value !== "running") {
    return undefined;
  }
  return restoreInterrupted && value === "running" ? "incomplete" : value;
}

export function getChatCompletionStatus(finishReason: string): ChatBubbleStatus {
  if (/^(error|failed)$/i.test(finishReason)) return "error";
  return /^(stop|end_turn|tool_calls|function_call|tool_use|stop_sequence|completed)$/i.test(finishReason)
    ? "complete"
    : "incomplete";
}

export function getChatBubbleStatus(
  message: { outputStatus?: ChatBubbleStatus; renderAsPlainText?: boolean },
  isLastSegment = true,
): ChatBubbleStatus {
  const status = message.outputStatus ?? (message.renderAsPlainText ? "incomplete" : "complete");
  // Earlier split bubbles have already been emitted; only the tail is still open.
  return isLastSegment ? status : "complete";
}

export function getToolBubbleStatus(
  group: {
    completed: boolean;
    visualizations: readonly { status: string }[];
    blocks: readonly { variant: string }[];
    segments?: readonly { message: { outputStatus?: ChatBubbleStatus } }[];
  },
  generationActive: boolean,
): ChatBubbleStatus {
  if (group.visualizations.some((tool) => tool.status === "error") ||
      group.blocks.some((block) => block.variant === "error")) return "error";
  if (group.completed) return "complete";
  if (group.segments?.some(({ message }) => message.outputStatus === "incomplete")) return "incomplete";
  return generationActive ? "running" : "incomplete";
}
