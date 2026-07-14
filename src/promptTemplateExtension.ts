import ejs from "ejs";
import lodash from "lodash";
import type { CharacterCard } from "./characterCardUtils";
import type { PromptTemplateExtensionSettings } from "./extensionUtils";
import type { ChatPreset } from "./presetUtils";
import type { WorldBook, WorldBookEntry } from "./worldbookUtils";

export type PromptTemplateApiMessage = {
  role: string;
  content: unknown;
  [key: string]: unknown;
};

export type PromptTemplateStoredMessage = {
  role: string;
  content: string;
  variables?: Record<string, unknown>;
  [key: string]: unknown;
};

export type PromptTemplateVariableBridge = {
  getGlobalVariables(): Record<string, unknown>;
  setGlobalVariables(variables: Record<string, unknown>): void;
  getChatVariables(): Record<string, unknown>;
  setChatVariables(variables: Record<string, unknown>): void;
  getMessages(): PromptTemplateStoredMessage[];
  setMessageVariables(index: number, variables: Record<string, unknown>): void;
};

export type PromptTemplateRuntimeOptions = {
  settings: PromptTemplateExtensionSettings;
  worldBooks: WorldBook[];
  activeWorldBookIds?: string[];
  character: CharacterCard | null;
  preset: ChatPreset | null;
  userName: string;
  assistantName: string;
  chatId: string;
  modelId: string;
  variables: PromptTemplateVariableBridge;
  debug?: (message: string, detail?: unknown) => void;
};

export type PromptTemplateRenderResult = {
  content: string;
  messageVariables: Record<string, unknown>;
};

type VariableScope = "cache" | "global" | "local" | "message" | "initial";

type TemplateRuntime = {
  options: PromptTemplateRuntimeOptions;
  initialVariables: Record<string, unknown>;
  pendingMessageVariables: Map<number, Record<string, unknown>>;
  injectedPrompts: Map<string, Map<string, { prompt: string; order: number; sticky: number }>>;
  defines: Record<string, unknown>;
  renderDepth: number;
};

type SpecialWorldBookEntry = {
  book: WorldBook;
  entry: WorldBookEntry;
  content: string;
  decorators: string[];
};

type ScopeOptions = {
  scope?: VariableScope;
  defaults?: unknown;
  flags?: "nx" | "xx" | "n" | "nxs" | "xxs";
  results?: "old" | "new" | "fullcache";
  merge?: boolean;
  index?: number;
};

const SPECIAL_COMMENT_PATTERN =
  /(?:\[GENERATE(?::[^\]]+)?\]|\[RENDER(?::[^\]]+)?\]|\[InitialVariables\]|@INJECT)/i;
const SPECIAL_DECORATORS = new Set([
  "@@generate_before",
  "@@generate_after",
  "@@render_before",
  "@@render_after",
  "@@initial_variables",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneRecord(value: unknown) {
  return isRecord(value) ? lodash.cloneDeep(value) : {};
}

function stringifyTemplateValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function findLastMessageIndex(messages: PromptTemplateStoredMessage[], role: string) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === role) return index;
  }
  return -1;
}

function normalizeScopeOptions(
  value: unknown,
  defaultScope: VariableScope,
): ScopeOptions {
  if (typeof value === "string") {
    const scope = value.toLowerCase();
    if (["cache", "global", "local", "message", "initial"].includes(scope)) {
      return { scope: scope as VariableScope };
    }
    return { flags: value as ScopeOptions["flags"], scope: defaultScope };
  }
  if (!isRecord(value)) return { scope: defaultScope };
  const scope = String(value.scope ?? defaultScope).toLowerCase();
  return {
    ...value,
    scope: ["cache", "global", "local", "message", "initial"].includes(scope)
      ? (scope as VariableScope)
      : defaultScope,
  } as ScopeOptions;
}

function parseDecorators(content: string) {
  if (!content.startsWith("@@")) return { decorators: [] as string[], content };
  const lines = content.split("\n");
  const decorators: string[] = [];
  let contentStart = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const base = line.split(/\s+/, 1)[0];
    if (!SPECIAL_DECORATORS.has(base)) {
      contentStart = index;
      break;
    }
    decorators.push(line);
    contentStart = index + 1;
  }
  return { decorators, content: lines.slice(contentStart).join("\n") };
}

export function isPromptTemplateSpecialEntry(entry: WorldBookEntry) {
  if (SPECIAL_COMMENT_PATTERN.test(entry.comment)) return true;
  const { decorators } = parseDecorators(entry.content);
  return decorators.length > 0;
}

