export const BROWSER_COMMENT_MIME_TYPE = "application/vnd.renge.browser-comment+json";

export type BrowserTargetRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserContextTarget = {
  pageUrl: string;
  pageTitle: string;
  tagName: string;
  selector: string;
  path: string;
  text: string;
  ariaLabel: string;
  nearbyText: string;
  outerHtml: string;
  imageUrl: string;
  linkUrl: string;
  rect: BrowserTargetRect;
};

export type BrowserPageComment = BrowserContextTarget & {
  id: string;
  comment: string;
  createdAt: string;
  screenshotDataUrl?: string;
};

export type BrowserContextMenuPlacement = {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
};

type BrowserContextMenuPlacementInput = {
  anchorX: number;
  anchorY: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
};

export function calculateBrowserContextMenuPlacement({
  anchorX,
  anchorY,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  margin = 8,
}: BrowserContextMenuPlacementInput): BrowserContextMenuPlacement {
  const safeMargin = Math.max(0, margin);
  const safeWidth = Math.max(1, viewportWidth);
  const safeHeight = Math.max(1, viewportHeight);
  const pointX = Math.min(Math.max(anchorX, safeMargin), Math.max(safeMargin, safeWidth - safeMargin));
  const pointY = Math.min(Math.max(anchorY, safeMargin), Math.max(safeMargin, safeHeight - safeMargin));
  const roomRight = Math.max(1, safeWidth - safeMargin - pointX);
  const roomLeft = Math.max(1, pointX - safeMargin);
  const roomBelow = Math.max(1, safeHeight - safeMargin - pointY);
  const roomAbove = Math.max(1, pointY - safeMargin);
  const desiredWidth = Math.max(1, menuWidth);
  const desiredHeight = Math.max(1, menuHeight);

  let left = pointX;
  let maxWidth = roomRight;
  if (desiredWidth > roomRight) {
    if (desiredWidth <= roomLeft || roomLeft > roomRight) {
      maxWidth = roomLeft;
      left = pointX - Math.min(desiredWidth, roomLeft);
    }
  }

  let top = pointY;
  let maxHeight = roomBelow;
  if (desiredHeight > roomBelow) {
    if (desiredHeight <= roomAbove || roomAbove > roomBelow) {
      maxHeight = roomAbove;
      top = pointY - Math.min(desiredHeight, roomAbove);
    }
  }

  return { left, top, maxWidth, maxHeight };
}

function safeCoordinate(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
export function buildBrowserContextTargetProbeScript(x: number, y: number) {
  const pointX = safeCoordinate(x);
  const pointY = safeCoordinate(y);
  return `(() => {
    const target = document.elementFromPoint(${pointX}, ${pointY});
    if (!(target instanceof Element)) return null;
    const compact = (value, limit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const escapeCss = (value) => globalThis.CSS?.escape
      ? globalThis.CSS.escape(String(value))
      : String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => '\\\\' + character);
    const escapeAttribute = (value) => String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
    const selectorSegment = (element) => {
      const tag = element.tagName.toLowerCase();
      if (element.id) return '#' + escapeCss(element.id);
      for (const attribute of ['data-testid', 'data-test', 'aria-label', 'name']) {
        const value = element.getAttribute(attribute);
        if (value && value.length <= 100) return tag + '[' + attribute + '="' + escapeAttribute(value) + '"]';
      }
      const siblings = element.parentElement
        ? Array.from(element.parentElement.children).filter((sibling) => sibling.tagName === element.tagName)
        : [];
      if (siblings.length > 1) return tag + ':nth-of-type(' + (siblings.indexOf(element) + 1) + ')';
      return tag;
    };
    const selectorParts = [];
    let cursor = target;
    while (cursor && selectorParts.length < 7) {
      selectorParts.unshift(selectorSegment(cursor));
      const candidate = selectorParts.join(' > ');
      try {
        if (document.querySelectorAll(candidate).length === 1) break;
      } catch {}
      cursor = cursor.parentElement;
    }
    const pathParts = [];
    cursor = target;
    while (cursor && pathParts.length < 6) {
      pathParts.unshift(cursor.tagName.toLowerCase());
      cursor = cursor.parentElement;
    }
    const link = target.closest('a[href]');
    const image = target instanceof HTMLImageElement
      ? target
      : target.closest('picture')?.querySelector('img') || null;
    const nearby = target.closest('a, button, article, li, section, [role="button"], div') || target.parentElement || target;
    const rect = target.getBoundingClientRect();
    return {
      pageUrl: location.href,
      pageTitle: document.title || '',
      tagName: target.tagName.toLowerCase(),
      selector: selectorParts.join(' > '),
      path: pathParts.join(' > '),
      text: compact(target.getAttribute('alt') || target.getAttribute('title') || target.textContent, 500),
      ariaLabel: compact(target.getAttribute('aria-label'), 200),
      nearbyText: compact(nearby.innerText || nearby.textContent, 800),
      outerHtml: compact(target.outerHTML, 1200),
      imageUrl: image?.currentSrc || image?.src || '',
      linkUrl: link?.href || '',
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  })()`;
}

export function serializeBrowserPageComment(comment: BrowserPageComment) {
  const { screenshotDataUrl, ...portableComment } = comment;
  return JSON.stringify({
    kind: "browser-element-comment",
    ...portableComment,
    screenshotAttached: Boolean(screenshotDataUrl),
  }, null, 2);
}

export function parseBrowserPageComment(
  value: string | undefined,
  screenshotDataUrl?: string,
): BrowserPageComment | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BrowserPageComment> & { kind?: string };
    if (
      parsed.kind !== "browser-element-comment"
      || typeof parsed.id !== "string"
      || typeof parsed.comment !== "string"
      || typeof parsed.pageUrl !== "string"
      || typeof parsed.selector !== "string"
      || typeof parsed.tagName !== "string"
      || !parsed.rect
    ) return null;
    return {
      id: parsed.id,
      comment: parsed.comment,
      createdAt: String(parsed.createdAt ?? ""),
      pageUrl: parsed.pageUrl,
      pageTitle: String(parsed.pageTitle ?? ""),
      tagName: parsed.tagName,
      selector: parsed.selector,
      path: String(parsed.path ?? ""),
      text: String(parsed.text ?? ""),
      ariaLabel: String(parsed.ariaLabel ?? ""),
      nearbyText: String(parsed.nearbyText ?? ""),
      outerHtml: String(parsed.outerHtml ?? ""),
      imageUrl: String(parsed.imageUrl ?? ""),
      linkUrl: String(parsed.linkUrl ?? ""),
      rect: {
        x: Number(parsed.rect.x ?? 0),
        y: Number(parsed.rect.y ?? 0),
        width: Number(parsed.rect.width ?? 0),
        height: Number(parsed.rect.height ?? 0),
      },
      ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
    };
  } catch {
    return null;
  }
}
