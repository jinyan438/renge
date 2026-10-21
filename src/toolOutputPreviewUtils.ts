export const TOOL_OUTPUT_PREVIEW_MAX_CHARS = 32_000;
export const TOOL_OUTPUT_PREVIEW_MAX_LINES = 400;

/** Bound rendered text only; the complete result stays in the tool transcript. */
export function getToolOutputPreview(text: string, tail = true, maxChars = TOOL_OUTPUT_PREVIEW_MAX_CHARS, maxLines = TOOL_OUTPUT_PREVIEW_MAX_LINES) {
  let start = tail ? Math.max(0, text.length - maxChars) : 0;
  let end = tail ? text.length : Math.min(text.length, maxChars);
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start])) start += 1;
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
  let cursor = tail ? end : start;
  for (let line = 0; line < maxLines; line += 1) {
    if (tail && cursor <= start) break;
    const newline = tail ? text.lastIndexOf("\n", cursor - 1) : text.indexOf("\n", cursor);
    if (newline < start || newline >= end || newline === -1) break;
    if (line === maxLines - 1) {
      if (tail) start = newline + 1;
      else end = newline;
    }
    cursor = tail ? newline : newline + 1;
  }
  return { text: text.slice(start, end), truncated: start > 0 || end < text.length };
}