export function filterPromptTemplateSpecialEntries(
  worldBooks: WorldBook[],
  extensionEnabled: boolean,
) {
  if (!extensionEnabled) return worldBooks;
  return worldBooks.map((book) => ({
    ...book,
    entries: book.entries.filter((entry) => !isPromptTemplateSpecialEntry(entry)),
  }));
}

function collectSpecialEntries(worldBooks: WorldBook[], activeWorldBookIds?: string[]) {
  const activeIds = new Set(activeWorldBookIds ?? worldBooks.map((book) => book.id));
  return worldBooks
    .flatMap((book) =>
      book.entries
        .filter(
          (entry) =>
            activeIds.has(book.id) && entry.enabled && isPromptTemplateSpecialEntry(entry),
        )
        .map((entry) => {
          const parsed = parseDecorators(entry.content);
          return {
            book,
            entry,
            content: parsed.content,
            decorators: parsed.decorators,
          } satisfies SpecialWorldBookEntry;
        }),
    )
    .filter(({ entry }) => {
      if (!entry.useProbability) return true;
      return Math.random() * 100 <= entry.probability;
    })
    .sort((left, right) => left.entry.order - right.entry.order || left.entry.uid.localeCompare(right.entry.uid));
}

function parseInitialVariables(entries: SpecialWorldBookEntry[]) {
  const initial: Record<string, unknown> = {};
  for (const item of entries) {
    const isInitial =
      item.entry.comment.includes("[InitialVariables]") ||
      item.decorators.some((decorator) => decorator.startsWith("@@initial_variables"));
    if (!isInitial) continue;
    const json = item.content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    try {
      const parsed = JSON.parse(json) as unknown;
      if (isRecord(parsed)) lodash.merge(initial, parsed);
    } catch {
      // Invalid initial-variable entries stay available as normal source data but are not executed.
    }
  }
  return initial;
}

function createRuntime(options: PromptTemplateRuntimeOptions): TemplateRuntime {
  const specialEntries = collectSpecialEntries(options.worldBooks, options.activeWorldBookIds);
  return {
    options,
    initialVariables: options.settings.preloadWorldBooks
      ? parseInitialVariables(specialEntries)
      : {},
    pendingMessageVariables: new Map(),
    injectedPrompts: new Map(),
    defines: {},
    renderDepth: 0,
  };
}

function getMessageVariables(runtime: TemplateRuntime, index: number) {
  const pending = runtime.pendingMessageVariables.get(index);
  if (pending) return cloneRecord(pending);
  return cloneRecord(runtime.options.variables.getMessages()[index]?.variables);
}

function setMessageVariables(
  runtime: TemplateRuntime,
  index: number,
  variables: Record<string, unknown>,
) {
  const cloned = cloneRecord(variables);
  runtime.pendingMessageVariables.set(index, cloned);
  runtime.options.variables.setMessageVariables(index, cloned);
}

function getScopeVariables(runtime: TemplateRuntime, scope: VariableScope, messageIndex: number) {
  if (scope === "global") return cloneRecord(runtime.options.variables.getGlobalVariables());
  if (scope === "local") return cloneRecord(runtime.options.variables.getChatVariables());
  if (scope === "message") return getMessageVariables(runtime, messageIndex);
  if (scope === "initial") return cloneRecord(runtime.initialVariables);
  return lodash.merge(
    {},
    runtime.initialVariables,
    runtime.options.variables.getGlobalVariables(),
    runtime.options.variables.getChatVariables(),
    getMessageVariables(runtime, messageIndex),
  );
}

function persistScopeVariables(
  runtime: TemplateRuntime,
  scope: VariableScope,
  messageIndex: number,
  variables: Record<string, unknown>,
) {
  if (scope === "global") {
    runtime.options.variables.setGlobalVariables(cloneRecord(variables));
  } else if (scope === "local" || scope === "cache" || scope === "initial") {
    runtime.options.variables.setChatVariables(cloneRecord(variables));
  } else {
    setMessageVariables(runtime, messageIndex, variables);
  }
}

