// Self-contained Tavern Helper 4 + SillyTavern 1.19 API bridge injected into
// isolated HTML preview iframes via `Function.prototype.toString()`.
// Keep `installHtmlPreviewTavernHelperApi` free of external module closures.
import { getHtmlPreviewDataRequest } from "./htmlPreviewContextData";

export type HtmlPreviewTavernSnapshot = {
  characterNames: string[];
  characterIds: string[];
  currentCharacterName: string | null;
  currentCharacterId: string | null;
  currentCharacterAvatar: string | null;
  worldbookNames: string[];
  globalWorldbookNames: string[];
  charWorldbookNames: { primary: string | null; additional: string[] };
  chatWorldbookName: string | null;
  presetNames: string[];
  loadedPresetName: string;
  personas: Array<Record<string, unknown>>;
  currentPersonaId: string;
  installedExtensionIds: string[];
  isGenerating: boolean;
  chatMetadata: Record<string, unknown>;
  inUsePreset?: Record<string, unknown> | null;
  namedPresets?: Record<string, Record<string, unknown>>;
  regexes?: Array<Record<string, unknown>>;
  charData?: Record<string, unknown> | null;
  charDataByName?: Record<string, Record<string, unknown>>;
  characterAvatars?: Record<string, string>;
  personaAvatars?: Record<string, string>;
};

export type HtmlPreviewTavernConstants = {
  tavernHelperVersion: string;
  sillyTavernVersion: string;
  tavernEvents: Record<string, string>;
  iframeEvents: Record<string, string>;
  messageIdEvents: string[];
  builtinPromptDefaultOrder: readonly string[];
  defaultPreset: Record<string, unknown>;
  remoteApiNames: readonly string[];
};

export const HTML_PREVIEW_TAVERN_EVENT_SUBSCRIPTIONS_MESSAGE =
  "renge-html-preview-event-subscriptions";

/**
 * Host-backed async functions exposed on `TavernHelper` / `window` in message
 * iframes. Sync getters and callback-taking updaters are implemented locally
 * on top of `snapshot.tavern` and `callTavernApi`.
 */
export const HTML_PREVIEW_TAVERN_API_REMOTE_NAMES: readonly string[] = Object.freeze([
  // Worldbooks & legacy lorebooks (async operations)
  "getWorldbook",
  "loadWorldInfo",
  "saveWorldInfo",
  "createWorldbook",
  "createOrReplaceWorldbook",
  "replaceWorldbook",
  "deleteWorldbook",
  "createWorldbookEntries",
  "deleteWorldbookEntries",
  "updateWorldbookEntry",
  "getWorldbookEntry",
  "getWorldbookEntryByKey",
  "rebindGlobalWorldbooks",
  "enableGlobalWorldbooks",
  "rebindCharWorldbooks",
  "rebindChatWorldbook",
  "getOrCreateChatWorldbook",
  "getLorebookEntries",
  "replaceLorebookEntries",
  "setLorebookEntries",
  "createLorebookEntry",
  "createLorebookEntries",
  "deleteLorebookEntry",
  "deleteLorebookEntries",
  "setCurrentCharLorebooks",
  "setChatLorebook",
  "getOrCreateChatLorebook",
  "createLorebook",
  "deleteLorebook",
  // Characters
  "getCharacter",
  "createCharacter",
  "createOrReplaceCharacter",
  "replaceCharacter",
  "deleteCharacter",
  "getChatHistoryBrief",
  "getChatHistoryDetail",
  // Presets
  "createPreset",
  "createOrReplacePreset",
  "deletePreset",
  "renamePreset",
  "replacePreset",
  "setPreset",
  // Personas
  "createPersona",
  "createOrReplacePersona",
  "deletePersona",
  "replacePersona",
  // Regexes & displayed messages
  "replaceTavernRegexes",
  "importRawTavernRegex",
  "createTavernRegex",
  "deleteTavernRegex",
  "refreshOneMessage",
  // Extensions, files, raw imports, models, chat rotation
  "getExtensionInstallationInfo",
  "getExtensionStatus",
  "installExtension",
  "uninstallExtension",
  "reinstallExtension",
  "updateExtension",
  "updateTavernHelper",
  "updateFrontendVersion",
  "getTavernFile",
  "uploadTavernFile",
  "deleteTavernFile",
  "importRawCharacter",
  "importRawChat",
  "importRawWorldbook",
  "importRawPreset",
  "getModelList",
  "getChatCompletionModel",
  "rotateChatMessages",
  "getAllEnabledScriptButtons",
]);

/**
 * Checks whether an HTML snippet may read presets, regexes, character cards or
 * avatar data URLs synchronously so routine bubbles skip serializing them.
 */
export function needsHeavyTavernPreviewContext(content: string): boolean {
  const request = getHtmlPreviewDataRequest(content);
  return Boolean(request.characters.length || request.presets.length || request.regexes ||
    request.characterAvatars.length || request.personaAvatars.length || request.scriptTrees);
}

type FrameRuntimeContext = {
  previewId: string;
  subscriptionMessageType: string;
  snapshot: {
    currentMessageIndex: number;
    currentHtmlPartIndex?: number;
    messages: Array<{
      role: string;
      content: string;
      source?: string;
      variables?: Record<string, unknown>;
      extra?: Record<string, unknown>;
    }>;
    chatVariables?: Record<string, unknown>;
    characterVariables?: Record<string, unknown>;
    globalVariables?: Record<string, unknown>;
    presetVariables?: Record<string, unknown>;
    extensionVariables?: Record<string, Record<string, unknown>>;
    userName: string;
    characterName: string;
    chatId: string;
    tavern?: HtmlPreviewTavernSnapshot;
  };
  clone: <T>(value: T) => T;
  isRecord: (value: unknown) => value is Record<string, unknown>;
  mergeRecords: (base: Record<string, unknown>, overlay: Record<string, unknown>) => Record<string, unknown>;
  requestParentCommand: (operation: string, data?: Record<string, unknown>) => Promise<unknown>;
  getVariables: (option?: unknown) => Record<string, unknown>;
};

