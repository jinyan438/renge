export type FileBrowserPreviewKind = "image" | "markdown" | "text" | "unsupported";

export type FileBrowserEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: string;
  absolutePath?: string;
};

export type WorkspaceHandleIdentity =
  | { kind: "electron"; path: string }
  | { kind: "android"; uri: string }
  | { kind: "pc"; baseUrl: string; path: string }
  | { kind: "directory"; name: string };

export function getWorkspaceHandleKey(handle: WorkspaceHandleIdentity) {
  switch (handle.kind) {
    case "electron":
      return handle.path;
    case "android":
      return `android:${handle.uri}`;
    case "pc":
      return `pc:${handle.baseUrl}:${handle.path}`;
    case "directory":
      return `browser:${handle.name}`;
  }
}

export function scopeWorkspaceHandleToSession<T extends WorkspaceHandleIdentity>(
  handle: T | null,
  workspaceKey: string,
) {
  if (!handle || !workspaceKey || workspaceKey === "default") return null;
  return getWorkspaceHandleKey(handle) === workspaceKey ? handle : null;
}

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

const TEXT_EXTENSIONS = new Set([
  "bat",
  "c",
  "cc",
  "cjs",
  "cmd",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "env",
  "go",
  "gradle",
  "h",
  "hpp",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsonl",
  "jsx",
  "kt",
  "kts",
  "less",
  "log",
  "lua",
  "mjs",
  "php",
  "properties",
  "ps1",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

const MIME_TYPES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export function getFileExtension(path: string) {
  const fileName = path.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
}

export function getFileBrowserPreviewKind(path: string): FileBrowserPreviewKind {
  const extension = getFileExtension(path);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "md" || extension === "markdown" || extension === "mdx") {
    return "markdown";
  }
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "unsupported";
}

export function getFileBrowserMimeType(path: string) {
  return MIME_TYPES[getFileExtension(path)] ?? "application/octet-stream";
}

export function getFileBrowserLanguage(path: string) {
  const extension = getFileExtension(path);
  const labels: Record<string, string> = {
    bat: "Batch",
    c: "C",
    cc: "C++",
    cjs: "JavaScript",
    cmd: "Command",
    cpp: "C++",
    cs: "C#",
    css: "CSS",
    go: "Go",
    gradle: "Gradle",
    h: "C Header",
    hpp: "C++ Header",
    html: "HTML",
    java: "Java",
    js: "JavaScript",
    json: "JSON",
    jsx: "JavaScript React",
    kt: "Kotlin",
    kts: "Kotlin",
    md: "Markdown",
    mdx: "MDX",
    mjs: "JavaScript",
    php: "PHP",
    ps1: "PowerShell",
    py: "Python",
    rb: "Ruby",
    rs: "Rust",
    scss: "SCSS",
    sh: "Shell",
    sql: "SQL",
    svelte: "Svelte",
    swift: "Swift",
    toml: "TOML",
    ts: "TypeScript",
    tsx: "TypeScript React",
    vue: "Vue",
    xml: "XML",
    yaml: "YAML",
    yml: "YAML",
  };
  return labels[extension] ?? (extension ? extension.toUpperCase() : "文本");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function normalizeFileBrowserEntries(value: unknown): FileBrowserEntry[] {
  const rawEntries = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.entries)
      ? value.entries
      : [];

  const entries = rawEntries.flatMap((item): FileBrowserEntry[] => {
    if (!isRecord(item)) return [];
    const path = normalizePath(item.path);
    const kind = item.kind === "directory" ? "directory" : item.kind === "file" ? "file" : null;
    if (!path || !kind) return [];
    const name = String(item.name ?? path.split("/").at(-1) ?? path);
    const size = Number(item.size);
    return [{
      name,
      path,
      kind,
      ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
      ...(typeof item.modifiedAt === "string" ? { modifiedAt: item.modifiedAt } : {}),
      ...(typeof item.absolutePath === "string" ? { absolutePath: item.absolutePath } : {}),
    }];
  });

  return entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name, "zh-CN", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

export function getFileBrowserRootPath(value: unknown) {
  return isRecord(value) && typeof value.rootPath === "string" ? value.rootPath : "";
}

export function getFileBrowserAbsolutePath(
  rootPath: string,
  entry: Pick<FileBrowserEntry, "path" | "absolutePath">,
) {
  if (entry.absolutePath) return entry.absolutePath;
  if (!rootPath) return entry.path;
  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${entry.path.replace(/[\\/]/g, separator)}`;
}

export function formatFileBrowserSize(value?: number) {
  if (!Number.isFinite(value) || value === undefined || value < 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
