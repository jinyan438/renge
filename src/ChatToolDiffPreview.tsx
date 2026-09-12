import { Copy, FileCode2 } from "lucide-react";
import { memo, useMemo } from "react";
import { parseToolDiffLines } from "./chatToolDiffUtils";
import { highlightSourceCode } from "./syntaxHighlighting";

export const ChatToolDiffPreview = memo(function ChatToolDiffPreview({
  diff, path, numbered, completed, onCopy,
}: {
  diff: string;
  path: string;
  numbered: boolean;
  completed: boolean;
  onCopy: (content: string) => void;
}) {
  const preview = useMemo(() => {
    const lines = parseToolDiffLines(diff, numbered);
    return {
      additions: lines.filter((line) => line.kind === "addition").length,
      deletions: lines.filter((line) => line.kind === "deletion").length,
      lines: lines.slice(0, 600).map((line) => ({
        ...line,
        html: highlightSourceCode(line.content || " ", path).html,
      })),
      truncated: lines.length > 600,
    };
  }, [diff, numbered, path]);

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
      <pre>{preview.lines.map((line, index) => (
        <span key={index} className={line.kind}>
          <i className="pi-tool-diff-line-number" aria-hidden="true">{line.number ?? ""}</i>
          <span className="pi-tool-diff-marker">{line.marker || " "}</span>
          <code dangerouslySetInnerHTML={{ __html: line.html }} />
        </span>
      ))}</pre>
      {preview.truncated && <p className="pi-tool-diff-truncated">显示前 600 行，复制可获取完整差异。</p>}
    </div>
  );
});
