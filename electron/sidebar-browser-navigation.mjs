export const SIDEBAR_BROWSER_PARTITION = "persist:renge-sidebar-browser";

export function isAllowedSidebarBrowserUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.href === "about:blank" || url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function createSidebarBrowserWindowOpenHandler(sourceWebContentsId, openTab) {
  return ({ url }) => {
    if (isAllowedSidebarBrowserUrl(url)) {
      openTab({ sourceWebContentsId, url });
    }
    return { action: "deny" };
  };
}
