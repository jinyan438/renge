export type ChatFileTarget = { path: string; line?: number };

/** Local paths only: never turn an arbitrary URL scheme into a file action. */
export function parseChatFileLink(value: string, explicit = false): ChatFileTarget | undefined {
  let path = value.trim();
  if (path.startsWith("<") && path.endsWith(">")) path = path.slice(1, -1);
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname && url.hostname !== "localhost") return undefined;
      path = url.pathname + url.hash;
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    } catch { return undefined; }
  }
  const suffix = /(?::([1-9]\d*)(?::[1-9]\d*)?|#L([1-9]\d*)(?:-L[1-9]\d*)?)$/.exec(path);
  if (suffix) path = path.slice(0, suffix.index);
  if (!path || /[\u0000-\u001f\u007f]/.test(path) || /^[\\/]{2}/.test(path)
    || (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))) return undefined;
  if (/[?#]/.test(path)) return undefined;
  try { path = decodeURIComponent(path); } catch { return undefined; }
  if (!path || /[\u0000-\u001f\u007f]/.test(path) || /^[\\/]{2}/.test(path)
    || (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))) return undefined;
  // Inline code often contains expressions. Require a recognizable path/file.
  if (!explicit && !/^(?:[a-z]:[\\/]|\.?\.?[\\/]|~[\\/])|[\\/][^\\/]+|^[\w\u4e00-\u9fff. -]+\.[a-z][a-z\d]{0,11}$/i.test(path)) return undefined;
  if (!explicit && /[=<>|*`]/.test(path)) return undefined;
  const line = suffix ? Number(suffix[1] || suffix[2]) : undefined;
  return { path, ...(line && Number.isSafeInteger(line) ? { line } : {}) };
}

export function splitChatFilePaths(text: string): { text: string; target?: ChatFileTarget }[] {
  const pattern = /(?:[a-z]:[\\/]|\.{0,2}[\\/]|~[\\/])[\p{L}\p{N}_.@+~$%()\-\\/]+(?::[1-9]\d*(?::[1-9]\d*)?|#L[1-9]\d*(?:-L[1-9]\d*)?)?|[\p{L}\p{N}_@+\-]+(?:[\\/][\p{L}\p{N}_.@+~$%()\-]+)+(?::[1-9]\d*|#L[1-9]\d*)?|\b[\w-]+\.(?:md|tsx?|jsx?|mjs|cjs|json|py|css|html|vue|rs|go|java|kt|cpp|hpp|txt|ya?ml|toml|ps1|sh)\b(?::[1-9]\d*|#L[1-9]\d*)?/giu;
  const parts: { text: string; target?: ChatFileTarget }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    // A slash inside a URL, date or identifier is not a local file mention.
    if (start > 0 && /[\w:/\\@]/.test(text[start - 1])) continue;
    let token = match[0].replace(/[.,;:!?，。；：！？、）】》]+$/u, "");
    while (token.endsWith(")") && (token.match(/\(/g)?.length ?? 0) < (token.match(/\)/g)?.length ?? 0)) token = token.slice(0, -1);
    const target = parseChatFileLink(token);
    if (!target || /^\d+[/-]\d+(?:[/-]\d+)?$/.test(token)) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: token, target });
    cursor = start + token.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

export function workspaceRelativeFilePath(path: string, root = "") {
  const normalized = path.replace(/\\/g, "/");
  const absolute = /^(?:[a-z]:\/|\/|~\/)/i.test(normalized);
  let result = normalized;
  if (absolute) {
    const base = root.replace(/\\/g, "/").replace(/\/$/, "");
    const insensitive = /^[a-z]:/i.test(base);
    const compare = (value: string) => insensitive ? value.toLowerCase() : value;
    if (!base || !compare(result).startsWith(compare(`${base}/`))) throw new Error("该路径不在当前工作区内，请先切换到文件所在的工作区。");
    result = result.slice(base.length + 1);
  }
  const segments: string[] = [];
  for (const segment of result.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new Error("该路径位于当前工作区之外。");
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
}

let opener: ((target: ChatFileTarget) => void) | undefined;
export function registerChatFileOpener(callback: (target: ChatFileTarget) => void) {
  opener = callback;
  return () => { if (opener === callback) opener = undefined; };
}
export function openChatFile(target: ChatFileTarget) { opener?.(target); }
