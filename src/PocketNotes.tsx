import { useState, type FormEvent } from "react";
import { ChevronLeft, FilePenLine, Search, Sparkles, Square, SquarePen, Trash2 } from "lucide-react";
import type { PocketNote } from "./pocketNotesState";
import "./pocket-notes.css";

type Props = {
  notes: PocketNote[]; pending: boolean; busy: boolean; error: string;
  onGenerate: () => void; onCancel: () => void;
  onSave: (id: string | undefined, title: string, body: string) => void;
  onDelete: (id: string) => void; onExit: () => void;
};
function noteDate(note: PocketNote) {
  const date = new Date(note.wechatTime || note.createdAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function PocketNotes(props: Props) {
  const [noteId, setNoteId] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<{ id?: string; title: string; body: string } | null>(null);
  const [saveError, setSaveError] = useState("");
  const note = props.notes.find(note => note.id === noteId);
  const search = query.trim().toLocaleLowerCase();
  const filtered = props.notes.filter(note => `${note.title}\n${note.body}`.toLocaleLowerCase().includes(search));
  const edit = (note?: PocketNote) => { setDraft({ id: note?.id, title: note?.title || "", body: note?.body || "" }); setSaveError(""); };
  function save(event: FormEvent) {
    event.preventDefault(); if (!draft) return;
    try { props.onSave(draft.id, draft.title, draft.body); setDraft(null); setSaveError(""); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "便签保存失败。"); }
  }
  return <div className="pocket-notes">
    <header className="pocket-notes-header">
      <button type="button" aria-label={draft ? "取消编辑便签" : note ? "返回便签列表" : "返回手机桌面"} onClick={() => { if (draft) { setDraft(null); setSaveError(""); } else if (note) setNoteId(""); else props.onExit(); }}><ChevronLeft size={22} />{draft ? "取消" : note ? "便签" : "返回"}</button>
      {draft ? <button type="submit" form="pocket-note-editor" disabled={!(draft.title.trim() || draft.body.trim())}>保存便签</button> : <button type="button" aria-label="生成便签" title="生成新的便签" disabled={props.busy} aria-busy={props.pending} onClick={props.onGenerate}><Sparkles size={20} /></button>}
    </header>
    {props.pending && <div className="pocket-notes-progress" role="status"><span>正在写下 ta 的小心事…</span><button type="button" aria-label="停止生成便签" onClick={props.onCancel}><Square size={12} />停止</button></div>}
    {props.error && <p className="pocket-notes-error" role="alert">{props.error}</p>}
    {draft ? <form id="pocket-note-editor" className="pocket-note-editor pocket-scroll" onSubmit={save}>
      <input aria-label="便签标题" placeholder="标题" maxLength={80} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} autoFocus />
      <textarea aria-label="便签正文" placeholder="记下待办、灵感，或一点小心事…" maxLength={6000} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} />
      {saveError && <p className="pocket-notes-error" role="alert">{saveError}</p>}
    </form> : note ? <>
      <article className="pocket-note-detail pocket-scroll"><time>{noteDate(note)}</time><h2>{note.title || "新建便签"}</h2><p>{note.body || "没有其他文本"}</p></article>
      <footer className="pocket-notes-toolbar"><button type="button" aria-label="删除便签" onClick={() => props.onDelete(note.id)}><Trash2 size={20} /></button><button type="button" aria-label="编辑便签" onClick={() => edit(note)}><FilePenLine size={22} /></button></footer>
    </> : <>
      <div className="pocket-notes-list pocket-scroll"><h2>便签</h2><label className="pocket-notes-search"><Search size={16} /><input aria-label="搜索便签" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="pocket-notes-rows">{filtered.map(note => <button className="pocket-note-row" type="button" key={note.id} onClick={() => setNoteId(note.id)}><strong>{note.title || "新建便签"}</strong><span><time>{noteDate(note)}</time><small>{note.body.replace(/\s+/g, " ").trim() || "没有其他文本"}</small></span></button>)}</div>
        {!filtered.length && <div className="pocket-notes-empty"><SquarePen size={30} /><p>{search ? "没有找到相关便签" : "还没有便签"}</p>{!search && <small>点右上角，让 ta 写下生活里的待办和小心事。</small>}</div>}
      </div>
      <footer className="pocket-notes-toolbar"><span>{props.notes.length} 条便签</span><button type="button" aria-label="新建便签" onClick={() => edit()}><SquarePen size={23} /></button></footer>
    </>}
  </div>;
}
