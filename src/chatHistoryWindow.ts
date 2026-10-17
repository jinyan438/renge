export const CHAT_HISTORY_PAGE_SIZE = 80;

export function getChatHistoryWindow(length: number, requestedStart: number | null, pageSize = CHAT_HISTORY_PAGE_SIZE) {
  const size = Math.max(1, Math.floor(pageSize));
  const count = Math.max(0, Math.floor(length));
  const latestStart = Math.max(0, count - size);
  const start = requestedStart === null ? latestStart : Math.max(0, Math.min(Math.floor(requestedStart), latestStart));
  return { start, end: Math.min(count, start + size), latestStart, size };
}
