export type ToolDiffLine = {
  kind: "addition" | "deletion" | "context" | "meta";
  number: number | null;
  marker: string;
  content: string;
};

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