function createVariableFunctions(
  runtime: TemplateRuntime,
  messageIndex: number,
  cacheView: Record<string, unknown>,
) {
  const refreshCacheView = (targetIndex: number) => {
    const refreshed = getScopeVariables(runtime, "cache", targetIndex);
    Object.keys(cacheView).forEach((key) => delete cacheView[key]);
    lodash.merge(cacheView, refreshed);
  };
  const getvar = (path?: unknown, optionsValue?: unknown) => {
    const options = normalizeScopeOptions(optionsValue, "cache");
    const variables = getScopeVariables(runtime, options.scope ?? "cache", options.index ?? messageIndex);
    if (path === undefined || path === null || String(path).trim() === "") return variables;
    return lodash.get(variables, String(path), options.defaults);
  };

  const setvar = (path: unknown, value: unknown, optionsValue?: unknown) => {
    const options = normalizeScopeOptions(optionsValue, "message");
    let scope = options.scope ?? "message";
    if (scope === "cache" || scope === "initial") scope = "local";
    const targetIndex = options.index ?? messageIndex;
    const variables = getScopeVariables(runtime, scope, targetIndex);
    const key = String(path ?? "").trim();
    const oldValue = key ? lodash.get(variables, key) : cloneRecord(variables);
    const exists = key ? lodash.has(variables, key) : Object.keys(variables).length > 0;
    if ((options.flags === "nx" || options.flags === "nxs") && exists) return oldValue;
    if ((options.flags === "xx" || options.flags === "xxs") && !exists) return undefined;
    if (key) {
      lodash.set(
        variables,
        key,
        options.merge && isRecord(value)
          ? lodash.merge({}, isRecord(oldValue) ? oldValue : {}, value)
          : lodash.cloneDeep(value),
      );
    } else if (isRecord(value)) {
      Object.keys(variables).forEach((variableKey) => delete variables[variableKey]);
      lodash.merge(variables, value);
    }
    persistScopeVariables(runtime, scope, targetIndex, variables);
    refreshCacheView(targetIndex);
    if (options.results === "old") return oldValue;
    if (options.results === "fullcache") return getScopeVariables(runtime, "cache", targetIndex);
    return key ? lodash.get(variables, key) : variables;
  };

  const delvar = (path: unknown, optionsValue?: unknown) => {
    const options = normalizeScopeOptions(optionsValue, "message");
    let scope = options.scope ?? "message";
    if (scope === "cache" || scope === "initial") scope = "local";
    const targetIndex = options.index ?? messageIndex;
    const variables = getScopeVariables(runtime, scope, targetIndex);
    const oldValue = lodash.get(variables, String(path));
    lodash.unset(variables, String(path));
    persistScopeVariables(runtime, scope, targetIndex, variables);
    refreshCacheView(targetIndex);
    return oldValue;
  };

  const incvar = (path: unknown, amount = 1, optionsValue?: unknown) => {
    const current = Number(getvar(path, optionsValue) ?? 0);
    return setvar(path, current + Number(amount || 0), optionsValue);
  };
  const decvar = (path: unknown, amount = 1, optionsValue?: unknown) =>
    incvar(path, -Number(amount || 0), optionsValue);
  const insvar = (
    path: unknown,
    value: unknown,
    position?: number | string,
    optionsValue?: unknown,
  ) => {
    const current = getvar(path, optionsValue);
    const array = Array.isArray(current) ? lodash.cloneDeep(current) : [];
    const numericPosition = Number(position);
    const index = Number.isFinite(numericPosition)
      ? Math.max(0, Math.min(array.length, Math.floor(numericPosition)))
      : array.length;
    array.splice(index, 0, lodash.cloneDeep(value));
    return setvar(path, array, optionsValue);
  };

  return {
    getvar,
    setvar,
    delvar,
    incvar,
    decvar,
    insvar,
    getLocalVar: (path: unknown, options?: unknown) =>
      getvar(path, { ...normalizeScopeOptions(options, "local"), scope: "local" }),
    getGlobalVar: (path: unknown, options?: unknown) =>
      getvar(path, { ...normalizeScopeOptions(options, "global"), scope: "global" }),
    getMessageVar: (path: unknown, options?: unknown) =>
      getvar(path, { ...normalizeScopeOptions(options, "message"), scope: "message" }),
    setLocalVar: (path: unknown, value: unknown, options?: unknown) =>
      setvar(path, value, { ...normalizeScopeOptions(options, "local"), scope: "local" }),
    setGlobalVar: (path: unknown, value: unknown, options?: unknown) =>
      setvar(path, value, { ...normalizeScopeOptions(options, "global"), scope: "global" }),
    setMessageVar: (path: unknown, value: unknown, options?: unknown) =>
      setvar(path, value, { ...normalizeScopeOptions(options, "message"), scope: "message" }),
    delLocalVar: (path: unknown, options?: unknown) =>
      delvar(path, { ...normalizeScopeOptions(options, "local"), scope: "local" }),
    delGlobalVar: (path: unknown, options?: unknown) =>
      delvar(path, { ...normalizeScopeOptions(options, "global"), scope: "global" }),
    delMessageVar: (path: unknown, options?: unknown) =>
      delvar(path, { ...normalizeScopeOptions(options, "message"), scope: "message" }),
  };
}

