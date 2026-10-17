// Pi extensions may return terminal hyperlinks (OSC 8) even in RPC mode.
// Preserve their targets in the browser, then remove remaining terminal codes.
export function normalizePiExtensionText(value) {
  if (typeof value !== "string") return "";
  return value.replace(
    /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)([\s\S]*?)\x1b\]8;[^;\x07\x1b]*;(?:\x07|\x1b\\)/g,
    (_match, url, label) => {
      if (!/^https?:\/\//i.test(url) || /[\s\x00-\x1f\x7f]/.test(url)) return label;
      const text = label.replace(/^\[([^\]]+)\]$/, "$1").replace(/[\\[\]]/g, "");
      const target = url.replace(/[<>\\()]/g, (character) => encodeURIComponent(character)
        .replace("(", "%28").replace(")", "%29"));
      return `[${text}](${target})`;
    },
  )
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_]|[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export function getPiExtensionDisplayText(value) {
  if (typeof value === "string") return normalizePiExtensionText(value);
  if (Array.isArray(value)) return value.map(getPiExtensionDisplayText).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  // Image blocks and private details are not text to display.
  for (const key of ["text", "content", "message", "markdown"]) {
    if (value[key] !== undefined) return getPiExtensionDisplayText(value[key]);
  }
  return "";
}

export function isPiTerminalUiCompatibilityNotice(value) {
  return normalizePiExtensionText(value).trim() === "此扩展使用了终端专用组件，请使用支持 RPC 的文本界面。";
}

export function normalizePiExtensionResult(result) {
  if (!result || !Array.isArray(result.content)) return result;
  return { ...result, content: result.content.map((block) => block?.type === "text"
    ? { ...block, text: normalizePiExtensionText(block.text) }
    : block) };
}
