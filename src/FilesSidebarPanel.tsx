import {
  ArrowLeft,
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  File,
  FileCode2,
  FileImage,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  MoreHorizontal,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import {
  Fragment,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  formatFileBrowserSize,
  getFileBrowserAbsolutePath,
  getFileBrowserLanguage,
  getFileBrowserMimeType,
  getFileBrowserPreviewKind,
  getFileBrowserRootPath,
  getFileExtension,
  normalizeFileBrowserEntries,
  type FileBrowserEntry,
  type FileBrowserPreviewKind,
} from "./fileBrowserUtils";
import "./files-sidebar.css";

export type FileBrowserSystemAction = "default" | "openWith" | "reveal";

export type FileBrowserSource = {
  id: string;
  kind: "workspace" | "temporary";
  name: string;
  rootPath?: string;
  listDirectory(path: string): Promise<unknown>;
  readText(path: string): Promise<unknown>;
  readBinary(path: string): Promise<unknown>;
  importFiles?(): Promise<unknown>;
  runSystemAction?(path: string, action: FileBrowserSystemAction): Promise<unknown>;
};

type FilesSidebarPanelProps = {
  source: FileBrowserSource | null;
  onBack: () => void;
  onClose: () => void;
  onChooseWorkspace?: () => void | Promise<void>;
};

type FilePreviewState = {
  entry: FileBrowserEntry;
  kind: FileBrowserPreviewKind;
  status: "loading" | "ready" | "error";
  content?: string;
  imageUrl?: string;
  truncated?: boolean;
  error?: string;
};

type FileContextMenuState = {
  entry: FileBrowserEntry;
  x: number;
  y: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getResultString(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : "";
}

function getResultBoolean(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === "boolean" ? value[key] : false;
}

function getFileIcon(entry: FileBrowserEntry, expanded = false) {
  if (entry.kind === "directory") {
    return expanded ? <FolderOpen size={15} /> : <Folder size={15} />;
  }
  const extension = getFileExtension(entry.path);
  if (getFileBrowserPreviewKind(entry.path) === "image") return <FileImage size={15} />;
  if (["json", "jsonl"].includes(extension)) return <FileJson2 size={15} />;
  if (["md", "markdown", "mdx", "txt", "log"].includes(extension)) {
    return <FileText size={15} />;
  }
  if (getFileBrowserPreviewKind(entry.path) === "text") return <FileCode2 size={15} />;
  return <File size={15} />;
}

function formatModifiedAt(value?: string) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function splitInlineMarkdown(content: string, keyPrefix: string): ReactNode[] {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(content))) {
    if (match.index > cursor) nodes.push(content.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = linkMatch?.[2] ?? "";
      const safeHref = /^(https?:|mailto:)/i.test(href);
      nodes.push(
        safeHref ? (
          <a href={href} key={key} rel="noreferrer" target="_blank">
            {linkMatch?.[1]}
          </a>
        ) : (
          <span key={key}>{linkMatch?.[1] ?? token}</span>
        ),
      );
    }
    cursor = match.index + token.length;
    index += 1;
  }
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

function MarkdownPreview({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const key = `md-${index}`;
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^```/.test(line.trim())) {
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(
        <div className="files-markdown-code" key={key}>
          {language ? <span>{language}</span> : null}
          <pre><code>{codeLines.join("\n")}</code></pre>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const children = splitInlineMarkdown(heading[2], key);
      nodes.push(
        level === 1 ? <h1 key={key}>{children}</h1>
          : level === 2 ? <h2 key={key}>{children}</h2>
            : level === 3 ? <h3 key={key}>{children}</h3>
              : <h4 key={key}>{children}</h4>,
      );
      index += 1;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      nodes.push(<hr key={key} />);
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      nodes.push(
        <blockquote key={key}>{splitInlineMarkdown(quoteLines.join(" "), key)}</blockquote>,
      );
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: ReactNode[] = [];
      const itemPattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/;
      while (index < lines.length && itemPattern.test(lines[index])) {
        const itemContent = lines[index].replace(itemPattern, "");
        items.push(<li key={`${key}-${index}`}>{splitInlineMarkdown(itemContent, `${key}-${index}`)}</li>);
        index += 1;
      }
      nodes.push(
        ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>,
      );
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^```/.test(lines[index].trim()) &&
      !/^>\s?/.test(lines[index]) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    nodes.push(<p key={key}>{splitInlineMarkdown(paragraphLines.join(" "), key)}</p>);
  }

  return <article className="files-markdown-preview">{nodes}</article>;
}

function SourcePreview({ content }: { content: string }) {
  const allLines = content.replace(/\r\n/g, "\n").split("\n");
  const lines = allLines.slice(0, 4000);
  return (
    <div className="files-source-preview">
      {lines.map((line, index) => (
        <Fragment key={index}>
          <span className="files-source-line-number">{index + 1}</span>
          <code>{line || " "}</code>
        </Fragment>
      ))}
      {allLines.length > lines.length ? (
        <div className="files-source-render-limit">仅渲染前 {lines.length} 行</div>
      ) : null}
    </div>
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function FilesSidebarPanel({
  source,
  onBack,
  onClose,
  onChooseWorkspace,
}: FilesSidebarPanelProps) {
  const [directoryEntries, setDirectoryEntries] = useState<Record<string, FileBrowserEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<FilePreviewState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [resolvedRootPath, setResolvedRootPath] = useState(source?.rootPath ?? "");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);
  const requestVersionRef = useRef(0);
  const sourceIdRef = useRef(source?.id ?? "");

  const loadDirectory = useCallback(async (path: string, refresh = false) => {
    if (!source || (!refresh && directoryEntries[path])) return;
    const sourceId = source.id;
    setLoadingPaths((current) => new Set(current).add(path));
    setError("");
    try {
      const result = await source.listDirectory(path);
      if (sourceIdRef.current !== sourceId) return;
      const entries = normalizeFileBrowserEntries(result).filter((entry) => {
        const parentPath = entry.path.split("/").slice(0, -1).join("/");
        return parentPath === path;
      });
      const nextRootPath = getFileBrowserRootPath(result);
      if (nextRootPath) setResolvedRootPath(nextRootPath);
      setDirectoryEntries((current) => ({ ...current, [path]: entries }));
    } catch (loadError) {
      if (sourceIdRef.current !== sourceId) return;
      setError(loadError instanceof Error ? loadError.message : "文件列表读取失败");
    } finally {
      if (sourceIdRef.current !== sourceId) return;
      setLoadingPaths((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  }, [directoryEntries, source]);

  useEffect(() => {
    sourceIdRef.current = source?.id ?? "";
    requestVersionRef.current += 1;
    setDirectoryEntries({});
    setExpandedPaths(new Set());
    setLoadingPaths(new Set());
    setPreview(null);
    setSearchQuery("");
    setResolvedRootPath(source?.rootPath ?? "");
    setStatusMessage("");
    setError("");
    if (!source) return;
    const version = requestVersionRef.current;
    setLoadingPaths(new Set([""]));
    void source.listDirectory("").then((result) => {
      if (requestVersionRef.current !== version) return;
      const entries = normalizeFileBrowserEntries(result).filter(
        (entry) => !entry.path.includes("/"),
      );
      setDirectoryEntries({ "": entries });
      const nextRootPath = getFileBrowserRootPath(result);
      if (nextRootPath) setResolvedRootPath(nextRootPath);
    }).catch((loadError) => {
      if (requestVersionRef.current === version) {
        setError(loadError instanceof Error ? loadError.message : "文件列表读取失败");
      }
    }).finally(() => {
      if (requestVersionRef.current === version) setLoadingPaths(new Set());
    });
  }, [source]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const openPreview = useCallback(async (entry: FileBrowserEntry) => {
    if (!source || entry.kind !== "file") return;
    const kind = getFileBrowserPreviewKind(entry.path);
    const version = ++requestVersionRef.current;
    setPreview({ entry, kind, status: "loading" });
    setError("");
    if (kind === "unsupported") {
      setPreview({ entry, kind, status: "ready" });
      return;
    }
    try {
      if (kind === "image") {
        const result = await source.readBinary(entry.path);
        const base64 = getResultString(result, "base64");
        if (!base64) throw new Error("图片内容为空");
        if (requestVersionRef.current !== version) return;
        setPreview({
          entry,
          kind,
          status: "ready",
          imageUrl: `data:${getFileBrowserMimeType(entry.path)};base64,${base64}`,
        });
        return;
      }
      const result = await source.readText(entry.path);
      if (requestVersionRef.current !== version) return;
      setPreview({
        entry,
        kind,
        status: "ready",
        content: getResultString(result, "content"),
        truncated: getResultBoolean(result, "truncated"),
      });
    } catch (previewError) {
      if (requestVersionRef.current !== version) return;
      setPreview({
        entry,
        kind,
        status: "error",
        error: previewError instanceof Error ? previewError.message : "文件预览失败",
      });
    }
  }, [source]);

  const toggleDirectory = async (entry: FileBrowserEntry) => {
    const expanded = expandedPaths.has(entry.path);
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (expanded) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (!expanded) await loadDirectory(entry.path);
  };

  const refresh = async () => {
    if (!source) return;
    setStatusMessage("正在刷新…");
    setDirectoryEntries({});
    setExpandedPaths(new Set());
    await loadDirectory("", true);
    setStatusMessage("文件列表已刷新");
  };

  const importFiles = async () => {
    if (!source?.importFiles) return;
    try {
      setStatusMessage("正在添加临时文件…");
      const result = await source.importFiles();
      const imported = isRecord(result) && Array.isArray(result.imported) ? result.imported.length : 0;
      if (imported > 0) {
        await loadDirectory("", true);
        setStatusMessage(`已添加 ${imported} 个临时文件`);
      } else {
        setStatusMessage("未添加文件");
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "临时文件添加失败");
    }
  };

  const runSystemAction = async (entry: FileBrowserEntry, action: FileBrowserSystemAction) => {
    if (!source?.runSystemAction) return;
    try {
      await source.runSystemAction(entry.path, action);
      setStatusMessage(
        action === "reveal" ? "已在文件夹中定位" : action === "openWith" ? "已打开方式选择器" : "已打开文件",
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "系统文件操作失败");
    }
  };

  const copyPath = async (entry: FileBrowserEntry, absolute: boolean) => {
    const path = absolute
      ? getFileBrowserAbsolutePath(resolvedRootPath, entry)
      : entry.path;
    try {
      await copyText(path);
      setStatusMessage(absolute ? "已复制完整路径" : "已复制相对路径");
    } catch {
      setError("路径复制失败");
    }
  };

  const showContextMenu = (event: MouseEvent<HTMLElement>, entry: FileBrowserEntry) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      entry,
      x: Math.min(event.clientX, window.innerWidth - 224),
      y: Math.min(event.clientY, window.innerHeight - 260),
    });
  };

  const renderEntries = (path = "", depth = 0): ReactNode => {
    const entries = directoryEntries[path] ?? [];
    return entries.map((entry) => {
      const expanded = expandedPaths.has(entry.path);
      const selected = preview?.entry.path === entry.path;
      const matchesSearch = !searchQuery.trim() || entry.name.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase());
      const childRows = entry.kind === "directory" && expanded
        ? renderEntries(entry.path, depth + 1)
        : null;
      const childMatches = Boolean(searchQuery.trim()) && Boolean(childRows);
      if (!matchesSearch && !childMatches) return null;
      return (
        <Fragment key={entry.path}>
          <button
            className={`files-tree-row kind-${entry.kind} ${selected ? "is-selected" : ""}`}
            onClick={(event) => {
              if (event.detail > 1) return;
              if (entry.kind === "directory") void toggleDirectory(entry);
              else void openPreview(entry);
            }}
            onContextMenu={(event) => showContextMenu(event, entry)}
            onDoubleClick={() => {
              if (entry.kind === "file" && source?.runSystemAction) void runSystemAction(entry, "default");
              else void openPreview(entry);
            }}
            style={{ "--file-tree-depth": depth } as CSSProperties}
            title={entry.path}
            type="button"
          >
            <span className="files-tree-chevron" aria-hidden="true">
              {entry.kind === "directory" ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
            </span>
            <span className={`files-tree-icon extension-${getFileExtension(entry.path) || "none"}`} aria-hidden="true">
              {getFileIcon(entry, expanded)}
            </span>
            <span className="files-tree-name">{entry.name}</span>
          </button>
          {childRows}
          {entry.kind === "directory" && expanded && loadingPaths.has(entry.path) ? (
            <div className="files-tree-loading" style={{ "--file-tree-depth": depth + 1 } as CSSProperties}>
              正在读取…
            </div>
          ) : null}
        </Fragment>
      );
    });
  };

  const visibleTree = renderEntries();
  const rootEntries = directoryEntries[""] ?? [];
  const contextMenuPortal = contextMenu && typeof document !== "undefined"
    ? createPortal(
        <div
          className="files-context-menu"
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.entry.kind === "file" ? (
            <button onClick={() => { void openPreview(contextMenu.entry); setContextMenu(null); }} role="menuitem" type="button">
              <Eye size={15} /> 在侧栏中打开
            </button>
          ) : null}
          {source?.runSystemAction ? (
            <>
              <button onClick={() => { void runSystemAction(contextMenu.entry, "default"); setContextMenu(null); }} role="menuitem" type="button">
                <ExternalLink size={15} /> 使用默认应用打开
              </button>
              {contextMenu.entry.kind === "file" ? (
                <button onClick={() => { void runSystemAction(contextMenu.entry, "openWith"); setContextMenu(null); }} role="menuitem" type="button">
                  <MoreHorizontal size={15} /> 打开方式…
                </button>
              ) : null}
              <button onClick={() => { void runSystemAction(contextMenu.entry, "reveal"); setContextMenu(null); }} role="menuitem" type="button">
                <FolderSearch size={15} /> 在文件夹中显示
              </button>
              <span className="files-context-separator" />
            </>
          ) : null}
          <button onClick={() => { void copyPath(contextMenu.entry, true); setContextMenu(null); }} role="menuitem" type="button">
            <Copy size={15} /> 复制完整路径
          </button>
          <button onClick={() => { void copyPath(contextMenu.entry, false); setContextMenu(null); }} role="menuitem" type="button">
            <Copy size={15} /> 复制相对路径
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <section className="right-tool-content files-sidebar-panel" aria-label="文件浏览器">
      <header className="files-sidebar-header">
        <div className="files-sidebar-heading">
          <button aria-label="返回工作区工具" onClick={onBack} title="返回工作区工具" type="button">
            <ArrowLeft size={16} />
          </button>
          <div>
            <span>{source?.kind === "workspace" ? "WORKSPACE FILES" : "TEMPORARY FILES"}</span>
            <strong>{source?.name ?? "文件"}</strong>
          </div>
        </div>
        <div className="files-sidebar-actions">
          {source?.importFiles ? (
            <button aria-label="添加临时文件" onClick={() => void importFiles()} title="添加临时文件" type="button">
              <Upload size={15} />
            </button>
          ) : null}
          <button aria-label="刷新文件" disabled={!source} onClick={() => void refresh()} title="刷新" type="button">
            <RefreshCw size={15} />
          </button>
          <button aria-label="关闭右侧栏" onClick={onClose} title="关闭右侧栏" type="button">
            <X size={16} />
          </button>
        </div>
      </header>

      {!source ? (
        <div className="files-sidebar-unavailable">
          <span><FolderOpen size={25} /></span>
          <strong>选择工作区后浏览文件</strong>
          <p>当前环境没有可用的临时文件存储。选择文件夹后可浏览源代码、Markdown 和图片。</p>
          {onChooseWorkspace ? <button onClick={() => void onChooseWorkspace()} type="button">选择工作区</button> : null}
        </div>
      ) : (
        <div className="files-sidebar-layout">
          <section className="files-tree-pane" aria-label="文件树">
            <div className="files-tree-toolbar">
              <label>
                <Search size={15} />
                <input
                  aria-label="筛选文件"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="筛选文件…"
                  type="search"
                  value={searchQuery}
                />
                {searchQuery ? (
                  <button aria-label="清除筛选" onClick={() => setSearchQuery("")} type="button"><X size={13} /></button>
                ) : null}
              </label>
              {source.kind === "temporary" ? (
                <div className="files-temporary-notice">
                  <span>未连接工作区</span>
                  <small>这里显示存放在系统临时目录中的文件。</small>
                  {onChooseWorkspace ? <button onClick={() => void onChooseWorkspace()} type="button">选择工作区</button> : null}
                </div>
              ) : null}
            </div>
            <div className="files-tree" role="tree">
              {loadingPaths.has("") && rootEntries.length === 0 ? (
                <div className="files-tree-empty"><RefreshCw className="is-spinning" size={19} />正在读取文件…</div>
              ) : rootEntries.length === 0 ? (
                <div className="files-tree-empty">
                  <FolderOpen size={22} />
                  <span>{source.kind === "temporary" ? "还没有临时文件" : "文件夹为空"}</span>
                  {source.importFiles ? <button onClick={() => void importFiles()} type="button">添加临时文件</button> : null}
                </div>
              ) : visibleTree}
            </div>
          </section>

          <section className="files-preview-pane" aria-label={preview ? `${preview.entry.name} 预览` : "文件预览"}>
            <header className="files-preview-header">
              <span className="files-preview-file-icon" aria-hidden="true">
                {preview ? getFileIcon(preview.entry) : <Eye size={15} />}
              </span>
              <div>
                <strong title={preview?.entry.path}>{preview?.entry.name ?? "文件预览"}</strong>
                <span>
                  {preview
                    ? `${getFileBrowserLanguage(preview.entry.path)}${
                        preview.entry.size !== undefined
                          ? ` · ${formatFileBrowserSize(preview.entry.size)}`
                          : ""
                      }`
                    : "源代码 · Markdown · 图片"}
                </span>
              </div>
              {preview && source.runSystemAction ? (
                <button className="files-preview-open" onClick={() => void runSystemAction(preview.entry, "default")} type="button">
                  <ExternalLink size={14} /> 打开
                </button>
              ) : null}
            </header>
            <div className="files-preview-content">
              {!preview ? (
                <div className="files-preview-message"><Eye size={24} /><strong>选择文件以预览</strong><span>支持源代码、Markdown 文档和常见图片格式。</span></div>
              ) : preview.status === "loading" ? (
                  <div className="files-preview-message"><RefreshCw className="is-spinning" size={22} />正在打开文件…</div>
                ) : preview.status === "error" ? (
                  <div className="files-preview-message is-error"><File size={24} /><strong>无法预览</strong><span>{preview.error}</span></div>
                ) : preview.kind === "image" && preview.imageUrl ? (
                  <div className="files-image-preview">
                    <img alt={preview.entry.name} src={preview.imageUrl} />
                    <span>{preview.entry.name}</span>
                  </div>
                ) : preview.kind === "markdown" ? (
                  <MarkdownPreview content={preview.content ?? ""} />
                ) : preview.kind === "text" ? (
                  <SourcePreview content={preview.content ?? ""} />
                ) : (
                  <div className="files-preview-message"><Braces size={24} /><strong>此格式不支持侧栏预览</strong><span>可以双击或使用右键菜单交给系统应用打开。</span></div>
              )}
            </div>
            {preview?.truncated ? <div className="files-preview-truncated">文件较大，仅显示前 512 KB</div> : null}
          </section>
        </div>
      )}

      <footer className="files-sidebar-footer">
        <span title={resolvedRootPath}>{resolvedRootPath || source?.name || "无文件来源"}</span>
        <span className={error ? "is-error" : ""}>{error || statusMessage || (source ? `${rootEntries.length} 个根目录条目` : "未连接")}</span>
      </footer>
      {contextMenuPortal}
    </section>
  );
}
