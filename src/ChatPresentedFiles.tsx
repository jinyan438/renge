import { Archive, ChevronDown, Copy, Download, ExternalLink, File, FileCode2, FileImage, FileSpreadsheet, FileText, FolderOpen, PanelRightOpen, Presentation } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDesktopWindow } from "./NativeDesktopWindow";
import { getFileBrowserLanguage, getFileBrowserPreviewKind, getFileExtension } from "./fileBrowserUtils";
import { openChatFile } from "./chatFileLinks";
import { runChatFileAction, useChatNativeFileActions, type ChatFileAction } from "./chatFileActions";
import { presentedFilePath, type PresentedFile, type PresentedFiles } from "./chatPresentedFileUtils";
import "./chat-presented-files.css";

function FileTile({ path }: { path: string }) {
  const ext = getFileExtension(path);
  const kind = getFileBrowserPreviewKind(path);
  const Icon = kind === "markdown" ? FileText : kind === "image" ? FileImage : ["xlsx", "xls", "csv", "tsv"].includes(ext) ? FileSpreadsheet
    : ["pptx", "ppt"].includes(ext) ? Presentation : ["zip", "7z", "rar", "tar", "gz"].includes(ext) ? Archive : kind === "text" ? FileCode2 : File;
  return <span className={`chat-presented-file-icon ${kind}`} aria-hidden="true"><Icon size={28} /><small>{ext.toUpperCase().slice(0, 5) || "FILE"}</small></span>;
}

function PresentedFileCard({ file, cwd }: { file: PresentedFile; cwd?: string }) {
  const view = useDesktopWindow();
  const native = useChatNativeFileActions();
  const path = presentedFilePath(file, cwd);
  const name = path.replace(/\\/g, "/").split("/").at(-1) || path;
  const description = file.description || `${getFileBrowserLanguage(path)} 文件`;
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(statusTimer.current); }; }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event.type === "pointerdown" && (menuRef.current?.contains(event.target as Node) || menuButton.current?.contains(event.target as Node))) return;
      setMenu(null);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenu(null); menuButton.current?.focus(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        const index = items.indexOf(view.document.activeElement as HTMLButtonElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length]?.focus({ preventScroll: true });
      }
    };
    view.document.addEventListener("pointerdown", close); view.document.addEventListener("keydown", keydown);
    view.addEventListener("resize", close); view.addEventListener("wheel", close, true); view.addEventListener("touchmove", close, true);
    // Opening a portal must not scroll the transcript or close its own menu.
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    return () => { view.document.removeEventListener("pointerdown", close); view.document.removeEventListener("keydown", keydown); view.removeEventListener("resize", close); view.removeEventListener("wheel", close, true); view.removeEventListener("touchmove", close, true); };
  }, [menu, view]);
  const action = async (kind: ChatFileAction | "copy") => {
    setMenu(null); setBusy(true); clearTimeout(statusTimer.current);
    try {
      if (kind === "copy") await view.navigator.clipboard.writeText(path);
      else await runChatFileAction({ path }, kind);
      if (alive.current) setStatus({ text: kind === "copy" ? "已复制文件路径" : kind === "download" ? "已开始下载" : kind === "reveal" ? "已在文件夹中显示" : "已打开文件" });
    } catch (error) { if (alive.current) setStatus({ text: error instanceof Error ? error.message : "文件操作失败", error: true }); }
    finally {
      if (alive.current) { setBusy(false); statusTimer.current = setTimeout(() => setStatus(null), 3500); }
    }
  };
  const preview = () => { setMenu(null); openChatFile({ path }); };
  return <div className="chat-presented-file" data-presented-path={path}>
    <button type="button" className="chat-presented-file-preview" title={path} aria-label={`预览文件 ${name}`} onClick={preview} />
    <FileTile path={path} />
    <div className="chat-presented-file-details"><strong title={path}>{name}</strong><span className={status?.error ? "is-error" : ""} title={status?.text || description} role={status ? "status" : undefined}>{status?.text || description}</span></div>
    <div className="chat-presented-file-actions">
      <button type="button" title="在侧栏预览" aria-label={`在侧栏预览 ${name}`} onClick={preview}><PanelRightOpen size={17} /></button>
      <button type="button" ref={menuButton} disabled={busy} title="文件操作" aria-label={`${name} 文件操作`} aria-haspopup="menu" aria-expanded={Boolean(menu)}
        onClick={() => { const rect = menuButton.current!.getBoundingClientRect(); setMenu(menu ? null : { left: Math.max(8, Math.min(rect.right - 208, view.innerWidth - 216)), top: Math.max(8, Math.min(rect.bottom + 6, view.innerHeight - (native ? 250 : 140))) }); }}><ChevronDown size={14} /></button>
    </div>
    {menu && createPortal(<div className="chat-presented-file-menu" role="menu" aria-label={`${name} 的文件操作`} ref={menuRef} style={{ left: menu.left, top: menu.top }}>
      <button type="button" role="menuitem" onClick={preview}><PanelRightOpen size={15} />在侧栏预览</button>
      {native && <><button type="button" role="menuitem" onClick={() => void action("default")}><ExternalLink size={15} />用默认应用打开</button>
        <button type="button" role="menuitem" onClick={() => void action("openWith")}><File size={15} />选择打开方式</button>
        <button type="button" role="menuitem" onClick={() => void action("reveal")}><FolderOpen size={15} />在文件夹中显示</button></>}
      <button type="button" role="menuitem" onClick={() => void action("copy")}><Copy size={15} />复制文件路径</button>
      <button type="button" role="menuitem" onClick={() => void action("download")}><Download size={15} />下载文件</button>
    </div>, view.document.body)}
  </div>;
}

export function ChatPresentedFiles({ presented }: { presented: PresentedFiles }) {
  return <section className="chat-presented-files" aria-label="交付文件">
    {presented.files.map(file => <PresentedFileCard key={presentedFilePath(file, presented.cwd)} file={file} cwd={presented.cwd} />)}
  </section>;
}
