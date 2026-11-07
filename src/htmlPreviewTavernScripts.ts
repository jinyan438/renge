import type { createTavernScriptTreeApi, TavernScriptScope, TavernScriptTree } from "./tavernScriptTreeUtils";

function installHtmlPreviewTavernScripts(
  snapshot: { scriptTrees?: Partial<Record<TavernScriptScope, TavernScriptTree[]>> },
  request: (operation: string, data: Record<string, unknown>) => Promise<unknown>,
  createScriptApi: typeof createTavernScriptTreeApi,
) {
  const report = (error: unknown) => {
    console.error("[TavernHelper] 角色卡命令执行失败", error);
  };
  const scriptApi = createScriptApi({
    get: (type) => snapshot.scriptTrees?.[type] ?? [],
    replace: (trees, type) => {
      snapshot.scriptTrees ??= {};
      snapshot.scriptTrees[type] = trees;
      void request("replaceScriptTrees", { trees, option: { type } }).catch(report);
    },
  });
  const uninjectPrompts = (ids: unknown) => {
    void request("uninjectPrompts", { ids }).catch(report);
  };
  const injectPrompts = (prompts: unknown, options: unknown = {}) => {
    const values = Array.isArray(prompts) ? prompts.map((prompt) => ({
      ...prompt, id: prompt.id ?? `injected-prompt-${crypto.randomUUID()}`,
    })) : [];
    void request("injectPrompts", { prompts: values, options }).catch(report);
    return { uninject: () => uninjectPrompts(values.map((prompt) => prompt.id)) };
  };
  return {
    ...scriptApi, injectPrompts, uninjectPrompts,
    deleteChatMessages: (ids: unknown, option: unknown = {}) => request("deleteChatMessages", { ids, option }),
  };
}

export const HTML_PREVIEW_TAVERN_SCRIPTS_SOURCE = installHtmlPreviewTavernScripts.toString();
