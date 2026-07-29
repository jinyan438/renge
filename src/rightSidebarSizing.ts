export const RIGHT_SIDEBAR_MIN_WIDTH = 260;
export const RIGHT_SIDEBAR_MIN_CHAT_WIDTH = 360;

export function getRightSidebarMaxWidth(
  workspaceWidth: number,
  leftSidebarWidth: number,
  minChatWidth = RIGHT_SIDEBAR_MIN_CHAT_WIDTH,
) {
  return Math.floor(
    Math.max(
      RIGHT_SIDEBAR_MIN_WIDTH,
      workspaceWidth - leftSidebarWidth - minChatWidth,
    ),
  );
}

export function clampRightSidebarWidth(width: number, maxWidth: number) {
  return Math.round(
    Math.min(
      Math.max(RIGHT_SIDEBAR_MIN_WIDTH, maxWidth),
      Math.max(RIGHT_SIDEBAR_MIN_WIDTH, width),
    ),
  );
}