function installHtmlPreviewTavernHelperApi(
  env: FrameRuntimeContext,
  constants: HtmlPreviewTavernConstants,
) {
  const {
    previewId,
    subscriptionMessageType,
    snapshot,
    clone,
    isRecord,
    mergeRecords,
    requestParentCommand,
    getVariables,
  } = env;

  const ensureTavern = (): HtmlPreviewTavernSnapshot => {
    if (!snapshot.tavern) {
      snapshot.tavern = {
        characterNames: snapshot.characterName ? [snapshot.characterName] : [],
        characterIds: snapshot.characterName ? [`${snapshot.characterName}.png`] : [],
        currentCharacterName: snapshot.characterName || null,
        currentCharacterId: snapshot.characterName ? `${snapshot.characterName}.png` : null,
        currentCharacterAvatar: null,
        worldbookNames: [],
        globalWorldbookNames: [],
        charWorldbookNames: { primary: null, additional: [] },
        chatWorldbookName: null,
        presetNames: [],
        loadedPresetName: "",
        personas: [
          {
            avatar_id: "user-default.png",
            avatar: "",
            name: snapshot.userName || "User",
            title: "",
            description: "",
            position: 0,
            depth: 2,
            role: 0,
            lorebook: "",
            connections: [],
            is_default: true,
          },
        ],
        currentPersonaId: "user-default.png",
        installedExtensionIds: [],
        isGenerating: false,
        chatMetadata: {},
      };
    }
    return snapshot.tavern;
  };

  const callTavernApi = async (name: string, args: unknown[] = []) => {
    const rawResult = await requestParentCommand("tavernApi", { name, args: clone(args) });
    if (isRecord(rawResult) && rawResult.__rengeResponse === true) {
      const status = Number(rawResult.status) || 200;
      const statusText = typeof rawResult.statusText === "string" ? rawResult.statusText : "";
      const contentType = typeof rawResult.contentType === "string" ? rawResult.contentType : "application/json";
      return new Response(String(rawResult.bodyText ?? ""), {
        status,
        statusText,
        headers: { "Content-Type": contentType },
      });
    }
    return rawResult;
  };

  // ---- Event system --------------------------------------------------------
  const legacyEventAliases: Record<string, string> = {
    chat_changed: constants.tavernEvents.CHAT_CHANGED || "chat_id_changed",
    generation_after_commands: constants.tavernEvents.GENERATION_AFTER_COMMANDS || "GENERATION_AFTER_COMMANDS",
    character_deleted: constants.tavernEvents.CHARACTER_DELETED || "characterDeleted",
  };
  const normalizeEventName = (eventName: unknown) => {
    const text = String(eventName ?? "");
    return Object.prototype.hasOwnProperty.call(legacyEventAliases, text)
      ? legacyEventAliases[text]
      : text;
  };
  const messageIdEvents = new Set(constants.messageIdEvents);

  type FrameEventHandler = {
    callback: (...args: unknown[]) => unknown;
    handle: unknown;
    priority: -1 | 0 | 1;
    sequence: number;
  };
  const handlersByEvent = new Map<string, FrameEventHandler[]>();
  let handlerSequence = 0;
  let lastSyncedEventKey = "";

  const syncSubscribedEvents = () => {
    const events = Array.from(handlersByEvent.keys()).sort();
    const nextKey = events.join("\n");
    if (nextKey === lastSyncedEventKey) return;
    lastSyncedEventKey = nextKey;
    try {
      window.parent.postMessage(
        {
          type: subscriptionMessageType,
          id: previewId,
          events,
        },
        "*",
      );
    } catch {}
  };

  const attachControls = <T extends (...args: unknown[]) => unknown>(
    fn: T,
    stop: () => boolean,
  ) =>
    Object.assign(fn, {
      stop,
      off: stop,
      dispose: stop,
      unsubscribe: stop,
    });

  const registerListener = (
    eventName: unknown,
    callback: unknown,
    priority: -1 | 0 | 1 = 0,
  ) => {
    if (typeof callback !== "function") {
      const noop = () => false;
      return { stop: noop, off: noop, dispose: noop, unsubscribe: noop };
    }
    const key = normalizeEventName(eventName);
    const list = handlersByEvent.get(key) ?? [];
    const typed = callback as (...args: unknown[]) => unknown;
    const stop = () => eventRemoveListener(key, typed);
    const handle = attachControls((...args: unknown[]) => typed(...args), stop);
    const existing = list.find((entry) => entry.callback === typed || entry.handle === callback);
    if (!existing) {
      list.push({
        callback: typed,
        handle,
        priority,
        sequence: handlerSequence++,
      });
      handlersByEvent.set(key, list);
      syncSubscribedEvents();
    }
    return handle;
  };

  const eventOn = (eventName: unknown, callback: unknown) => registerListener(eventName, callback, 0);
  const eventMakeFirst = (eventName: unknown, callback: unknown) => registerListener(eventName, callback, -1);
  const eventMakeLast = (eventName: unknown, callback: unknown) => registerListener(eventName, callback, 1);

  const eventRemoveListener = (eventName: unknown, callback: unknown) => {
    const key = normalizeEventName(eventName);
    const list = handlersByEvent.get(key);
    if (!list) return false;
    if (typeof callback === "function" || isRecord(callback)) {
      const index = list.findIndex(
        (entry) => entry.callback === callback || entry.handle === callback,
      );
      if (index >= 0) list.splice(index, 1);
    }
    if (list.length === 0) handlersByEvent.delete(key);
    syncSubscribedEvents();
    return true;
  };

  const eventOnce = (eventName: unknown, callback: unknown) => {
    if (typeof callback !== "function") return registerListener(eventName, callback, 0);
    const typed = callback as (...args: unknown[]) => unknown;
    const once = async (...args: unknown[]) => {
      eventRemoveListener(eventName, once);
      return await typed(...args);
    };
    return registerListener(eventName, once, 0);
  };

  const eventClearEvent = (eventName: unknown) => {
    const removed = handlersByEvent.delete(normalizeEventName(eventName));
    syncSubscribedEvents();
    return removed;
  };

  const eventClearListener = (callback: unknown) => {
    let removed = false;
    handlersByEvent.forEach((list, key) => {
      const next = list.filter((entry) => entry.callback !== callback && entry.handle !== callback);
      if (next.length !== list.length) removed = true;
      if (next.length > 0) handlersByEvent.set(key, next);
      else handlersByEvent.delete(key);
    });
    syncSubscribedEvents();
    return removed;
  };

  const eventClearAll = () => {
    handlersByEvent.clear();
    syncSubscribedEvents();
  };

  const runLocalEventHandlers = async (rawEventName: unknown, rawArgs: unknown[]) => {
    const key = normalizeEventName(rawEventName);
    const args = [...rawArgs];
    if (messageIdEvents.has(key) && args.length > 0 && typeof args[0] === "string") {
      const parsed = Number(args[0]);
      if (args[0].trim() !== "" && Number.isInteger(parsed)) args[0] = parsed;
    }
    const list = [...(handlersByEvent.get(key) ?? [])].sort(
      (left, right) => left.priority - right.priority || left.sequence - right.sequence,
    );
    for (const entry of list) {
      try {
        await entry.callback(...args);
      } catch (error) {
        console.error(`[TavernHelper] 事件 ${key} 处理失败`, error);
      }
    }
    return list.length > 0;
  };

  const deliverHostEvent = async (eventName: unknown, args: unknown[]) =>
    await runLocalEventHandlers(eventName, args);

  const eventEmit = async (eventName: unknown, ...args: unknown[]) => {
    const normalized = normalizeEventName(eventName);
    await runLocalEventHandlers(normalized, args);
    await requestParentCommand("tavernEmitEvent", {
      eventName: normalized,
      args: clone(args),
    }).catch(() => undefined);
  };

  const eventEmitAndWait = (eventName: unknown, ...args: unknown[]) => {
    void eventEmit(eventName, ...args);
  };

  // ---- Script & iframe identity helpers ------------------------------------
  const getScriptId = () => `TH-message--${snapshot.currentMessageIndex}`;
  const getIframeName = () =>
    `TH-message--${snapshot.currentMessageIndex}--${snapshot.currentHtmlPartIndex ?? 0}`;
  const getMessageId = (iframeName?: unknown) => {
    if (typeof iframeName === "string" && iframeName.trim()) {
      const match = /^TH-message--(-?\d+)--\d+$/.exec(iframeName.trim());
      if (match) return Number(match[1]);
    }
    return snapshot.currentMessageIndex;
  };
  const reloadIframe = () => window.location.reload();
  let frameScriptInfo = "";
  let frameScriptButtons: Array<{ name: string; visible: boolean }> = [];
  const getScriptName = () => getIframeName();
  const getScriptInfo = () => frameScriptInfo;
  const replaceScriptInfo = (info: unknown) => {
    frameScriptInfo = String(info ?? "");
  };
  const normalizeButtons = (values: unknown) =>
    (Array.isArray(values) ? values : [])
      .filter(isRecord)
      .map((item) => ({
        name: String(item.name ?? item.label ?? "").trim(),
        visible: typeof item.visible === "boolean" ? item.visible : true,
      }))
      .filter((item) => Boolean(item.name));
  const getScriptButtons = () => clone(frameScriptButtons);
  const replaceScriptButtons = (first: unknown, second?: unknown) => {
    const values = typeof first === "string" ? second : first;
    if (!Array.isArray(values)) return;
    frameScriptButtons = normalizeButtons(values);
  };
  const updateScriptButtonsWith = (updater: unknown) => {
    const current = getScriptButtons();
    if (typeof updater !== "function") return current;
    const result = (updater as (buttons: Array<{ name: string; visible: boolean }>) => unknown)(current);
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      return Promise.resolve(result).then((resolved) => {
        if (Array.isArray(resolved)) replaceScriptButtons(resolved);
        return getScriptButtons();
      });
    }
    if (Array.isArray(result)) replaceScriptButtons(result);
    return getScriptButtons();
  };
  const appendInexistentScriptButtons = (first: unknown, second?: unknown) => {
    const values = typeof first === "string" ? second : first;
    const additions = normalizeButtons(values).filter(
      (candidate) => !frameScriptButtons.some((existing) => existing.name === candidate.name),
    );
    frameScriptButtons = [...frameScriptButtons, ...additions];
    return getScriptButtons();
  };
  const getButtonEvent = (name: unknown) => `tavern_script_button:${getScriptId()}:${String(name ?? "")}`;
  const eventOnButton = (name: unknown, callback: unknown) => eventOn(getButtonEvent(name), callback);

  // ---- Macros --------------------------------------------------------------
  const macroEntries = new Set<{
    matcher: string | RegExp;
    resolver: (context: Record<string, unknown>, match: string, ...groups: unknown[]) => unknown;
  }>();
  const registerMacroLike = (matcher: unknown, resolver: unknown) => {
    const isRegex = Object.prototype.toString.call(matcher) === "[object RegExp]";
    if ((typeof matcher !== "string" && !isRegex) || typeof resolver !== "function") {
      const noop = () => false;
      return attachControls(noop, noop);
    }
    const entry = {
      matcher:
        typeof matcher === "string"
          ? matcher
          : new RegExp(String((matcher as RegExp).source), String((matcher as RegExp).flags)),
      resolver: resolver as (context: Record<string, unknown>, match: string, ...groups: unknown[]) => unknown,
    };
    macroEntries.add(entry);
    const stop = () => macroEntries.delete(entry);
    return Object.assign(attachControls(stop, stop), { unregister: stop });
  };
  const unregisterMacroLike = (matcher: unknown) => {
    const isRegex = Object.prototype.toString.call(matcher) === "[object RegExp]";
    let removed = false;
    macroEntries.forEach((entry) => {
      const matches = isRegex
        ? entry.matcher instanceof RegExp &&
          entry.matcher.source === String((matcher as RegExp).source) &&
          entry.matcher.flags === String((matcher as RegExp).flags)
        : entry.matcher === matcher;
      if (matches) removed = macroEntries.delete(entry) || removed;
    });
    return removed;
  };
  const stringifyMacroValue = (value: unknown) => {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };
  const substitudeMacros = (value: unknown) => {
    const context = {
      message_id: snapshot.currentMessageIndex,
      chat_id: snapshot.chatId,
      script_id: getScriptId(),
    };
    let text = String(value ?? "")
      .replace(/\{\{\s*user\s*\}\}/gi, () => snapshot.userName || "用户")
      .replace(/\{\{\s*char\s*\}\}/gi, () => snapshot.characterName || "角色")
      .replace(/<USER>/gi, () => snapshot.userName || "用户")
      .replace(/<BOT>/gi, () => snapshot.characterName || "角色")
      .replace(/\{\{\s*lastMessageId\s*\}\}/gi, () => String(snapshot.messages.length - 1))
      .replace(/\{\{\s*currentMessageId\s*\}\}/gi, () => String(snapshot.currentMessageIndex))
      .replace(/\{\{\s*getvar::([\s\S]*?)\}\}/gi, (_m, key: string) =>
        stringifyMacroValue(getVariables({ type: "chat" })[key.trim()]),
      )
      .replace(/\{\{\s*getglobalvar::([\s\S]*?)\}\}/gi, (_m, key: string) =>
        stringifyMacroValue(getVariables({ type: "global" })[key.trim()]),
      );
    macroEntries.forEach(({ matcher, resolver }) => {
      const replace = (match: string, ...groups: unknown[]) => {
        try {
          return String(resolver(context, match, ...groups) ?? "");
        } catch {
          return match;
        }
      };
      text =
        typeof matcher === "string"
          ? text.split(matcher).join(replace(matcher))
          : text.replace(matcher, replace);
    });
    return text;
  };

  // ---- Worldbook & Lorebook sync getters + optimistic mutators -------------
  const getWorldbookNames = () => [...ensureTavern().worldbookNames];
  const getGlobalWorldbookNames = () => [...ensureTavern().globalWorldbookNames];
  const getLorebooks = () => getWorldbookNames();
  const getCharWorldbookNames = (_character: unknown = "current") => {
    const names = ensureTavern().charWorldbookNames;
    return {
      primary: names?.primary ?? null,
      additional: [...(names?.additional ?? [])],
    };
  };
  const getCharLorebooks = (option: unknown = {}) => {
    const type = isRecord(option) ? String(option.type ?? "all") : "all";
    const names = getCharWorldbookNames();
    return {
      primary: type === "additional" ? null : names.primary,
      additional: type === "primary" ? [] : names.additional,
    };
  };
  const getCurrentCharPrimaryLorebook = () => getCharWorldbookNames().primary;
  const getChatWorldbookName = (_chat: unknown = "current") => ensureTavern().chatWorldbookName ?? null;
  const getChatLorebook = () => getChatWorldbookName("current");
  const getLorebookSettings = () => {
    const active = getGlobalWorldbookNames();
    return {
      selected_global_lorebooks: active,
      selected_world_info: active,
      scan_depth: 10,
      context_percentage: 50,
      budget_cap: 0,
      min_activations: 1,
      max_depth: 0,
      max_recursion_steps: 5,
      insertion_strategy: "evenly",
      include_names: true,
      recursive: true,
      case_sensitive: false,
      match_whole_words: false,
      use_group_scoring: false,
      overflow_alert: true,
    };
  };
  const setLorebookSettings = (settings: unknown) => {
    if (isRecord(settings) && Array.isArray(settings.selected_global_lorebooks)) {
      const allowed = new Set(getWorldbookNames());
      ensureTavern().globalWorldbookNames = settings.selected_global_lorebooks
        .map(String)
        .filter((name) => allowed.has(name));
    }
    void callTavernApi("setLorebookSettings", [settings]).catch(() => undefined);
  };

  // ---- Characters & RawCharacter -------------------------------------------
  const getCharacterNames = () => [...ensureTavern().characterNames];
  const getCharacterIds = () => [...ensureTavern().characterIds];
  const getCurrentCharacterName = () => ensureTavern().currentCharacterName;
  const getCurrentCharacterId = () => ensureTavern().currentCharacterId;
  const resolveTargetName = (value: unknown, fallback: string) => String(value ?? "").trim() || fallback;
  const getCharAvatarPath = (name: unknown = "current") => {
    const tavern = ensureTavern();
    const target = resolveTargetName(name, "current");
    if (target === "current" || target === tavern.currentCharacterName || target === tavern.currentCharacterId) {
      return tavern.currentCharacterAvatar ?? null;
    }
    return tavern.characterAvatars?.[target] ?? null;
  };
  const buildFallbackCharData = () => {
    const tavern = ensureTavern();
    if (!tavern.currentCharacterName) return null;
    const avatar = tavern.currentCharacterAvatar || tavern.currentCharacterId || `${tavern.currentCharacterName}.png`;
    const world = tavern.charWorldbookNames?.primary || "";
    return {
      name: tavern.currentCharacterName,
      description: "",
      personality: "",
      scenario: "",
      first_mes: snapshot.messages[0]?.content ?? "",
      mes_example: "",
      creatorcomment: "",
      tags: [],
      talkativeness: 0.5,
      fav: false,
      create_date: "",
      avatar,
      chat: snapshot.chatId,
      data: {
        name: tavern.currentCharacterName,
        description: "",
        character_version: "",
        personality: "",
        scenario: "",
        first_mes: snapshot.messages[0]?.content ?? "",
        mes_example: "",
        creator_notes: "",
        tags: [],
        system_prompt: "",
        post_history_instructions: "",
        creator: "",
        alternate_greetings: [],
        group_only_greetings: [],
        extensions: {
          talkativeness: "0.5",
          fav: false,
          ...(world ? { world } : {}),
          regex_scripts: [],
        },
      },
    };
  };
  const getCharData = (name: unknown = "current") => {
    const tavern = ensureTavern();
    const target = resolveTargetName(name, "current");
    if (target === "current" || target === tavern.currentCharacterName || target === tavern.currentCharacterId) {
      return clone(tavern.charData ?? buildFallbackCharData());
    }
    const bare = target.replace(/\.png$/i, "");
    const found = tavern.charDataByName?.[target] ?? tavern.charDataByName?.[bare] ?? null;
    return clone(found);
  };
  class RawCharacter {
    characterData: Record<string, unknown>;
    constructor(characterData: unknown) {
      this.characterData = isRecord(characterData) ? characterData : {};
    }
    static find(options: unknown = {}) {
      return getCharData(isRecord(options) ? options.name ?? "current" : "current");
    }
    static findIndex(name: unknown) {
      const target = resolveTargetName(name, "current");
      if (target === "current") {
        const currentName = getCurrentCharacterName();
        return currentName ? getCharacterNames().indexOf(currentName) : -1;
      }
      const names = getCharacterNames();
      const byName = names.indexOf(target);
      if (byName >= 0) return byName;
      const byId = getCharacterIds().indexOf(target);
      if (byId >= 0) return byId;
      return names.indexOf(target.replace(/\.png$/i, ""));
    }
    static async getChatsFromFiles(data: unknown, _isGroupChat?: unknown) {
      const detail = await callTavernApi("getChatHistoryDetail", [data]);
      return isRecord(detail) ? detail : {};
    }
    getCardData() {
      return this.characterData;
    }
    getAvatarId() {
      return String(this.characterData.avatar ?? "");
    }
    getRegexScripts() {
      const data = isRecord(this.characterData.data) ? this.characterData.data : {};
      const extensions = isRecord(data.extensions) ? data.extensions : {};
      return Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : [];
    }
    getCharacterBook() {
      const data = isRecord(this.characterData.data) ? this.characterData.data : {};
      return isRecord(data.character_book) ? data.character_book : null;
    }
    getWorldName() {
      const data = isRecord(this.characterData.data) ? this.characterData.data : {};
      const extensions = isRecord(data.extensions) ? data.extensions : {};
      return String(extensions.world ?? "");
    }
  }

  // ---- Presets -------------------------------------------------------------
  const default_preset = clone(constants.defaultPreset);
  const presetSystemIds = new Set(["main", "nsfw", "jailbreak", "enhanceDefinitions"]);
  const presetPlaceholderIds = new Set([
    "worldInfoBefore",
    "personaDescription",
    "charDescription",
    "charPersonality",
    "scenario",
    "worldInfoAfter",
    "dialogueExamples",
    "chatHistory",
  ]);
  const presetPromptAliases: Record<string, string> = {
    enhance_definitions: "enhanceDefinitions",
    world_info_before: "worldInfoBefore",
    persona_description: "personaDescription",
    char_description: "charDescription",
    char_personality: "charPersonality",
    world_info_after: "worldInfoAfter",
    dialogue_examples: "dialogueExamples",
    chat_history: "chatHistory",
  };
  const canonicalPromptId = (id: unknown) => {
    const text = String(id ?? "");
    return presetPromptAliases[text] ?? text;
  };
  const isPresetSystemPrompt = (prompt: unknown) =>
    isRecord(prompt) && presetSystemIds.has(canonicalPromptId(prompt.id));
  const isPresetPlaceholderPrompt = (prompt: unknown) =>
    isRecord(prompt) && presetPlaceholderIds.has(canonicalPromptId(prompt.id));
  const isPresetNormalPrompt = (prompt: unknown) =>
    isRecord(prompt) && !isPresetSystemPrompt(prompt) && !isPresetPlaceholderPrompt(prompt);

  const getPresetNames = () => ["in_use", ...ensureTavern().presetNames];
  const getLoadedPresetName = () => ensureTavern().loadedPresetName ?? "";
  const loadPreset = (name: unknown) => {
    const target = String(name ?? "").trim();
    if (!target || target === "in_use" || !ensureTavern().presetNames.includes(target)) return false;
    ensureTavern().loadedPresetName = target;
    if (ensureTavern().namedPresets?.[target]) {
      ensureTavern().inUsePreset = clone(ensureTavern().namedPresets![target]);
    }
    void callTavernApi("loadPreset", [target]).catch(() => undefined);
    return true;
  };
  const getPreset = (name: unknown = "in_use") => {
    const target = resolveTargetName(name, "in_use");
    const tavern = ensureTavern();
    if (target === "in_use") return clone(tavern.inUsePreset ?? default_preset);
    const named = tavern.namedPresets?.[target];
    if (named) return clone(named);
    if (tavern.presetNames.includes(target)) return clone(default_preset);
    throw new Error(`预设 '${target}' 不存在`);
  };

  // ---- Personas ------------------------------------------------------------
  const getPersonaRecords = () => ensureTavern().personas ?? [];
  const getPersonaNames = () => getPersonaRecords().map((persona) => String(persona.name ?? ""));
  const getPersonaIds = () => getPersonaRecords().map((persona) => String(persona.avatar_id ?? ""));
  const getCurrentPersonaId = () => ensureTavern().currentPersonaId || getPersonaIds()[0] || null;
  const findPersona = (id: unknown = "current") => {
    const requested = resolveTargetName(id, "current");
    const target = requested === "current" ? getCurrentPersonaId() : requested;
    const list = getPersonaRecords();
    return (
      list.find((persona) => persona.avatar_id === target) ??
      list.find((persona) => persona.name === target) ??
      null
    );
  };
  const getCurrentPersonaName = () => {
    const persona = findPersona("current");
    return persona ? String(persona.name ?? "") : null;
  };
  const getPersonaAvatarPath = (id: unknown = "current") => {
    const persona = findPersona(id);
    if (!persona) return null;
    const avatarId = String(persona.avatar_id ?? "");
    const avatar = ensureTavern().personaAvatars?.[avatarId] ?? persona.avatar;
    return typeof avatar === "string" && avatar ? avatar : null;
  };
  const getPersona = (id: unknown = "current") => {
    const persona = findPersona(id);
    if (!persona) throw new Error(`用户角色 '${resolveTargetName(id, "current")}' 不存在`);
    const cloned = clone(persona);
    const avatarId = String(cloned.avatar_id ?? "");
    if (!cloned.avatar && ensureTavern().personaAvatars?.[avatarId]) {
      cloned.avatar = ensureTavern().personaAvatars![avatarId];
    }
    return cloned;
  };

  // ---- Regexes & displayed messages ----------------------------------------
  const getTavernRegexes = (options: unknown = {}) => {
    const all = ensureTavern().regexes ?? [];
    const normalized = isRecord(options) ? options : {};
    if (typeof normalized.type === "string") {
      return clone(all.filter((regex) => regex.scope === normalized.type));
    }
    const scope = String(normalized.scope ?? "all");
    const enableState = String(normalized.enable_state ?? "all");
    return clone(
      all
        .filter((regex) => scope === "all" || regex.scope === scope)
        .filter((regex) => {
          if (enableState === "enabled") return regex.enabled !== false;
          if (enableState === "disabled") return regex.enabled === false;
          return true;
        }),
    );
  };
  const isCharacterTavernRegexesEnabled = () =>
    getTavernRegexes({ type: "character" }).length > 0;
  const formatAsTavernRegexedString = (
    value: unknown,
    source = "ai_output",
    destination = "display",
    options: unknown = {},
  ) => {
    const normalized = isRecord(options) ? options : {};
    const depth = Number(normalized.depth ?? 0) || 0;
    return getTavernRegexes({ scope: "all", enable_state: "enabled" }).reduce(
      (result, regex) => {
        const regexSource = isRecord(regex.source) ? regex.source : {};
        const regexDestination = isRecord(regex.destination) ? regex.destination : {};
        const hasDestination = regexDestination.display === true || regexDestination.prompt === true;
        if (regexSource[source] === false || (hasDestination && regexDestination[destination] === false)) {
          return result;
        }
        const minDepth = regex.min_depth == null ? null : Number(regex.min_depth);
        const maxDepth = regex.max_depth == null ? null : Number(regex.max_depth);
        if (minDepth !== null && depth < minDepth) return result;
        if (maxDepth !== null && depth > maxDepth) return result;
        try {
          const findRegex = String(regex.find_regex ?? "");
          const match = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(findRegex);
          const pattern = match ? new RegExp(match[1], match[2]) : new RegExp(findRegex, "g");
          return result.replace(pattern, String(regex.replace_string ?? ""));
        } catch {
          return result;
        }
      },
      substitudeMacros(value),
    );
  };
  const resolveDisplayedMessageId = (value: unknown) => {
    const count = snapshot.messages.length;
    if (value === "last" || value == null) return count - 1;
    if (value === "last_user") {
      for (let i = count - 1; i >= 0; i -= 1) {
        if (snapshot.messages[i].role === "user" && snapshot.messages[i].extra?.tavernIsSystem !== true) return i;
      }
      return count - 1;
    }
    if (value === "last_char") {
      for (let i = count - 1; i >= 0; i -= 1) {
        if (snapshot.messages[i].role === "assistant" && snapshot.messages[i].extra?.tavernIsSystem !== true) return i;
      }
      return count - 1;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return count - 1;
    return parsed < 0 ? count + parsed : parsed;
  };
  const formatAsDisplayedMessage = (text: unknown, options: unknown = {}) => {
    const source = isRecord(text) ? String(text.message ?? text.mes ?? text.content ?? "") : String(text ?? "");
    const messageId = resolveDisplayedMessageId(isRecord(options) ? options.message_id : undefined);
    const depth = Math.max(0, snapshot.messages.length - 1 - messageId);
    return formatAsTavernRegexedString(source, "ai_output", "display", { depth });
  };
  const retrieveDisplayedMessage = (messageId: unknown) => {
    const resolved = resolveDisplayedMessageId(messageId);
    const win = window as unknown as {
      __rengeTavernParent?: { document?: Document };
      jQuery?: (target: unknown) => { find(selector: string): unknown };
    };
    const rootDoc = win.__rengeTavernParent?.document ?? document;
    const selector = `[mesid="${resolved}"] .mes_text`;
    return typeof win.jQuery === "function"
      ? win.jQuery(rootDoc).find(selector)
      : rootDoc.querySelector(selector);
  };

  // ---- Audio (sync state mirror + host runtime playback) -------------------
  type AudioTrack = { title: string; url: string };
  type AudioState = {
    playlist: AudioTrack[];
    src: string;
    playing: boolean;
    enabled: boolean;
    mode: "repeat_one" | "repeat_all" | "shuffle" | "play_one_and_stop";
    muted: boolean;
    volume: number;
  };
  const audioChannels: Record<"bgm" | "ambient", AudioState> = {
    bgm: { playlist: [], src: "", playing: false, enabled: true, mode: "repeat_all", muted: false, volume: 50 },
    ambient: { playlist: [], src: "", playing: false, enabled: true, mode: "play_one_and_stop", muted: false, volume: 50 },
  };
  const getAudioChannel = (type: unknown) =>
    audioChannels[type === "ambient" ? "ambient" : "bgm"];
  const titleFromUrl = (url: string) => url.split("/").at(-1)?.split(".").at(0) || url;
  const toAudioTrack = (value: unknown): AudioTrack | null => {
    const url = (typeof value === "string" ? value : isRecord(value) ? String(value.url ?? value.src ?? "") : "").trim();
    if (!url) return null;
    const title = isRecord(value) && typeof value.title === "string" && value.title.trim() ? value.title : titleFromUrl(url);
    return { title, url };
  };
  const toAudioTracks = (values: unknown) =>
    (Array.isArray(values) ? values : [values]).map(toAudioTrack).filter((item): item is AudioTrack => Boolean(item));
  const playAudio = (type: unknown, audio: unknown) => {
    const channel = getAudioChannel(type);
    const track = toAudioTrack(audio);
    if (!track) return;
    const existing = channel.playlist.find((item) => item.title === track.title || item.url === track.url);
    if (existing) Object.assign(existing, track);
    else channel.playlist.push(track);
    channel.src = track.url;
    channel.playing = channel.enabled;
    void callTavernApi("playAudio", [type, audio]).catch(() => undefined);
  };
  const pauseAudio = (type: unknown) => {
    getAudioChannel(type).playing = false;
    void callTavernApi("pauseAudio", [type]).catch(() => undefined);
  };
  const getAudioList = (type: unknown) => clone(getAudioChannel(type).playlist);
  const replaceAudioList = (type: unknown, list: unknown) => {
    getAudioChannel(type).playlist = toAudioTracks(list);
    void callTavernApi("replaceAudioList", [type, list]).catch(() => undefined);
  };
  const appendAudioList = (type: unknown, list: unknown) => {
    const channel = getAudioChannel(type);
    toAudioTracks(list).forEach((track) => {
      if (!channel.playlist.some((item) => item.title === track.title || item.url === track.url)) {
        channel.playlist.push(track);
      }
    });
    void callTavernApi("appendAudioList", [type, list]).catch(() => undefined);
  };
  const getAudioSettings = (type: unknown) => {
    const { enabled, mode, muted, volume } = getAudioChannel(type);
    return { enabled, mode, muted, volume };
  };
  const setAudioSettings = (type: unknown, settings: unknown) => {
    const channel = getAudioChannel(type);
    if (isRecord(settings)) {
      if (typeof settings.enabled === "boolean") {
        channel.enabled = settings.enabled;
        if (!settings.enabled) channel.playing = false;
      }
      if (
        settings.mode === "repeat_one" ||
        settings.mode === "repeat_all" ||
        settings.mode === "shuffle" ||
        settings.mode === "play_one_and_stop"
      ) {
        channel.mode = settings.mode;
      }
      if (typeof settings.muted === "boolean") channel.muted = settings.muted;
      if (settings.volume !== undefined && Number.isFinite(Number(settings.volume))) {
        channel.volume = Math.min(100, Math.max(0, Number(settings.volume)));
      }
    }
    void callTavernApi("setAudioSettings", [type, settings]).catch(() => undefined);
  };
  const getCurrentAudio = (type: unknown) => {
    const channel = getAudioChannel(type);
    return {
      src: channel.src,
      title: channel.playlist.find((item) => item.url === channel.src)?.title ?? "",
      playing: channel.playing,
      progress: 0,
    };
  };
  const audioEnable = (args: unknown) => {
    if (!isRecord(args)) return "";
    setAudioSettings(args.type, { enabled: !/^(?:0|false|off|no)$/i.test(String(args.state ?? "true").trim()) });
    return "";
  };
  const audioPlay = (args: unknown) => {
    if (!isRecord(args)) return "";
    if (/^(?:0|false|off|no)$/i.test(String(args.play ?? "true").trim())) pauseAudio(args.type);
    else {
      const target = getCurrentAudio(args.type).src || getAudioList(args.type)[0]?.url;
      if (target) playAudio(args.type, target);
    }
    return "";
  };
  const audioMode = (args: unknown) => {
    if (!isRecord(args)) return "";
    const modeMap: Record<string, AudioState["mode"]> = {
      single: "repeat_one",
      repeat: "repeat_all",
      random: "shuffle",
      stop: "play_one_and_stop",
    };
    const mapped = modeMap[String(args.mode ?? "").trim().toLowerCase()];
    if (mapped) setAudioSettings(args.type, { mode: mapped });
    return "";
  };
  const audioImport = (args: unknown, url: unknown) => {
    const options = isRecord(args) ? args : {};
    const urls = String(url ?? options.url ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    if (urls.length === 0) return "";
    appendAudioList(options.type, urls);
    if (!/^(?:0|false|off|no)$/i.test(String(options.play ?? "true").trim())) playAudio(options.type, urls[0]);
    return "";
  };
  const audioSelect = (args: unknown, url: unknown) => {
    const options = isRecord(args) ? args : {};
    const target = String(url ?? options.url ?? "").trim();
    if (target) playAudio(options.type, target);
    return "";
  };

  // ---- Builtin, extension & global helpers ---------------------------------
  const parseRegexFromString = (input: unknown) => {
    const match = /^\/([\s\S]+)\/([a-z]*)$/i.exec(String(input ?? ""));
    if (!match) return null;
    try {
      return new RegExp(match[1], match[2]);
    } catch {
      return null;
    }
  };
  const promptManager = {
    messages: [] as unknown[],
    getPromptCollection: () => ({
      collection: (Array.isArray(getPreset("in_use").prompts) ? (getPreset("in_use").prompts as unknown[]) : [])
        .filter(isRecord)
        .map((prompt) => {
          const position = isRecord(prompt.position) ? prompt.position : {};
          const placeholder = isPresetPlaceholderPrompt(prompt);
          return {
            identifier: String(prompt.id ?? ""),
            name: String(prompt.name ?? ""),
            enabled: prompt.enabled !== false,
            injection_position: position.type === "in_chat" ? 1 : 0,
            injection_depth: Number(position.depth ?? 4),
            injection_order: Number(position.order ?? 100),
            role: String(prompt.role ?? "system"),
            content: String(prompt.content ?? ""),
            system_prompt: placeholder || isPresetSystemPrompt(prompt),
            marker: placeholder,
            ...(isRecord(prompt.extra) ? { extra: clone(prompt.extra) } : {}),
            forbid_overrides: false,
          };
        }),
    }),
    render: () => undefined,
    renderDebounced: () => undefined,
    saveServiceSettings: async () => {
      await callTavernApi("saveSettingsDebounced", []);
    },
  };
  const reloadChat = async () => {
    await callTavernApi("refreshOneMessage", []);
  };
  const builtin = {
    addOneMessage: () => undefined,
    copyText: (text: unknown) => {
      void navigator.clipboard?.writeText(String(text ?? "")).catch(() => undefined);
    },
    duringGenerating: () => Boolean(ensureTavern().isGenerating),
    getImageTokenCost: async (_dataUrl: unknown, quality: unknown = "auto") => (quality === "low" ? 85 : 765),
    getVideoTokenCost: async () => 0,
    parseRegexFromString,
    promptManager,
    reloadAndRenderChatWithoutEvents: reloadChat,
    reloadChatWithoutEvents: reloadChat,
    reloadEditor: () => undefined,
    reloadEditorDebounced: () => undefined,
    renderMarkdown: (text: unknown) => formatAsDisplayedMessage(text),
    renderPromptManager: () => undefined,
    renderPromptManagerDebounced: () => undefined,
    saveSettings: async () => {
      await callTavernApi("saveSettingsDebounced", []);
    },
    uuidv4: () => crypto.randomUUID(),
  };

  const TAVERN_HELPER_EXTENSION_ID = "JS-Slash-Runner";
  const isInstalledExtension = (extensionId: unknown) => {
    const id = String(extensionId ?? "").trim().replace(/^third-party\//, "");
    return id === TAVERN_HELPER_EXTENSION_ID || ensureTavern().installedExtensionIds.includes(id);
  };
  const getExtensionType = (extensionId: unknown) => (isInstalledExtension(extensionId) ? "local" : null);
  const initializeGlobal = (name: unknown, value: unknown) => {
    const key = String(name ?? "");
    if (!key) return;
    (window as unknown as Record<string, unknown>)[key] = value;
    void eventEmit(`global_${key}_initialized`);
  };

  // ---- Remote stubs + optimistic snapshot sync + frame-side updaters -------
  const remoteApi: Record<string, (...args: unknown[]) => unknown> = {};
  constants.remoteApiNames.forEach((name) => {
    remoteApi[name] = (...args: unknown[]) => callTavernApi(name, args);
  });

  remoteApi.createWorldbook = async (name: unknown, entries: unknown = []) => {
    const created = await callTavernApi("createWorldbook", [name, entries]);
    const trimmed = String(name ?? "").trim();
    if (created && trimmed && !ensureTavern().worldbookNames.includes(trimmed)) {
      ensureTavern().worldbookNames.push(trimmed);
    }
    return created;
  };
  remoteApi.createLorebook = (name: unknown) => remoteApi.createWorldbook(name, []);
  remoteApi.createOrReplaceWorldbook = async (name: unknown, entries: unknown = []) => {
    const created = await callTavernApi("createOrReplaceWorldbook", [name, entries]);
    const trimmed = String(name ?? "").trim();
    if (trimmed && !ensureTavern().worldbookNames.includes(trimmed)) {
      ensureTavern().worldbookNames.push(trimmed);
    }
    return created;
  };
  remoteApi.deleteWorldbook = async (name: unknown) => {
    const deleted = await callTavernApi("deleteWorldbook", [name]);
    const trimmed = String(name ?? "").trim();
    if (deleted && trimmed) {
      const tavern = ensureTavern();
      tavern.worldbookNames = tavern.worldbookNames.filter((item) => item !== trimmed);
      tavern.globalWorldbookNames = tavern.globalWorldbookNames.filter((item) => item !== trimmed);
      if (tavern.chatWorldbookName === trimmed) tavern.chatWorldbookName = null;
    }
    return deleted;
  };
  remoteApi.deleteLorebook = remoteApi.deleteWorldbook;
  remoteApi.rebindGlobalWorldbooks = async (names: unknown) => {
    const result = await callTavernApi("rebindGlobalWorldbooks", [names]);
    if (Array.isArray(names)) {
      const allowed = new Set(getWorldbookNames());
      ensureTavern().globalWorldbookNames = names.map(String).filter((item) => allowed.has(item));
    }
    return result;
  };
  remoteApi.rebindCharWorldbooks = async (character: unknown, bindings: unknown) => {
    const result = await callTavernApi("rebindCharWorldbooks", [character, bindings]);
    if (isRecord(bindings)) {
      if ("primary" in bindings) {
        ensureTavern().charWorldbookNames.primary =
          bindings.primary == null ? null : String(bindings.primary).trim() || null;
      }
      if (Array.isArray(bindings.additional)) {
        ensureTavern().charWorldbookNames.additional = bindings.additional.map(String);
      }
    }
    return result;
  };
  remoteApi.setCurrentCharLorebooks = (bindings: unknown) => remoteApi.rebindCharWorldbooks("current", bindings);
  remoteApi.rebindChatWorldbook = async (chat: unknown, name: unknown) => {
    const result = await callTavernApi("rebindChatWorldbook", [chat, name]);
    ensureTavern().chatWorldbookName = name == null ? null : String(name).trim() || null;
    return result;
  };
  remoteApi.setChatLorebook = (name: unknown) => remoteApi.rebindChatWorldbook("current", name);
  remoteApi.getOrCreateChatWorldbook = async (chatOrName: unknown = "current", requestedName?: unknown) => {
    const resolved = String(await callTavernApi("getOrCreateChatWorldbook", [chatOrName, requestedName]) ?? "");
    if (resolved) {
      const tavern = ensureTavern();
      tavern.chatWorldbookName = resolved;
      if (!tavern.worldbookNames.includes(resolved)) tavern.worldbookNames.push(resolved);
    }
    return resolved;
  };
  remoteApi.getOrCreateChatLorebook = (name?: unknown) => remoteApi.getOrCreateChatWorldbook("current", name);
  remoteApi.replaceTavernRegexes = async (regexes: unknown, options: unknown = {}) => {
    const result = await callTavernApi("replaceTavernRegexes", [regexes, options]);
    if (Array.isArray(regexes)) {
      const scope = isRecord(options) ? String(options.type ?? options.scope ?? "all") : "all";
      const current = ensureTavern().regexes ?? [];
      ensureTavern().regexes =
        scope === "all"
          ? clone(regexes.filter(isRecord))
          : [
              ...current.filter((item) => item.scope !== scope),
              ...clone(regexes.filter(isRecord)).map((item) => ({ ...item, scope })),
            ];
    }
    return result;
  };
  remoteApi.replacePreset = async (name: unknown, preset: unknown, options?: unknown) => {
    await callTavernApi("replacePreset", [name, preset, options]);
    const target = resolveTargetName(name, "in_use");
    if (isRecord(preset)) {
      if (target === "in_use") ensureTavern().inUsePreset = clone(preset);
      else {
        ensureTavern().namedPresets ??= {};
        ensureTavern().namedPresets![target] = clone(preset);
      }
    }
  };
  remoteApi.createPreset = async (name: unknown, preset: unknown = default_preset) => {
    const created = await callTavernApi("createPreset", [name, preset]);
    const target = String(name ?? "").trim();
    if (created && target && !ensureTavern().presetNames.includes(target)) {
      ensureTavern().presetNames.push(target);
      if (isRecord(preset)) {
        ensureTavern().namedPresets ??= {};
        ensureTavern().namedPresets![target] = clone(preset);
      }
    }
    return created;
  };
  remoteApi.createOrReplacePreset = async (name: unknown, preset: unknown = default_preset, options?: unknown) => {
    const created = await callTavernApi("createOrReplacePreset", [name, preset, options]);
    const target = resolveTargetName(name, "in_use");
    if (target !== "in_use" && !ensureTavern().presetNames.includes(target)) {
      ensureTavern().presetNames.push(target);
    }
    if (isRecord(preset)) {
      if (target === "in_use") ensureTavern().inUsePreset = clone(preset);
      else {
        ensureTavern().namedPresets ??= {};
        ensureTavern().namedPresets![target] = clone(preset);
      }
    }
    return created;
  };
  remoteApi.deletePreset = async (name: unknown) => {
    const deleted = await callTavernApi("deletePreset", [name]);
    const target = String(name ?? "").trim();
    if (deleted && target) {
      ensureTavern().presetNames = ensureTavern().presetNames.filter((item) => item !== target);
      delete ensureTavern().namedPresets?.[target];
    }
    return deleted;
  };
  remoteApi.renamePreset = async (name: unknown, newName: unknown) => {
    const renamed = await callTavernApi("renamePreset", [name, newName]);
    const from = String(name ?? "").trim();
    const to = String(newName ?? "").trim();
    if (renamed && from && to) {
      ensureTavern().presetNames = ensureTavern().presetNames.map((item) => (item === from ? to : item));
      if (ensureTavern().namedPresets?.[from]) {
        ensureTavern().namedPresets![to] = ensureTavern().namedPresets![from];
        delete ensureTavern().namedPresets![from];
      }
    }
    return renamed;
  };

  const remoteUpdater = (
    readCurrent: (...targetArgs: unknown[]) => Promise<unknown> | unknown,
    writeUpdated: (...writeArgs: unknown[]) => Promise<unknown>,
    argCount: number,
  ) => async (...args: unknown[]) => {
    const target = args.slice(0, argCount);
    const updater = args[argCount];
    const rest = args.slice(argCount + 1);
    const current = await readCurrent(...target, ...rest);
    const updated = typeof updater === "function" ? await updater(clone(current)) : current;
    const nextValue = updated ?? current;
    await writeUpdated(...target, nextValue, ...rest);
    return await readCurrent(...target, ...rest);
  };

  const updateWorldbookWith = remoteUpdater(
    (name) => callTavernApi("getWorldbook", [name]),
    (name, value, options) => callTavernApi("replaceWorldbook", [name, value, options]),
    1,
  );
  const updateLorebookEntriesWith = remoteUpdater(
    (name) => callTavernApi("getLorebookEntries", [name]),
    (name, value) => callTavernApi("replaceLorebookEntries", [name, value]),
    1,
  );
  const updateCharacterWith = remoteUpdater(
    (name) => callTavernApi("getCharacter", [name]),
    (name, value, options) => callTavernApi("replaceCharacter", [name, value, options]),
    1,
  );
  const updatePresetWith = remoteUpdater(
    (name) => getPreset(name),
    (name, value, options) => remoteApi.replacePreset(name, value, options) as Promise<unknown>,
    1,
  );
  const setPreset = async (name: unknown, patchValue: unknown, options?: unknown) =>
    await updatePresetWith(
      name,
      (current: Record<string, unknown>) => {
        const patch = isRecord(patchValue) ? patchValue : {};
        return {
          settings: mergeRecords(
            isRecord(current.settings) ? current.settings : {},
            isRecord(patch.settings) ? patch.settings : {},
          ),
          prompts: patch.prompts ?? current.prompts,
          prompts_unused: patch.prompts_unused ?? current.prompts_unused,
          extensions: mergeRecords(
            isRecord(current.extensions) ? current.extensions : {},
            isRecord(patch.extensions) ? patch.extensions : {},
          ),
        };
      },
      options,
    );
  const updatePersonaWith = remoteUpdater(
    (id) => getPersona(id),
    async (id, value, options) => {
      await callTavernApi("replacePersona", [id, value, options]);
      const target = findPersona(id);
      if (target && isRecord(value)) Object.assign(target, clone(value));
    },
    1,
  );
  const updateTavernRegexesWith = remoteUpdater(
    (options) => getTavernRegexes(options),
    (value, options) => remoteApi.replaceTavernRegexes(value, options) as Promise<unknown>,
    0,
  );

  const eventSource = {
    on: eventOn,
    off: eventRemoveListener,
    once: eventOnce,
    emit: eventEmit,
    emitAndWait: eventEmitAndWait,
    removeListener: eventRemoveListener,
    makeFirst: eventMakeFirst,
    makeLast: eventMakeLast,
    clearEvent: eventClearEvent,
    clearListener: eventClearListener,
    clearAll: eventClearAll,
  };

  const versionInfo = {
    agent: "Renge",
    pkgVersion: constants.sillyTavernVersion,
    gitRevision: "renge-compat",
    gitBranch: "main",
  };

  const api = {
    ...remoteApi,
    // Events
    tavern_events: clone(constants.tavernEvents),
    iframe_events: clone(constants.iframeEvents),
    eventOn,
    eventOnce,
    eventMakeFirst,
    eventMakeLast,
    eventOnButton,
    eventOff: eventRemoveListener,
    eventRemoveListener,
    eventClearEvent,
    eventClearListener,
    eventClearAll,
    eventEmit,
    eventEmitAndWait,
    eventSource,
    // Worldbooks & Lorebooks
    getWorldbookNames,
    getGlobalWorldbookNames,
    getCharWorldbookNames,
    getChatWorldbookName,
    getLorebooks,
    getCharLorebooks,
    getCurrentCharPrimaryLorebook,
    getChatLorebook,
    getLorebookSettings,
    setLorebookSettings,
    updateWorldbookWith,
    updateLorebookEntriesWith,
    // Characters & RawCharacter
    getCharacterNames,
    getCharacterIds,
    getCurrentCharacterName,
    getCurrentCharacterId,
    getCharAvatarPath,
    getCharData,
    RawCharacter,
    updateCharacterWith,
    // Presets
    default_preset,
    isPresetNormalPrompt,
    isPresetSystemPrompt,
    isPresetPlaceholderPrompt,
    builtin_prompt_default_order: [...constants.builtinPromptDefaultOrder],
    placeholder_prompt_default_order: [...constants.builtinPromptDefaultOrder],
    getProxyPresetNames: () => [] as string[],
    getPresetNames,
    getLoadedPresetName,
    loadPreset,
    getPreset,
    updatePresetWith,
    setPreset,
    // Personas
    getPersonaNames,
    getPersonaIds,
    getCurrentPersonaName,
    getCurrentPersonaId,
    getPersonaAvatarPath,
    getPersona,
    updatePersonaWith,
    // Regexes & displayed messages
    getTavernRegexes,
    isCharacterTavernRegexesEnabled,
    formatAsTavernRegexedString,
    updateTavernRegexesWith,
    formatAsDisplayedMessage,
    retrieveDisplayedMessage,
    // Macros, global, builtin, extensions
    registerMacroLike,
    unregisterMacroLike,
    substitudeMacros,
    initializeGlobal,
    builtin,
    isAdmin: () => true,
    getTavernHelperExtensionId: () => TAVERN_HELPER_EXTENSION_ID,
    getExtensionType,
    isInstalledExtension,
    // Audio
    playAudio,
    pauseAudio,
    getAudioList,
    replaceAudioList,
    appendAudioList,
    getAudioSettings,
    setAudioSettings,
    getCurrentAudio,
    audioEnable,
    audioPlay,
    audioMode,
    audioImport,
    audioSelect,
    // Script & iframe util
    getIframeName,
    getMessageId,
    getScriptId,
    getScriptName,
    getScriptInfo,
    replaceScriptInfo,
    getScriptButtons,
    replaceScriptButtons,
    updateScriptButtonsWith,
    appendInexistentScriptButtons,
    getButtonEvent,
    reloadIframe,
    // Versions
    getTavernHelperVersion: () => constants.tavernHelperVersion,
    getFrontendVersion: () => constants.tavernHelperVersion,
    getTavernVersion: () => constants.sillyTavernVersion,
    getVersion: () => clone(versionInfo),
  };

  return {
    api,
    eventSource,
    versionInfo,
    deliverHostEvent,
    hasEventListeners: (eventName: unknown) =>
      (handlersByEvent.get(normalizeEventName(eventName))?.length ?? 0) > 0,
    substitudeMacros,
    getCharactersForContext: () => {
      const current = getCharData("current");
      const names = getCharacterNames();
      const ids = getCharacterIds();
      const others = names
        .map((name, index) => ({ name, avatar: ids[index] ?? `${name}.png`, data: { name } }))
        .filter((entry) => entry.name !== current?.name);
      return current ? [current, ...others] : others;
    },
  };
}

export const HTML_PREVIEW_TAVERN_HELPER_API_SOURCE =
  `((__name) => (${installHtmlPreviewTavernHelperApi.toString().replace(/<\/script/gi, "<\\/script")}))((target, value) => Object.defineProperty(target, "name", { value, configurable: true }))`;
