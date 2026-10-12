export type ReviewMode = "working" | "staged" | "branch" | "commit";
export type ReviewFile = { path: string; oldPath?: string; status: string; additions: number; deletions: number; binary: boolean; size: number; version: string; statsUnknown?: boolean };
export type ReviewSnapshot = { root: string; branch: string; head: string; mode: ReviewMode; base: string; baseCommit: string; branches: string[]; defaultBase: string; files: ReviewFile[]; version: string; truncated: boolean; totalFiles: number; createdAt: string };
export type ReviewDetail = ReviewFile & { diff: string; fingerprint: string; truncated: boolean };
export type ReviewLine = { kind: "addition" | "deletion" | "context" | "meta"; content: string; oldLine: number | null; newLine: number | null };
export type ReviewFinding = { id: string; path: string; side: "left" | "right"; line: number; priority: number; title: string; body: string; source: "manual" | "ai"; resolved: boolean; fingerprint: string; scope: string; snapshotVersion?: string; fileVersion?: string };
export type ReviewSource = { id: string; name: string; snapshot(mode: ReviewMode, base: string, signal?: AbortSignal): Promise<ReviewSnapshot>; file(path: string, mode: ReviewMode, base: string, signal?: AbortSignal): Promise<ReviewDetail> };
export type ReviewRequest = { snapshot: ReviewSnapshot; files: ReviewDetail[]; instructions: string };
export type ReviewAiResult = { summary: string; findings: unknown[] };

export function parseReviewDiff(diff: string): ReviewLine[] {
  let oldLine = 0, newLine = 0, inHunk = false;
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; }
    if (hunk || !inHunk || line.startsWith("\\") || !/^[ +\-]/.test(line)) {
      return { kind: "meta", content: line, oldLine: null, newLine: null };
    }
    if (line.startsWith("+")) return { kind: "addition", content: line.slice(1), oldLine: null, newLine: newLine++ };
    if (line.startsWith("-")) return { kind: "deletion", content: line.slice(1), oldLine: oldLine++, newLine: null };
    return { kind: "context", content: line.slice(1), oldLine: oldLine++, newLine: newLine++ };
  });
}

export function buildSplitReviewRows(lines: ReviewLine[]): { left: ReviewLine | null; right: ReviewLine | null }[] {
  const rows: { left: ReviewLine | null; right: ReviewLine | null }[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.kind !== "deletion" && line.kind !== "addition") {
      rows.push({ left: line, right: line }); index++; continue;
    }
    const removed: ReviewLine[] = [], added: ReviewLine[] = [];
    while (index < lines.length && lines[index].kind === "deletion") removed.push(lines[index++]);
    while (index < lines.length && lines[index].kind === "addition") added.push(lines[index++]);
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair++) rows.push({ left: removed[pair] ?? null, right: added[pair] ?? null });
  }
  return rows;
}

export function normalizeReviewFindings(raw: unknown[], files: ReviewDetail[], scope: string): ReviewFinding[] {
  const allowed = new Map(files.map((file) => [file.path, { file, lines: parseReviewDiff(file.diff) }]));
  return raw.slice(0, 100).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>, target = allowed.get(String(item.path ?? ""));
    const side = item.side === "left" ? "left" : "right", line = Number(item.line);
    if (!target || !Number.isInteger(line) || line < 1 || !target.lines.some((entry) => (side === "left" ? entry.oldLine : entry.newLine) === line)) return [];
    const title = String(item.title ?? "").trim(), body = String(item.body ?? "").trim();
    if (!title || !body) return [];
    return [{ id: crypto.randomUUID(), path: target.file.path, side, line, priority: typeof item.priority === "number" && Number.isInteger(item.priority) && item.priority >= 0 && item.priority <= 3 ? item.priority : 2, title: title.slice(0, 300), body: body.slice(0, 10_000), source: "ai" as const, resolved: false, fingerprint: target.file.fingerprint, scope }];
  });
}

export function buildReviewReport(findings: ReviewFinding[], summary = "") {
  return ["代码审阅", summary, ...findings.map((finding) => `[P${finding.priority}] ${finding.title}\n${finding.path}:${finding.line}（${finding.side === "left" ? "旧代码" : "新代码"}）\n${finding.body}`)].filter(Boolean).join("\n\n");
}