function matchEntry(entry: WorldBookEntry, selector: unknown) {
  if (selector instanceof RegExp) return selector.test(entry.comment);
  if (typeof selector === "number") {
    return Number(entry.uid) === selector || Number(entry.id) === selector;
  }
  const value = String(selector ?? "").trim();
  return entry.comment === value || entry.uid === value || entry.id === value;
}

function getWorldBook(runtime: TemplateRuntime, name: unknown) {
  const normalized = String(name ?? "").trim();
  if (!normalized) return runtime.options.worldBooks[0] ?? null;
  return runtime.options.worldBooks.find((book) => book.name === normalized) ?? null;
}

function protectEscapedTemplateRanges(content: string) {
  return content.replace(/<#escape-ejs>([\s\S]*?)<#\/escape-ejs>/gi, (_match, body: string) =>
    body.replaceAll("<%", "<%%").replaceAll("%>", "%%>"),
  );
}

async function renderTemplate(
  runtime: TemplateRuntime,
  content: string,
  messageIndex: number,
  mode: "generate" | "render",
  extra: Record<string, unknown> = {},
): Promise<string> {
  if (!content.includes("<%")) return content;
  if (runtime.renderDepth > 12) throw new Error("Prompt Template 递归超过 12 层。");
  runtime.renderDepth += 1;
  try {
    const context = await createTemplateContext(runtime, messageIndex, mode, extra);
    const rendered = ejs.render(protectEscapedTemplateRanges(content), context, {
      async: true,
      outputFunctionName: "print",
      _with: true,
      escape: mode === "generate" ? stringifyTemplateValue : ejs.escapeXML,
    });
    return String(await rendered);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    runtime.options.debug?.(`Prompt Template ${mode} 处理失败`, detail);
    throw new Error(`Prompt Template 模板执行失败：${detail}`);
  } finally {
    runtime.renderDepth -= 1;
  }
}

