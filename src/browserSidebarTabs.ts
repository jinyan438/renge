export const MAX_BROWSER_TABS = 12;

export type BrowserOpenTabRequest = {
  sourceWebContentsId: number;
  url: string;
};

export function parseBrowserOpenTabRequest(value: unknown): BrowserOpenTabRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sourceWebContentsId = Number(
    (value as { sourceWebContentsId?: unknown }).sourceWebContentsId,
  );
  const rawUrl = String((value as { url?: unknown }).url ?? "").trim();
  if (!Number.isInteger(sourceWebContentsId) || sourceWebContentsId <= 0) return null;

  try {
    const url = new URL(rawUrl);
    if (url.href !== "about:blank" && url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return { sourceWebContentsId, url: url.href };
  } catch {
    return null;
  }
}

export function getBrowserTabAfterClose(
  tabIds: readonly string[],
  activeTabId: string,
  closingTabId: string,
) {
  if (activeTabId !== closingTabId) return activeTabId;
  const closingIndex = tabIds.indexOf(closingTabId);
  if (closingIndex < 0) return activeTabId;
  return tabIds[closingIndex + 1] ?? tabIds[closingIndex - 1] ?? "";
}
