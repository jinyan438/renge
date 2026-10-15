import { ArrowLeft, Check, ClipboardCheck, Copy, FileCode2, Maximize2, MessageSquarePlus, Minimize2, RefreshCw, Search, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDesktopWindow } from "./NativeDesktopWindow";
import { buildReviewReport, buildSplitReviewRows, normalizeReviewFindings, parseReviewDiff, type ReviewAiResult, type ReviewDetail, type ReviewFinding, type ReviewLine, type ReviewMode, type ReviewRequest, type ReviewSnapshot, type ReviewSource } from "./codeReviewUtils";
import { highlightSourceCode } from "./syntaxHighlighting";
import "./code-review.css";

export type CodeReviewPanelProps = {
  source: ReviewSource | null;
  onBack: () => void;
  onClose: () => void;
  onChooseWorkspace?: () => void | Promise<void>;
  onAiReview?: (request: ReviewRequest, signal: AbortSignal) => Promise<ReviewAiResult>;
  onSendToChat?: (content: string) => void | Promise<void>;
  modelLabel?: string;
};
type StoredReview = { findings: ReviewFinding[]; reviewed: Record<string, string> };
type Anchor = { path: string; side: "left" | "right"; line: number };
const statusNames: Record<string, string> = { M: "修改", A: "新增", D: "删除", R: "重命名", C: "复制", U: "冲突", T: "类型变更", "?": "未跟踪" };
function loadReview(key: string): StoredReview {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
    return { findings: Array.isArray(raw.findings) ? raw.findings.filter((item: ReviewFinding) => item && typeof item.id === "string" && typeof item.path === "string" && typeof item.body === "string" && typeof item.scope === "string").slice(0, 1000) : [], reviewed: raw.reviewed && typeof raw.reviewed === "object" && !Array.isArray(raw.reviewed) ? raw.reviewed : {} };
  } catch { return { findings: [], reviewed: {} }; }
}
const describeError = (error: unknown) => error instanceof Error ? error.message : String(error);

