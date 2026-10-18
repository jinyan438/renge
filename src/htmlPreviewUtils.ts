type HtmlPreviewContentSegment = {
  type: "text" | "html";
  content: string;
};

type HtmlPreviewStyleMessage = {
  role?: string;
  content?: string;
};

export function unwrapPackedHtmlPreviewDocument(content: string) {
  let unpacked = content;
  for (let depth = 0; depth < 3; depth += 1) {
    const wrapper = /^\s*(?:<body\b[^>]*>\s*)?<script\b([^>]*)>([\s\S]*?)<\/script>\s*(?:<\/body>\s*)?$/i.exec(unpacked);
    if (!wrapper) break;
    const scriptType = /\btype\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i.exec(wrapper[1]);
    if (/(?:^|\s)(?:src|async|defer)\b/i.test(wrapper[1]) ||
        (scriptType && !/^(?:text|application)\/javascript$/i.test(scriptType[2] ?? scriptType[3]))) break;
    // Recognize the complete UTF-8/base64 document writer, without evaluating
    // script code or discarding additional initialization statements.
    const packed = /^\s*\(function\s*\(\)\s*\{\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+TextDecoder\(\)\.decode\(\s*Uint8Array\.from\(\s*atob\((['"])([A-Za-z0-9+/=\s]+)\2\)\s*,\s*function\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*return\s+\4\.charCodeAt\(\s*0\s*\)\s*;?\s*\}\s*\)\s*\)\s*;\s*document\.write\(\s*\1\s*\)\s*;?\s*\}\s*\)\(\)\s*;?\s*$/.exec(wrapper[2]);
    if (!packed) break;
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(packed[3]), (character) => character.charCodeAt(0)),
      );
      if (!/^\s*(?:<!doctype\s+html|<(?:html|head|body)\b)/i.test(decoded)) break;
      unpacked = decoded;
    } catch { break; }
  }
  return unpacked;
}

export function deferHtmlPreviewFontStylesheets(content: string) {
  return content.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => {
    if (!/^<link\b/i.test(tag) || !/\brel\s*=\s*(['"])stylesheet\1/i.test(tag) ||
        !/\bhref\s*=\s*(['"])(?:https?:)?\/\/fonts\.googleapis\.com\/[^'"]*\1/i.test(tag) ||
        /\b(?:media|onload)\s*=/i.test(tag)) return tag;
    // Font downloads may be unavailable. Render with fallback fonts while the
    // optional stylesheet loads instead of blocking the card's module startup.
    return tag.replace(/\/?\s*>$/, " media=\"print\" onload=\"this.media='all'\">");
  });
}

export function getHtmlPreviewRootAttributes(content: string, ownerDocument: Document) {
  const match = /<html\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(content);
  if (!match) return {};
  const template = ownerDocument.createElement("template");
  template.innerHTML = `<div${match[1]}></div>`;
  return Object.fromEntries(Array.from(template.content.firstElementChild?.attributes ?? [])
    .filter(({ name }) => /^(?:data-|id$|class$)/i.test(name))
    .map(({ name, value }) => [name, value]));
}

// Tavern Helper only turns full frontend documents into frames. Passive HTML
// stays in .mes_text so card scripts can find and mount their own UI there.
export function isTavernInlineHtmlFragment(content: string, ownerDocument: Document) {
  if (!content.trimStart().startsWith("<") || /<!doctype|<\/?(?:html|head|body)\b/i.test(content)) return false;
  const template = ownerDocument.createElement("template");
  template.innerHTML = content;
  if (!template.content.childElementCount) return false;
  const allowedTags = new Set(
    "a b strong i em u s del small sub sup span div p br hr section article aside header footer main nav h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code table thead tbody tfoot tr th td caption colgroup col button label input select option optgroup textarea details summary img".split(" "),
  );
  for (const element of template.content.querySelectorAll("*")) {
    if (!allowedTags.has(element.localName)) return false;
    for (const attribute of element.attributes) {
      if (/^on|^(?:is|srcdoc)$/i.test(attribute.name)) return false;
      if (/^(?:href|src|action|formaction|xlink:href)$/i.test(attribute.name) &&
          /^(?:javascript|vbscript|data:text\/html):?/i.test(attribute.value.replace(/[\x00-\x20]/g, ""))) return false;
    }
  }
  return true;
}

export function injectHtmlPreviewHead(documentContent: string, headInjection: string) {
  const normalizedContent = documentContent.replace(
    /<meta\b(?=[^>]*\bname\s*=\s*["']?viewport\b)[^>]*>/gi,
    "",
  );
  // A replacement string would expand $&, $1, $` and $' found in bundled
  // dependencies or serialized card data, corrupting their JavaScript.
  if (/<head[\s>]/i.test(normalizedContent)) {
    return normalizedContent.replace(/<head([^>]*)>/i, (_match, attributes: string) =>
      `<head${attributes}>${headInjection}`);
  }
  if (/<html[\s>]/i.test(normalizedContent)) {
    return normalizedContent.replace(/<html([^>]*)>/i, (_match, attributes: string) =>
      `<html${attributes}><head>${headInjection}</head>`);
  }
  return `<head>${headInjection}</head>${normalizedContent}`;
}

const LOCALIZED_QUOTE_PAIR_PATTERN =
  /(["＂])(“[^”\n]+”|〝[^〞\n]+〞|「[^」\n]+」|｢[^｣\n]+｣|『[^』\n]+』)\1/g;

// These are inert markers for card scripts, not standalone HTML documents.
// Consume quoted attributes as a unit so a ref containing ">" stays intact.
export const TAVERN_INLINE_PLACEHOLDER_PATTERN =
  /<[A-Za-z][\w:-]*(?=[\s/>])(?:[^<>"'\r\n]|"[^"\r\n]*"|'[^'\r\n]*')*>/;

export function isTavernInlinePlaceholder(
  source: string,
  standardTags: ReadonlySet<string>,
) {
  const match = /^<([A-Za-z][\w:-]*)\b/.exec(source);
  if (!match || standardTags.has(match[1].toLowerCase())) return false;
  return /\/\s*>$/.test(source) || /Impl$/i.test(match[1]);
}

export function isTavernPlaceholderLine(
  source: string,
  standardTags: ReadonlySet<string>,
) {
  const pattern = new RegExp(TAVERN_INLINE_PLACEHOLDER_PATTERN.source, "g");
  let cursor = 0;
  let found = false;
  for (const match of source.matchAll(pattern)) {
    if (source.slice(cursor, match.index).trim() || !isTavernInlinePlaceholder(match[0], standardTags)) {
      return false;
    }
    cursor = match.index + match[0].length;
    found = true;
  }
  return found && !source.slice(cursor).trim();
}

const HTML_PREVIEW_LIGHTWEIGHT_SETTLE_DELAYS = [80, 240, 600] as const;
const HTML_PREVIEW_HEAVY_SETTLE_DELAYS = [240, 800, 1600] as const;

export function getHtmlPreviewLayoutSettleDelays(heavyContent: boolean) {
  return heavyContent
    ? [...HTML_PREVIEW_HEAVY_SETTLE_DELAYS]
    : [...HTML_PREVIEW_LIGHTWEIGHT_SETTLE_DELAYS];
}

export function isHtmlPreviewRootTag(
  tagName: string,
  standardTags: ReadonlySet<string>,
  blockRootTags: ReadonlySet<string>,
) {
  const normalizedTagName = tagName.trim().toLowerCase();
  return Boolean(normalizedTagName) &&
    (blockRootTags.has(normalizedTagName) || !standardTags.has(normalizedTagName));
}

export function unwrapTavernProseWrappers(content: string, standardTags: ReadonlySet<string>) {
  type Wrapper = {
    name: string;
    start: number;
    openEnd: number;
    closeStart: number;
    end: number;
    prose: boolean;
    transparent: boolean;
    comments: Array<[number, number]>;
    children: Wrapper[];
  };
  const roots: Wrapper[] = [];
  const stack: Wrapper[] = [];
  // Scan source instead of parsing/reserializing HTML, preserving Markdown,
  // entities and script payloads exactly. Code examples are opaque to this pass.
  const tokens = /<!--[\s\S]*?(?:-->|$)|^[ \t]*(?<fence>`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)|(?<inline>`+)[\s\S]*?\k<inline>(?!`)|<\s*(?<isClosing>\/\s*)?(?<tag>[A-Za-z][\w:-]*)(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>/gm;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(content))) {
    const parent = stack[stack.length - 1];
    if (parent && content.slice(cursor, match.index).trim()) parent.prose = true;
    const { fence, inline, tag, isClosing } = match.groups ?? {};
    if (fence) {
      const closing = new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*(?:\\r?\\n|$)`, "gm");
      closing.lastIndex = tokens.lastIndex;
      const end = closing.exec(content);
      tokens.lastIndex = end ? closing.lastIndex : content.length;
      if (parent) parent.prose = true;
    } else if (inline) {
      if (parent) parent.prose = true;
    } else if (match[0].startsWith("<!--")) {
      parent?.comments.push([match.index, tokens.lastIndex]);
    } else if (tag) {
      const name = tag.toLowerCase();
      if (isClosing) {
        // Only balanced wrappers qualify. Mismatched/unfinished markup keeps
        // its original HTML recovery behavior.
        if (parent?.name === name) {
          parent.closeStart = match.index;
          parent.end = tokens.lastIndex;
          stack.pop();
          const outer = stack[stack.length - 1];
          if (outer) {
            outer.prose ||= parent.prose;
            if (outer.name !== "content" && !parent.transparent) outer.transparent = false;
          }
        } else if (parent) {
          parent.transparent = false;
        }
      } else if (isTavernInlinePlaceholder(match[0], standardTags)) {
        // Inert illustration/status slots may occur between prose paragraphs.
      } else {
        const transparent = name === "content" ||
          (!standardTags.has(name) && /^[A-Za-z]\w*$/.test(tag) &&
            new RegExp(`^<\\s*${tag}\\s*>$`, "i").test(match[0]));
        if (parent && parent.name !== "content" && !transparent) parent.transparent = false;
        if (/\/\s*>$/.test(match[0]) || /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name)) {
          // Standard void elements are HTML, not prose boundary markers.
        } else if (/^(?:script|style|pre|code|textarea|title)$/.test(name)) {
          const closing = new RegExp(`</${name}\\s*>`, "gi");
          closing.lastIndex = tokens.lastIndex;
          tokens.lastIndex = closing.exec(content) ? closing.lastIndex : content.length;
        } else {
          const wrapper: Wrapper = {
            name, start: match.index, openEnd: tokens.lastIndex, closeStart: -1, end: -1,
            prose: false, transparent, comments: [], children: [],
          };
          (parent?.children ?? roots).push(wrapper);
          stack.push(wrapper);
        }
      }
    }
    cursor = tokens.lastIndex;
  }
  const removals: Array<[number, number]> = [];
  const collect = (wrapper: Wrapper) => {
    if (!wrapper.transparent || wrapper.end < 0 || !wrapper.prose) return;
    removals.push([wrapper.start, wrapper.openEnd], [wrapper.closeStart, wrapper.end]);
    // Comments were invisible in HTML and must stay invisible when the body
    // switches to Markdown. Comments inside code/real HTML remain untouched.
    removals.push(...wrapper.comments);
    wrapper.children.forEach(collect);
  };
  roots.forEach(collect);
  let result = content;
  removals.sort((a, b) => b[0] - a[0]).forEach(([start, end]) => {
    // Adjacent wrappers must not concatenate the last and first paragraphs.
    const separator = content.startsWith("<!--", start) ||
      (content[start - 1] === "\n" && content[end] === "\n") ? "" : "\n\n";
    result = result.slice(0, start) + separator + result.slice(end);
  });
  return result;
}

export function normalizeRedundantTavernQuotePairs(content: string) {
  let normalized = content;
  let previous = "";

  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(LOCALIZED_QUOTE_PAIR_PATTERN, "$2");
  }

  return normalized;
}

function isHtmlStylesheetLink(resource: string) {
  return /\brel\s*=\s*(?:"[^"]*\bstylesheet\b[^"]*"|'[^']*\bstylesheet\b[^']*'|stylesheet\b)/i.test(
    resource,
  );
}

export function collectInheritedHtmlPreviewStyleResources(
  messages: HtmlPreviewStyleMessage[],
  currentMessageIndex: number,
) {
  const inheritedResources = new Map<string, string>();
  const endIndex = Number.isFinite(currentMessageIndex)
    ? Math.max(0, Math.min(messages.length, Math.trunc(currentMessageIndex)))
    : 0;

  messages.slice(0, endIndex).forEach((message) => {
    if (message.role !== "assistant" || typeof message.content !== "string") return;

    const contentWithoutScripts = message.content.replace(
      /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
      "",
    );
    const resourcePattern = /<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = resourcePattern.exec(contentWithoutScripts))) {
      const resource = match[0].trim();
      if (/^<link\b/i.test(resource) && !isHtmlStylesheetLink(resource)) continue;

      // An identical later resource supersedes its earlier occurrence. Moving
      // it to the end keeps CSS cascade order without cloning it per turn.
      inheritedResources.delete(resource);
      inheritedResources.set(resource, resource);
    }
  });

  return Array.from(inheritedResources.values()).join("\n");
}

function isHtmlPreviewSegmentGlue(content: string) {
  return content.replace(/<!--[\s\S]*?-->/g, "").trim().length === 0;
}

export function mergeWhitespaceSeparatedHtmlPreviewSegments(
  segments: HtmlPreviewContentSegment[],
) {
  const merged: HtmlPreviewContentSegment[] = [];

  segments.forEach((segment) => {
    const nextSegment = { ...segment };
    const previousSegment = merged[merged.length - 1];

    if (previousSegment?.type === nextSegment.type) {
      previousSegment.content += nextSegment.content;
      return;
    }

    const precedingHtmlSegment = merged[merged.length - 2];
    if (
      nextSegment.type === "html" &&
      previousSegment?.type === "text" &&
      precedingHtmlSegment?.type === "html" &&
      isHtmlPreviewSegmentGlue(previousSegment.content)
    ) {
      merged.pop();
      precedingHtmlSegment.content += previousSegment.content + nextSegment.content;
      return;
    }

    merged.push(nextSegment);
  });

  return merged;
}

export function stabilizeHtmlPreviewRuntimeCompatibility(content: string) {
  let stabilized = content.replace(
    /(\b(?:document\.getElementById|(?:document|[A-Za-z_$][\w$]*)\.querySelector)\([^;\r\n]*?\))\.addEventListener\s*\(/g,
    "$1?.addEventListener(",
  );

  stabilized = stabilized.replace(
    /\bawait\s+loadFabShortcutConfig\s*\(\s*\)\s*;/g,
    'if (typeof loadFabShortcutConfig === "function") await loadFabShortcutConfig();',
  );

  return stabilized;
}

export function stabilizeHtmlPreviewMapViewport(content: string) {
  let stabilized = content.replace(
    /(class\s+MapRenderer\s*\{[\s\S]*?\n\s+resize\(\)\s*\{)\s*this\.canvas\.width\s*=\s*this\.container\.clientWidth;\s*this\.canvas\.height\s*=\s*this\.container\.clientHeight;\s*this\.drawMap\(\);\s*\}/,
    `$1
            const nextWidth = this.container.clientWidth;
            const nextHeight = this.container.clientHeight;
            this.canvas.width = nextWidth;
            this.canvas.height = nextHeight;

            if (!this.__rengeInitialMapFit && nextWidth > 0 && nextHeight > 0 && this._mapData) {
              const mapPoints = [];
              const collectPoints = item => {
                if (Array.isArray(item?.points)) {
                  item.points.forEach(point => {
                    if (Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))) {
                      mapPoints.push([Number(point[0]), Number(point[1])]);
                    }
                  });
                } else if (Number.isFinite(Number(item?.x)) && Number.isFinite(Number(item?.y))) {
                  mapPoints.push([Number(item.x), Number(item.y)]);
                }
              };
              ['terrains', 'main_regions', 'sub_regions', 'points_of_interest'].forEach(key => {
                const items = this._mapData[key];
                if (Array.isArray(items)) items.forEach(collectPoints);
              });
              if (mapPoints.length === 0) {
                const mapWidth = Number(this._mapData.width);
                const mapHeight = Number(this._mapData.height);
                if (mapWidth > 0 && mapHeight > 0) mapPoints.push([0, 0], [mapWidth, mapHeight]);
              }
              if (mapPoints.length > 0) {
                const xs = mapPoints.map(point => point[0]);
                const ys = mapPoints.map(point => point[1]);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);
                const minY = Math.min(...ys);
                const maxY = Math.max(...ys);
                const mapWidth = Math.max(1, maxX - minX);
                const mapHeight = Math.max(1, maxY - minY);
                const padding = 20;
                this.scale = Math.max(0.05, Math.min(5,
                  Math.max(1, nextWidth - padding * 2) / mapWidth,
                  Math.max(1, nextHeight - padding * 2) / mapHeight,
                ));
                this.offsetX = (nextWidth - mapWidth * this.scale) / 2 - minX * this.scale;
                this.offsetY = (nextHeight - mapHeight * this.scale) / 2 - minY * this.scale;
                this.__rengeInitialMapFit = true;
              }
            }
            this.drawMap();
          }`,
  );

  stabilized = stabilized.replace(
    /(async\s+function\s+openBirthLocationSelection\s*\(\s*\)\s*\{[\s\S]*?await\s+openMapManagement\s*\(\s*\)\s*;)(\s*\})/,
    `$1
          const __rengeMapChoices = document.querySelectorAll(
            '#map-list-container input[name="defaultMapSelection"]',
          );
          if (__rengeMapChoices.length === 1) {
            __rengeMapChoices[0].checked = true;
            await setDefaultMap();
            document.getElementById('map-management-overlay')?.classList.remove('visible');
            openMapSelection();
          }$2`,
  );

  return stabilized;
}
