import { parseChatFileLink, workspaceRelativeFilePath } from "./chatFileLinks.ts";

export const PRESENT_FILES_TOOL = "chat_present_files";
export type PresentedFile = { path: string; description?: string };
export type PresentedFiles = { cwd?: string; files: PresentedFile[] };
const MAX_PRESENTED_FILES = 8;

export const presentFilesToolDefinition = {
  type: "function" as const,
  function: {
    name: PRESENT_FILES_TOOL,
    description: "将已经存在的最终文件交付给用户，显示带图标、文件名、简短说明和打开菜单的独立文件卡片。完成文档、源码或其他文件后，选择最重要的 1–4 个调用此工具；不要把所有修改过的文件都当成交付物。先创建文件再交付，不创建或复制文件内容。",
    parameters: {
      type: "object", required: ["files"], properties: {
        files: { type: "array", minItems: 1, maxItems: MAX_PRESENTED_FILES, items: {
          type: "object", required: ["path"], properties: {
            path: { type: "string", description: "当前工作区内已存在文件的相对或绝对路径。" },
            description: { type: "string", maxLength: 160, description: "面向用户的一句话文件用途说明。" },
          },
        } },
      },
    },
  },
};

export function normalizePresentedFileArguments(value: unknown): PresentedFile[] {
  const raw = value && typeof value === "object" ? (value as { files?: unknown }).files : undefined;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PRESENTED_FILES) throw new Error("交付文件数量必须为 1 到 8 个。");
  const files = new Map<string, PresentedFile>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || typeof item.path !== "string" || item.path.length > 4096) throw new Error("交付文件缺少有效路径。");
    const target = parseChatFileLink(item.path, true);
    if (!target || target.line || /[<>|*]/.test(target.path)) throw new Error(`无效的交付文件路径：${item.path}`);
    const description = typeof item.description === "string" ? item.description.replace(/\s+/g, " ").trim().slice(0, 160) : "";
    const key = target.path.replace(/\\/g, "/");
    files.set(/^[a-z]:/i.test(key) ? key.toLowerCase() : key, { path: target.path, ...(description ? { description } : {}) });
  }
  return [...files.values()];
}

export function getPresentedFiles(value: unknown): PresentedFiles | undefined {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const metadata = record.presentedFiles ?? (record.details && typeof record.details === "object" ? (record.details as Record<string, unknown>).presentedFiles : undefined);
  if (!metadata || typeof metadata !== "object") return;
  try {
    const files = normalizePresentedFileArguments(metadata);
    const cwd = (metadata as { cwd?: unknown }).cwd;
    return { files, ...(typeof cwd === "string" ? { cwd } : {}) };
  } catch { return; }
}

export async function validatePresentedFiles(value: unknown, cwd: string, list: (path: string) => Promise<{ path: string; kind: "file" | "directory" }[]>): Promise<PresentedFiles> {
  const files = normalizePresentedFileArguments(value);
  const listings = new Map<string, Promise<{ path: string; kind: "file" | "directory" }[]>>();
  const validated: PresentedFile[] = [];
  for (const file of files) {
    const path = workspaceRelativeFilePath(file.path, cwd);
    if (!path) throw new Error("不能将工作区目录作为文件交付。");
    const parent = path.split("/").slice(0, -1).join("/");
    if (!listings.has(parent)) listings.set(parent, list(parent));
    const entries = await listings.get(parent)!;
    const name = path.split("/").at(-1);
    const same = (a: string, b: string) => /^[a-z]:/i.test(cwd) ? a.toLowerCase() === b.toLowerCase() : a === b;
    const entry = entries.find(entry => same(entry.path.replace(/\\/g, "/"), path) || same(entry.path, name!));
    if (!entry || entry.kind !== "file") throw new Error(`交付文件不存在或不是普通文件：${file.path}`);
    validated.push({ ...file, path });
  }
  return { ...(cwd ? { cwd } : {}), files: validated };
}

type DeliveryMessage = { id: string; role: string; content: string; outputStatus?: string; renderAsPlainText?: boolean; extra?: Record<string, unknown>;
  toolVisualization?: { name: string; status: string; result?: unknown } };

/** Successful declarations persist in tool results; show them once at each turn's tail. */
export function collectTurnPresentedFiles(messages: readonly DeliveryMessage[]): Map<string, PresentedFiles> {
  const cards = new Map<string, PresentedFiles>();
  let target: DeliveryMessage | undefined;
  let cwd: string | undefined;
  let files = new Map<string, PresentedFile>();
  const flush = () => {
    if (target && files.size && target.outputStatus !== "running" && !target.renderAsPlainText) cards.set(target.id, { cwd, files: [...files.values()] });
    target = undefined; cwd = undefined; files = new Map();
  };
  for (const message of messages) {
    if (message.role === "user") { flush(); continue; }
    const tool = message.toolVisualization;
    const presented = tool?.name === PRESENT_FILES_TOOL && tool.status === "done" ? getPresentedFiles(tool.result) : getPresentedFiles(message.extra);
    if (presented) {
      cwd = presented.cwd ?? cwd;
      for (const file of presented.files) {
        const absolute = presentedFilePath(file, presented.cwd);
        const key = /^[a-z]:/i.test(absolute) ? absolute.toLowerCase() : absolute;
        files.set(key, { ...file, path: absolute });
      }
    }
    if (message.role === "assistant" && (message.content.length > 0 || tool || presented || message.outputStatus === "running" || message.renderAsPlainText)) target = message;
  }
  flush();
  return cards;
}

export function presentedFilePath(file: PresentedFile, cwd?: string) {
  return /^(?:[a-z]:[\\/]|\/)/i.test(file.path) || !cwd ? file.path : `${cwd.replace(/[\\/]$/, "")}/${file.path}`;
}