async function createTemplateContext(
  runtime: TemplateRuntime,
  messageIndex: number,
  mode: "generate" | "render",
  extra: Record<string, unknown>,
) {
  const bridgeMessages = runtime.options.variables.getMessages();
  const cacheVariables = getScopeVariables(runtime, "cache", messageIndex);
  const variables = createVariableFunctions(runtime, messageIndex, cacheVariables);
  const character = runtime.options.character;
  const getwi = async (
    worldBookOrEntry: unknown,
    entryOrData: unknown = {},
    data: Record<string, unknown> = {},
  ) => {
    let worldBookName = "";
    let selector: unknown = worldBookOrEntry;
    if (isRecord(entryOrData)) {
      const worldInfo = isRecord(extra.world_info) ? extra.world_info : {};
      worldBookName = String(worldInfo.world ?? "");
      data = entryOrData;
    } else {
      worldBookName = String(worldBookOrEntry ?? "");
      selector = entryOrData;
    }
    const book = getWorldBook(runtime, worldBookName);
    const entry = book?.entries.find((candidate) => matchEntry(candidate, selector));
    if (!book || !entry) return "";
    return await renderTemplate(runtime, entry.content, messageIndex, mode, {
      ...data,
      world_info: {
        world: book.name,
        uid: entry.uid,
        id: entry.id,
        name: entry.comment,
        comment: entry.comment,
        content: entry.content,
        keys: lodash.cloneDeep(entry.keys),
      },
    });
  };
  const getChatMessage = (index: number) => bridgeMessages[index] ?? null;
  const getChatMessages = (start = 0, end = bridgeMessages.length) =>
    lodash.cloneDeep(bridgeMessages.slice(start, end));
  const injectPrompt = (
    key: unknown,
    prompt: unknown,
    order = 100,
    sticky = 0,
    uid = "",
  ) => {
    const listKey = String(key);
    const promptId = uid || `${listKey}:${String(prompt)}`;
    if (!runtime.injectedPrompts.has(listKey)) runtime.injectedPrompts.set(listKey, new Map());
    runtime.injectedPrompts.get(listKey)?.set(promptId, {
      prompt: String(prompt),
      order: Number(order) || 100,
      sticky: Number(sticky) || 0,
    });
  };
  const getPromptsInjected = (key: unknown) =>
    Array.from(runtime.injectedPrompts.get(String(key))?.values() ?? [])
      .sort((left, right) => left.order - right.order)
      .map((item) => item.prompt)
      .join("\n");
  const define = (name: unknown, value: unknown, merge = false) => {
    const key = String(name);
    const oldValue = lodash.get(runtime.defines, key);
    lodash.set(
      runtime.defines,
      key,
      merge && isRecord(value)
        ? lodash.merge({}, isRecord(oldValue) ? oldValue : {}, value)
        : value,
    );
    return oldValue;
  };
  const getCharacter = (field?: unknown) => {
    if (!character) return "";
    const key = String(field ?? "").trim();
    if (key && key in character) return stringifyTemplateValue(character[key as keyof CharacterCard]);
    return [character.description, character.personality, character.scenario]
      .filter(Boolean)
      .join("\n\n");
  };
  const getPresetPrompt = (name: unknown) => {
    const promptName = String(name ?? "");
    const prompt = runtime.options.preset?.prompts.find(
      (candidate) => candidate.name === promptName || candidate.identifier === promptName,
    );
    return prompt?.content ?? "";
  };
  const lastUserMessageId = findLastMessageIndex(bridgeMessages, "user");
  const lastCharMessageId = findLastMessageIndex(bridgeMessages, "assistant");
  const activeWorldBookIds = new Set(
    runtime.options.activeWorldBookIds ?? runtime.options.worldBooks.map((book) => book.id),
  );
  const formatWorldBookEntries = (name: unknown) =>
    lodash.cloneDeep(
      (getWorldBook(runtime, name)?.entries ?? []).map((entry) => ({
        ...entry,
        name: entry.comment,
        disabled: !entry.enabled,
        position: {
          type: entry.position,
          depth: entry.depth,
          order: entry.order,
        },
      })),
    );
  const compatSillyTavern = {
    getContext: () => ({
      chat: bridgeMessages.map((message) => ({
        ...lodash.cloneDeep(message),
        is_user: message.role === "user",
        is_system: message.role === "system",
        mes: message.content,
      })),
      characters: character ? [{ name: character.name, data: lodash.cloneDeep(character) }] : [],
      characterId: character ? "0" : undefined,
      name1: runtime.options.userName,
      name2: runtime.options.assistantName,
      chatId: runtime.options.chatId,
    }),
    getWorldbookNames: () => runtime.options.worldBooks.map((book) => book.name),
    getGlobalWorldbookNames: () => runtime.options.worldBooks.map((book) => book.name),
    getWorldbook: formatWorldBookEntries,
    getLorebookEntries: async (name: unknown) => formatWorldBookEntries(name),
    getCharWorldbookNames: () => ({
      primary: character?.characterBook?.name ?? null,
      additional: runtime.options.worldBooks
        .filter(
          (book) =>
            activeWorldBookIds.has(book.id) &&
            book.name !== character?.characterBook?.name,
        )
        .map((book) => book.name),
    }),
  };
  const hostSillyTavern =
    typeof window !== "undefined"
      ? (window as unknown as { SillyTavern?: unknown }).SillyTavern
      : undefined;

  return {
    _: lodash,
    lodash,
    $: typeof window !== "undefined" ? (window as unknown as { $?: unknown }).$ : undefined,
    console,
    toastr: typeof window !== "undefined"
      ? (window as unknown as { toastr?: unknown }).toastr
      : undefined,
    SillyTavern: hostSillyTavern ?? compatSillyTavern,
    variables: cacheVariables,
    userName: runtime.options.userName,
    assistantName: runtime.options.assistantName,
    charName: runtime.options.assistantName,
    chatId: runtime.options.chatId,
    characterId: character?.id ?? null,
    charLoreBook: character?.characterBook?.name ?? null,
    model: runtime.options.modelId,
    runType: mode,
    messageId: messageIndex,
    lastUserMessageId,
    lastUserMessage: bridgeMessages[lastUserMessageId]?.content ?? "",
    lastCharMessageId,
    lastCharMessage: bridgeMessages[lastCharMessageId]?.content ?? "",
    lastMessageId: bridgeMessages.length - 1,
    getwi,
    getWorldInfo: getwi,
    getWorldInfoData: (name: unknown) =>
      lodash.cloneDeep(getWorldBook(runtime, name)?.entries ?? []),
    getWorldbookNames: compatSillyTavern.getWorldbookNames,
    getGlobalWorldbookNames: compatSillyTavern.getGlobalWorldbookNames,
    getWorldbook: compatSillyTavern.getWorldbook,
    getLorebookEntries: compatSillyTavern.getLorebookEntries,
    getCharWorldbookNames: compatSillyTavern.getCharWorldbookNames,
    getEnabledWorldInfoEntries: () =>
      lodash.cloneDeep(
        runtime.options.worldBooks.flatMap((book) =>
          book.entries.filter((entry) => entry.enabled),
        ),
      ),
    getchr: getCharacter,
    getchar: getCharacter,
    getChara: getCharacter,
    getCharData: () => lodash.cloneDeep(character),
    getCharaData: () => lodash.cloneDeep(character),
    getprp: getPresetPrompt,
    getpreset: getPresetPrompt,
    getPresetPrompt,
    getChatMessage,
    getChatMessages,
    injectPrompt,
    getPromptsInjected,
    hasPromptsInjected: (key: unknown) => runtime.injectedPrompts.has(String(key)),
    define,
    evalTemplate: async (template: unknown, data: Record<string, unknown> = {}) =>
      await renderTemplate(runtime, String(template ?? ""), messageIndex, mode, data),
    ...variables,
    ...lodash.cloneDeep(runtime.defines),
    ...extra,
  };
}

