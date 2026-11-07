import {
  normalizeTavernScript,
  type TavernScript,
  type TavernScriptFolder,
} from "./tavernScriptUtils.ts";

export type TavernScriptScope = "global" | "preset" | "character";
export type TavernScriptTree = {
  type: "script" | "folder";
  id: string;
  name: string;
  enabled: boolean;
  content?: string;
  info?: string;
  button?: { enabled: boolean; buttons: Array<{ name: string; visible: boolean }> };
  data?: Record<string, unknown>;
  export_with?: { data: boolean; button: boolean };
  icon?: string;
  color?: string;
  scripts?: TavernScriptTree[];
};

export function getTavernScriptTrees(scripts: TavernScript[]): TavernScriptTree[] {
  const trees: TavernScriptTree[] = [];
  for (const script of scripts) {
    let children = trees;
    for (const folder of script.folderPath ?? []) {
      let node = children.find((candidate) => candidate.type === "folder" && candidate.id === folder.id);
      if (!node) {
        node = { ...folder, type: "folder", scripts: [] };
        children.push(node);
      }
      children = node.scripts!;
    }
    children.push({
      type: "script",
      id: script.sourceId || script.id,
      name: script.name,
      enabled: script.enabled,
      content: script.content,
      info: script.info,
      button: {
        enabled: script.buttonEnabled,
        buttons: script.buttons.map(({ name, visible }) => ({ name, visible })),
      },
      // export_with controls exports, not live reads of script variables.
      data: JSON.parse(JSON.stringify(script.data)),
      export_with: { ...script.exportWith },
    });
  }
  return trees;
}

export function replaceTavernScriptTrees(current: TavernScript[], trees: unknown[]): TavernScript[] {
  const next: TavernScript[] = [];
  const ids = new Set<string>();
  const visit = (nodes: unknown[], folderPath: TavernScriptFolder[]) => {
    for (const value of nodes) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("无效的酒馆脚本。");
      const node = value as Record<string, unknown>;
      const id = String(node.id || crypto.randomUUID());
      if (ids.has(id)) throw new Error(`酒馆脚本 ID 重复：${id}`);
      ids.add(id);
      if (node.type === "folder") {
        if (node.scripts != null && !Array.isArray(node.scripts)) throw new Error("无效的酒馆脚本文件夹。");
        visit((node.scripts ?? []) as unknown[], [...folderPath, {
          id, name: String(node.name ?? ""), enabled: node.enabled !== false,
          icon: String(node.icon ?? ""), color: String(node.color ?? ""),
        }]);
      } else {
        const previous = current.find((script) => script.id === id || script.sourceId === id);
        const script = normalizeTavernScript({
          ...previous, ...node,
          id: previous?.id ?? id,
          sourceId: previous?.sourceId || id,
          sourceFormat: previous?.sourceFormat ?? "sillytavern",
          updatedAt: new Date().toISOString(),
          folderPath,
        });
        next.push(script);
      }
    }
  };
  visit(trees, []);
  return next;
}

// Kept self-contained so the isolated HTML frontend uses exactly the same
// synchronous reads and sync/async updater contract as background scripts.
export function createTavernScriptTreeApi(adapter: {
  get(type: TavernScriptScope): TavernScriptTree[];
  replace(trees: TavernScriptTree[], type: TavernScriptScope): void;
}) {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const scope = (option: unknown): TavernScriptScope => {
    const type = (option as { type?: unknown } | undefined)?.type;
    if (type !== "global" && type !== "preset" && type !== "character") {
      throw new Error("酒馆脚本作用域必须是 global、preset 或 character。");
    }
    return type;
  };
  const getScriptTrees = (option: unknown) => clone(adapter.get(scope(option)));
  const replaceScriptTrees = (trees: unknown, option: unknown) => {
    const type = scope(option);
    if (!Array.isArray(trees)) throw new Error("酒馆脚本树必须是数组。");
    adapter.replace(clone(trees), type);
  };
  const updateScriptTreesWith = (
    updater: (trees: TavernScriptTree[]) => unknown,
    option: unknown,
  ): TavernScriptTree[] | Promise<TavernScriptTree[]> => {
    if (typeof updater !== "function") throw new Error("酒馆脚本更新器必须是函数。");
    const current = getScriptTrees(option);
    const save = (next: unknown) => {
      replaceScriptTrees(next, option);
      return getScriptTrees(option);
    };
    const next = updater(current);
    return next && typeof (next as Promise<unknown>).then === "function"
      ? Promise.resolve(next).then(save) : save(next);
  };
  return { getScriptTrees, replaceScriptTrees, updateScriptTreesWith };
}

export const TAVERN_SCRIPT_TREE_API_SOURCE = createTavernScriptTreeApi.toString();
