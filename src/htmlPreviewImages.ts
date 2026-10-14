// Install before card scripts run, including scripts which build inline CSS
// through innerHTML. Leave local, data and blob resources in their original realm.
function installHtmlPreviewImages(proxyBaseUrl: string) {
  const proxy = (source: string) => {
    if (!/^(?:https?:)?\/\//i.test(source)) return source;
    try {
      const url = new URL(source, document.baseURI);
      if (!/^https?:$/.test(url.protocol) || url.origin === location.origin ||
          url.origin === new URL(proxyBaseUrl).origin ||
          /^(?:localhost|127\.|\[::1\])|\.localhost$/i.test(url.hostname)) return source;
      return proxyBaseUrl + "?url=" + encodeURIComponent(url.href);
    } catch { return source; }
  };
  const css = (source: string) => source.replace(
    /(^|[;{])(\s*(?:background(?:-image)?|border-image(?:-source)?|list-style(?:-image)?|(?:-webkit-)?mask(?:-image)?|content|cursor)\s*:\s*)([^;}]+)/gi,
    (_match, boundary: string, property: string, value: string) => boundary + property + value.replace(
      /url\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s)'"\\]+))\s*\)/gi,
      (match: string, doubleQuoted: string, singleQuoted: string, unquoted: string) => {
        const sourceUrl = doubleQuoted ?? singleQuoted ?? unquoted;
        const nextUrl = proxy(sourceUrl);
        return nextUrl === sourceUrl ? match : `url("${nextUrl}")`;
      },
    ),
  );
  const update = (element: Element) => {
    if (element instanceof HTMLImageElement ||
        (element instanceof HTMLSourceElement && element.parentElement?.localName === "picture")) {
      for (const attribute of ["src", "srcset"]) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        // Data URL commas belong to the resource, not a srcset separator.
        const next = attribute === "src" ? proxy(value) : value.replace(
          /(^|\s)((?:https?:)?\/\/[^\s]+)/gi,
          (_match, prefix: string, source: string) => {
            const trailing = /,+$/.exec(source)?.[0] ?? "";
            return prefix + proxy(source.slice(0, source.length - trailing.length)) + trailing;
          },
        );
        if (next !== value) element.setAttribute(attribute, next);
      }
    }
    const style = element.getAttribute("style");
    if (style) {
      const next = css(style);
      if (next !== style) element.setAttribute("style", next);
    }
    if (element instanceof HTMLStyleElement) {
      const value = element.textContent ?? "";
      const next = css(value);
      if (next !== value) element.textContent = next;
    }
  };
  const scan = (node: Node) => {
    if (!(node instanceof Element)) return;
    update(node);
    node.querySelectorAll("img,source,[style],style").forEach(update);
  };
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") update(record.target as Element);
      else if (record.type === "characterData" && record.target.parentElement instanceof HTMLStyleElement) {
        update(record.target.parentElement);
      } else {
        if (record.target instanceof HTMLStyleElement) update(record.target);
        record.addedNodes.forEach(scan);
      }
    }
  }).observe(document, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ["style", "src", "srcset"] });
  if (document.documentElement) scan(document.documentElement);
}

export function buildHtmlPreviewImagesScript(proxyBaseUrl: string) {
  return `<script data-renge-html-preview-images="true">(${installHtmlPreviewImages.toString()})(${JSON.stringify(proxyBaseUrl)});</script>`;
}