async function renderMessageContent(
  runtime: TemplateRuntime,
  content: unknown,
  messageIndex: number,
  mode: "generate" | "render",
  extra: Record<string, unknown> = {},
) {
  if (typeof content === "string") {
    return await renderTemplate(runtime, content, messageIndex, mode, extra);
  }
  if (!Array.isArray(content)) return content;
  const nextParts: unknown[] = [];
  for (const part of content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      nextParts.push({
        ...part,
        text: await renderTemplate(runtime, part.text, messageIndex, mode, extra),
      });
    } else {
      nextParts.push(part);
    }
  }
  return nextParts;
}

function prependMessageContent(message: PromptTemplateApiMessage, prefix: string) {
  if (!prefix) return message;
  if (typeof message.content === "string") {
    return { ...message, content: [prefix, message.content].filter(Boolean).join("\n") };
  }
  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: [{ type: "text", text: prefix }, ...message.content],
    };
  }
  return { ...message, content: prefix };
}

function appendMessageContent(message: PromptTemplateApiMessage, suffix: string) {
  if (!suffix) return message;
  if (typeof message.content === "string") {
    return { ...message, content: [message.content, suffix].filter(Boolean).join("\n") };
  }
  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: [...message.content, { type: "text", text: suffix }],
    };
  }
  return { ...message, content: suffix };
}

function getMessageText(message: PromptTemplateApiMessage) {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => isRecord(part) && part.type === "text")
    .map((part) => String((part as Record<string, unknown>).text ?? ""))
    .join("\n");
}

function hasDecorator(item: SpecialWorldBookEntry, decorator: string) {
  return item.decorators.some((value) => value.split(/\s+/, 1)[0] === decorator);
}

function getDecoratorArgument(item: SpecialWorldBookEntry, decorator: string) {
  const value = item.decorators.find((candidate) => candidate.startsWith(`${decorator} `));
  return value ? value.slice(decorator.length).trim() : "";
}

async function renderEntry(
  runtime: TemplateRuntime,
  item: SpecialWorldBookEntry,
  messageIndex: number,
  mode: "generate" | "render",
  extra: Record<string, unknown> = {},
) {
  return await renderTemplate(runtime, item.content, messageIndex, mode, {
    world_info: {
      world: item.book.name,
      uid: item.entry.uid,
      id: item.entry.id,
      name: item.entry.comment,
      comment: item.entry.comment,
      content: item.content,
      keys: lodash.cloneDeep(item.entry.keys),
    },
    ...extra,
  });
}

