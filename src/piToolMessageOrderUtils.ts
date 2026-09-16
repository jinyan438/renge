/**
 * Ordering helpers for Pi tool messages.
 *
 * Pi reports a streamed preview id while the model writes a tool call, and its
 * own execution id while the tool actually runs. The two can differ, so a
 * tool_start / tool_end event may arrive carrying an id that no rendered
 * message uses. Appending in that case would drop the completion below text
 * that streamed after the tool was initiated, so the update must instead find
 * the message that already anchors the tool.
 */

export type PiToolVisualizationAnchor = {
  toolCallId?: string;
  name?: string;
  status?: string;
};

export type PiToolAnchorMessage = {
  id: string;
  toolVisualization?: PiToolVisualizationAnchor;
};

export type PiToolAnchorQuery = {
  toolCallId?: string;
  toolName?: string;
  includeFinished?: boolean;
};

function isUsableAnchor(
  visualization: PiToolVisualizationAnchor | undefined,
  includeFinished: boolean,
) {
  if (!visualization) return false;
  return includeFinished || visualization.status === "running";
}

/**
 * Finds the newest message that can anchor a tool event.
 *
 * The exact toolCallId wins. When it matches nothing, the newest message that
 * is still running under the same tool name is reused, which keeps a renamed
 * or execution-phase id attached to the position where the tool was initiated.
 */
export function resolvePiToolAnchor<T extends PiToolAnchorMessage>(
  messages: readonly T[],
  query: PiToolAnchorQuery,
): T | undefined {
  const { toolCallId, toolName, includeFinished = false } = query;

  if (toolCallId) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const visualization = messages[index].toolVisualization;
      if (visualization?.toolCallId !== toolCallId) continue;
      if (isUsableAnchor(visualization, includeFinished)) return messages[index];
    }
  }

  if (!toolName) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const visualization = messages[index].toolVisualization;
    if (visualization?.name !== toolName) continue;
    if (isUsableAnchor(visualization, includeFinished)) return messages[index];
  }
  return undefined;
}