export function CodeReviewPanel({ source, onBack, onClose, onChooseWorkspace, onAiReview, onSendToChat, modelLabel }: CodeReviewPanelProps) {
  const window = useDesktopWindow();
  const document = window.document;
  const storageKey = `renge-code-review-v1:${source?.id ?? "none"}`;
  const [stored, setStored] = useState(() => loadReview(storageKey));
  const [mode, setMode] = useState<ReviewMode>("working");
  const [base, setBase] = useState("HEAD");
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const [path, setPath] = useState("");
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [filter, setFilter] = useState("");
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [notice, setNotice] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [aiScope, setAiScope] = useState("current");
  const [instructions, setInstructions] = useState("");
  const [summary, setSummary] = useState("");
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const anchorRef = useRef(anchor); anchorRef.current = anchor;
  const [focusAnchor, setFocusAnchor] = useState<Anchor | null>(null);
  const [comment, setComment] = useState("");
  const [editingFindingId, setEditingFindingId] = useState<string | null>(null);
  const [priority, setPriority] = useState(2);
  const [showResolved, setShowResolved] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const aiRef = useRef<AbortController | null>(null);
  const diffRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const scope = `${mode}:${mode === "branch" ? base : ""}`;

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(stored)); }
    catch { setError("评论暂未保存到本机，请复制审阅报告后重试。"); }
  }, [stored, storageKey]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; requestRef.current?.abort(); aiRef.current?.abort(); }; }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!source) return;
    if (quiet && anchorRef.current) return;
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    if (!quiet) { setLoading(true); setError(""); }
    try {
      const next = await source.snapshot(mode, base, controller.signal);
      if (controller.signal.aborted) return;
      if (snapshotRef.current?.version !== next.version || snapshotRef.current.mode !== next.mode || snapshotRef.current.base !== next.base) {
        if (snapshotRef.current) setSummary("");
        snapshotRef.current = next; setSnapshot(next);
        setPath((current) => next.files.some((file) => file.path === current) ? current : next.files[0]?.path ?? "");
      }
    } catch (failure) { if (!controller.signal.aborted) setError(describeError(failure)); }
    finally { if (requestRef.current === controller) setLoading(false); }
  }, [source, mode, base]);
  useEffect(() => {
    setSnapshot(null); snapshotRef.current = null; setDetail(null); setSummary(""); setAnchor(null);
    aiRef.current?.abort();
    void refresh();
    const focus = () => void refresh(true);
    const timer = window.setInterval(focus, 8000);
    window.addEventListener("focus", focus);
    return () => { requestRef.current?.abort(); window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [refresh]);
  useEffect(() => {
    setDetail(null); setAnchor(null); setFileError("");
    if (!source || !snapshot || !path) { setDetailLoading(false); return; }
    const controller = new AbortController(); setDetailLoading(true);
    void source.file(path, mode, base, controller.signal).then((next) => {
      if (!controller.signal.aborted) setDetail(next);
    }).catch((failure) => { if (!controller.signal.aborted) setFileError(describeError(failure)); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [source, snapshot, path, mode, base]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [expanded]);
  useEffect(() => {
    if (!detail || !focusAnchor || detail.path !== focusAnchor.path) return;
    const elements = diffRef.current?.querySelectorAll<HTMLElement>("[data-review-line]");
    const target = Array.from(elements ?? []).find((element) => Number(element.dataset.reviewLine) === focusAnchor.line && element.dataset.reviewSide === focusAnchor.side);
    target?.scrollIntoView({ block: "center", behavior: "smooth" }); target?.focus({ preventScroll: true });
    setFocusAnchor(null);
  }, [detail, focusAnchor, layout]);

  const lines = useMemo(() => detail ? parseReviewDiff(detail.diff).slice(0, 5000) : [], [detail]);
  const highlighted = useMemo(() => new Map(lines.map((line) => [line, highlightSourceCode(line.content || " ", detail?.path ?? "").html])), [lines, detail?.path]);
  const splitRows = useMemo(() => buildSplitReviewRows(lines), [lines]);
  const visibleFiles = (snapshot?.files ?? []).filter((file) => file.path.toLowerCase().includes(filter.toLowerCase()));
  const findings = stored.findings.filter((finding) => finding.scope === scope && (showResolved || !finding.resolved));
  const isFindingCurrent = (finding: ReviewFinding) => Boolean(snapshot &&
    (finding.fileVersion ? snapshot.files.some((file) => file.path === finding.path && file.version === finding.fileVersion) : finding.snapshotVersion === snapshot.version) &&
    (finding.path !== detail?.path || finding.fingerprint === detail.fingerprint));
  const freshFindings = findings.filter((finding) => !finding.resolved && isFindingCurrent(finding));
  const selectedFindings = findings.filter((finding) => finding.path === path);
  const reviewedCount = snapshot?.files.filter((file) => stored.reviewed[`${scope}:${file.path}`] === file.version).length ?? 0;
  const totals = snapshot?.files.reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 });

  const saveComment = () => {
    if (!anchor || !detail || !snapshot || !comment.trim()) return;
    const finding: ReviewFinding = { id: editingFindingId ?? crypto.randomUUID(), ...anchor, title: comment.trim().split("\n")[0].slice(0, 150), body: comment.trim(), priority, source: "manual", resolved: false, fingerprint: detail.fingerprint, scope, snapshotVersion: snapshot.version, fileVersion: snapshot.files.find((file) => file.path === detail.path)?.version };
    setStored((current) => ({ ...current, findings: [...current.findings.filter((entry) => entry.id !== finding.id), finding] })); setAnchor(null); setComment(""); setEditingFindingId(null);
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setNotice("已复制。"); } catch { setError("复制失败，请检查剪贴板权限。"); }
  };
  const runAi = async () => {
    if (!source || !snapshot || !onAiReview || aiBusy) return;
    const currentSnapshot = snapshot;
    const controller = new AbortController(); aiRef.current = controller;
    setAiBusy(true); setError(""); setNotice("");
    try {
      const selected = aiScope === "all" ? currentSnapshot.files : currentSnapshot.files.filter((file) => file.path === path);
      if (selected.length > 50 || (aiScope === "all" && currentSnapshot.truncated)) throw new Error("变更文件较多，请选择当前文件逐个审阅。");
      const files: ReviewDetail[] = [];
      for (const file of selected) {
        if (controller.signal.aborted) return;
        setNotice(`正在读取 ${file.path}…`);
        files.push(await source.file(file.path, mode, base, controller.signal));
      }
      const readable = files.filter((file) => !file.binary && !file.truncated && file.diff);
      if (!readable.length) throw new Error("当前范围没有可供 AI 审阅的文本差异。");
      if (readable.reduce((size, file) => size + file.diff.length, 0) > 120_000) throw new Error("差异较大，请选择当前文件逐个审阅。");
      setNotice("AI 正在审阅代码…");
      const result = await onAiReview({ snapshot: currentSnapshot, files: readable, instructions }, controller.signal);
      const latest = await source.snapshot(mode, base, controller.signal);
      if (controller.signal.aborted) return;
      if (latest.version !== currentSnapshot.version) { await refresh(); throw new Error("审阅期间代码已变化，请基于最新差异重新审阅。"); }
      const next = normalizeReviewFindings(result.findings, readable, scope).map((finding) => ({ ...finding, snapshotVersion: currentSnapshot.version, fileVersion: currentSnapshot.files.find((file) => file.path === finding.path)?.version }));
      const paths = new Set(readable.map((file) => file.path));
      setStored((current) => ({ ...current, findings: [...current.findings.filter((finding) => finding.scope !== scope || finding.source !== "ai" || !paths.has(finding.path)), ...next] }));
      setSummary(result.summary);
      const skipped = files.length - readable.length;
      const rejected = result.findings.length - next.length;
      setNotice(`审阅完成，发现 ${next.length} 项问题。${skipped ? `已跳过 ${skipped} 个二进制或过大文件。` : ""}${rejected ? `已忽略 ${rejected} 条超出限制或无法定位的意见。` : ""}`);
    } catch (failure) { if (!controller.signal.aborted) { setError(describeError(failure)); setNotice(""); } }
    finally { if (aiRef.current === controller) { setAiBusy(false); aiRef.current = null; } }
  };
  const send = async () => {
    if (!freshFindings.length || !onSendToChat || !snapshot || !source || sendBusy) return;
    setSendBusy(true);
    try {
      const latest = await source.snapshot(mode, base);
      if (!mountedRef.current) return;
      if (latest.version !== snapshot.version) { await refresh(); throw new Error("代码已变化，请刷新并重新检查审阅意见后再交给 AI 修复。"); }
      await onSendToChat(`请根据以下代码审阅意见检查并修复当前工作区，修复后运行相关验证。\n工作区：${snapshot.root}\n范围：${mode === "branch" ? `分支相对 ${base}` : mode === "staged" ? "已暂存变更" : mode === "commit" ? "最近一次提交" : "未暂存变更"}\n\n${buildReviewReport(freshFindings, summary)}`);
      setNotice("已交给当前会话处理；会话运行中时会加入队列。");
    } catch (failure) { if (mountedRef.current) setError(describeError(failure)); }
    finally { if (mountedRef.current) setSendBusy(false); }
  };
  const numberButton = (line: ReviewLine | null, side: "left" | "right") => {
    const number = side === "left" ? line?.oldLine : line?.newLine;
    if (!number) return <span className="review-line-number" />;
    const hasFinding = selectedFindings.some((finding) => finding.side === side && finding.line === number && !finding.resolved);
    return <button className={`review-line-number${hasFinding ? " has-finding" : ""}`} type="button" data-review-side={side} data-review-line={number}
      aria-label={`在${side === "left" ? "旧代码" : "新代码"}第${number}行添加评论`} title="添加行级评论" onClick={() => { setAnchor({ path, side, line: number }); setComment(""); setEditingFindingId(null); }}>{number}</button>;
  };
  const findingCard = (finding: ReviewFinding) => {
    const stale = !isFindingCurrent(finding);
    return <article className={`review-finding${finding.resolved ? " resolved" : ""}`} key={finding.id}>
      <header><span className={`review-priority p${finding.priority}`}>P{finding.priority}</span><strong>{finding.title}</strong><small>{finding.source === "ai" ? "AI" : "评论"}{stale ? " · 代码已变化" : ""}</small></header>
      <button className="review-finding-location" type="button" disabled={stale} onClick={() => { setPath(finding.path); setFocusAnchor(finding); }}>{finding.path}:{finding.line} · {finding.side === "left" ? "旧" : "新"}</button>
      <p>{finding.body}</p><footer>
        {!stale && finding.path === detail?.path && <button type="button" onClick={() => { setAnchor(finding); setComment(finding.body); setPriority(finding.priority); setEditingFindingId(finding.id); }}>编辑</button>}
        <button type="button" onClick={() => setStored((current) => ({ ...current, findings: current.findings.map((entry) => entry.id === finding.id ? { ...entry, resolved: !entry.resolved } : entry) }))}><Check size={13} />{finding.resolved ? "重新打开" : "标记解决"}</button>
        <button type="button" aria-label="删除审阅意见" onClick={() => setStored((current) => ({ ...current, findings: current.findings.filter((entry) => entry.id !== finding.id) }))}><Trash2 size={13} /></button>
      </footer></article>;
  };

  const content = <section className={`code-review-panel${expanded ? " expanded" : ""}`} aria-label="代码审阅面板" role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined}>
    <header className="right-tool-page-header review-header"><button className="right-tool-page-back" type="button" onClick={expanded ? () => setExpanded(false) : onBack}><ArrowLeft size={16} />审阅</button><div>
      <button type="button" aria-label={expanded ? "收起代码审阅" : "展开代码审阅"} onClick={() => setExpanded((current) => !current)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      <button type="button" aria-label="关闭代码审阅" onClick={() => { setExpanded(false); onClose(); }}><X size={16} /></button></div></header>
    {!source ? <div className="review-empty"><ClipboardCheck size={30} /><strong>选择 Git 工作区开始审阅</strong><p>支持电脑本地仓库和连接电脑的仓库。手机本地文件夹与浏览器授权文件夹可通过「连接电脑」审阅。</p><button type="button" onClick={() => void onChooseWorkspace?.()}><FileCode2 size={15} />选择工作区</button></div> : <>
      <div className="review-repository"><div><strong>{source.name}</strong><small title={snapshot?.root}>{snapshot ? `${snapshot.branch} · ${snapshot.root}` : "正在读取 Git 仓库…"}</small></div><button type="button" aria-label="刷新代码变更" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "chat-status-spinner" : ""} size={16} /></button></div>
      <div className="review-controls"><div className="review-mode" role="group" aria-label="审阅范围">{([ ["working", "未暂存"], ["staged", "已暂存"], ["branch", "分支变更"], ["commit", "最近提交"] ] as const).map(([value, label]) => <button type="button" className={mode === value ? "active" : ""} key={value} onClick={() => { if (value === "branch" && mode !== "branch") setBase(snapshot?.defaultBase ?? "HEAD"); setMode(value); }}>{label}</button>)}</div>
        {mode === "branch" && <label className="review-base">比较基准<input aria-label="比较基准" list="review-base-refs" value={base} onChange={(event) => setBase(event.target.value)} /><datalist id="review-base-refs">{snapshot?.branches.map((branch) => <option value={branch} key={branch} />)}</datalist></label>}
        <div className="review-summary"><span>{snapshot?.totalFiles ?? 0} 个文件 · 已阅 {reviewedCount}</span><b className="additions">+{totals?.additions ?? 0}</b><b className="deletions">−{totals?.deletions ?? 0}</b></div>
      </div>
      {(error || fileError) && <p className="review-notice error" role="alert">{error || fileError}</p>}{notice && <p className="review-notice" role="status">{notice}</p>}{snapshot?.truncated && <p className="review-notice">仅列出前 {snapshot.files.length} 个文件，请缩小范围后完整审阅。</p>}
      <div className="review-body"><aside className="review-files" aria-label="变更文件"><label className="review-search"><Search size={14} /><input aria-label="筛选变更文件" placeholder="筛选文件" value={filter} onChange={(event) => setFilter(event.target.value)} /></label><div className="review-file-list">{visibleFiles.map((file) => <button type="button" key={file.path} className={file.path === path ? "active" : ""} onClick={() => setPath(file.path)} title={`${file.oldPath ? `${file.oldPath} → ` : ""}${file.path}`}><span className={`review-file-status s${file.status === "?" ? "new" : file.status}`}>{statusNames[file.status] ?? file.status}</span><span className="review-file-path">{file.path}</span><small>{file.binary ? "二进制" : file.statsUnknown ? "待统计" : `+${file.additions} −${file.deletions}`}</small>{stored.reviewed[`${scope}:${file.path}`] === file.version && <Check size={13} aria-label="已阅" />}</button>)}</div></aside>
        <main className="review-main">{!snapshot || loading ? <div className="review-empty">{error && !loading ? <><FileCode2 size={24} /><strong>无法读取此仓库</strong><button type="button" onClick={() => void onChooseWorkspace?.()}>更换工作区</button></> : <><RefreshCw size={24} className="chat-status-spinner" />正在读取变更…</>}</div> : !snapshot.files.length ? <div className="review-empty"><Check size={28} /><strong>此范围没有代码变更</strong><p>可以切换到已暂存、分支变更或最近提交。</p></div> : <>
          <div className="review-diff-header"><strong title={path}>{path}</strong><div><button type="button" disabled={!detail} onClick={() => void copy(detail?.diff ?? "")} aria-label="复制文件差异"><Copy size={14} /></button><button type="button" className={layout === "unified" ? "active" : ""} onClick={() => setLayout("unified")}>统一</button><button type="button" className={layout === "split" ? "active" : ""} onClick={() => setLayout("split")}>并排</button><label><input type="checkbox" aria-label="标记当前文件已阅" checked={Boolean(snapshot.files.find((file) => file.path === path && stored.reviewed[`${scope}:${file.path}`] === file.version))} onChange={(event) => { const file = snapshot.files.find((entry) => entry.path === path); if (file) setStored((current) => ({ ...current, reviewed: { ...current.reviewed, [`${scope}:${path}`]: event.target.checked ? file.version : "" } })); }} />已阅</label></div></div>
          <div className={`review-diff ${layout}`} ref={diffRef} aria-label="代码差异">{detailLoading ? <div className="review-empty">正在读取文件差异…</div> : detail?.binary ? <div className="review-empty">二进制文件，无法显示逐行差异。</div> : !detail?.diff ? <div className="review-empty">此文件没有可显示的文本差异。</div> : layout === "unified" ? lines.map((line, index) => <div className={`review-diff-row ${line.kind}`} key={index}>{line.kind === "meta" ? <code className="review-diff-meta">{line.content}</code> : <>{numberButton(line, "left")}{numberButton(line, "right")}<span className="review-marker">{line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : " "}</span><code dangerouslySetInnerHTML={{ __html: highlighted.get(line) ?? "" }} /></>}</div>) : splitRows.map((row, index) => row.left?.kind === "meta" ? <div className="review-diff-meta" key={index}>{row.left.content}</div> : <div className="review-split-row" key={index}>{(["left", "right"] as const).map((side) => <div className={`review-split-cell ${row[side]?.kind ?? "empty"}`} key={side}>{numberButton(row[side], side)}<code dangerouslySetInnerHTML={{ __html: row[side] ? highlighted.get(row[side]!) ?? "" : "" }} /></div>)}</div>)}</div>
          {(detail?.truncated || (detail && parseReviewDiff(detail.diff).length > 5000)) && <p className="review-notice">此差异较大，当前预览已截断；AI 审阅会跳过读取不完整的文件。</p>}
          {anchor && <form className="review-comment-editor" onSubmit={(event) => { event.preventDefault(); saveComment(); }}><header><MessageSquarePlus size={15} /><strong>{anchor.side === "left" ? "旧代码" : "新代码"}第 {anchor.line} 行</strong><button type="button" aria-label="取消评论" onClick={() => setAnchor(null)}><X size={14} /></button></header><textarea autoFocus aria-label="行级审阅评论" rows={3} placeholder="描述问题、影响及修复建议" value={comment} onChange={(event) => setComment(event.target.value)} /><footer><select aria-label="问题优先级" value={priority} onChange={(event) => setPriority(Number(event.target.value))}><option value={0}>P0 紧急</option><option value={1}>P1 高</option><option value={2}>P2 一般</option><option value={3}>P3 低</option></select><button type="submit" disabled={!comment.trim()}>保存评论</button></footer></form>}
          {selectedFindings.length > 0 && <section className="review-inline-findings" aria-label="当前文件的审阅意见">{selectedFindings.map(findingCard)}</section>}
        </>}</main>
      </div>
      <section className="review-ai"><div className="review-ai-heading"><strong><Sparkles size={15} />AI 审阅</strong><small>{modelLabel || "当前会话模型"}</small></div><textarea aria-label="额外审阅要求" rows={2} placeholder="可选：重点检查错误处理、并发或权限边界" value={instructions} onChange={(event) => setInstructions(event.target.value)} /><div><select aria-label="AI审阅范围" value={aiScope} onChange={(event) => setAiScope(event.target.value)}><option value="current">当前文件</option><option value="all">全部变更</option></select><button type="button" disabled={!snapshot?.files.length || !onAiReview || loading || aiBusy} onClick={() => void runAi()}><Sparkles size={14} />开始审阅</button>{aiBusy && <button type="button" onClick={() => { aiRef.current?.abort(); setNotice("AI 审阅已停止。"); }}><Square size={12} />停止</button>}</div>{summary && <p className="review-ai-summary">{summary}</p>}</section>
      <section className="review-findings" aria-label="全部审阅意见"><header><strong>审阅意见 · {findings.length}</strong><label><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />显示已解决</label><button type="button" aria-label="复制审阅报告" disabled={!findings.length && !summary} onClick={() => void copy(buildReviewReport(findings, summary))}><Copy size={14} /></button></header>{findings.length ? findings.map(findingCard) : <p>点击差异行号添加评论，或让 AI 检查代码变更。</p>}<button className="review-send" type="button" disabled={!freshFindings.length || !onSendToChat || aiBusy || sendBusy} onClick={() => void send()}><Send size={14} />交给当前会话修复（{freshFindings.length}）</button></section>
    </>}
  </section>;
  return expanded ? <>{createPortal(<div className="review-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}>{content}</div>, document.body)}<div className="review-expanded-placeholder"><ClipboardCheck size={28} /><p>审阅面板已展开</p><button type="button" onClick={() => setExpanded(false)}>收起面板</button></div></> : content;
}
