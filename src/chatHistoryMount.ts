/**
 * Opening a long conversation mounts the newest items first and then prepends
 * older batches until the whole history is in the document. Nothing is ever
 * unmounted again, so scrolling from the first to the last message never
 * waits for a page change.
 */
export const CHAT_HISTORY_INITIAL_MOUNT_COUNT = 40;
export const CHAT_HISTORY_MOUNT_BATCH_SIZE = 30;

export type ChatHistoryMountState = { sessionId: string; start: number };

export function getChatHistoryMountStart(
  state: ChatHistoryMountState,
  sessionId: string,
  itemCount: number,
  initialCount = CHAT_HISTORY_INITIAL_MOUNT_COUNT,
) {
  const count = Math.max(0, Math.floor(itemCount));
  if (state.sessionId !== sessionId) return Math.max(0, count - Math.max(1, Math.floor(initialCount)));
  return Math.max(0, Math.min(Math.floor(state.start), count));
}

export function getNextChatHistoryMountStart(start: number, batchSize = CHAT_HISTORY_MOUNT_BATCH_SIZE) {
  return Math.max(0, Math.floor(start) - Math.max(1, Math.floor(batchSize)));
}
