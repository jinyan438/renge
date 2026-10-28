import { ChevronDown, FileCode2 } from "lucide-react";
import { useState } from "react";
import { ChatFileLink } from "./ChatFileLink";
import "./chat-workspace-changes.css";

export type WorkspaceChangedFile = { path: string; status: "added" | "modified" | "deleted"; added?: number; deleted?: number; binary?: boolean; oversized?: boolean; coarse?: boolean };
export type WorkspaceChanges = { cwd: string; files: WorkspaceChangedFile[]; total: number; added: number; deleted: number; truncated?: boolean };

export function getWorkspaceChanges(value: unknown): WorkspaceChanges | undefined {
  if (!value || typeof value !== "object") return;
  const summary = value as WorkspaceChanges;
  if (typeof summary.cwd !== "string" || !Array.isArray(summary.files)) return;
  const files = summary.files.filter(file => file && typeof file.path === "string"
    && ["added", "modified", "deleted"].includes(file.status));
  if (!files.length) return;
  return { ...summary, files, total: summary.total || files.length, added: Number(summary.added) || 0, deleted: Number(summary.deleted) || 0 };
}

const labels = { added: "新增", modified: "修改", deleted: "删除" };
export function ChatWorkspaceChanges({ changes }: { changes: WorkspaceChanges }) {
  const [expanded, setExpanded] = useState(false);
  const files = expanded ? changes.files : changes.files.slice(0, 4);
  return <section className="chat-workspace-changes" aria-label="本次任务文件变更">
    <header><span className="workspace-changes-icon"><FileCode2 size={22} /></span><div>
      <strong>已变更 {changes.total} 个文件</strong>
      <div className="workspace-changes-stats"><span className="additions">+{changes.added.toLocaleString()}</span><span className="deletions">-{changes.deleted.toLocaleString()}</span>
        <small>{Object.entries(labels).map(([status, label]) => `${label} ${changes.files.filter(file => file.status === status).length}`).join(" · ")}</small>
      </div>
    </div></header>
    <ul>{files.map(file => <li key={file.path}>
      <span className={`workspace-change-status ${file.status}`}>{labels[file.status]}</span>
      {file.status === "deleted" ? <span className="workspace-change-path deleted" title={`${file.path}（已删除）`}>{file.path}</span>
        : <ChatFileLink target={{ path: /^(?:[a-z]:[\\/]|\/)/i.test(file.path) ? file.path : `${changes.cwd.replace(/[\\/]$/, "")}/${file.path}` }}>{file.path}</ChatFileLink>}
      <span className="workspace-changes-stats">{file.binary || file.oversized ? <small>{file.oversized ? "大文件" : "二进制"}</small> : <>
        {file.coarse && <small title="文件较大，行数按变更区间估算">约</small>}<span className="additions">+{file.added ?? 0}</span><span className="deletions">-{file.deleted ?? 0}</span></>}</span>
    </li>)}</ul>
    {changes.files.length > 4 && <button type="button" className="workspace-changes-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? "收起文件列表" : `全部 ${changes.files.length} 个文件`}<ChevronDown size={15} style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
    </button>}
    {changes.truncated && <p>变更较多，仅列出前 {changes.files.length} 个文件。</p>}
  </section>;
}
