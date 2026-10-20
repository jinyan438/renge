import { Copy, FileCode2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createToolDiffPreviewCache, getToolDiffViewportRange, type HighlightedToolDiffLine } from "./chatToolDiffUtils";
import { escapeSourceHtml, highlightSourceCode } from "./syntaxHighlighting";

const DiffLine = memo(function DiffLine({ line }: { line: HighlightedToolDiffLine }) {
  return (
    <span className={line.kind}>
      <i className="pi-tool-diff-line-number" aria-hidden="true">{line.number ?? ""}</i>
      <span className="pi-tool-diff-marker">{line.marker || " "}</span>
      <code dangerouslySetInnerHTML={{ __html: line.html }} />
    </span>
  );
});

const DiffLines = memo(function DiffLines({ lines }: { lines: HighlightedToolDiffLine[] }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 300, rowHeight: 18 });
  const measure = useCallback(() => {
    const pre = preRef.current;
    const view = pre?.ownerDocument.defaultView;
    if (!pre || !view) return;
    const next = {
      top: pre.scrollTop, height: pre.clientHeight,
      rowHeight: Number.parseFloat(view.getComputedStyle(pre).lineHeight) || 18,
    };
    setViewport((current) => current.top === next.top && current.height === next.height && current.rowHeight === next.rowHeight ? current : next);
  }, []);
  useEffect(() => {
    const pre = preRef.current;
    const Observer = pre?.ownerDocument.defaultView?.ResizeObserver;
    if (!pre || !Observer) return;
    const observer = new Observer(measure);
    observer.observe(pre);
    return () => observer.disconnect();
  }, [measure]);
  const range = getToolDiffViewportRange(lines.length, viewport.top, viewport.height, viewport.rowHeight);
  const width = useMemo(() => Math.max(0, ...lines.map((line) =>
    line.content.replace(/[^\u0000-\u00ff]/g, "__").length,
  )), [lines]);
  // Only the code scroller is windowed. Message heights, the full transcript
  // and copied source remain intact; scrolling can reach all preview lines.
  const spacerStyle = { display: "block", padding: 0, minWidth: `calc(${width}ch + 54px)` };
  return (
    <pre ref={preRef} onScroll={(event) => {
      const top = event.currentTarget.scrollTop;
      setViewport((current) => current.top === top ? current : { ...current, top });
    }}>
      <span aria-hidden="true" style={{ ...spacerStyle, height: range.before }} />
      {lines.slice(range.start, range.end).map((line, index) => <DiffLine key={range.start + index} line={line} />)}
      <span aria-hidden="true" style={{ ...spacerStyle, height: range.after }} />
    </pre>
  );
});

export const ChatToolDiffPreview = memo(function ChatToolDiffPreview({
  diff, path, numbered, completed, onCopy,
}: {
  diff: string;
  path: string;
  numbered: boolean;
  completed: boolean;
  onCopy: (content: string) => void;
}) {
  const buildPreview = useMemo(() => createToolDiffPreviewCache((content, filePath) =>
    // Minified/generated single lines can make syntax regexes monopolize the UI.
    content.length > 1_000 ? escapeSourceHtml(content) : highlightSourceCode(content, filePath).html,
  ), []);
  const preview = useMemo(() => buildPreview(diff, numbered, path), [buildPreview, diff, numbered, path]);

  return (
    <div className="pi-tool-diff">
      <div className="pi-tool-diff-toolbar">
        <span className="pi-tool-diff-file" title={path}>
          <FileCode2 size={16} />{completed ? path || "文件变更" : "变更预览（未完成）"}
        </span>
        <span className="pi-tool-diff-stats">
          <b className="additions">+{preview.additions}</b><b className="deletions">-{preview.deletions}</b>
        </span>
        <button type="button" className="chat-diff-copy" title="复制差异" aria-label="复制差异" onClick={() => onCopy(diff)}>
          <Copy size={14} />
        </button>
      </div>
      <DiffLines lines={preview.lines} />
      {preview.truncated && <p className="pi-tool-diff-truncated">显示前 600 行，复制可获取完整差异。</p>}
    </div>
  );
});
