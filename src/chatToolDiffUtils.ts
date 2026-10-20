export type ToolDiffLine = {
  kind: "addition" | "deletion" | "context" | "meta";
  number: number | null;
  marker: string;
  content: string;
};

export type HighlightedToolDiffLine = ToolDiffLine & { html: string };
export const TOOL_DIFF_PREVIEW_MAX_LINES = 600;

export function getToolDiffViewportRange(lineCount: number, scrollTop: number, viewportHeight: number, rowHeight: number) {
  const height = Math.max(1, rowHeight);
  const top = Math.max(0, scrollTop);
  const start = Math.max(0, Math.min(Math.floor(top / height) - 8, lineCount - 1));
  const end = Math.min(lineCount, Math.ceil((top + viewportHeight) / height) + 8);
  return { start, end, before: start * height, after: (lineCount - end) * height };
}

/** Retain only the visible lines, and highlight only code that actually changed. */
export function createToolDiffPreviewCache(highlight: (content: string, path: string) => string) {
  let previousPath = "";
  let previousLines: HighlightedToolDiffLine[] = [];
  return (diff: string, numbered: boolean, path: string) => {
    const parsed = parseToolDiffLines(diff, numbered);
    let unchanged = path === previousPath;
    const lines = parsed.slice(0, TOOL_DIFF_PREVIEW_MAX_LINES).map((line, index) => {
      const previous = path === previousPath ? previousLines[index] : undefined;
      const html = previous?.content === line.content
        ? previous.html : highlight(line.content || " ", path);
      if (previous && previous.content === line.content && previous.kind === line.kind &&
        previous.number === line.number && previous.marker === line.marker) return previous;
      unchanged = false;
      return { ...line, html };
    });
    if (lines.length !== previousLines.length) unchanged = false;
    previousLines = unchanged ? previousLines : lines;
    previousPath = path;
    return {
      lines: previousLines,
      additions: parsed.filter((line) => line.kind === "addition").length,
      deletions: parsed.filter((line) => line.kind === "deletion").length,
      truncated: parsed.length > TOOL_DIFF_PREVIEW_MAX_LINES,
    };
  };
}

export function parseToolDiffLines(diff: string, numbered = false): ToolDiffLine[] {
  let oldLine: number | null = null;
  let newLine: number | null = null;
  return diff.replace(/\r\n/g, "\n").split("\n").map((line) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
    }
    if (hunk || /^(?:diff |index |--- |\+\+\+ |\\ No newline|\*\*\*)/.test(line)) {
      return { kind: "meta", number: null, marker: "", content: line };
    }
    const marker = /^[+ -]/.test(line) ? line[0] : "";
    const kind = marker === "+" ? "addition" : marker === "-" ? "deletion" : "context";
    const numberedLine = numbered ? /^[+ -]\s*(\d+) (.*)$/.exec(line) : null;
    if (numberedLine) {
      return { kind, number: Number(numberedLine[1]), marker, content: numberedLine[2] };
    }
    // Unnumbered argument previews have no reliable file offsets.
    const number = kind === "deletion" ? oldLine : newLine;
    if (kind !== "addition" && oldLine !== null) oldLine++;
    if (kind !== "deletion" && newLine !== null) newLine++;
    return { kind, number, marker, content: marker ? line.slice(1) : line };
  });
}