function splitInjectArguments(value: string) {
  return value
    .split(/,(?=(?:[^'\"]|'[^']*'|\"[^\"]*\")*$)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((result, part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return result;
      const key = part.slice(0, separator).trim().toLowerCase();
      const rawValue = part.slice(separator + 1).trim();
      result[key] = rawValue.replace(/^(['\"])([\s\S]*)\1$/, "$2");
      return result;
    }, {});
}

function resolveRelativeIndex(indices: number[], indexValue: string | undefined) {
  if (indices.length === 0) return -1;
  const parsed = Number(indexValue ?? "1");
  if (!Number.isFinite(parsed)) return indices[0];
  if (parsed < 0) return indices[Math.max(0, indices.length + Math.floor(parsed))] ?? -1;
  return indices[Math.max(0, Math.floor(parsed) - 1)] ?? -1;
}

async function applyInjectEntries(
  runtime: TemplateRuntime,
  messages: PromptTemplateApiMessage[],
  entries: SpecialWorldBookEntry[],
) {
  const next = [...messages];
  for (const item of entries) {
    const match = item.entry.comment.match(/@INJECT\s*(.*)$/i);
    if (!match) continue;
    const args = splitInjectArguments(match[1]);
    const role = ["system", "user", "assistant"].includes(args.role)
      ? args.role
      : "system";
    let insertionIndex = -1;
    if (args.pos !== undefined) {
      const parsed = Math.floor(Number(args.pos));
      insertionIndex = parsed < 0
        ? Math.max(0, next.length + parsed)
        : Math.max(0, parsed - 1);
    } else if (args.target) {
      const roleIndices = next
        .map((message, index) => (message.role === args.target ? index : -1))
        .filter((index) => index >= 0);
      const targetIndex = resolveRelativeIndex(roleIndices, args.index);
      if (targetIndex >= 0) insertionIndex = targetIndex + (args.at === "after" ? 1 : 0);
    } else if (args.regex) {
      try {
        const expression = new RegExp(args.regex, "i");
        const targetIndex = next.findIndex((message) => expression.test(getMessageText(message)));
        if (targetIndex >= 0) insertionIndex = targetIndex + (args.at === "after" ? 1 : 0);
      } catch {
        insertionIndex = -1;
      }
    }
    if (insertionIndex < 0) continue;
    const content = await renderEntry(runtime, item, insertionIndex, "generate");
    next.splice(Math.min(next.length, insertionIndex), 0, { role, content });
  }
  return next;
}

function applyInjectedPromptOutlets(runtime: TemplateRuntime, content: unknown): unknown {
  if (typeof content === "string") {
    return content.replace(/\{\{outletPromptsInjected:(.+?)\}\}/g, (_match, key: string) =>
      Array.from(runtime.injectedPrompts.get(key)?.values() ?? [])
        .sort((left, right) => left.order - right.order)
        .map((item) => item.prompt)
        .join("\n"),
    );
  }
  if (!Array.isArray(content)) return content;
  return content.map((part) =>
    isRecord(part) && part.type === "text"
      ? { ...part, text: applyInjectedPromptOutlets(runtime, part.text) }
      : part,
  );
}

function updateTokenStats(runtime: TemplateRuntime, direction: "SEND" | "RECEIVE", text: string) {
  const variables = cloneRecord(runtime.options.variables.getGlobalVariables());
  variables[`LAST_${direction}_CHARS`] = text.length;
  variables[`LAST_${direction}_TOKENS`] = Math.ceil(text.length / 4);
  runtime.options.variables.setGlobalVariables(variables);
}

export async function processPromptTemplateApiMessages(
  messages: PromptTemplateApiMessage[],
  options: PromptTemplateRuntimeOptions,
) {
  if (!options.settings.processGeneratedPrompts) return messages;
  const runtime = createRuntime(options);
  const specialEntries = collectSpecialEntries(options.worldBooks, options.activeWorldBookIds);
  const generateEntries = options.settings.injectGenerateWorldBookEntries
    ? specialEntries
    : [];
  const preRenderedBeforeEntries = new Map<string, string>();
  for (const item of generateEntries) {
    const decoratorBefore = hasDecorator(item, "@@generate_before");
    const decoratorArgument = getDecoratorArgument(item, "@@generate_before");
    const isIndexedDecorator =
      decoratorBefore && decoratorArgument !== "" && Number.isFinite(Number(decoratorArgument));
    if (item.entry.comment.includes("[GENERATE:BEFORE]") || (decoratorBefore && !isIndexedDecorator)) {
      preRenderedBeforeEntries.set(
        `${item.book.id}:${item.entry.id}`,
        await renderEntry(runtime, item, 0, "generate"),
      );
    }
  }
  const next: PromptTemplateApiMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    next.push({
      ...messages[index],
      content: await renderMessageContent(runtime, messages[index].content, index, "generate"),
    });
  }

  const beforeAll: string[] = [];
  const afterAll: string[] = [];
  for (const item of generateEntries) {
    const comment = item.entry.comment;
    const indexed = comment.match(/\[GENERATE:(\d+):(BEFORE|AFTER)\]/i);
    const regexMatch = comment.match(/\[GENERATE:REGEX:([^\]]+)\]/i);
    if (indexed) {
      const index = Number(indexed[1]);
      if (!next[index]) continue;
      const rendered = await renderEntry(runtime, item, index, "generate");
      next[index] = indexed[2].toUpperCase() === "BEFORE"
        ? prependMessageContent(next[index], rendered)
        : appendMessageContent(next[index], rendered);
      continue;
    }
    if (regexMatch) {
      try {
        const expression = new RegExp(regexMatch[1], "i");
        const targetIndex = next.findIndex((message) => expression.test(getMessageText(message)));
        if (targetIndex >= 0) {
          const rendered = await renderEntry(runtime, item, targetIndex, "generate", {
            matched_message: getMessageText(next[targetIndex]),
            matched_message_index: targetIndex,
            matched_message_role: next[targetIndex].role,
          });
          next.splice(targetIndex, 0, { role: "system", content: rendered });
        }
      } catch {
        // Invalid regular expressions are ignored, matching SillyTavern's tolerant loader.
      }
      continue;
    }
    const decoratorBefore = hasDecorator(item, "@@generate_before");
    const decoratorAfter = hasDecorator(item, "@@generate_after");
    const decoratorIndex = Number(
      getDecoratorArgument(
        item,
        decoratorBefore ? "@@generate_before" : "@@generate_after",
      ),
    );
    if ((decoratorBefore || decoratorAfter) && Number.isFinite(decoratorIndex) && next[decoratorIndex]) {
      const rendered = await renderEntry(runtime, item, decoratorIndex, "generate");
      next[decoratorIndex] = decoratorBefore
        ? prependMessageContent(next[decoratorIndex], rendered)
        : appendMessageContent(next[decoratorIndex], rendered);
      continue;
    }
    if (comment.includes("[GENERATE:BEFORE]") || decoratorBefore) {
      beforeAll.push(
        preRenderedBeforeEntries.get(`${item.book.id}:${item.entry.id}`) ??
          (await renderEntry(runtime, item, 0, "generate")),
      );
    }
    if (comment.includes("[GENERATE:AFTER]") || decoratorAfter) {
      afterAll.push(await renderEntry(runtime, item, Math.max(0, next.length - 1), "generate"));
    }
  }
  if (next.length > 0 && beforeAll.length > 0) {
    next[0] = prependMessageContent(next[0], beforeAll.filter(Boolean).join("\n"));
  }
  if (next.length > 0 && afterAll.length > 0) {
    const lastIndex = next.length - 1;
    next[lastIndex] = appendMessageContent(next[lastIndex], afterAll.filter(Boolean).join("\n"));
  }

  const injected = options.settings.injectPromptWorldBookEntries
    ? await applyInjectEntries(runtime, next, specialEntries)
    : next;
  const finalized = injected.map((message) => ({
    ...message,
    content: applyInjectedPromptOutlets(runtime, message.content),
  }));
  const combinedText = finalized.map(getMessageText).join("\n");
  updateTokenStats(runtime, "SEND", combinedText);
  if (options.settings.debug) options.debug?.("Prompt Template 已处理发送提示词", finalized);
  return finalized;
}

export async function processPromptTemplateRenderedMessage(
  content: string,
  messageIndex: number,
  options: PromptTemplateRuntimeOptions,
): Promise<PromptTemplateRenderResult> {
  if (
    !options.settings.processRenderedMessages ||
    !options.settings.processRawMessages ||
    (options.settings.depthLimit >= 0 &&
      options.variables.getMessages().length - messageIndex > options.settings.depthLimit)
  ) {
    return { content, messageVariables: {} };
  }
  const runtime = createRuntime(options);
  const specialEntries = collectSpecialEntries(options.worldBooks, options.activeWorldBookIds);
  const beforeEntries: SpecialWorldBookEntry[] = [];
  const afterEntries: SpecialWorldBookEntry[] = [];
  if (options.settings.injectRenderWorldBookEntries) {
    for (const item of specialEntries) {
      if (item.entry.comment.includes("[RENDER:BEFORE]") || hasDecorator(item, "@@render_before")) {
        beforeEntries.push(item);
      }
      if (item.entry.comment.includes("[RENDER:AFTER]") || hasDecorator(item, "@@render_after")) {
        afterEntries.push(item);
      }
    }
  }
  const before: string[] = [];
  for (const item of beforeEntries) {
    before.push(await renderEntry(runtime, item, messageIndex, "render"));
  }
  const renderedContent = await renderTemplate(runtime, content, messageIndex, "render");
  const after: string[] = [];
  for (const item of afterEntries) {
    after.push(await renderEntry(runtime, item, messageIndex, "render"));
  }
  const rendered = [before.filter(Boolean).join("\n"), renderedContent, after.filter(Boolean).join("\n")]
      .filter(Boolean)
      .join("\n");
  updateTokenStats(runtime, "RECEIVE", rendered);
  if (options.settings.debug) options.debug?.("Prompt Template 已处理楼层消息", rendered);
  return {
    content: rendered,
    messageVariables: getMessageVariables(runtime, messageIndex),
  };
}

export async function evaluatePromptTemplateCode(
  content: string,
  data: Record<string, unknown>,
  messageIndex: number,
  options: PromptTemplateRuntimeOptions,
) {
  const runtime = createRuntime(options);
  return await renderTemplate(runtime, content, messageIndex, "generate", data);
}

export async function preparePromptTemplateContext(
  data: Record<string, unknown>,
  messageIndex: number,
  options: PromptTemplateRuntimeOptions,
) {
  const runtime = createRuntime(options);
  return await createTemplateContext(runtime, messageIndex, "generate", data);
}

export function getPromptTemplateInitialVariables(options: PromptTemplateRuntimeOptions) {
  return lodash.cloneDeep(createRuntime(options).initialVariables);
}
