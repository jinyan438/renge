import type { TavernScript, TavernScriptButton } from "./tavernScriptUtils";
import { isTavernScriptEnabled } from "./tavernScriptUtils";
import { createTavernScriptExports } from "./tavernScriptExports";
import { createTavernScriptTreeApi, type TavernScriptScope, type TavernScriptTree } from "./tavernScriptTreeUtils";
import {
  attachTavernSubscriptionControls,
  createTavernMacroRegistry,
  createTavernErrorCatched,
  installLegacyTavernSendControls,
  installTavernPresetManagerControls,
  normalizeTavernSetChatMessageUpdate,
  proxyTavernModuleUrl,
  proxyTavernModuleUrls,
  resolveTavernCreateMessageInsertionIndex,
  resolveTavernButtonOwnerId,
  resolveTavernCallerScriptId,
  type TavernCompatibilityErrorReporter,
  type TavernPresetManagerAdapter,
} from "./tavernCompatibilityUtils";
import fontAwesomeCss from "@fortawesome/fontawesome-free/css/all.min.css?raw";
import fontAwesomeBrandsUrl from "@fortawesome/fontawesome-free/webfonts/fa-brands-400.woff2?url";
import fontAwesomeRegularUrl from "@fortawesome/fontawesome-free/webfonts/fa-regular-400.woff2?url";
import fontAwesomeSolidUrl from "@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2?url";
import fontAwesomeV4CompatibilityUrl from "@fortawesome/fontawesome-free/webfonts/fa-v4compatibility.woff2?url";
import {
  scopeTavernClassicScript,
  usesTavernModuleSyntax,
} from "./tavernScriptModuleUtils";
import { initializeTavernMvuMessages } from "./tavernMvuInitUtils";
import {
  getTavernGreetingSwipeIndex,
  getTavernMessageSwipeState,
  type TavernGreetingState,
} from "./tavernGreetingUtils";
import {
  SILLYTAVERN_VERSION,
  TAVERN_BUILTIN_PROMPT_DEFAULT_ORDER,
  TAVERN_EVENT_TYPES,
  TAVERN_HELPER_IFRAME_EVENTS,
  TAVERN_HELPER_VERSION,
  TAVERN_MESSAGE_ID_EVENTS,
  assignTavernWorldbookUids,
  createTavernHelperDefaultPreset,
  formatSillyTavernWorldInfoEntry,
  formatTavernHelperLorebookEntry,
  formatTavernHelperWorldbookEntry,
  isPresetNormalPrompt,
  isPresetPlaceholderPrompt,
  isPresetSystemPrompt,
  normalizeTavernEventName,
  readTavernHelperWorldbookEntry,
  resolveTavernMessageRange,
  rotateTavernMessages,
} from "./tavernHelperCompat";
import type { TavernHelperHostServices, TavernHelperSaveMode } from "./tavernHelperHostServices";

export type TavernRuntimeMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  variables?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  source?: string;
  aiIdentity?: Record<string, unknown>;
};

export type TavernRuntimeWorldBookEntry = {
  extra?: Record<string, unknown>;
  id: string;
  uid: string;
  comment: string;
  content: string;
  enabled: boolean;
  keys: string[];
  secondaryKeys: string[];
  constant: boolean;
  selective: boolean;
  selectiveLogic: number;
  position:
    | "before_char"
    | "after_char"
    | "before_examples"
    | "after_examples"
    | "before_an"
    | "after_an"
    | "at_depth";
  depth: number;
  scanDepth: number | null;
  order: number;
  probability: number;
  useProbability: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useRegex: boolean;
};

export type TavernRuntimeWorldBook = {
  id: string;
  name: string;
  description: string;
  entries: TavernRuntimeWorldBookEntry[];
  scope: "global" | "character";
  active: boolean;
  sourceFormat?: "renge" | "sillytavern";
  sourceFileName?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type TavernRuntimeCharacter = {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  messageExample: string;
  avatarDataUrl: string;
  extensions: Record<string, unknown>;
  worldBook: TavernRuntimeWorldBook | null;
  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  alternateGreetings?: string[];
  tags?: string[];
  creator?: string;
  characterVersion?: string;
};

export type TavernRuntimeButton = TavernScriptButton & {
  scriptId: string;
  scriptName: string;
};

export type TavernRuntimeLog = {
  id: string;
  level: "log" | "info" | "warn" | "error";
  scriptId: string;
  scriptName: string;
  message: string;
  createdAt: string;
};

export type TavernRuntimeStatus = {
  state: "idle" | "loading" | "ready" | "error";
  message: string;
};

export type TavernRuntimePresetPrompt = {
  identifier: string;
  name: string;
  content: string;
  enabled: boolean;
};

export type TavernRuntimePresetState = {
  prompts: TavernRuntimePresetPrompt[];
  topP: number;
  customIncludeBody: string;
  customExcludeBody: string;
};

export type TavernRuntimeAudioType = "bgm" | "ambient";

export type TavernScriptRuntimeOptions = {
  /**
   * Installs the Tavern Helper API without running scripts, loading remote
   * dependencies or touching host globals. Message iframes use this runtime
   * through `callApi` when a card ships no scripts of its own.
   */
  apiOnly?: boolean;
};

export type TavernScriptRuntimeAdapter = Partial<TavernHelperHostServices> & {
  /** Renders message text the way the chat displays it (markdown + regex). */
  formatDisplayedMessage?(text: string, messageId: number): string;
  /** Persona description sent to the model for the active user profile. */
  getPersonaDescription?(): string;
  /** Other chats of a character, newest first. */
  getChatHistory?(characterName: string): Array<Record<string, unknown>>;
  /** Clears the session override so the card-level worldbook binding applies. */
  resetCharacterWorldBookBinding?(): void;
  /** Ids (folder names) of the extensions installed in the app. */
  getInstalledExtensionIds?(): string[];
  /** Called for every event card code emits, so message iframes receive it too. */
  onScriptEvent?(eventName: string, args: unknown[]): void;
  /** Rebuilds the rendered chat after scripts changed it behind the UI. */
  reloadChat?(): void | Promise<void>;
  /** Imports a raw SillyTavern file the way the matching import dialog does. */
  importRawFile?(
    kind: "character" | "chat" | "preset" | "worldbook",
    fileName: string,
    content: string | Blob,
  ): boolean | Promise<boolean>;
  getMessages(): TavernRuntimeMessage[];
  setMessages(messages: TavernRuntimeMessage[]): void;
  getGreetingState?(): TavernGreetingState;
  selectGreeting?(index: number): boolean | Promise<boolean>;
  getChatVariables(): Record<string, unknown>;
  setChatVariables(variables: Record<string, unknown>): void;
  getCharacterVariables(): Record<string, unknown>;
  setCharacterVariables(variables: Record<string, unknown>): void;
  getGlobalVariables(): Record<string, unknown>;
  setGlobalVariables(variables: Record<string, unknown>): void;
  getPresetVariables?(): Record<string, unknown>;
  setPresetVariables?(variables: Record<string, unknown>): void;
  getExtensionSettings?(): Record<string, unknown>;
  setExtensionSettings?(settings: Record<string, unknown>): void | Promise<void>;
  flushPersistence?(): Promise<void>;
  getChatMetadata?(): Record<string, unknown>;
  setChatMetadata?(metadata: Record<string, unknown>): void;
  getScriptData(scriptId: string): Record<string, unknown>;
  setScriptData(scriptId: string, data: Record<string, unknown>): void;
  getScriptTrees?(scope: TavernScriptScope): TavernScriptTree[];
  replaceScriptTrees?(trees: TavernScriptTree[], scope: TavernScriptScope): void;
  getCharacter(): TavernRuntimeCharacter | null;
  getCharacterSummaries?(): Array<{ id: string; name: string; avatarDataUrl: string }>;
  getWorldBooks(): TavernRuntimeWorldBook[];
  setWorldBook(worldBook: TavernRuntimeWorldBook): void;
  deleteWorldBook?(identifier: string): void;
  setActiveWorldBookNames?(names: string[]): void;
  getRegexes(): Array<Record<string, unknown>>;
  setRegexes(regexes: Array<Record<string, unknown>>): void;
  getUserName(): string;
  getChatId(): string;
  isChatMounted?(): boolean;
  getModelId?(): string;
  getPresetNames?(): string[];
  loadPreset?(name: string): boolean;
  getPresetState?(): TavernRuntimePresetState | null;
  setPresetPromptEnabled?(identifier: string, enabled: boolean): void;
  setPresetTopP?(value: number): void;
  savePresetSettings?(settings: TavernRuntimePresetState): void;
  getInput?(): string;
  setInput?(value: string): unknown;
  appendInput?(value: string): unknown;
  sendMessage?(value?: string): Promise<unknown> | unknown;
  triggerSlash?(command: string): Promise<unknown> | unknown;
  generate?(config?: unknown): Promise<string>;
  stopGeneration?(): Promise<unknown> | unknown;
  isGenerating?(): boolean;
  onButtonsChange?(buttons: TavernRuntimeButton[]): void;
  onLog?(log: TavernRuntimeLog): void;
  onStatus?(status: TavernRuntimeStatus): void;
  onNotice?(
    level: "success" | "info" | "warning" | "error",
    message: string,
    title?: string,
  ): void;
};

type RuntimeWindow = Window &
  typeof globalThis &
  Record<string, unknown> & {
    $?: unknown;
    jQuery?: unknown;
    _?: unknown;
    Vue?: unknown;
    z?: unknown;
    YAML?: unknown;
  };

type VariableOption = {
  type?: string;
  message_id?: number | string;
  script_id?: string;
  extension_id?: string;
};

type RuntimeEventHandler = {
  callback: (...args: unknown[]) => unknown;
  scriptId: string;
  priority: -1 | 0 | 1;
  sequence: number;
};

// SillyTavern's real event names, so card code that hardcodes a string such as
// "chat_id_changed" matches. Names older Renge builds used keep working
// through normalizeTavernEventName.
const TAVERN_EVENTS = TAVERN_EVENT_TYPES;

const TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY = "__sillytavern_extension_settings__";

const JQUERY_SOURCES = [
  "https://testingcf.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js",
  "https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js",
  "https://unpkg.com/jquery@3.7.1/dist/jquery.min.js",
];

const LODASH_SOURCES = [
  "https://testingcf.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js",
  "https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js",
  "https://unpkg.com/lodash@4.17.21/lodash.min.js",
];

const VUE_SOURCES = [
  "https://testingcf.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js",
  "https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js",
  "https://unpkg.com/vue@3.5.13/dist/vue.global.prod.js",
];

const VUE_ESM_BUNDLER_FEATURE_FLAGS = Object.freeze({
  __VUE_OPTIONS_API__: true,
  __VUE_PROD_DEVTOOLS__: false,
  __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
});

const ZOD_SOURCES = [
  "https://testingcf.jsdelivr.net/npm/zod@4.1.5/+esm",
  "https://cdn.jsdelivr.net/npm/zod@4.1.5/+esm",
];

const YAML_SOURCES = [
  "https://testingcf.jsdelivr.net/npm/yaml@2.8.1/+esm",
  "https://cdn.jsdelivr.net/npm/yaml@2.8.1/+esm",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function installVueEsmBundlerFeatureFlags(targetWindow: RuntimeWindow) {
  Object.entries(VUE_ESM_BUNDLER_FEATURE_FLAGS).forEach(([name, value]) => {
    if (name in targetWindow) return;
    Object.defineProperty(targetWindow, name, {
      value,
      configurable: true,
      enumerable: false,
      writable: true,
    });
  });
}

function buildZodGlobal(zodModule: Record<string, unknown>) {
  const zodApi = isRecord(zodModule.z)
    ? zodModule.z
    : isRecord(zodModule.default)
      ? zodModule.default
      : zodModule;

  // Tavern scripts use both the normal `z.object()` API and the Zod 4
  // module namespace shape (`z.z.ZodObject`). Keep both views available.
  return {
    ...zodModule,
    ...zodApi,
    default: zodApi,
    z: zodApi,
  };
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall back to JSON for values crossing the iframe boundary.
    }
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        valuesEqual(left[key], right[key]),
    )
  );
}

// Tavern scripts often inject full modules into `parent.document`. Removing the
// sandbox iframe alone leaves their observers, timers and document listeners alive,
// so every runtime rebuild would stack another copy. Attribute parent-side work by
// sourceURL and tear it down as one lifecycle unit.
function installParentSideEffectTracker(
  hostWindow: Window,
  getCurrentScriptId: () => string,
) {
  const hostGlobal = hostWindow as Window & typeof globalThis;
  const hostDocument = hostWindow.document;
  const runtimeToken = crypto.randomUUID();
  const sourcePrefix = `renge-tavern-parent-${runtimeToken}`;
  const existingWindowGlobals = new Set(Object.getOwnPropertyNames(hostWindow));
  const existingDocumentGlobals = new Set(Object.getOwnPropertyNames(hostDocument));
  const protectedAppRoot = hostDocument.getElementById("root");
  const baselineNodes = new WeakSet<Node>([
    hostDocument,
    hostDocument.documentElement,
    hostDocument.head,
    hostDocument.body,
    ...Array.from(hostDocument.querySelectorAll("*")),
  ]);
  const ownedNodes = new Set<Node>();
  const trackedTimeouts = new Set<number>();
  const trackedIntervals = new Set<number>();
  const trackedAnimationFrames = new Set<number>();
  const trackedObservers = new Set<{ disconnect(): void }>();
  const trackedEventListeners: Array<{
    target: EventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
  }> = [];
  const restoreCallbacks: Array<() => void> = [];
  let active = true;

  const isTavernCall = () => {
    const stack = String(new Error().stack ?? "");
    if (stack.includes(sourcePrefix) || /renge-tavern-script-/i.test(stack)) return true;
    // Static and dynamic imports retain their CDN URL instead of Renge's sourceURL.
    // Treat cross-origin renderer stacks as Tavern-owned while same-origin React
    // work remains outside this lifecycle tracker.
    const externalUrls = Array.from(stack.matchAll(/https?:\/\/[^\s)]+/g), (match) => match[0]);
    return externalUrls.some((value) => {
      try {
        return new URL(value).origin !== hostWindow.location.origin;
      } catch {
        return false;
      }
    });
  };

  const isProtectedTree = (node: Node | null) =>
    // Lifecycle cleanup must never claim or remove the app's React tree.
    Boolean(
      protectedAppRoot &&
        node &&
        (node === protectedAppRoot ||
          protectedAppRoot.contains(node) ||
          (node instanceof hostGlobal.Element && node.contains(protectedAppRoot))),
    );

  const isMessageContentTarget = (node: Node, replaceContents: boolean) => {
    const element = node instanceof hostGlobal.Element ? node : node.parentElement;
    const messageText = element?.closest(".mes_text");
    return Boolean(
      messageText &&
      protectedAppRoot?.contains(messageText) &&
      messageText.closest("#chat .chat-message.mes") &&
      !messageText.closest(".chat-inline-editor") &&
      (replaceContents || node !== messageText),
    );
  };

  const assertTavernMutationAllowed = (
    node: Node,
    operation: string,
    replaceContents = false,
  ) => {
    // Card decorators legitimately clear and rebuild paragraph children. The
    // message renderer remounts that DOM when its content changes. Protect the
    // message container and app chrome, while allowing edits inside the body.
    if (!isProtectedTree(node) || isMessageContentTarget(node, replaceContents)) return;
    // A successful-looking no-op traps `while (node.firstChild) removeChild(...)`
    // in an infinite loop. Report rejected mutations instead of pretending that
    // the requested removal/replacement happened.
    throw new hostGlobal.DOMException(
      `Tavern scripts cannot ${operation} protected app UI outside message content.`,
      "NoModificationAllowedError",
    );
  };

  const isProtectedParent = (node: Node) =>
    Boolean(protectedAppRoot && (node === protectedAppRoot || protectedAppRoot.contains(node)));

  const hasOwnedAncestor = (node: Node | null) => {
    let cursor = node;
    while (cursor) {
      if (ownedNodes.has(cursor)) return true;
      cursor = cursor.parentNode;
    }
    return false;
  };

  const trackOwnedTree = (node: Node) => {
    if (node instanceof hostGlobal.DocumentFragment) {
      Array.from(node.childNodes).forEach(trackOwnedTree);
      return;
    }
    if (
      node.ownerDocument !== hostDocument ||
      baselineNodes.has(node) ||
      isProtectedTree(node)
    ) {
      return;
    }
    ownedNodes.add(node);
    if (node instanceof hostGlobal.Element) {
      node.setAttribute("data-renge-tavern-parent-owner", runtimeToken);
    }
  };

  const eventTargetPrototype = hostGlobal.EventTarget.prototype;
  const originalAddEventListener = eventTargetPrototype.addEventListener;
  const originalRemoveEventListener = eventTargetPrototype.removeEventListener;
  const trackedAddEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (active && listener && isTavernCall()) {
      trackedEventListeners.push({ target: this, type, listener, options });
    }
    return originalAddEventListener.call(this, type, listener, options);
  };
  eventTargetPrototype.addEventListener = trackedAddEventListener;
  restoreCallbacks.push(() => {
    if (eventTargetPrototype.addEventListener === trackedAddEventListener) {
      eventTargetPrototype.addEventListener = originalAddEventListener;
    }
  });

  const nodePrototype = hostGlobal.Node.prototype;
  const originalAppendChild = nodePrototype.appendChild;
  const trackedAppendChild = function <T extends Node>(this: Node, node: T): T {
    if (
      active &&
      isTavernCall() &&
      !isProtectedParent(this) &&
      !hasOwnedAncestor(this)
    ) {
      trackOwnedTree(node);
      const scriptNode = node as unknown as HTMLScriptElement;
      if (
        node instanceof hostGlobal.HTMLScriptElement &&
        !scriptNode.src &&
        !String(scriptNode.textContent ?? "").includes(sourcePrefix)
      ) {
        const scriptId = encodeURIComponent(getCurrentScriptId() || "runtime");
        scriptNode.textContent = `${scriptNode.textContent ?? ""}\n//# sourceURL=${sourcePrefix}-${scriptId}.mjs`;
        scriptNode.dataset.rengeTavernParentScript = runtimeToken;
      }
    }
    return originalAppendChild.call(this, node) as T;
  };
  nodePrototype.appendChild = trackedAppendChild;
  restoreCallbacks.push(() => {
    if (nodePrototype.appendChild === trackedAppendChild) {
      nodePrototype.appendChild = originalAppendChild;
    }
  });

  const originalInsertBefore = nodePrototype.insertBefore;
  const trackedInsertBefore = function <T extends Node>(
    this: Node,
    node: T,
    child: Node | null,
  ): T {
    if (
      active &&
      isTavernCall() &&
      !isProtectedParent(this) &&
      !hasOwnedAncestor(this)
    ) {
      trackOwnedTree(node);
    }
    return originalInsertBefore.call(this, node, child) as T;
  };
  nodePrototype.insertBefore = trackedInsertBefore;
  restoreCallbacks.push(() => {
    if (nodePrototype.insertBefore === trackedInsertBefore) {
      nodePrototype.insertBefore = originalInsertBefore;
    }
  });

  const originalRemoveChild = nodePrototype.removeChild;
  const trackedRemoveChild = function <T extends Node>(this: Node, child: T): T {
    if (active && isTavernCall()) assertTavernMutationAllowed(child, "removeChild");
    const removed = originalRemoveChild.call(this, child) as T;
    ownedNodes.delete(child);
    return removed;
  };
  nodePrototype.removeChild = trackedRemoveChild;
  restoreCallbacks.push(() => {
    if (nodePrototype.removeChild === trackedRemoveChild) {
      nodePrototype.removeChild = originalRemoveChild;
    }
  });

  const originalReplaceChild = nodePrototype.replaceChild;
  const trackedReplaceChild = function <T extends Node>(
    this: Node,
    node: Node,
    child: T,
  ): T {
    if (active && isTavernCall()) {
      assertTavernMutationAllowed(child, "replaceChild");
      if (!isProtectedParent(this) && !hasOwnedAncestor(this)) trackOwnedTree(node);
    }
    const replaced = originalReplaceChild.call(this, node, child) as T;
    ownedNodes.delete(child);
    return replaced;
  };
  nodePrototype.replaceChild = trackedReplaceChild;
  restoreCallbacks.push(() => {
    if (nodePrototype.replaceChild === trackedReplaceChild) {
      nodePrototype.replaceChild = originalReplaceChild;
    }
  });

  const elementPrototype = hostGlobal.Element.prototype;
  const originalRemove = elementPrototype.remove;
  const trackedRemove = function (this: Element) {
    if (active && isTavernCall()) assertTavernMutationAllowed(this, "remove");
    const result = originalRemove.call(this);
    ownedNodes.delete(this);
    return result;
  };
  elementPrototype.remove = trackedRemove;
  restoreCallbacks.push(() => {
    if (elementPrototype.remove === trackedRemove) elementPrototype.remove = originalRemove;
  });

  const originalReplaceWith = elementPrototype.replaceWith;
  const trackedReplaceWith = function (this: Element, ...nodes: Array<Node | string>) {
    if (active && isTavernCall()) {
      assertTavernMutationAllowed(this, "replaceWith");
      if (
        !isProtectedParent(this.parentNode ?? hostDocument) &&
        !hasOwnedAncestor(this.parentNode)
      ) {
        nodes.forEach((node) => {
          if (node instanceof hostGlobal.Node) trackOwnedTree(node);
        });
      }
    }
    const result = originalReplaceWith.call(this, ...nodes);
    ownedNodes.delete(this);
    return result;
  };
  elementPrototype.replaceWith = trackedReplaceWith;
  restoreCallbacks.push(() => {
    if (elementPrototype.replaceWith === trackedReplaceWith) {
      elementPrototype.replaceWith = originalReplaceWith;
    }
  });

  const originalReplaceChildren = elementPrototype.replaceChildren;
  const trackedReplaceChildren = function (this: Element, ...nodes: Array<Node | string>) {
    if (active && isTavernCall()) {
      assertTavernMutationAllowed(this, "replaceChildren", true);
      if (!hasOwnedAncestor(this)) {
        nodes.forEach((node) => {
          if (node instanceof hostGlobal.Node) trackOwnedTree(node);
        });
      }
    }
    return originalReplaceChildren.call(this, ...nodes);
  };
  elementPrototype.replaceChildren = trackedReplaceChildren;
  restoreCallbacks.push(() => {
    if (elementPrototype.replaceChildren === trackedReplaceChildren) {
      elementPrototype.replaceChildren = originalReplaceChildren;
    }
  });

  const protectDestructiveSetter = (prototype: object, property: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (!descriptor?.set) return;
    const originalSetter = descriptor.set;
    const guardedSetter = function (this: Node, value: unknown) {
      if (active && isTavernCall()) {
        assertTavernMutationAllowed(this, property, property !== "outerHTML");
      }
      originalSetter.call(this, value);
    };
    Object.defineProperty(prototype, property, {
      ...descriptor,
      set: guardedSetter,
    });
    restoreCallbacks.push(() => {
      const current = Object.getOwnPropertyDescriptor(prototype, property);
      if (current?.set === guardedSetter) Object.defineProperty(prototype, property, descriptor);
    });
  };
  protectDestructiveSetter(nodePrototype, "textContent");
  protectDestructiveSetter(elementPrototype, "innerHTML");
  protectDestructiveSetter(elementPrototype, "outerHTML");

  const originalSetTimeout = hostWindow.setTimeout;
  const originalClearTimeout = hostWindow.clearTimeout;
  const originalSetInterval = hostWindow.setInterval;
  const originalClearInterval = hostWindow.clearInterval;
  const trackedSetTimeout = ((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    if (!active || !isTavernCall() || typeof handler !== "function") {
      return originalSetTimeout(handler, timeout, ...args);
    }
    let timerId = 0;
    timerId = originalSetTimeout(
      (...callbackArgs: unknown[]) => {
        trackedTimeouts.delete(timerId);
        return handler(...callbackArgs);
      },
      timeout,
      ...args,
    );
    trackedTimeouts.add(timerId);
    return timerId;
  }) as typeof hostWindow.setTimeout;
  const trackedClearTimeout = ((timerId?: number) => {
    if (typeof timerId === "number") {
      trackedTimeouts.delete(timerId);
      trackedIntervals.delete(timerId);
    }
    return originalClearTimeout(timerId);
  }) as typeof hostWindow.clearTimeout;
  const trackedSetInterval = ((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    const timerId = originalSetInterval(handler, timeout, ...args);
    if (active && isTavernCall()) trackedIntervals.add(timerId);
    return timerId;
  }) as typeof hostWindow.setInterval;
  const trackedClearInterval = ((timerId?: number) => {
    if (typeof timerId === "number") {
      trackedIntervals.delete(timerId);
      trackedTimeouts.delete(timerId);
    }
    return originalClearInterval(timerId);
  }) as typeof hostWindow.clearInterval;
  hostWindow.setTimeout = trackedSetTimeout;
  hostWindow.clearTimeout = trackedClearTimeout;
  hostWindow.setInterval = trackedSetInterval;
  hostWindow.clearInterval = trackedClearInterval;
  restoreCallbacks.push(() => {
    if (hostWindow.setTimeout === trackedSetTimeout) hostWindow.setTimeout = originalSetTimeout;
    if (hostWindow.clearTimeout === trackedClearTimeout) {
      hostWindow.clearTimeout = originalClearTimeout;
    }
    if (hostWindow.setInterval === trackedSetInterval) hostWindow.setInterval = originalSetInterval;
    if (hostWindow.clearInterval === trackedClearInterval) {
      hostWindow.clearInterval = originalClearInterval;
    }
  });

  const originalRequestAnimationFrame = hostWindow.requestAnimationFrame;
  const originalCancelAnimationFrame = hostWindow.cancelAnimationFrame;
  if (typeof originalRequestAnimationFrame === "function") {
    const trackedRequestAnimationFrame = ((callback: FrameRequestCallback) => {
      if (!active || !isTavernCall()) return originalRequestAnimationFrame(callback);
      let frameId = 0;
      frameId = originalRequestAnimationFrame((timestamp) => {
        trackedAnimationFrames.delete(frameId);
        callback(timestamp);
      });
      trackedAnimationFrames.add(frameId);
      return frameId;
    }) as typeof hostWindow.requestAnimationFrame;
    const trackedCancelAnimationFrame = ((frameId: number) => {
      trackedAnimationFrames.delete(frameId);
      return originalCancelAnimationFrame(frameId);
    }) as typeof hostWindow.cancelAnimationFrame;
    hostWindow.requestAnimationFrame = trackedRequestAnimationFrame;
    hostWindow.cancelAnimationFrame = trackedCancelAnimationFrame;
    restoreCallbacks.push(() => {
      if (hostWindow.requestAnimationFrame === trackedRequestAnimationFrame) {
        hostWindow.requestAnimationFrame = originalRequestAnimationFrame;
      }
      if (hostWindow.cancelAnimationFrame === trackedCancelAnimationFrame) {
        hostWindow.cancelAnimationFrame = originalCancelAnimationFrame;
      }
    });
  }

  const hostRecord = hostWindow as unknown as Record<string, unknown>;
  ["MutationObserver", "ResizeObserver", "IntersectionObserver"].forEach((name) => {
    const OriginalObserver = hostRecord[name];
    if (typeof OriginalObserver !== "function") return;
    const previousDescriptor = Object.getOwnPropertyDescriptor(hostWindow, name);
    const TrackedObserver = function (this: unknown, ...args: unknown[]) {
      const observer = Reflect.construct(OriginalObserver, args) as { disconnect(): void };
      if (active && isTavernCall()) trackedObservers.add(observer);
      return observer;
    };
    Object.setPrototypeOf(TrackedObserver, OriginalObserver);
    TrackedObserver.prototype = OriginalObserver.prototype;
    try {
      Object.defineProperty(hostWindow, name, {
        configurable: true,
        enumerable: previousDescriptor?.enumerable ?? false,
        writable: true,
        value: TrackedObserver,
      });
      restoreCallbacks.push(() => {
        if (hostRecord[name] !== TrackedObserver) return;
        if (previousDescriptor) Object.defineProperty(hostWindow, name, previousDescriptor);
        else delete hostRecord[name];
      });
    } catch {
      // Some embedded browsers expose observer constructors as non-configurable globals.
    }
  });

  return () => {
    if (!active) return;
    active = false;
    restoreCallbacks.splice(0).reverse().forEach((restore) => restore());
    trackedObservers.forEach((observer) => {
      try {
        observer.disconnect();
      } catch {}
    });
    trackedTimeouts.forEach((timerId) => originalClearTimeout(timerId));
    trackedIntervals.forEach((timerId) => originalClearInterval(timerId));
    trackedAnimationFrames.forEach((frameId) => originalCancelAnimationFrame(frameId));
    trackedEventListeners.forEach(({ target, type, listener, options }) => {
      try {
        originalRemoveEventListener.call(target, type, listener, options);
      } catch {}
    });
    Array.from(ownedNodes).reverse().forEach((node) => {
      if (!baselineNodes.has(node) && node.isConnected) node.parentNode?.removeChild(node);
    });
    Object.getOwnPropertyNames(hostWindow).forEach((property) => {
      if (existingWindowGlobals.has(property)) return;
      const descriptor = Object.getOwnPropertyDescriptor(hostWindow, property);
      if (descriptor?.configurable) delete hostRecord[property];
    });
    const documentRecord = hostDocument as unknown as Record<string, unknown>;
    Object.getOwnPropertyNames(hostDocument).forEach((property) => {
      if (existingDocumentGlobals.has(property)) return;
      const descriptor = Object.getOwnPropertyDescriptor(hostDocument, property);
      if (descriptor?.configurable) delete documentRecord[property];
    });
    ownedNodes.clear();
    trackedObservers.clear();
    trackedTimeouts.clear();
    trackedIntervals.clear();
    trackedAnimationFrames.clear();
    trackedEventListeners.splice(0);
  };
}

type TavernJQuery = ((selector?: unknown, context?: unknown) => unknown) & {
  fn?: Record<string, unknown>;
};

function isJQuery(value: unknown): value is TavernJQuery {
  return (
    typeof value === "function" &&
    isRecord((value as TavernJQuery).fn) &&
    typeof (value as TavernJQuery).fn?.jquery === "string"
  );
}

function installParentJQueryBridge(
  runtimeWindow: RuntimeWindow,
  hostWindow: Window,
) {
  // SillyTavern scripts normally run in the visible host document. Keep the
  // runtime jQuery instance, but make its default selectors and created nodes
  // use Renge's visible document whenever a script explicitly targets parent.
  const host = hostWindow as unknown as Record<string, unknown>;
  if (isJQuery(host.jQuery)) return () => undefined;
  const runtimeJQuery = runtimeWindow.jQuery;
  if (!isJQuery(runtimeJQuery)) return () => undefined;

  const runtimeDocument = runtimeWindow.document;
  const hostDocument = hostWindow.document;
  const mapRuntimeTarget = (value: unknown) => {
    if (value === runtimeWindow) return hostWindow;
    if (value === runtimeDocument) return hostDocument;
    if (value === runtimeDocument.documentElement) return hostDocument.documentElement;
    if (value === runtimeDocument.head) return hostDocument.head;
    if (value === runtimeDocument.body) return hostDocument.body;
    return value;
  };
  const bridge = function (selector?: unknown, context?: unknown) {
    const mappedSelector = mapRuntimeTarget(selector);
    const mappedContext = mapRuntimeTarget(context);
    if (typeof mappedSelector === "function" && mappedContext === undefined) {
      const runReadyCallback = () => mappedSelector.call(hostDocument, bridge);
      if (hostDocument.readyState === "loading") {
        hostDocument.addEventListener("DOMContentLoaded", runReadyCallback, { once: true });
      } else {
        hostWindow.queueMicrotask(runReadyCallback);
      }
      return runtimeJQuery(hostDocument);
    }
    return runtimeJQuery(
      mappedSelector,
      mappedContext === undefined && typeof mappedSelector === "string"
        ? hostDocument
        : mappedContext,
    );
  } as TavernJQuery;
  Object.setPrototypeOf(bridge, runtimeJQuery);

  const previousDescriptors = new Map<string, PropertyDescriptor | undefined>();
  ["jQuery", "$"].forEach((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(hostWindow, name);
    if (descriptor?.configurable === false && descriptor.writable === false) return;
    previousDescriptors.set(name, descriptor);
    try {
      Object.defineProperty(hostWindow, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        writable: true,
        value: bridge,
      });
    } catch {
      try {
        host[name] = bridge;
      } catch {}
    }
  });

  return () => {
    Array.from(previousDescriptors.entries()).reverse().forEach(([name, descriptor]) => {
      try {
        if (descriptor) Object.defineProperty(hostWindow, name, descriptor);
        else delete host[name];
      } catch {}
    });
    previousDescriptors.clear();
  };
}

function installRuntimeStyleBridge(
  runtimeWindow: RuntimeWindow,
  hostWindow: Window & typeof globalThis,
) {
  // A loader can inject CSS before it discovers that its UI belongs in parent.
  // Mirror runtime styles continuously so a later parent-mounted UI never loses
  // its stylesheet, external icon font, or subsequent live style updates.
  const runtimeDocument = runtimeWindow.document;
  const hostDocument = hostWindow.document;
  const mirrors = new Map<HTMLStyleElement | HTMLLinkElement, HTMLStyleElement | HTMLLinkElement>();
  let active = true;
  let syncQueued = false;

  const getSources = () =>
    Array.from(
      runtimeDocument.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
        'style, link[rel~="stylesheet"]',
      ),
    ).filter(
      (element) =>
        element.dataset.rengeFontawesome !== "true" &&
        element.dataset.rengeFontawesomeStyle !== "true",
    );

  const findHostConflict = (
    source: HTMLStyleElement | HTMLLinkElement,
    mirror?: HTMLStyleElement | HTMLLinkElement,
  ) => {
    if (!source.id) return null;
    return Array.from(hostDocument.querySelectorAll<HTMLElement>("[id]")).find(
      (element) => element.id === source.id && element !== mirror,
    ) ?? null;
  };

  const copyAttributes = (
    source: HTMLStyleElement | HTMLLinkElement,
    mirror: HTMLStyleElement | HTMLLinkElement,
  ) => {
    const sourceNames = new Set(Array.from(source.attributes, (attribute) => attribute.name));
    Array.from(mirror.attributes).forEach((attribute) => {
      if (attribute.name === "data-renge-tavern-style-mirror") return;
      if (!sourceNames.has(attribute.name)) mirror.removeAttribute(attribute.name);
    });
    Array.from(source.attributes).forEach((attribute) => {
      if (mirror.getAttribute(attribute.name) !== attribute.value) {
        mirror.setAttribute(attribute.name, attribute.value);
      }
    });
    mirror.dataset.rengeTavernStyleMirror = "true";
    if (
      source instanceof runtimeWindow.HTMLLinkElement &&
      mirror instanceof hostWindow.HTMLLinkElement
    ) {
      if (mirror.href !== source.href) mirror.href = source.href;
      mirror.disabled = source.disabled;
    }
    if (
      source instanceof runtimeWindow.HTMLStyleElement &&
      mirror instanceof hostWindow.HTMLStyleElement
    ) {
      if (mirror.textContent !== source.textContent) mirror.textContent = source.textContent;
      mirror.disabled = source.disabled;
    }
  };

  const sync = () => {
    if (!active) return;
    const sources = new Set(getSources());
    Array.from(mirrors.entries()).forEach(([source, mirror]) => {
      if (sources.has(source) && !findHostConflict(source, mirror)) return;
      mirror.remove();
      mirrors.delete(source);
    });
    sources.forEach((source) => {
      const existingMirror = mirrors.get(source);
      if (findHostConflict(source, existingMirror)) return;
      const mirror = existingMirror ?? (
        source instanceof runtimeWindow.HTMLStyleElement
          ? hostDocument.createElement("style")
          : hostDocument.createElement("link")
      );
      copyAttributes(source, mirror);
      if (!existingMirror) {
        mirrors.set(source, mirror);
        hostDocument.head.appendChild(mirror);
      }
    });
  };

  const scheduleSync = () => {
    if (!active || syncQueued) return;
    syncQueued = true;
    runtimeWindow.queueMicrotask(() => {
      syncQueued = false;
      sync();
    });
  };
  const runtimeObserver = new runtimeWindow.MutationObserver(scheduleSync);
  runtimeObserver.observe(runtimeDocument.documentElement, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  const hostObserver = new hostWindow.MutationObserver(scheduleSync);
  hostObserver.observe(hostDocument.head, { childList: true, subtree: true });
  sync();

  return () => {
    if (!active) return;
    active = false;
    runtimeObserver.disconnect();
    hostObserver.disconnect();
    mirrors.forEach((mirror) => mirror.remove());
    mirrors.clear();
  };
}

type ParentTavernApiBridge = {
  syncPresetManager(): void;
  cleanup(): void;
};

function installParentTavernApiBridge(
  hostWindow: Window,
  api: Record<string, unknown>,
  sillyTavern: Record<string, unknown>,
  eventSource: Record<string, unknown>,
  toastr: Record<string, unknown>,
  presetManagerAdapter: TavernPresetManagerAdapter,
  reportError: TavernCompatibilityErrorReporter,
): ParentTavernApiBridge {
  const host = hostWindow as unknown as Record<string, unknown>;
  const values: Record<string, unknown> = {
    ...api,
    TavernHelper: api,
    tavernHelper: api,
    tavernHelperAPI: api,
    th: api,
    SillyTavern: sillyTavern,
    eventSource,
    event_types: TAVERN_EVENTS,
    tavern_events: TAVERN_EVENTS,
    toastr,
  };
  const previousDescriptors = new Map<string, PropertyDescriptor | undefined>();
  Object.entries(values).forEach(([name, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(hostWindow, name);
    if (descriptor?.configurable === false && descriptor.writable === false) return;
    previousDescriptors.set(name, descriptor);
    try {
      Object.defineProperty(hostWindow, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        writable: true,
        value,
      });
    } catch {
      try {
        host[name] = value;
      } catch {}
    }
  });
  const legacySendControlsCleanup = installLegacyTavernSendControls(
    hostWindow.document,
    (value) => {
      const sendMessage = api.sendMessage;
      if (typeof sendMessage !== "function") {
        throw new Error("Renge 会话发送接口尚未初始化。");
      }
      return Reflect.apply(sendMessage, api, [value]);
    },
    reportError,
  );
  const presetManagerControls = installTavernPresetManagerControls(
    hostWindow.document,
    presetManagerAdapter,
    reportError,
  );
  return {
    syncPresetManager: presetManagerControls.sync,
    cleanup: () => {
      presetManagerControls.cleanup();
      legacySendControlsCleanup();
      Array.from(previousDescriptors.entries()).reverse().forEach(([name, descriptor]) => {
        try {
          if (descriptor) Object.defineProperty(hostWindow, name, descriptor);
          else delete host[name];
        } catch {}
      });
      previousDescriptors.clear();
    },
  };
}

function mergeVariableRecords(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
) {
  const result = cloneValue(base);
  Object.entries(overlay).forEach(([key, value]) => {
    const current = result[key];
    result[key] =
      isRecord(current) && isRecord(value)
        ? mergeVariableRecords(current, value)
        : cloneValue(value);
  });
  return result;
}

function buildLocalTavernPlaceholderImage(value: string) {
  // Most values are prose, embedded scripts or data URLs, not remote images.
  if (!/^[\x00-\x20]*https?:/i.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    url.hostname.toLowerCase() !== "via.placeholder.com"
  ) {
    return value;
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  const sizeMatch = /^(\d{1,4})(?:x(\d{1,4}))?$/i.exec(pathSegments[0] ?? "");
  if (!sizeMatch) return value;
  const width = Math.min(4096, Math.max(1, Number(sizeMatch[1])));
  const height = Math.min(4096, Math.max(1, Number(sizeMatch[2] ?? sizeMatch[1])));
  const normalizeColor = (color: string | undefined, fallback: string) =>
    color && /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)
      ? `#${color}`
      : fallback;
  const background = normalizeColor(pathSegments[1], "#e5e7eb");
  const foreground = normalizeColor(pathSegments[2], "#94a3b8");
  const label = (url.searchParams.get("text") ?? "").trim().slice(0, 40);
  const escapeXml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const scale = Math.min(width, height);
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const graphic = label
    ? `<text x="${centerX}" y="${centerY}" fill="${foreground}" font-family="system-ui,sans-serif" font-size="${Math.max(10, Math.round(scale * 0.16))}" text-anchor="middle" dominant-baseline="central">${escapeXml(label)}</text>`
    : [
        `<circle cx="${centerX}" cy="${Math.round(centerY - scale * 0.12)}" r="${Math.max(2, Math.round(scale * 0.14))}" fill="${foreground}"/>`,
        `<ellipse cx="${centerX}" cy="${Math.round(centerY + scale * 0.2)}" rx="${Math.max(4, Math.round(scale * 0.28))}" ry="${Math.max(3, Math.round(scale * 0.18))}" fill="${foreground}"/>`,
      ].join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/>${graphic}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mapTavernVariableStrings<T>(
  value: T,
  mapper: (text: string) => string,
  seen = new WeakMap<object, unknown>(),
): T {
  if (typeof value === "string") return mapper(value) as T;
  if (!value || typeof value !== "object") return value;
  const objectValue = value as object;
  const existing = seen.get(objectValue);
  if (existing !== undefined) return existing as T;
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(objectValue, output);
    value.forEach((item) => output.push(mapTavernVariableStrings(item, mapper, seen)));
    return output as T;
  }
  if (!isRecord(value) || Object.prototype.toString.call(value) !== "[object Object]") {
    return value;
  }
  const output: Record<string, unknown> = {};
  seen.set(objectValue, output);
  Object.entries(value).forEach(([key, item]) => {
    output[key] = mapTavernVariableStrings(item, mapper, seen);
  });
  return output as T;
}

function normalizeTavernWorldBookEntry(
  value: unknown,
  index: number,
  fallback?: TavernRuntimeWorldBookEntry,
): TavernRuntimeWorldBookEntry {
  return readTavernHelperWorldbookEntry(
    value,
    index,
    fallback,
    () => `worldbook-entry-${crypto.randomUUID()}`,
  );
}

/** Tavern Helper 4 `WorldbookEntry` rows for a book, with stable numeric uids. */
function formatTavernWorldBookEntries(book: Pick<TavernRuntimeWorldBook, "entries">) {
  const uids = assignTavernWorldbookUids(book.entries);
  return book.entries.map((entry, index) => formatTavernHelperWorldbookEntry(entry, uids[index]));
}

/** Deprecated `LorebookEntry` rows, still used by cards written for Tavern Helper 3. */
function formatTavernLorebookEntries(book: Pick<TavernRuntimeWorldBook, "entries">) {
  const uids = assignTavernWorldbookUids(book.entries);
  return book.entries.map((entry, index) => formatTavernHelperLorebookEntry(entry, uids[index], index));
}

/**
 * Finds the stored entry a script-supplied row refers to. Scripts address
 * entries by the numeric uid they were given; Renge ids are accepted too.
 */
function createTavernWorldBookEntryLookup(book: Pick<TavernRuntimeWorldBook, "entries">) {
  const uids = assignTavernWorldbookUids(book.entries);
  const byKey = new Map<string, TavernRuntimeWorldBookEntry>();
  book.entries.forEach((entry) => {
    byKey.set(entry.id, entry);
    byKey.set(entry.uid, entry);
  });
  // Assigned uids are what scripts see, so they win over raw stored ids.
  book.entries.forEach((entry, index) => byKey.set(String(uids[index]), entry));
  return {
    uids,
    find: (value: unknown) => {
      if (isRecord(value)) {
        const byUid = value.uid === undefined ? undefined : byKey.get(String(value.uid));
        return byUid ?? (value.id === undefined ? undefined : byKey.get(String(value.id)));
      }
      return value === undefined || value === null ? undefined : byKey.get(String(value));
    },
  };
}

function normalizeTavernRegexRecord(
  value: unknown,
  fallbackScope = "global",
  fromApi = false,
): Record<string, unknown> {
  const raw = isRecord(value) ? cloneValue(value) : {};
  // Returned rows include legacy aliases. On writes, a script's native fields
  // must win over stale aliases carried along by {...row, enabled: ...}.
  const disabled =
    fromApi && typeof raw.enabled === "boolean"
      ? !raw.enabled
      : typeof raw.disabled === "boolean"
        ? raw.disabled
        : typeof raw.enabled === "boolean"
          ? !raw.enabled
          : false;
  const placement = fromApi && isRecord(raw.source)
    ? Object.entries({ user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 })
        .filter(([name]) => (raw.source as Record<string, unknown>)[name] === true)
        .map(([, value]) => value)
    : Array.isArray(raw.placement)
      ? raw.placement.map(Number).filter(Number.isFinite)
      : [2];
  const scriptName = String(raw.script_name ?? raw.scriptName ?? raw.name ?? "Unnamed Regex");
  const findRegex = String(raw.find_regex ?? raw.findRegex ?? "");
  const replaceString = String(raw.replace_string ?? raw.replaceString ?? "");
  const rawTrimStrings = raw.trim_strings ?? raw.trimStrings;
  const trimStrings = Array.isArray(rawTrimStrings)
    ? rawTrimStrings.map(String)
    : [];
  const destination = fromApi && isRecord(raw.destination) ? raw.destination : null;
  const markdownOnly = Boolean(destination?.display ?? raw.markdown_only ?? raw.markdownOnly ?? true);
  const promptOnly = Boolean(destination?.prompt ?? raw.prompt_only ?? raw.promptOnly ?? false);
  const scope = ["global", "character", "preset"].includes(String(raw.scope))
    ? String(raw.scope)
    : fallbackScope;

  return {
    ...raw,
    id: String(raw.id ?? `regex-${crypto.randomUUID()}`),
    scope,
    script_name: scriptName,
    scriptName,
    find_regex: findRegex,
    findRegex,
    replace_string: replaceString,
    replaceString,
    trim_strings: trimStrings,
    trimStrings,
    placement,
    disabled,
    enabled: !disabled,
    markdown_only: markdownOnly,
    markdownOnly,
    prompt_only: promptOnly,
    promptOnly,
    run_on_edit: Boolean(raw.run_on_edit ?? raw.runOnEdit ?? true),
    runOnEdit: Boolean(raw.run_on_edit ?? raw.runOnEdit ?? true),
    substitute_regex: Number(raw.substitute_regex ?? raw.substituteRegex ?? 0) || 0,
    substituteRegex: Number(raw.substitute_regex ?? raw.substituteRegex ?? 0) || 0,
    min_depth: raw.min_depth ?? raw.minDepth ?? null,
    minDepth: raw.min_depth ?? raw.minDepth ?? null,
    max_depth: raw.max_depth ?? raw.maxDepth ?? null,
    maxDepth: raw.max_depth ?? raw.maxDepth ?? null,
    source: isRecord(raw.source)
      ? raw.source
      : {
          user_input: placement.includes(1),
          ai_output: placement.includes(2),
          slash_command: placement.includes(3),
          world_info: placement.includes(5),
          reasoning: placement.includes(6),
        },
    destination: isRecord(raw.destination)
      ? raw.destination
      : {
          display: markdownOnly,
          prompt: promptOnly,
        },
  };
}

function buildLocalFontAwesomeCss(baseUrl: string) {
  const withoutTrueTypeFallbacks = fontAwesomeCss.replace(
    /,url\(\.\.\/webfonts\/fa-(?:brands-400|regular-400|solid-900|v4compatibility)\.ttf\) format\("truetype"\)/g,
    "",
  );
  const fontAssets = [
    ["../webfonts/fa-brands-400.woff2", fontAwesomeBrandsUrl],
    ["../webfonts/fa-regular-400.woff2", fontAwesomeRegularUrl],
    ["../webfonts/fa-solid-900.woff2", fontAwesomeSolidUrl],
    ["../webfonts/fa-v4compatibility.woff2", fontAwesomeV4CompatibilityUrl],
  ] as const;
  return fontAssets.reduce(
    (css, [source, assetUrl]) => css.replaceAll(source, new URL(assetUrl, baseUrl).href),
    withoutTrueTypeFallbacks,
  );
}

export function getTavernFontAwesomeCss(baseUrl = window.location.href) {
  return buildLocalFontAwesomeCss(baseUrl);
}

function installLocalFontAwesomeShadowSupport(
  targetWindow: Window & typeof globalThis,
  assetBaseUrl: string,
) {
  const { document } = targetWindow;
  const elementPrototype = targetWindow.Element.prototype;
  const originalAttachShadow = elementPrototype.attachShadow;
  const css = buildLocalFontAwesomeCss(assetBaseUrl);
  const solidUrl = new URL(fontAwesomeSolidUrl, assetBaseUrl).href;
  const regularUrl = new URL(fontAwesomeRegularUrl, assetBaseUrl).href;
  const brandsUrl = new URL(fontAwesomeBrandsUrl, assetBaseUrl).href;
  const fontFaces = [
    new targetWindow.FontFace("Font Awesome 6 Free", `url("${solidUrl}") format("woff2")`, {
      style: "normal",
      weight: "900",
    }),
    new targetWindow.FontFace("Font Awesome 6 Free", `url("${regularUrl}") format("woff2")`, {
      style: "normal",
      weight: "400",
    }),
    new targetWindow.FontFace("Font Awesome 6 Brands", `url("${brandsUrl}") format("woff2")`, {
      style: "normal",
      weight: "400",
    }),
  ];
  fontFaces.forEach((fontFace) => document.fonts.add(fontFace));
  const ready = Promise.all(fontFaces.map((fontFace) => fontFace.load())).then(() => undefined);
  const links = new Set<HTMLLinkElement>();
  const styles = new Set<HTMLStyleElement>();
  const documentStyle = document.createElement("style");
  documentStyle.dataset.rengeFontawesome = "true";
  documentStyle.textContent = css;
  document.head.appendChild(documentStyle);

  const inject = (root: ShadowRoot) => {
    if (root.querySelector('[data-renge-fontawesome="true"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "data:text/css;charset=utf-8,/*renge-fontawesome*/";
    link.dataset.rengeFontawesome = "true";
    const style = document.createElement("style");
    style.dataset.rengeFontawesomeStyle = "true";
    style.textContent = css;
    root.prepend(style);
    root.prepend(link);
    links.add(link);
    styles.add(style);
  };

  const patchedAttachShadow: typeof Element.prototype.attachShadow = function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = originalAttachShadow.call(this, init);
    inject(root);
    return root;
  };
  elementPrototype.attachShadow = patchedAttachShadow;
  document.querySelectorAll("*").forEach((element) => {
    if (element.shadowRoot) inject(element.shadowRoot);
  });

  return {
    ready,
    cleanup: () => {
      if (elementPrototype.attachShadow === patchedAttachShadow) {
        elementPrototype.attachShadow = originalAttachShadow;
      }
      links.forEach((link) => link.remove());
      links.clear();
      styles.forEach((style) => style.remove());
      styles.clear();
      documentStyle.remove();
      fontFaces.forEach((fontFace) => document.fonts.delete(fontFace));
    },
  };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

function formatLogArgument(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pathSegments(path: string) {
  return path
    .replace(/\[(?:"([^"]+)"|'([^']+)'|(\d+))\]/g, (_, double, single, index) =>
      `.${double ?? single ?? index}`,
    )
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getPath(root: unknown, path: string, fallback?: unknown) {
  let value = root;
  for (const segment of pathSegments(path)) {
    if (!isRecord(value) && !Array.isArray(value)) return fallback;
    value = (value as Record<string, unknown>)[segment];
  }
  return value === undefined ? fallback : value;
}

function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const segments = pathSegments(path);
  if (segments.length === 0) return root;
  let cursor: Record<string, unknown> = root;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }
    if (!isRecord(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  });
  return root;
}

function deletePath(root: Record<string, unknown>, path: string) {
  const segments = pathSegments(path);
  const last = segments.pop();
  if (!last) return false;
  let cursor: Record<string, unknown> = root;
  for (const segment of segments) {
    if (!isRecord(cursor[segment])) return false;
    cursor = cursor[segment] as Record<string, unknown>;
  }
  return delete cursor[last];
}

function normalizeMessageId(value: unknown, messages: TavernRuntimeMessage[]) {
  if (value === "latest" || value === -1 || value === "-1" || value == null) {
    return messages.length - 1;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return messages.length - 1;
  return parsed < 0 ? messages.length + parsed : parsed;
}

type TavernAudioTrack = { title: string; url: string };
type TavernAudioMode = "repeat_one" | "repeat_all" | "shuffle" | "play_one_and_stop";
type TavernAudioChannel = {
  element: HTMLAudioElement | null;
  playlist: TavernAudioTrack[];
  src: string;
  playing: boolean;
  enabled: boolean;
  mode: TavernAudioMode;
  muted: boolean;
  volume: number;
};

const TAVERN_AUDIO_MODES: readonly TavernAudioMode[] = [
  "repeat_one",
  "repeat_all",
  "shuffle",
  "play_one_and_stop",
];

/**
 * Tavern Helper's audio player: one background-music and one ambient channel,
 * each with a playlist and a play mode. Elements live in the host window so
 * playback survives the hidden script iframe.
 */
function createTavernAudioPlayer(hostWindow: Window & typeof globalThis) {
  const channels = new Map<TavernRuntimeAudioType, TavernAudioChannel>();
  const titleFromUrl = (url: string) => url.split("/").at(-1)?.split(".").at(0) || url;
  const toTrack = (value: unknown): TavernAudioTrack | null => {
    const url = (typeof value === "string" ? value : isRecord(value) ? String(value.url ?? value.src ?? "") : "").trim();
    if (!url) return null;
    const title = isRecord(value) && typeof value.title === "string" && value.title.trim() ? value.title : titleFromUrl(url);
    return { title, url };
  };
  const toTracks = (values: unknown) =>
    (Array.isArray(values) ? values : [values]).map(toTrack).filter((track): track is TavernAudioTrack => Boolean(track));
  const getChannel = (type: unknown) => {
    const key: TavernRuntimeAudioType = type === "ambient" ? "ambient" : "bgm";
    let channel = channels.get(key);
    if (!channel) {
      channel = {
        element: null,
        playlist: [],
        src: "",
        playing: false,
        enabled: true,
        mode: key === "bgm" ? "repeat_all" : "play_one_and_stop",
        muted: false,
        volume: 50,
      };
      channels.set(key, channel);
    }
    return channel;
  };
  const applySettings = (channel: TavernAudioChannel) => {
    if (!channel.element) return;
    channel.element.muted = channel.muted;
    channel.element.volume = Math.min(1, Math.max(0, channel.volume / 100));
  };
  const start = (channel: TavernAudioChannel, url: string) => {
    channel.src = url;
    channel.playing = channel.enabled;
    if (!channel.enabled) return;
    if (!channel.element) {
      const element = new hostWindow.Audio();
      element.preload = "auto";
      element.addEventListener("ended", () => {
        const index = channel.playlist.findIndex((track) => track.url === channel.src);
        const next =
          channel.mode === "repeat_one"
            ? channel.src
            : channel.mode === "repeat_all"
              ? channel.playlist[(index + 1) % Math.max(1, channel.playlist.length)]?.url ?? channel.src
              : channel.mode === "shuffle"
                ? channel.playlist[Math.floor(Math.random() * channel.playlist.length)]?.url ?? channel.src
                : "";
        if (next) start(channel, next);
        else channel.playing = false;
      });
      channel.element = element;
    }
    const element = channel.element;
    applySettings(channel);
    if (element.getAttribute("src") !== url) element.src = url;
    element.currentTime = 0;
    // Browsers reject playback before the first user gesture; the track stays
    // selected and starts on the next play request.
    void element.play().catch(() => {
      channel.playing = false;
    });
  };
  return {
    playAudio: (type: unknown, audio: unknown) => {
      const channel = getChannel(type);
      const track = toTrack(audio);
      if (!track) return;
      const existing = channel.playlist.find((item) => item.title === track.title || item.url === track.url);
      if (existing) Object.assign(existing, track);
      else channel.playlist.push(track);
      start(channel, track.url);
    },
    pauseAudio: (type: unknown) => {
      const channel = getChannel(type);
      channel.playing = false;
      channel.element?.pause();
    },
    getAudioList: (type: unknown) => cloneValue(getChannel(type).playlist),
    replaceAudioList: (type: unknown, list: unknown) => {
      getChannel(type).playlist = toTracks(list);
    },
    appendAudioList: (type: unknown, list: unknown) => {
      const channel = getChannel(type);
      toTracks(list).forEach((track) => {
        if (!channel.playlist.some((item) => item.title === track.title || item.url === track.url)) {
          channel.playlist.push(track);
        }
      });
    },
    getAudioSettings: (type: unknown) => {
      const { enabled, mode, muted, volume } = getChannel(type);
      return { enabled, mode, muted, volume };
    },
    setAudioSettings: (type: unknown, settings: unknown) => {
      const channel = getChannel(type);
      if (!isRecord(settings)) return;
      if (typeof settings.enabled === "boolean") {
        channel.enabled = settings.enabled;
        if (!settings.enabled) {
          channel.playing = false;
          channel.element?.pause();
        }
      }
      if (TAVERN_AUDIO_MODES.includes(settings.mode as TavernAudioMode)) {
        channel.mode = settings.mode as TavernAudioMode;
      }
      if (typeof settings.muted === "boolean") channel.muted = settings.muted;
      if (Number.isFinite(Number(settings.volume)) && settings.volume !== undefined) {
        channel.volume = Math.min(100, Math.max(0, Number(settings.volume)));
      }
      applySettings(channel);
    },
    getCurrentAudio: (type: unknown) => {
      const channel = getChannel(type);
      const element = channel.element;
      const duration = element && Number.isFinite(element.duration) ? element.duration : 0;
      return {
        src: channel.src,
        title: channel.playlist.find((item) => item.url === channel.src)?.title ?? "",
        playing: channel.playing && Boolean(element) && !element?.paused,
        progress: element && duration > 0 ? (element.currentTime / duration) * 100 : 0,
      };
    },
    destroy: () => {
      channels.forEach((channel) => {
        channel.element?.pause();
        channel.element?.removeAttribute("src");
        channel.element = null;
      });
      channels.clear();
    },
  };
}

function isFrameworkScript(script: TavernScript) {
  return (
    /\bMVU\b/i.test(script.name) ||
    /MagVarUpdate|\bMvu\b|registerMvuSchema/i.test(script.content)
  );
}

export class TavernScriptRuntime {
  private scriptExports: ReturnType<typeof createTavernScriptExports> | null = null;
  private readonly scripts: TavernScript[];
  private readonly adapter: TavernScriptRuntimeAdapter;
  private iframe: HTMLIFrameElement | null = null;
  private runtimeWindow: RuntimeWindow | null = null;
  private currentScriptId = "";
  private lastScriptId = "";
  private destroyed = false;
  private ready = false;
  private pendingChatMounts = new Set<() => void>();
  private executedScriptIds = new Set<string>();
  private eventHandlers = new Map<string, RuntimeEventHandler[]>();
  private eventHandlerSequence = 0;
  private scriptSourceOwners = new Map<string, string>();
  private chatChangeEmissionVersion = 0;
  private chatChangeEmissionQueue: Promise<void> = Promise.resolve();
  private scriptButtons = new Map<string, TavernScriptButton[]>();
  private variableSchemas = new Map<string, unknown>();
  private promptInjections = new Map<string, { prompt: Record<string, unknown>; once: boolean }>();
  private promptChatId: string;
  private sillyTavernChatCache: Array<Record<string, unknown>> = [];
  private syncChatMetadata: (() => void) | null = null;
  private parentSideEffectCleanup: (() => void) | null = null;
  private parentApiBridge: ParentTavernApiBridge | null = null;
  private parentJQueryCleanup: (() => void) | null = null;
  private runtimeStyleBridgeCleanup: (() => void) | null = null;
  private fontAwesomeCleanups: Array<() => void> = [];
  private localPlaceholderImageSources = new Map<string, string>();

  private readonly hostWindow: Window & typeof globalThis;
  private readonly apiOnly: boolean;
  private api: Record<string, unknown> | null = null;
  private audioPlayer: ReturnType<typeof createTavernAudioPlayer> | null = null;
  private macroSubstitute: ((value: unknown) => string) | null = null;

  constructor(
    scripts: TavernScript[],
    adapter: TavernScriptRuntimeAdapter,
    hostWindow: Window = window,
    options: TavernScriptRuntimeOptions = {},
  ) {
    this.hostWindow = hostWindow as Window & typeof globalThis;
    this.apiOnly = options.apiOnly === true;
    this.scripts = this.apiOnly ? [] : scripts.map((script) => cloneValue(script));
    this.adapter = adapter;
    this.promptChatId = adapter.getChatId();
    this.scripts.forEach((script) => {
      this.scriptButtons.set(script.id, cloneValue(script.buttons));
    });
  }

  isReady() {
    return this.ready && !this.destroyed;
  }

  /** True when this runtime only serves the API to message iframes. */
  isApiOnly() {
    return this.apiOnly;
  }

  /**
   * Calls a Tavern Helper API function by name on behalf of a message iframe.
   * Only plain functions of the installed API can be reached this way.
   */
  async callApi(name: string, args: unknown[] = []) {
    if (this.destroyed || !this.api) throw new Error("酒馆助手接口尚未初始化。");
    const target = Object.prototype.hasOwnProperty.call(this.api, name) ? this.api[name] : undefined;
    if (typeof target !== "function") throw new Error(`酒馆助手接口 ${name} 不存在。`);
    return await Reflect.apply(target, this.api, args);
  }

  getScriptExportSnapshots(names: string[], messageIndex: number) {
    return this.isReady() ? this.scriptExports?.snapshot(names, messageIndex) ?? {} : {};
  }

  async callScriptExport(name: string, method: string, args: unknown[]) {
    if (!this.isReady() || !this.scriptExports) throw new Error("酒馆脚本接口尚未就绪。");
    return await this.scriptExports.call(name, method, args);
  }

  /** Applies macros registered through `registerMacroLike` plus the builtin ones. */
  substituteMacros(value: unknown) {
    return this.macroSubstitute ? this.macroSubstitute(value) : String(value ?? "");
  }

  syncChat() {
    if (this.destroyed) return;
    const chatId = this.adapter.getChatId();
    if (chatId !== this.promptChatId) {
      this.promptInjections.clear();
      this.promptChatId = chatId;
    }
    this.refreshSillyTavernChatCache();
    this.syncChatMetadata?.();
  }

  syncPresetCompatibility() {
    if (this.destroyed) return;
    this.parentApiBridge?.syncPresetManager();
  }

  async getPromptInjections(purpose: "prompt" | "scan" = "prompt") {
    const prompts: Array<{ role: "system" | "user" | "assistant"; content: string; depth: number }> = [];
    for (const { prompt } of Array.from(this.promptInjections.values())) {
      if (purpose === "scan" ? prompt.should_scan !== true : prompt.position === "none") continue;
      if (typeof prompt.filter === "function" && !await prompt.filter()) continue;
      prompts.push({
        role: prompt.role === "user" || prompt.role === "assistant" ? prompt.role : "system",
        content: String(prompt.content ?? ""),
        depth: Math.max(0, Math.trunc(Number(prompt.depth) || 0)),
      });
    }
    return prompts;
  }

  uninjectPrompts(ids: unknown) {
    if (ids === null) {
      this.promptInjections.clear();
      return;
    }
    if (Array.isArray(ids)) ids.forEach((id) => this.promptInjections.delete(String(id)));
  }

  injectPrompts(prompts: unknown, options: unknown = {}) {
    const ids: string[] = [];
    const handle = { uninject: () => this.uninjectPrompts(ids) };
    if (!Array.isArray(prompts)) return handle;
    const once = isRecord(options) && options.once === true;
    prompts.forEach((value, index) => {
      if (!isRecord(value)) return;
      const content = value.content ?? value.message ?? value.mes;
      if (typeof content !== "string" || !content.trim()) return;
      const id = String(value.id ?? `injected-prompt-${crypto.randomUUID()}-${index}`);
      const role = value.role === "assistant" || value.role === "user" ? value.role : "system";
      this.promptInjections.set(id, {
        prompt: { ...cloneValue(value), id, role, content, filter: value.filter }, once,
      });
      ids.push(id);
    });
    return handle;
  }

  async initializeGreeting(swipeIndex: number) {
    if (this.destroyed) return;
    await this.initializeMvuMessageVariables(swipeIndex);
  }

  async initialize() {
    if (this.destroyed) throw new Error("脚本运行时已销毁。");
    if (this.apiOnly) {
      // No scripts to run: expose the API for message iframes and leave the
      // host page, its globals and the network untouched.
      await this.createIframe();
      if (this.destroyed) return;
      this.refreshSillyTavernChatCache();
      this.installCompatibilityApi();
      this.ready = true;
      return;
    }
    this.reportStatus("loading", "正在初始化酒馆脚本运行环境...");
    await this.createIframe();
    if (this.destroyed) return;
    this.parentSideEffectCleanup = installParentSideEffectTracker(
      this.hostWindow,
      () => this.currentScriptId || this.lastScriptId,
    );
    this.refreshSillyTavernChatCache();
    const fontAwesomeSupports = [
      installLocalFontAwesomeShadowSupport(this.hostWindow, window.location.href),
    ];
    if (this.runtimeWindow) {
      fontAwesomeSupports.push(
        installLocalFontAwesomeShadowSupport(this.runtimeWindow, window.location.href),
      );
    }
    this.fontAwesomeCleanups.push(...fontAwesomeSupports.map((support) => support.cleanup));
    await Promise.all(fontAwesomeSupports.map((support) => support.ready));
    this.installCompatibilityApi();
    await this.loadDependencies();
    if (this.runtimeWindow) {
      this.parentJQueryCleanup = installParentJQueryBridge(this.runtimeWindow, this.hostWindow);
      this.runtimeStyleBridgeCleanup = installRuntimeStyleBridge(this.runtimeWindow, this.hostWindow);
    }
    this.publishButtons();

    this.scriptExports = createTavernScriptExports(
      this.hostWindow as unknown as Record<string, unknown>,
      new Set(Object.getOwnPropertyNames(this.hostWindow)),
    );

    const startupScripts = this.scripts
      .filter(
        (script) =>
          isTavernScriptEnabled(script) && script.autoRun && script.runOn === "startup" && script.content.trim(),
      )
      .sort((left, right) => Number(isFrameworkScript(right)) - Number(isFrameworkScript(left)));
    for (const script of startupScripts) {
      if (this.destroyed) return;
      try {
        try {
          await this.executeScript(script.id);
        } catch (error) {
          // SillyTavern keeps #chat mounted. A desktop home screen can initialize
          // extensions before that DOM exists, so retry its observer once the
          // user opens the chat instead of leaving the card permanently blank.
          const mounted = this.adapter.isChatMounted?.() ?? Boolean(this.hostWindow.document.getElementById("chat"));
          if (mounted || !/MutationObserver.*(?:Node|parameter)|(?:Node|parameter).*MutationObserver/i.test(toErrorMessage(error))) throw error;
          await this.waitForChatMount();
          if (this.destroyed) return;
          await this.executeScript(script.id);
        }
        if (isFrameworkScript(script)) {
          await this.waitForGlobal("Mvu", 15000);
        }
      } catch (error) {
        // Cards frequently bundle several independent startup modules. A
        // broken optional status/data module must not prevent a later visual
        // renderer from mounting the message UI.
        this.writeLog(
          "error",
          script,
          `启动脚本执行失败，已继续运行其余脚本：${toErrorMessage(error)}`,
        );
      }
    }
    if (this.destroyed) return;
    this.ready = true;
    await this.emit(TAVERN_EVENTS.SETTINGS_LOADED_AFTER);
    await this.emit(TAVERN_EVENTS.WORLDINFO_ENTRIES_LOADED);
    await this.emit(TAVERN_EVENTS.APP_READY);
    await this.emit(TAVERN_EVENTS.CHAT_CHANGED, this.adapter.getChatId());
    await this.initializeMvuMessageVariables();
    const character = this.localizePlaceholderImages(this.adapter.getCharacter());
    if (character) {
      await this.emit(TAVERN_EVENTS.CHARACTER_SELECTED, {
        characterId: character.id,
        character,
      });
    }
    this.reportStatus(
      "ready",
      startupScripts.length > 0
        ? `${startupScripts.length} 个酒馆脚本已运行。`
        : "酒馆脚本运行环境已就绪。",
    );
  }

  async executeScript(scriptId: string) {
    const script = this.scripts.find((candidate) => candidate.id === scriptId);
    if (!script) throw new Error("没有找到要运行的脚本。");
    if (!isTavernScriptEnabled(script)) throw new Error(`脚本「${script.name}」未启用。`);
    if (!script.content.trim()) throw new Error(`脚本「${script.name}」没有可执行内容。`);
    if (!this.runtimeWindow || !this.iframe) throw new Error("酒馆脚本运行环境尚未初始化。");
    if (this.executedScriptIds.has(script.id) && isFrameworkScript(script)) {
      this.writeLog("info", script, "脚本已经在当前会话中运行，无需重复加载。");
      return;
    }

    this.currentScriptId = script.id;
    this.lastScriptId = script.id;
    this.ensureScriptMarker(script.id);
    this.writeLog("info", script, "开始运行脚本。");
    try {
      await this.appendExecutableScript(script);
      this.executedScriptIds.add(script.id);
      this.writeLog("info", script, "脚本运行完成。");
    } catch (error) {
      const message = toErrorMessage(error);
      this.writeLog("error", script, message);
      this.reportStatus("error", `脚本「${script.name}」运行失败：${message}`);
      throw error;
    } finally {
      if (this.currentScriptId === script.id) this.currentScriptId = "";
    }
  }

  async emit(rawEventName: string, ...args: unknown[]) {
    const eventName = normalizeTavernEventName(rawEventName);
    if (eventName === TAVERN_EVENTS.CHAT_CHANGED) {
      const version = ++this.chatChangeEmissionVersion;
      const queued = this.chatChangeEmissionQueue
        .catch(() => undefined)
        .then(async () => {
          if (this.destroyed || version !== this.chatChangeEmissionVersion) return [];
          this.syncChat();
          return await this.emitNow(eventName, ...args);
        });
      this.chatChangeEmissionQueue = queued.then(
        () => undefined,
        () => undefined,
      );
      return await queued;
    }
    return await this.emitNow(eventName, ...args);
  }

  private async emitNow(eventName: string, ...args: unknown[]) {
    if (this.destroyed) return [];
    // Tavern Helper hands listeners of message events a numeric message id.
    if (TAVERN_MESSAGE_ID_EVENTS.has(eventName) && args.length > 0 && typeof args[0] === "string") {
      const messageId = Number(args[0]);
      if (args[0].trim() !== "" && Number.isInteger(messageId)) args[0] = messageId;
    }
    if (eventName === TAVERN_EVENTS.GENERATION_ENDED || eventName === TAVERN_EVENTS.GENERATION_STOPPED) {
      this.promptInjections.forEach((injection, id) => {
        if (injection.once) this.promptInjections.delete(id);
      });
    }
    if (
      eventName === TAVERN_EVENTS.MESSAGE_SENT ||
      eventName === TAVERN_EVENTS.MESSAGE_RECEIVED
    ) {
      for (const script of this.scripts.filter(
        (candidate) =>
          isTavernScriptEnabled(candidate) &&
          candidate.autoRun &&
          candidate.runOn === "message" &&
          !this.executedScriptIds.has(candidate.id),
      )) {
        await this.executeScript(script.id);
      }
    }
    const handlers = [...(this.eventHandlers.get(eventName) ?? [])].sort(
      (left, right) => left.priority - right.priority || left.sequence - right.sequence,
    );
    const results: unknown[] = [];
    for (const handler of handlers) {
      const previousScriptId = this.currentScriptId;
      this.currentScriptId = handler.scriptId || previousScriptId;
      try {
        results.push(await handler.callback(...args));
      } catch (error) {
        this.writeRuntimeLog("error", `事件 ${eventName} 处理失败：${toErrorMessage(error)}`);
      } finally {
        this.currentScriptId = previousScriptId;
      }
    }
    return results;
  }

  async triggerButton(button: TavernRuntimeButton) {
    const expectedEventName = this.getButtonEventName(button.scriptId, button.name);
    const matchingEventNames = [...this.eventHandlers.keys()].filter(
      (eventName) =>
        eventName.startsWith("tavern_script_button:") &&
        eventName.endsWith(`:${button.name}`),
    );
    const eventName = this.eventHandlers.has(expectedEventName)
      ? expectedEventName
      : matchingEventNames.length === 1
        ? matchingEventNames[0]
        : expectedEventName;
    const results = await this.emit(eventName, {
      name: button.name,
      scriptId: button.scriptId,
      messageId: this.adapter.getMessages().length - 1,
    });
    if (results.length === 0) {
      throw new Error(`按钮「${button.name}」尚未注册可执行事件。`);
    }
    return results;
  }

  private waitForChatMount() {
    return new Promise<void>((resolve) => {
      let timer = 0;
      const finish = () => {
        window.clearInterval(timer);
        this.pendingChatMounts.delete(finish);
        resolve();
      };
      const check = () => {
        if (this.destroyed || (this.adapter.isChatMounted?.() ?? Boolean(this.hostWindow.document.getElementById("chat")))) finish();
      };
      timer = window.setInterval(check, 50);
      this.pendingChatMounts.add(finish);
      check();
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const finish of this.pendingChatMounts) finish();
    this.ready = false;
    this.chatChangeEmissionVersion += 1;
    this.eventHandlers.clear();
    this.scriptSourceOwners.clear();
    this.scriptButtons.clear();
    this.variableSchemas.clear();
    this.promptInjections.clear();
    this.sillyTavernChatCache.splice(0);
    this.syncChatMetadata = null;
    this.api = null;
    this.macroSubstitute = null;
    this.audioPlayer?.destroy();
    this.audioPlayer = null;
    if (!this.apiOnly) {
      this.adapter.onButtonsChange?.([]);
      const parentWindow = this.hostWindow as Window & { Mvu?: unknown };
      if (parentWindow.Mvu) delete parentWindow.Mvu;
    }
    this.runtimeStyleBridgeCleanup?.();
    this.runtimeStyleBridgeCleanup = null;
    this.parentSideEffectCleanup?.();
    this.parentSideEffectCleanup = null;
    this.parentApiBridge?.cleanup();
    this.parentApiBridge = null;
    this.parentJQueryCleanup?.();
    this.parentJQueryCleanup = null;
    this.iframe?.remove();
    this.fontAwesomeCleanups
      .splice(0)
      .reverse()
      .forEach((cleanup) => cleanup());
    this.localPlaceholderImageSources.clear();
    this.iframe = null;
    this.runtimeWindow = null;
    this.reportStatus("idle", "");
  }

  private async createIframe() {
    const document = this.hostWindow.document;
    const iframe = document.createElement("iframe");
    iframe.title = "酒馆脚本运行环境";
    iframe.style.display = "none";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-modals allow-downloads");
    iframe.srcdoc = [
      "<!doctype html>",
      '<html lang="zh-CN"><head><meta charset="utf-8"><title>Renge Tavern Script Runtime</title></head>',
      '<body><div id="chat"></div><div id="extensions_settings2"></div>',
      '<div id="tavern_helper"></div></body></html>',
    ].join("");
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error("酒馆脚本 iframe 初始化超时。"));
        }, 10000);
        iframe.addEventListener(
          "load",
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
        iframe.addEventListener(
          "error",
          () => {
            window.clearTimeout(timeout);
            reject(new Error("酒馆脚本 iframe 无法加载。"));
          },
          { once: true },
        );
        // Bind both terminal listeners before insertion. An about:srcdoc frame
        // can finish loading synchronously when a runtime is recreated.
        document.body.appendChild(iframe);
      });
    } catch (error) {
      iframe.remove();
      throw error;
    }
    if (this.destroyed) {
      iframe.remove();
      return;
    }
    this.iframe = iframe;
    this.runtimeWindow = iframe.contentWindow as RuntimeWindow | null;
    if (!this.runtimeWindow) throw new Error("无法访问酒馆脚本 iframe。 ");
    // CDN packages such as pinia/+esm and Vue's esm-bundler runtime expect
    // bundlers to replace these compile-time identifiers. Tavern scripts load
    // them directly in the browser, so expose the standard feature flags in
    // the iframe realm before any dependency or user module is evaluated.
    installVueEsmBundlerFeatureFlags(this.runtimeWindow);
    // Dynamic imports used by Tavern auto-updaters (for example
    // import(`https://testingcf.jsdelivr.net/...@${version}/stable.js`))
    // need the same-origin module proxy as static imports. Expose the resolver
    // in the iframe realm so the rewritten import can evaluate its template
    // literal first and proxy the concrete URL afterwards.
    this.runtimeWindow.__rengeTavernModuleUrl = (remoteUrl: unknown) =>
      proxyTavernModuleUrl(String(remoteUrl ?? ""), window.location.origin);
    this.runtimeWindow.addEventListener("error", (event: ErrorEvent) => {
      this.writeRuntimeLog("error", event.message || "脚本运行时发生错误。");
    });
    this.runtimeWindow.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
      this.writeRuntimeLog("error", `未处理的 Promise：${toErrorMessage(event.reason)}`);
    });
    this.wrapConsole();
  }

  private wrapConsole() {
    const win = this.runtimeWindow;
    if (!win) return;
    (["log", "info", "warn", "error"] as const).forEach((level) => {
      const original = win.console[level].bind(win.console);
      win.console[level] = (...args: unknown[]) => {
        original(...args);
        const message = args.map(formatLogArgument).join(" ");
        if (
          message.includes("function tools are not supported") ||
          message.includes("MVU: function tools")
        ) {
          return;
        }
        this.writeRuntimeLog(level, message);
      };
    });
  }

  private async loadDependencies() {
    const win = this.runtimeWindow;
    if (!win) throw new Error("酒馆脚本运行环境不存在。");
    await this.loadClassicDependency(JQUERY_SOURCES, "jQuery", "jQuery");
    win.$ = win.jQuery;
    await this.loadClassicDependency(LODASH_SOURCES, "_", "Lodash");
    await this.loadClassicDependency(VUE_SOURCES, "Vue", "Vue");
    let zodModule: Record<string, unknown> | null = null;
    let lastError: unknown = null;
    const importer = win.Function("url", "return import(url)") as (
      url: string,
    ) => Promise<Record<string, unknown>>;
    for (const source of ZOD_SOURCES) {
      try {
        zodModule = await importer(source);
        if (zodModule) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!zodModule) {
      throw new Error(`Zod 4 加载失败：${toErrorMessage(lastError)}`);
    }
    win.z = buildZodGlobal(zodModule);
    let yamlModule: Record<string, unknown> | null = null;
    lastError = null;
    for (const source of YAML_SOURCES) {
      try {
        yamlModule = await importer(source);
        if (yamlModule) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!yamlModule) {
      throw new Error(`YAML 加载失败：${toErrorMessage(lastError)}`);
    }
    win.YAML = yamlModule;
  }

  private async loadClassicDependency(
    sources: string[],
    globalName: string,
    displayName: string,
  ) {
    const win = this.runtimeWindow;
    const document = win?.document;
    if (!win || !document) throw new Error("酒馆脚本运行环境不存在。");
    if (win[globalName] != null) return;
    let lastError: unknown = null;
    for (const source of sources) {
      try {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = source;
          script.crossOrigin = "anonymous";
          script.addEventListener("load", () => resolve(), { once: true });
          script.addEventListener(
            "error",
            () => reject(new Error(`${displayName} 资源加载失败：${source}`)),
            { once: true },
          );
          document.head.appendChild(script);
        });
        if (win[globalName] != null) return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`${displayName} 加载失败：${toErrorMessage(lastError)}`);
  }

  private installCompatibilityApi() {
    const win = this.runtimeWindow;
    if (!win) throw new Error("酒馆脚本运行环境不存在。");
    const nativeFetch = win.fetch.bind(win);
    win.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (/^\/?version(?:\?|$)/.test(url)) {
        return Promise.resolve(
          new Response(JSON.stringify({ pkgVersion: SILLYTAVERN_VERSION, agent: "Renge" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    const getScriptId = () =>
      resolveTavernCallerScriptId(
        new Error().stack,
        this.currentScriptId,
        this.lastScriptId || this.scripts[0]?.id || "renge-script",
        this.scriptSourceOwners,
      );

    const registerEventHandler = (
      eventName: unknown,
      callback: unknown,
      priority: RuntimeEventHandler["priority"] = 0,
    ) => {
      if (typeof callback !== "function") return callback;
      const key = normalizeTavernEventName(eventName);
      const callbacks = this.eventHandlers.get(key) ?? [];
      const typedCallback = callback as (...args: unknown[]) => unknown;
      if (!callbacks.some((handler) => handler.callback === typedCallback)) {
        callbacks.push({
          callback: typedCallback,
          scriptId: getScriptId(),
          priority,
          sequence: this.eventHandlerSequence++,
        });
      }
      this.eventHandlers.set(key, callbacks);
      return attachTavernSubscriptionControls(typedCallback, () => {
        const registeredCallbacks = this.eventHandlers.get(key);
        if (!registeredCallbacks) return false;
        const index = registeredCallbacks.findIndex(
          (handler) => handler.callback === typedCallback,
        );
        if (index < 0) return false;
        registeredCallbacks.splice(index, 1);
        if (registeredCallbacks.length === 0) this.eventHandlers.delete(key);
        return true;
      });
    };
    const eventOn = (eventName: unknown, callback: unknown) =>
      registerEventHandler(eventName, callback, 0);
    const eventRemoveListener = (eventName: unknown, callback: unknown) => {
      const key = normalizeTavernEventName(eventName);
      const callbacks = this.eventHandlers.get(key);
      if (!callbacks) return false;
      if (typeof callback === "function") {
        const index = callbacks.findIndex((handler) => handler.callback === callback);
        if (index >= 0) callbacks.splice(index, 1);
      }
      if (callbacks.length === 0) this.eventHandlers.delete(key);
      return true;
    };
    const eventOnce = (eventName: unknown, callback: unknown) => {
      if (typeof callback !== "function") return callback;
      const once = async (...args: unknown[]) => {
        eventRemoveListener(eventName, once);
        return await (callback as (...callbackArgs: unknown[]) => unknown)(...args);
      };
      eventOn(eventName, once);
      return once;
    };
    const eventClearListener = (callback: unknown) => {
      if (typeof callback !== "function") return false;
      let removed = false;
      this.eventHandlers.forEach((handlers, eventName) => {
        const remaining = handlers.filter((handler) => handler.callback !== callback);
        removed ||= remaining.length !== handlers.length;
        if (remaining.length > 0) this.eventHandlers.set(eventName, remaining);
        else this.eventHandlers.delete(eventName);
      });
      return removed;
    };
    const emitFromScript = (eventName: unknown, ...args: unknown[]) => {
      const normalizedEventName = normalizeTavernEventName(eventName);
      // Events raised by card code also reach message iframes, which share
      // one event bus with scripts in SillyTavern.
      this.adapter.onScriptEvent?.(normalizedEventName, args);
      if (
        [
          TAVERN_EVENTS.MESSAGE_UPDATED,
          TAVERN_EVENTS.MESSAGE_EDITED,
          TAVERN_EVENTS.MESSAGE_DELETED,
          TAVERN_EVENTS.MESSAGE_SWIPED,
          "MESSAGE_UPDATED",
          "MESSAGE_EDITED",
          "MESSAGE_DELETED",
          "MESSAGE_SWIPED",
        ].includes(normalizedEventName)
      ) {
        this.persistSillyTavernChatCache();
      }
      return this.emit(normalizedEventName, ...args);
    };
    const eventSource = {
      on: eventOn,
      off: eventRemoveListener,
      once: eventOnce,
      emit: emitFromScript,
      emitAndWait: emitFromScript,
      removeListener: eventRemoveListener,
      makeFirst: (eventName: string, callback: (...args: unknown[]) => unknown) => {
        registerEventHandler(eventName, callback, -1);
        return { stop: () => eventRemoveListener(eventName, callback) };
      },
      makeLast: (eventName: string, callback: (...args: unknown[]) => unknown) => {
        registerEventHandler(eventName, callback, 1);
        return { stop: () => eventRemoveListener(eventName, callback) };
      },
      clearEvent: (eventName: unknown) => this.eventHandlers.delete(normalizeTavernEventName(eventName)),
      clearListener: eventClearListener,
      clearAll: () => this.eventHandlers.clear(),
    };

    const getScript = () =>
      this.scripts.find((script) => script.id === getScriptId()) ?? this.scripts[0];
    const runWithScriptContext = <T>(scriptId: string, callback: () => T) => {
      const previousScriptId = this.currentScriptId;
      this.currentScriptId = scriptId || previousScriptId;
      try {
        return callback();
      } finally {
        this.currentScriptId = previousScriptId;
      }
    };
    const timerHost = typeof window.RengeAndroidNative?.scheduleBackgroundTimer === "function"
      ? window
      : win;
    const nativeSetTimeout = timerHost.setTimeout.bind(timerHost) as typeof win.setTimeout;
    const nativeClearTimeout = timerHost.clearTimeout.bind(timerHost) as typeof win.clearTimeout;
    const nativeSetInterval = timerHost.setInterval.bind(timerHost) as typeof win.setInterval;
    const nativeClearInterval = timerHost.clearInterval.bind(timerHost) as typeof win.clearInterval;
    const nativeRequestAnimationFrame = win.requestAnimationFrame?.bind(win);
    const nativeCancelAnimationFrame = win.cancelAnimationFrame?.bind(win);
    const animationFrameFallbacks = new Map<number, number>();
    win.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const ownerScriptId = getScriptId();
      return nativeSetTimeout(
        typeof handler === "function"
          ? ownerScriptId
            ? (...callbackArgs: unknown[]) =>
                runWithScriptContext(ownerScriptId, () => handler(...callbackArgs))
            : handler
          : () => win.eval(String(handler)),
        timeout,
        ...args,
      );
    }) as typeof win.setTimeout;
    win.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const ownerScriptId = getScriptId();
      return nativeSetInterval(
        typeof handler === "function"
          ? ownerScriptId
            ? (...callbackArgs: unknown[]) =>
                runWithScriptContext(ownerScriptId, () => handler(...callbackArgs))
            : handler
          : () => win.eval(String(handler)),
        timeout,
        ...args,
      );
    }) as typeof win.setInterval;
    win.clearTimeout = ((timerId?: number) => nativeClearTimeout(timerId)) as typeof win.clearTimeout;
    win.clearInterval = ((timerId?: number) => nativeClearInterval(timerId)) as typeof win.clearInterval;
    if (nativeRequestAnimationFrame) {
      win.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        const ownerScriptId = getScriptId();
        let completed = false;
        let fallbackTimer = 0;
        const frameId = nativeRequestAnimationFrame((time) => {
          if (completed) return;
          completed = true;
          if (fallbackTimer) nativeClearTimeout(fallbackTimer);
          animationFrameFallbacks.delete(frameId);
          runWithScriptContext(ownerScriptId, () => callback(time));
        });
        // Chromium suspends requestAnimationFrame in the hidden Tavern runtime
        // iframe. Many SillyTavern extensions use it to refresh parent-mounted
        // panels after a database or variable update, so provide a timer-backed
        // frame when the native callback cannot run.
        fallbackTimer = nativeSetTimeout(() => {
          if (completed) return;
          completed = true;
          animationFrameFallbacks.delete(frameId);
          nativeCancelAnimationFrame?.(frameId);
          runWithScriptContext(ownerScriptId, () => callback(win.performance.now()));
        }, 120);
        animationFrameFallbacks.set(frameId, fallbackTimer);
        return frameId;
      }) as typeof win.requestAnimationFrame;
      if (nativeCancelAnimationFrame) {
        win.cancelAnimationFrame = ((frameId: number) => {
          const fallbackTimer = animationFrameFallbacks.get(frameId);
          if (fallbackTimer) nativeClearTimeout(fallbackTimer);
          animationFrameFallbacks.delete(frameId);
          nativeCancelAnimationFrame(frameId);
        }) as typeof win.cancelAnimationFrame;
      }
    }
    const eventTargetPrototype = win.EventTarget?.prototype;
    if (eventTargetPrototype) {
      const nativeAddEventListener = eventTargetPrototype.addEventListener;
      const nativeRemoveEventListener = eventTargetPrototype.removeEventListener;
      const listenerWrappers = new WeakMap<object, EventListenerOrEventListenerObject>();
      eventTargetPrototype.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        const ownerScriptId = getScriptId();
        if (!listener || !ownerScriptId) {
          return nativeAddEventListener.call(this, type, listener, options);
        }
        const listenerKey = listener as object;
        let wrapped = listenerWrappers.get(listenerKey);
        if (!wrapped) {
          wrapped = typeof listener === "function"
            ? function (this: EventTarget, event: Event) {
                return runWithScriptContext(ownerScriptId, () => listener.call(this, event));
              }
            : {
                handleEvent: (event: Event) =>
                  runWithScriptContext(ownerScriptId, () => listener.handleEvent(event)),
              };
          listenerWrappers.set(listenerKey, wrapped);
        }
        return nativeAddEventListener.call(this, type, wrapped, options);
      };
      eventTargetPrototype.removeEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) {
        const wrapped = listener ? listenerWrappers.get(listener as object) ?? listener : listener;
        return nativeRemoveEventListener.call(this, type, wrapped, options);
      };
    }
    let lastButtonScriptId = "";
    const resolveButtonScript = (buttons: unknown[]) => {
      const fallbackScriptId = getScriptId();
      const buttonNames = buttons
        .map((button) =>
          isRecord(button) ? String(button.name ?? button.label ?? "").trim() : String(button).trim(),
        )
        .filter(Boolean);
      const scriptId = resolveTavernButtonOwnerId(
        buttonNames,
        fallbackScriptId,
        this.scripts.map((script) => ({
          id: script.id,
          buttonNames: (this.scriptButtons.get(script.id) ?? []).map((button) => button.name),
        })),
      );
      lastButtonScriptId = scriptId;
      return this.scripts.find((script) => script.id === scriptId) ?? this.scripts[0];
    };
    const getScriptButtons = () => {
      const script = getScript();
      const buttons = this.scriptButtons.get(script?.id ?? "") ?? [];
      if (buttons.length > 0 || !lastButtonScriptId) return cloneValue(buttons);
      return cloneValue(this.scriptButtons.get(lastButtonScriptId) ?? []);
    };
    const replaceScriptButtons = (first: unknown, second?: unknown) => {
      const explicitScriptId = typeof first === "string" ? first.trim() : "";
      const buttons = typeof first === "string" ? second : first;
      if (!Array.isArray(buttons)) return;
      const script = explicitScriptId
        ? this.scripts.find((candidate) => candidate.id === explicitScriptId) ?? resolveButtonScript(buttons)
        : resolveButtonScript(buttons);
      if (!script) return;
      const normalized = this.normalizeRuntimeButtons(buttons, script.id);
      this.scriptButtons.set(script.id, normalized);
      this.publishButtons();
    };
    const updateScriptButtonsWith = (updater: unknown) => {
      const current = getScriptButtons();
      if (typeof updater !== "function") return current;
      const result = (updater as (buttons: TavernScriptButton[]) => unknown)(current);
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
      const explicitScriptId = typeof first === "string" ? first.trim() : "";
      const buttons = typeof first === "string" ? second : first;
      if (!Array.isArray(buttons)) return getScriptButtons();
      const script = explicitScriptId
        ? this.scripts.find((candidate) => candidate.id === explicitScriptId) ?? resolveButtonScript(buttons)
        : resolveButtonScript(buttons);
      if (!script) return [];
      const existing = this.scriptButtons.get(script.id) ?? [];
      const names = new Set(existing.map((button) => button.name));
      const additions = this.normalizeRuntimeButtons(buttons, script.id).filter(
        (button) => !names.has(button.name),
      );
      if (additions.length > 0) {
        this.scriptButtons.set(script.id, [...existing, ...additions]);
        this.publishButtons();
      }
      return cloneValue(this.scriptButtons.get(script.id) ?? []);
    };
    const getScriptName = () => getScript()?.name ?? "";
    const getScriptInfo = () => getScript()?.info ?? "";
    const replaceScriptInfo = (info: unknown) => {
      const script = getScript();
      if (script) script.info = String(info ?? "");
    };

    const getChatMessages = (range: unknown = null, options: unknown = {}) => {
      const messages = this.adapter.getMessages();
      const normalizedOptions = isRecord(options) ? options : {};
      const bounds = resolveTavernMessageRange(range, messages.length);
      if (!bounds) return [];
      const role = normalizedOptions.role == null ? "all" : String(normalizedOptions.role);
      const hideState = String(normalizedOptions.hide_state ?? "all");
      const result: ReturnType<typeof this.formatHelperMessage>[] = [];
      for (let index = bounds.start; index <= bounds.end; index += 1) {
        const item = this.formatHelperMessage(messages[index], index);
        if (role !== "all" && item.role !== role) continue;
        if (hideState === "hidden" && !item.is_hidden) continue;
        if (hideState === "unhidden" && item.is_hidden) continue;
        result.push(item);
      }
      return result;
    };

    const getDefaultMessageName = (role: TavernRuntimeMessage["role"]) =>
      role === "user"
        ? this.adapter.getUserName() || "User"
        : this.adapter.getCharacter()?.name || "Assistant";
    // Tavern Helper models "system" as a role and hidden/name as message
    // fields; Renge stores all three as flags next to the message.
    const applyMessageFlags = (
      message: TavernRuntimeMessage,
      extra: Record<string, unknown>,
      source: Record<string, unknown>,
    ) => {
      if (source.role === "system") extra.tavernIsSystem = true;
      else if (source.role === "user" || source.role === "assistant") delete extra.tavernIsSystem;
      if (typeof source.is_hidden === "boolean") {
        if (source.is_hidden) extra.tavernIsHidden = true;
        else delete extra.tavernIsHidden;
      }
      if (typeof source.name === "string") {
        const name = source.name.trim();
        if (name && (name !== getDefaultMessageName(message.role) || extra.tavernIsSystem === true)) {
          extra.tavernName = name;
        } else {
          delete extra.tavernName;
        }
      }
    };

    const setChatMessages = async (updates: unknown, _options?: unknown) => {
      if (!Array.isArray(updates)) return false;
      let messages = this.adapter.getMessages().map((message) => cloneValue(message));
      let messagesChanged = false;
      let greetingChanged = false;
      let succeeded = true;
      const reservedUpdateKeys = new Set([
        "message_id", "mesid", "id", "name", "role", "is_user", "is_system",
        "is_hidden", "message", "mes", "content", "data", "variables", "extra",
        "swipe_id", "swipes", "swipes_data", "swipes_info",
      ]);
      for (const update of updates) {
        if (!isRecord(update)) continue;
        const index = normalizeMessageId(update.message_id, messages);
        const message = messages[index];
        if (!message) continue;
        const greetingSwipeIndex = getTavernGreetingSwipeIndex(
          message, update, this.adapter.getGreetingState?.()?.greetings,
        );
        if (greetingSwipeIndex !== null && this.adapter.selectGreeting) {
          if (messagesChanged) {
            this.adapter.setMessages(messages);
            messagesChanged = false;
          }
          const selected = await this.adapter.selectGreeting(greetingSwipeIndex);
          succeeded = selected && succeeded;
          greetingChanged = selected || greetingChanged;
          if (selected) await this.initializeMvuMessageVariables(greetingSwipeIndex);
          messages = this.adapter.getMessages().map((item) => cloneValue(item));
          continue;
        }
        if (typeof update.mes === "string") message.content = update.mes;
        else if (typeof update.message === "string") message.content = update.message;
        else if (typeof update.content === "string") message.content = update.content;
        const swipeIndex = Number.isInteger(Number(update.swipe_id))
          ? Math.max(0, Number(update.swipe_id))
          : 0;
        if (Array.isArray(update.swipes) && typeof update.swipes[swipeIndex] === "string") {
          message.content = update.swipes[swipeIndex];
        }
        if (update.role === "user" || update.role === "assistant") message.role = update.role;
        if (isRecord(update.data)) message.variables = cloneValue(update.data);
        else if (
          Array.isArray(update.swipes_data) &&
          isRecord(update.swipes_data[swipeIndex])
        ) {
          message.variables = cloneValue(update.swipes_data[swipeIndex]);
        } else if (Array.isArray(update.variables) && isRecord(update.variables[swipeIndex])) {
          message.variables = cloneValue(update.variables[swipeIndex]);
        } else if (isRecord(update.variables)) {
          message.variables = cloneValue(update.variables);
        }
        if (isRecord(update.extra)) message.extra = cloneValue(update.extra);
        else if (
          Array.isArray(update.swipes_info) &&
          isRecord(update.swipes_info[swipeIndex])
        ) {
          message.extra = cloneValue(update.swipes_info[swipeIndex]);
        }
        const nextExtra = isRecord(message.extra) ? cloneValue(message.extra) : {};
        Object.entries(update).forEach(([key, value]) => {
          if (!reservedUpdateKeys.has(key)) nextExtra[key] = cloneValue(value);
        });
        applyMessageFlags(message, nextExtra, update);
        if (Object.keys(nextExtra).length > 0) message.extra = nextExtra;
        else delete message.extra;
        messagesChanged = true;
      }
      if (messagesChanged) this.adapter.setMessages(messages);
      this.refreshSillyTavernChatCache();
      if (messagesChanged || greetingChanged) await this.adapter.flushPersistence?.();
      return succeeded;
    };

    const setChatMessage = async (messageOrId: unknown, idOrContent: unknown, options?: unknown) =>
      await setChatMessages([normalizeTavernSetChatMessageUpdate(messageOrId, idOrContent, options)]);

    const createChatMessages = async (values: unknown, positionOrOptions: unknown = -1) => {
      if (!Array.isArray(values)) return false;
      const messages = this.adapter.getMessages().map((message) => cloneValue(message));
      const created = values
        .filter(isRecord)
        .map((value): TavernRuntimeMessage => {
          const message: TavernRuntimeMessage = {
            id: crypto.randomUUID(),
            role: value.role === "assistant" || value.role === "system" ? "assistant" : "user",
            content: String(value.message ?? value.content ?? value.mes ?? ""),
            createdAt: new Date().toISOString(),
            ...(isRecord(value.data) ? { variables: cloneValue(value.data) } : {}),
          };
          const extra = isRecord(value.extra) ? cloneValue(value.extra) : {};
          applyMessageFlags(message, extra, value);
          if (Object.keys(extra).length > 0) message.extra = extra;
          return message;
        });
      const insertionIndex = resolveTavernCreateMessageInsertionIndex(
        positionOrOptions,
        messages.length,
      );
      messages.splice(insertionIndex, 0, ...created);
      this.adapter.setMessages(messages);
      this.refreshSillyTavernChatCache();
      await this.adapter.flushPersistence?.();
      return true;
    };

    const deleteChatMessages = async (ids: unknown, _options?: unknown) => {
      const values = Array.isArray(ids) ? ids : [ids];
      const count = this.adapter.getMessages().length;
      const indexes = new Set(
        values
          .map((id) => Number(id))
          .filter(Number.isInteger)
          .map((index) => (index < 0 ? count + index : index)),
      );
      this.adapter.setMessages(
        this.adapter.getMessages().filter((_, index) => !indexes.has(index)),
      );
      this.refreshSillyTavernChatCache();
      await this.adapter.flushPersistence?.();
      return true;
    };

    const rotateChatMessages = async (begin: unknown, middle: unknown, end: unknown, _options?: unknown) => {
      this.adapter.setMessages(
        rotateTavernMessages(this.adapter.getMessages(), Number(begin), Number(middle), Number(end)),
      );
      this.refreshSillyTavernChatCache();
      await this.adapter.flushPersistence?.();
    };

    const resolveVariableScriptId = (option?: unknown) =>
      isRecord(option) && typeof option.script_id === "string" && option.script_id.trim()
        ? option.script_id.trim()
        : getScriptId();
    const getVariables = (option?: unknown) => {
      const resolved = this.resolveVariables(option, resolveVariableScriptId(option));
      return this.localizePlaceholderImages(cloneValue(resolved));
    };
    const getAllVariables = () =>
      this.localizePlaceholderImages(
        mergeVariableRecords(
          mergeVariableRecords(
            mergeVariableRecords(
              cloneValue(this.adapter.getGlobalVariables()),
              cloneValue(this.adapter.getCharacterVariables()),
            ),
            cloneValue(this.adapter.getScriptData(getScriptId())),
          ),
          cloneValue(this.adapter.getChatVariables()),
        ),
      );
    const publishVariableChange = async (
      variables: Record<string, unknown>,
      previousVariables: Record<string, unknown>,
      option?: unknown,
    ) => {
      await this.adapter.flushPersistence?.();
      await this.emit(TAVERN_EVENTS.VARIABLE_CHANGED, cloneValue(variables), cloneValue(option));
      await this.emit(
        "mag_variable_update_ended",
        cloneValue(variables),
        cloneValue(previousVariables),
      );
      return variables;
    };
    const replaceVariables = async (variables: unknown, option?: unknown) => {
      const previous = getVariables(option);
      const next = isRecord(variables) ? cloneValue(variables) : {};
      this.saveVariables(option, resolveVariableScriptId(option), next);
      return await publishVariableChange(next, previous, option);
    };
    const updateVariablesWith = async (updater: unknown, option?: unknown) => {
      const current = getVariables(option);
      const previous = cloneValue(current);
      let next = current;
      if (typeof updater === "function") {
        const result = await (updater as (value: Record<string, unknown>) => unknown)(current);
        if (isRecord(result)) next = result;
      } else if (isRecord(updater)) {
        next = { ...current, ...cloneValue(updater) };
      }
      this.saveVariables(option, resolveVariableScriptId(option), next);
      await this.emit("variables_updated", cloneValue(next), cloneValue(option));
      return await publishVariableChange(next, previous, option);
    };
    const insertOrAssignVariables = async (variables: unknown, option?: unknown) => {
      const current = getVariables(option);
      const next = isRecord(variables)
        ? mergeVariableRecords(current, cloneValue(variables))
        : current;
      this.saveVariables(option, resolveVariableScriptId(option), next);
      return await publishVariableChange(next, current, option);
    };
    const insertVariables = async (variables: unknown, option?: unknown) => {
      const current = getVariables(option);
      const next = isRecord(variables)
        ? mergeVariableRecords(cloneValue(variables), current)
        : current;
      this.saveVariables(option, resolveVariableScriptId(option), next);
      return await publishVariableChange(next, current, option);
    };
    const deleteVariable = async (path: unknown, option?: unknown) => {
      const current = getVariables(option);
      const previous = cloneValue(current);
      const deleted = deletePath(current, String(path));
      this.saveVariables(option, resolveVariableScriptId(option), current);
      await publishVariableChange(current, previous, option);
      return { variables: current, delete_occurred: deleted };
    };
    const registerVariableSchema = (schema: unknown, name = getScriptId()) => {
      this.variableSchemas.set(String(name || getScriptId()), schema);
      return () => this.variableSchemas.delete(String(name || getScriptId()));
    };
    const mvu = isRecord(win.Mvu) ? win.Mvu : {};
    const mvuEvents = isRecord(mvu.events) ? mvu.events : {};
    Object.assign(mvuEvents, {
      VARIABLE_INITIALIZED:
        mvuEvents.VARIABLE_INITIALIZED ?? "mag_variable_initialized",
      VARIABLE_UPDATE_ENDED:
        mvuEvents.VARIABLE_UPDATE_ENDED ?? "mag_variable_update_ended",
    });
    Object.assign(mvu, {
      events: mvuEvents,
      getMvuData: getVariables,
      getData: getVariables,
      setMvuData: replaceVariables,
      replaceMvuData: replaceVariables,
      setData: replaceVariables,
      updateMvuData: updateVariablesWith,
      updateData: updateVariablesWith,
      isDuringExtraAnalysis: () => false,
      registerMvuSchema: registerVariableSchema,
    });
    win.Mvu = mvu;

    const getCharacter = () => this.localizePlaceholderImages(this.adapter.getCharacter());
    const getGlobalWorldBooks = () =>
      this.adapter.getWorldBooks().filter((book) => book.scope === "global");
    const getCharacterWorldBook = () => getCharacter()?.worldBook ?? null;
    const getWorldBooks = () => {
      const characterBook = getCharacterWorldBook();
      const globalBooks = getGlobalWorldBooks();
      if (!characterBook) return globalBooks;
      return [
        characterBook,
        ...globalBooks.filter(
          (book) => book.id !== characterBook.id || book.name !== characterBook.name,
        ),
      ];
    };
    const findWorldBook = (name: unknown) => {
      const normalizedName = String(name ?? "").trim();
      if (!normalizedName) return null;
      const characterBook = getCharacterWorldBook();
      if (characterBook?.name === normalizedName) return characterBook;
      return getGlobalWorldBooks().find((book) => book.name === normalizedName) ?? null;
    };
    const requireWorldBook = (name: unknown) => {
      const book = findWorldBook(name);
      if (!book) throw new Error(`未能找到世界书 '${String(name)}'`);
      return book;
    };
    const getWorldbookNames = () =>
      Array.from(new Set(getWorldBooks().map((book) => book.name)));
    const getGlobalWorldbookNames = () =>
      getGlobalWorldBooks().filter((book) => book.active).map((book) => book.name);
    const readWorldbook = (name: unknown) => {
      const book = findWorldBook(name);
      return book ? cloneValue(formatTavernWorldBookEntries(book)) : [];
    };
    const getWorldbook = async (name: unknown) =>
      cloneValue(formatTavernWorldBookEntries(requireWorldBook(name)));
    const loadWorldInfo = async (name: unknown) => {
      const book = findWorldBook(name);
      if (!book) return null;
      const uids = assignTavernWorldbookUids(book.entries);
      return {
        name: book.name,
        entries: Object.fromEntries(
          book.entries.map((entry, index) => [
            String(uids[index]),
            formatSillyTavernWorldInfoEntry(entry, uids[index], index),
          ]),
        ),
      };
    };
    const listWorldBookRecords = () =>
      getWorldBooks().map((book) => ({
        id: book.id,
        name: book.name,
        description: book.description,
        global: book.scope === "global",
        active: book.active,
        entries: readWorldbook(book.name),
      }));
    const getLorebooks = () => getWorldbookNames();
    const getLorebookEntries = async (name: unknown) =>
      cloneValue(formatTavernLorebookEntries(requireWorldBook(name)));
    const getCharWorldbookNames = (_character: unknown = "current") => {
      const primary = getCharacterWorldBook()?.name ?? null;
      // Renge keeps one worldbook per card; the other books that apply to the
      // character's chats are the enabled global ones.
      const additional = getGlobalWorldBooks()
        .filter((book) => book.active && book.name !== primary)
        .map((book) => book.name);
      return { primary, additional };
    };
    const getCharLorebooks = (option: unknown = {}) => {
      const type = isRecord(option) ? String(option.type ?? "all") : "all";
      const names = getCharWorldbookNames();
      return {
        primary: type === "additional" ? null : names.primary,
        additional: type === "primary" ? [] : names.additional,
      };
    };
    const getCurrentCharPrimaryLorebook = () => getCharacterWorldBook()?.name ?? null;
    const notifyWorldbookUpdated = async (name: string) => {
      await this.adapter.flushPersistence?.();
      const book = findWorldBook(name);
      const data = await loadWorldInfo(name);
      this.adapter.onScriptEvent?.(TAVERN_EVENTS.WORLDINFO_UPDATED, [name, cloneValue(data)]);
      await this.emit(TAVERN_EVENTS.WORLDINFO_UPDATED, name, data ?? { name, entries: {} });
      return book;
    };
    const persistWorldBookEntries = (
      book: TavernRuntimeWorldBook,
      values: unknown[],
    ) => {
      const lookup = createTavernWorldBookEntryLookup(book);
      const reused = new Set<string>();
      const ids = new Set<string>();
      const entries = values.map((value, index) => {
        const candidate = lookup.find(value);
        // A script may clone a row; only the first copy keeps the stored identity.
        const fallback = candidate && !reused.has(candidate.id) ? candidate : undefined;
        if (fallback) reused.add(fallback.id);
        const entry = normalizeTavernWorldBookEntry(value, index, fallback);
        if (ids.has(entry.id)) entry.id = `worldbook-entry-${crypto.randomUUID()}`;
        ids.add(entry.id);
        return entry;
      });
      const nextBook: TavernRuntimeWorldBook = {
        ...book,
        entries,
        updatedAt: new Date().toISOString(),
      };
      this.adapter.setWorldBook(nextBook);
      return nextBook;
    };
    const createWorldBookRecord = (name: string, entries: unknown[]) => {
      const timestamp = new Date().toISOString();
      const createdBook: TavernRuntimeWorldBook = {
        id: `worldbook-${crypto.randomUUID()}`,
        name,
        description: "",
        entries: [],
        scope: "global",
        active: false,
        sourceFormat: "sillytavern",
        sourceFileName: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return persistWorldBookEntries(createdBook, entries);
    };
    const createWorldbook = async (name: unknown, entries: unknown = []) => {
      const normalizedName = String(name ?? "").trim();
      if (!normalizedName || findWorldBook(normalizedName)) return false;
      createWorldBookRecord(normalizedName, Array.isArray(entries) ? entries : []);
      await notifyWorldbookUpdated(normalizedName);
      return true;
    };
    /** Resolves `true` when the book was created and `false` when replaced. */
    const createOrReplaceWorldbook = async (name: unknown, entries: unknown = []) => {
      const normalizedName = String(name ?? "").trim();
      if (!normalizedName) throw new Error("世界书名称不能为空。");
      const values = Array.isArray(entries) ? entries : [];
      const existingBook = findWorldBook(normalizedName);
      if (existingBook) persistWorldBookEntries(existingBook, values);
      else createWorldBookRecord(normalizedName, values);
      await notifyWorldbookUpdated(normalizedName);
      return !existingBook;
    };
    const replaceWorldbook = async (name: unknown, entries: unknown) => {
      const book = requireWorldBook(name);
      if (!Array.isArray(entries)) throw new Error("世界书条目必须是数组。");
      persistWorldBookEntries(book, entries);
      await notifyWorldbookUpdated(book.name);
      return true;
    };
    const saveWorldInfo = async (name: unknown, data: unknown) => {
      const rawEntries = isRecord(data) ? data.entries : undefined;
      const values = Array.isArray(rawEntries)
        ? rawEntries
        : isRecord(rawEntries)
          ? Object.values(rawEntries)
          : null;
      if (!values) return false;
      await createOrReplaceWorldbook(name, values);
      return true;
    };
    const deleteWorldbook = async (name: unknown) => {
      const book = findWorldBook(name);
      if (!book || !this.adapter.deleteWorldBook) return false;
      this.adapter.deleteWorldBook(book.id || book.name);
      await this.adapter.flushPersistence?.();
      return true;
    };
    const rebindGlobalWorldbooks = async (names: unknown) => {
      if (!Array.isArray(names) || !this.adapter.setActiveWorldBookNames) return false;
      const availableNames = new Set(getGlobalWorldBooks().map((book) => book.name));
      const nextNames = Array.from(
        new Set(
          names
            .map(String)
            .map((name) => name.trim())
            .filter((name) => availableNames.has(name)),
        ),
      );
      this.adapter.setActiveWorldBookNames(nextNames);
      await this.adapter.flushPersistence?.();
      return true;
    };
    const enableGlobalWorldbooks = async (names: unknown[]) => {
      const active = getGlobalWorldbookNames();
      const additions = names.map(String).filter((name) => !active.includes(name));
      if (additions.length > 0) await rebindGlobalWorldbooks([...active, ...additions]);
    };
    const rebindCharWorldbooks = async (character: unknown, bindings: unknown) => {
      const normalized = isRecord(bindings) ? bindings : {};
      if (Array.isArray(normalized.additional)) await enableGlobalWorldbooks(normalized.additional);
      if (!("primary" in normalized)) return;
      const primary = normalized.primary == null ? null : String(normalized.primary).trim() || null;
      const target = String(character ?? "current");
      const isCurrent = target === "current" || target === getCharacter()?.name;
      const currentBook = isCurrent ? getCharacterWorldBook() : null;
      if (isCurrent && (currentBook?.name ?? null) === primary) return;
      if (primary && !findWorldBook(primary)) throw new Error(`未能找到世界书 '${primary}'`);
      if (!this.adapter.setCharacterWorldbookName) throw new Error("当前环境不支持修改角色卡世界书绑定。");
      // The card's embedded book would otherwise be lost: SillyTavern keeps it
      // in the library, so move it there before changing the binding.
      if (currentBook && currentBook.scope === "character" && !getGlobalWorldBooks().some((book) => book.name === currentBook.name)) {
        this.adapter.setWorldBook({
          ...cloneValue(currentBook),
          id: `worldbook-${crypto.randomUUID()}`,
          scope: "global",
          active: false,
        });
      }
      if (isCurrent) this.adapter.resetCharacterWorldBookBinding?.();
      this.adapter.setCharacterWorldbookName(target, primary);
      await this.adapter.flushPersistence?.();
    };
    const readChatWorldbookName = () => {
      const metadata = this.adapter.getChatMetadata?.() ?? {};
      const storedName = String(metadata.world_info ?? metadata.rengeChatWorldbookName ?? "").trim();
      return storedName && findWorldBook(storedName) ? storedName : null;
    };
    const getChatWorldbookName = (_chat: unknown = "current") => readChatWorldbookName();
    const rebindChatWorldbook = async (_chat: unknown, name: unknown) => {
      const metadata = { ...(this.adapter.getChatMetadata?.() ?? {}) };
      const worldbookName = name == null ? "" : String(name).trim();
      if (worldbookName) {
        requireWorldBook(worldbookName);
        metadata.world_info = worldbookName;
        metadata.rengeChatWorldbookName = worldbookName;
        // Renge has no per-chat book list, so a chat binding enables the book.
        if (getGlobalWorldBooks().some((book) => book.name === worldbookName)) {
          await enableGlobalWorldbooks([worldbookName]);
        }
      } else {
        delete metadata.world_info;
        delete metadata.rengeChatWorldbookName;
      }
      this.adapter.setChatMetadata?.(metadata);
      this.syncChatMetadata?.();
      await this.adapter.flushPersistence?.();
    };
    const getOrCreateChatWorldbook = async (chatOrName: unknown = "current", requestedName?: unknown) => {
      // Tavern Helper 4 takes ('current', name?); version 3 took (name?).
      const explicitName = String(
        (requestedName ?? (chatOrName === "current" ? "" : chatOrName)) ?? "",
      ).trim();
      if (explicitName) {
        if (!findWorldBook(explicitName)) await createWorldbook(explicitName, []);
        await rebindChatWorldbook("current", explicitName);
        return explicitName;
      }
      const storedName = readChatWorldbookName();
      if (storedName) return storedName;
      // Edits to the card's book are stored per conversation, which is what a
      // chat-bound worldbook is for.
      const characterBook = getCharacterWorldBook();
      if (characterBook) return characterBook.name;
      const activeBook = getGlobalWorldBooks().find((book) => book.active);
      if (activeBook) return activeBook.name;
      const generatedName = `会话世界书-${this.adapter.getChatId()}`;
      if (!findWorldBook(generatedName)) await createWorldbook(generatedName, []);
      await rebindChatWorldbook("current", generatedName);
      return generatedName;
    };
    const updateWorldbookWith = async (name: unknown, updater: unknown) => {
      const book = requireWorldBook(name);
      if (typeof updater !== "function") throw new Error("updateWorldbookWith 需要一个更新函数。");
      const currentEntries = cloneValue(formatTavernWorldBookEntries(book));
      const result = await (updater as (entries: Array<Record<string, unknown>>) => unknown)(
        currentEntries as Array<Record<string, unknown>>,
      );
      const nextEntries = Array.isArray(result)
        ? result
        : isRecord(result) && Array.isArray(result.entries)
          ? result.entries
          : currentEntries;
      const persisted = persistWorldBookEntries(book, nextEntries);
      await notifyWorldbookUpdated(book.name);
      return cloneValue(formatTavernWorldBookEntries(persisted));
    };
    const appendWorldBookEntries = async (name: unknown, entries: unknown) => {
      const book = requireWorldBook(name);
      if (!Array.isArray(entries)) throw new Error("世界书条目必须是数组。");
      const existing = formatTavernWorldBookEntries(book);
      // New rows never adopt the identity of a stored entry.
      const additions = entries.map((entry) =>
        isRecord(entry) ? { ...entry, uid: undefined, id: undefined } : entry,
      );
      const persisted = persistWorldBookEntries(book, [...existing, ...additions]);
      await notifyWorldbookUpdated(book.name);
      const formatted = cloneValue(formatTavernWorldBookEntries(persisted));
      return { book: persisted, worldbook: formatted, new_entries: formatted.slice(existing.length) };
    };
    const createWorldbookEntries = async (name: unknown, entries: unknown) => {
      const { worldbook, new_entries } = await appendWorldBookEntries(name, entries);
      return { worldbook, new_entries };
    };
    const removeWorldBookEntries = async (name: unknown, idsOrPredicate: unknown) => {
      const book = requireWorldBook(name);
      const formattedEntries = cloneValue(formatTavernWorldBookEntries(book));
      let removed: boolean[];
      if (typeof idsOrPredicate === "function") {
        removed = formattedEntries.map((entry, index) => {
          try {
            return Boolean(
              (idsOrPredicate as (value: unknown, index: number) => unknown)(entry, index),
            );
          } catch {
            return false;
          }
        });
      } else {
        const lookup = createTavernWorldBookEntryLookup(book);
        const values = Array.isArray(idsOrPredicate) ? idsOrPredicate : [idsOrPredicate];
        const targets = new Set(values.map((value) => lookup.find(value)?.id).filter(Boolean));
        removed = book.entries.map((entry) => targets.has(entry.id));
      }
      const persisted = persistWorldBookEntries(
        book,
        formattedEntries.filter((_entry, index) => !removed[index]),
      );
      await notifyWorldbookUpdated(book.name);
      return {
        book: persisted,
        worldbook: cloneValue(formatTavernWorldBookEntries(persisted)),
        deleted_entries: formattedEntries.filter((_entry, index) => removed[index]),
      };
    };
    const deleteWorldbookEntries = async (name: unknown, idsOrPredicate: unknown) => {
      const { worldbook, deleted_entries } = await removeWorldBookEntries(name, idsOrPredicate);
      return { worldbook, deleted_entries };
    };
    const replaceLorebookEntries = async (name: unknown, entries: unknown) => {
      const book = requireWorldBook(name);
      if (!Array.isArray(entries)) throw new Error("世界书条目必须是数组。");
      persistWorldBookEntries(book, entries);
      await notifyWorldbookUpdated(book.name);
    };
    const updateLorebookEntriesWith = async (name: unknown, updater: unknown) => {
      const book = requireWorldBook(name);
      const current = cloneValue(formatTavernLorebookEntries(book));
      const result = typeof updater === "function"
        ? await (updater as (entries: unknown[]) => unknown)(current)
        : current;
      const persisted = persistWorldBookEntries(book, Array.isArray(result) ? result : current);
      await notifyWorldbookUpdated(book.name);
      return cloneValue(formatTavernLorebookEntries(persisted));
    };
    const setLorebookEntries = async (name: unknown, entries: unknown) => {
      const book = requireWorldBook(name);
      if (!Array.isArray(entries)) throw new Error("世界书条目必须是数组。");
      const lookup = createTavernWorldBookEntryLookup(book);
      const patches = new Map<string, Record<string, unknown>>();
      entries.filter(isRecord).forEach((patch) => {
        const target = lookup.find(patch);
        if (!target) throw new Error(`未能找到世界书条目：${String(patch.uid ?? patch.id)}`);
        patches.set(target.id, patch);
      });
      const persisted = persistWorldBookEntries(
        book,
        book.entries.map((entry, index) => {
          const patch = patches.get(entry.id);
          return patch ? { ...patch, uid: lookup.uids[index] } : { uid: lookup.uids[index] };
        }),
      );
      await notifyWorldbookUpdated(book.name);
      return cloneValue(formatTavernLorebookEntries(persisted));
    };
    const createLorebookEntries = async (name: unknown, entries: unknown) => {
      const { book, new_entries } = await appendWorldBookEntries(name, entries);
      return {
        entries: cloneValue(formatTavernLorebookEntries(book)),
        new_uids: new_entries.map((entry) => entry.uid),
      };
    };
    const createLorebookEntry = async (name: unknown, entry: unknown) =>
      (await createLorebookEntries(name, [entry])).new_uids[0] ?? null;
    const deleteLorebookEntries = async (name: unknown, uids: unknown) => {
      const { book, deleted_entries } = await removeWorldBookEntries(name, uids);
      return {
        entries: cloneValue(formatTavernLorebookEntries(book)),
        delete_occurred: deleted_entries.length > 0,
      };
    };
    const deleteLorebookEntry = async (name: unknown, entryId: unknown) =>
      (await deleteLorebookEntries(name, [entryId])).delete_occurred;
    const updateWorldbookEntry = async (
      name: unknown,
      entryId: unknown,
      updates: unknown,
    ) => {
      const book = findWorldBook(name);
      if (!book || !isRecord(updates)) return null;
      const lookup = createTavernWorldBookEntryLookup(book);
      const target = lookup.find(entryId);
      if (!target) return null;
      const index = book.entries.indexOf(target);
      const persisted = persistWorldBookEntries(
        book,
        book.entries.map((_entry, entryIndex) =>
          entryIndex === index
            ? { ...cloneValue(updates), uid: lookup.uids[entryIndex] }
            : { uid: lookup.uids[entryIndex] },
        ),
      );
      await notifyWorldbookUpdated(book.name);
      return cloneValue(formatTavernWorldBookEntries(persisted)[index] ?? null);
    };
    const getWorldbookEntry = (name: unknown, entryId: unknown) => {
      const book = findWorldBook(name);
      if (!book) return null;
      const target = createTavernWorldBookEntryLookup(book).find(entryId);
      return target ? cloneValue(formatTavernWorldBookEntries(book)[book.entries.indexOf(target)]) : null;
    };
    const getWorldbookEntryByKey = (name: unknown, key: unknown) => {
      const normalizedKey = String(key ?? "").trim();
      return (
        readWorldbook(name).find(
          (entry) =>
            entry.name === normalizedKey ||
            entry.strategy.keys.some((entryKey: string) => entryKey === normalizedKey),
        ) ?? null
      );
    };
    const getLorebookSettings = () => {
      const activeGlobalNames = getGlobalWorldbookNames();
      return {
        selected_global_lorebooks: activeGlobalNames,
        selected_world_info: activeGlobalNames,
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
    const setLorebookSettings = async (settings: unknown) => {
      if (isRecord(settings) && Array.isArray(settings.selected_global_lorebooks)) {
        await rebindGlobalWorldbooks(settings.selected_global_lorebooks);
      }
      return true;
    };
    const setCurrentCharLorebooks = async (bindings: unknown) =>
      await rebindCharWorldbooks("current", bindings);
    const getChatLorebook = () => readChatWorldbookName();
    const setChatLorebook = async (name: unknown) => await rebindChatWorldbook("current", name);
    const getOrCreateChatLorebook = async (name?: unknown) =>
      await getOrCreateChatWorldbook("current", name);
    const createLorebook = async (name: unknown) => await createWorldbook(name, []);
    const worldbookManager = {
      getWorldbookNames,
      getGlobalWorldbookNames,
      getWorldbook,
      getLorebooks,
      getLorebookEntries,
      getLorebookSettings,
      setLorebookSettings,
      createWorldbook,
      createOrReplaceWorldbook,
      replaceWorldbook,
      deleteWorldbook,
      rebindGlobalWorldbooks,
      rebindCharWorldbooks,
      getChatWorldbookName,
      rebindChatWorldbook,
      getOrCreateChatWorldbook,
      setLorebookEntries,
      replaceLorebookEntries,
      updateLorebookEntriesWith,
      createLorebookEntry,
      createLorebookEntries,
      deleteLorebookEntry,
      getCharWorldbookNames,
      getCharLorebooks,
      getCurrentCharPrimaryLorebook,
      updateWorldbookWith,
      createWorldbookEntries,
      deleteWorldbookEntries,
      deleteLorebookEntries,
      updateWorldbookEntry,
      getWorldbookEntry,
      getWorldbookEntryByKey,
    };

    const macroRegistry = createTavernMacroRegistry(() => ({
      message_id: this.adapter.getMessages().length - 1,
      chat_id: this.adapter.getChatId(),
      script_id: getScriptId(),
    }));
    const registerMacroLike = macroRegistry.registerMacroLike;
    const substitudeMacros = (value: unknown) =>
      macroRegistry.substitute(
        String(value ?? "")
        .replace(/{{\s*user\s*}}/gi, this.adapter.getUserName() || "用户")
        .replace(/{{\s*char\s*}}/gi, getCharacter()?.name || "角色")
        .replace(/<USER>/gi, this.adapter.getUserName() || "用户")
        .replace(/<BOT>/gi, getCharacter()?.name || "角色"),
      );
    const getTavernRegexes = (options: unknown = {}) => {
      const normalizedOptions = isRecord(options) ? options : {};
      const scope = String(normalizedOptions.type ?? normalizedOptions.scope ?? "all");
      const enableState = String(normalizedOptions.enable_state ?? "all");
      return this.adapter
        .getRegexes()
        .map((regex) => normalizeTavernRegexRecord(regex))
        .filter((regex) => scope === "all" || regex.scope === scope)
        .filter((regex) => {
          if (enableState === "enabled") return regex.disabled !== true;
          if (enableState === "disabled") return regex.disabled === true;
          return true;
        })
        .map((regex) => cloneValue(regex));
    };
    const replaceTavernRegexes = async (values: unknown, options: unknown = {}) => {
      if (!Array.isArray(values)) return false;
      const normalizedOptions = isRecord(options) ? options : {};
      const scope = String(normalizedOptions.type ?? normalizedOptions.scope ?? "all");
      const incoming = values.map((value) =>
        normalizeTavernRegexRecord(value, scope === "all" ? "global" : scope, true),
      );
      if (scope === "all") {
        this.adapter.setRegexes(incoming);
        await this.adapter.flushPersistence?.();
        return true;
      }
      const retained = getTavernRegexes({ scope: "all", enable_state: "all" }).filter(
        (regex) => regex.scope !== scope,
      );
      this.adapter.setRegexes([
        ...retained,
        ...incoming.map((regex) => ({ ...regex, scope })),
      ]);
      await this.adapter.flushPersistence?.();
      return true;
    };
    const updateTavernRegexesWith = async (updater: unknown, options: unknown = {}) => {
      const current = getTavernRegexes(options);
      const updated =
        typeof updater === "function"
          ? await (updater as (regexes: Array<Record<string, unknown>>) => unknown)(current)
          : current;
      const next = Array.isArray(updated) ? updated : current;
      await replaceTavernRegexes(next, options);
      return getTavernRegexes(options);
    };
    const importRawTavernRegex = (fileNameOrValue: unknown, rawValue?: unknown) => {
      const sourceFileName = rawValue === undefined ? "" : String(fileNameOrValue ?? "");
      let parsed: unknown = rawValue === undefined ? fileNameOrValue : rawValue;
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      const imported = values.filter(isRecord).map((value) =>
        normalizeTavernRegexRecord(
          {
            ...value,
            scope: value.scope ?? "global",
            sourceFormat: "sillytavern",
            sourceFileName,
          },
          "global",
        ),
      );
      if (imported.length === 0) throw new Error("没有找到可导入的酒馆正则。");
      this.adapter.setRegexes([
        ...getTavernRegexes({ scope: "all", enable_state: "all" }),
        ...imported,
      ]);
      return cloneValue(imported);
    };
    const createTavernRegex = (value: unknown, scope = "global") => {
      const created = normalizeTavernRegexRecord(
        {
          ...(isRecord(value) ? value : {}),
          id: isRecord(value) && value.id ? value.id : `regex-${crypto.randomUUID()}`,
          scope,
        },
        scope,
      );
      this.adapter.setRegexes([
        ...getTavernRegexes({ scope: "all", enable_state: "all" }),
        created,
      ]);
      return cloneValue(created);
    };
    const deleteTavernRegex = (regexId: unknown, scope = "all") => {
      const current = getTavernRegexes({ scope: "all", enable_state: "all" });
      const next = current.filter(
        (regex) =>
          regex.id !== String(regexId) || (scope !== "all" && regex.scope !== scope),
      );
      if (next.length === current.length) return false;
      this.adapter.setRegexes(next);
      return true;
    };
    const formatAsTavernRegexedString = (
      value: unknown,
      source = "ai_output",
      destination = "display",
      options: unknown = {},
    ) => {
      const normalizedOptions = isRecord(options) ? options : {};
      const depth = Number(normalizedOptions.depth ?? 0) || 0;
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
    const chatMetadata = cloneValue(this.adapter.getChatMetadata?.() ?? {});
    this.syncChatMetadata = () => {
      const latestMetadata = cloneValue(this.adapter.getChatMetadata?.() ?? {});
      Object.keys(chatMetadata).forEach((key) => delete chatMetadata[key]);
      Object.assign(chatMetadata, latestMetadata);
    };
    const saveChat = async () => {
      this.adapter.setChatMetadata?.(cloneValue(chatMetadata));
      this.persistSillyTavernChatCache();
      await this.adapter.flushPersistence?.();
      return true;
    };
    const updateChatMetadata = async (patch: unknown, reset = false) => {
      const next = reset
        ? isRecord(patch) ? cloneValue(patch) : {}
        : isRecord(patch) ? mergeVariableRecords(chatMetadata, patch) : cloneValue(chatMetadata);
      Object.keys(chatMetadata).forEach((key) => delete chatMetadata[key]);
      Object.assign(chatMetadata, next);
      this.adapter.setChatMetadata?.(cloneValue(chatMetadata));
      await this.adapter.flushPersistence?.();
      return cloneValue(chatMetadata);
    };
    const deleteLastMessage = async () => {
      if (this.sillyTavernChatCache.length === 0) return false;
      this.sillyTavernChatCache.pop();
      this.persistSillyTavernChatCache();
      await this.adapter.flushPersistence?.();
      await this.emit(TAVERN_EVENTS.MESSAGE_DELETED, this.sillyTavernChatCache.length);
      return true;
    };
    const stopGeneration = () => this.adapter.stopGeneration?.();
    const host = this.hostWindow as unknown as Record<string, unknown>;
    const hostSillyTavern = isRecord(host.SillyTavern) ? host.SillyTavern : {};
    const chatCompletionSettings: Record<string, unknown> = isRecord(host.chatCompletionSettings)
      ? host.chatCompletionSettings
      : isRecord(host.chat_completion_settings)
        ? host.chat_completion_settings
        : isRecord(hostSillyTavern.chatCompletionSettings)
          ? hostSillyTavern.chatCompletionSettings
          : {};
    const chatCompletionDefaults: Record<string, unknown> = {
      function_calling: true,
      tool_calling: true,
      temperature: 1,
      max_tokens: 4096,
    };
    Object.entries(chatCompletionDefaults).forEach(([key, value]) => {
      if (chatCompletionSettings[key] === undefined) chatCompletionSettings[key] = value;
    });
    const syncChatCompletionSettingsFromPreset = () => {
      const preset = this.adapter.getPresetState?.();
      if (!preset) {
        chatCompletionSettings.prompts = [];
        return null;
      }
      const currentPrompts = Array.isArray(chatCompletionSettings.prompts)
        ? chatCompletionSettings.prompts.filter(isRecord)
        : [];
      const promptsByIdentifier = new Map(
        currentPrompts.map((prompt) => [String(prompt.identifier ?? prompt.id ?? ""), prompt]),
      );
      chatCompletionSettings.prompts = preset.prompts.map((prompt) => {
        const current = promptsByIdentifier.get(prompt.identifier) ?? {};
        Object.assign(current, cloneValue(prompt));
        return current;
      });
      chatCompletionSettings.top_p_openai = preset.topP;
      chatCompletionSettings.top_p = preset.topP;
      chatCompletionSettings.custom_include_body = preset.customIncludeBody;
      chatCompletionSettings.custom_exclude_body = preset.customExcludeBody;
      return preset;
    };
    syncChatCompletionSettingsFromPreset();
    const getChatCompletionModel = () =>
      String(
        [
          chatCompletionSettings.custom_model,
          chatCompletionSettings.model,
          chatCompletionSettings.openai_model,
          chatCompletionSettings.model_openai,
        ].find((value) => typeof value === "string" && value.trim()) ?? "",
      ).trim() || (this.adapter.getModelId?.() ?? "");
    const getContext = () => {
      const character = this.adapter.getCharacter();
      return {
        chat: this.getSillyTavernChat(),
        characters: this.getSillyTavernCharacters(),
        characterId: character ? "0" : undefined,
        this_chid: character ? 0 : undefined,
        name1: this.adapter.getUserName() || "User",
        name2: character?.name || "Assistant",
        chatId: this.adapter.getChatId(),
        eventSource,
        eventTypes: TAVERN_EVENTS,
        event_types: TAVERN_EVENTS,
        chatMetadata,
        chat_metadata: chatMetadata,
        extensionSettings,
        extension_settings: extensionSettings,
        saveChat,
        saveSettingsDebounced,
        setChatMessages,
        deleteLastMessage,
        stopGeneration,
        updateChatMetadata,
        loadWorldInfo,
        getWorldBooks: listWorldBookRecords,
        saveWorldInfo,
        substituteParams: (value: unknown) => substitudeMacros(value),
        createOrReplaceWorldbook,
        replaceWorldbook,
        deleteWorldbook,
        rebindGlobalWorldbooks,
        getOrCreateChatWorldbook,
        chatCompletionSettings,
        powerUserSettings: {},
        getRequestHeaders: () => ({ "Content-Type": "application/json" }),
      };
    };

    const toastr = {
      success: (message: unknown, title?: unknown) =>
        this.adapter.onNotice?.("success", String(message), String(title ?? "")),
      info: (message: unknown, title?: unknown) =>
        this.adapter.onNotice?.("info", String(message), String(title ?? "")),
      warning: (message: unknown, title?: unknown) =>
        this.adapter.onNotice?.("warning", String(message), String(title ?? "")),
      error: (message: unknown, title?: unknown) =>
        this.adapter.onNotice?.("error", String(message), String(title ?? "")),
      clear: () => undefined,
    };
    const errorCatched = createTavernErrorCatched((error) => {
      win.console.error("[TavernHelper] 角色卡回调执行失败", error);
    });

    const storedExtensionSettings = this.adapter.getExtensionSettings?.() ?? getPath(
      this.adapter.getGlobalVariables(),
      TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY,
      {},
    );
    const extensionSettings = isRecord(storedExtensionSettings)
      ? storedExtensionSettings
      : {};
    const saveSettingsDebounced = () => {
      let saved: void | Promise<void> = undefined;
      if (this.adapter.setExtensionSettings) {
        saved = this.adapter.setExtensionSettings(extensionSettings);
      } else {
        const variables = cloneValue(this.adapter.getGlobalVariables());
        variables[TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY] = cloneValue(extensionSettings);
        this.adapter.setGlobalVariables(variables);
      }

      const preset = this.adapter.getPresetState?.();
      if (!preset || !this.adapter.savePresetSettings) return saved;
      const completionPrompts = Array.isArray(chatCompletionSettings.prompts)
        ? chatCompletionSettings.prompts.filter(isRecord)
        : [];
      const promptsByIdentifier = new Map(
        completionPrompts.map((prompt) => [
          String(prompt.identifier ?? prompt.id ?? ""),
          prompt,
        ]),
      );
      const topP = Number(
        chatCompletionSettings.top_p_openai ?? chatCompletionSettings.top_p ?? preset.topP,
      );
      this.adapter.savePresetSettings({
        prompts: preset.prompts.map((prompt) => {
          const completionPrompt = promptsByIdentifier.get(prompt.identifier);
          return {
            ...prompt,
            content:
              typeof completionPrompt?.content === "string"
                ? completionPrompt.content
                : prompt.content,
            enabled:
              typeof completionPrompt?.enabled === "boolean"
                ? completionPrompt.enabled
                : prompt.enabled,
          };
        }),
        topP: Number.isFinite(topP) ? topP : preset.topP,
        customIncludeBody:
          typeof chatCompletionSettings.custom_include_body === "string"
            ? chatCompletionSettings.custom_include_body
            : preset.customIncludeBody,
        customExcludeBody:
          typeof chatCompletionSettings.custom_exclude_body === "string"
            ? chatCompletionSettings.custom_exclude_body
            : preset.customExcludeBody,
      });
      return saved;
    };

    const sillyTavern: Record<string, unknown> = {
      version: SILLYTAVERN_VERSION,
      versionInfo: {
        agent: "Renge",
        pkgVersion: SILLYTAVERN_VERSION,
        gitRevision: "renge-compat",
        gitBranch: "main",
      },
      getContext,
      eventSource,
      eventTypes: TAVERN_EVENTS,
      event_types: TAVERN_EVENTS,
      chatMetadata,
      chat_metadata: chatMetadata,
      extensionSettings,
      extension_settings: extensionSettings,
      saveChat,
      saveSettingsDebounced,
      setChatMessages,
      deleteLastMessage,
      stopGeneration,
      updateChatMetadata,
      getCurrentChatId: () => this.adapter.getChatId(),
      getRequestHeaders: () => ({ "Content-Type": "application/json" }),
      getChatCompletionModel,
      getCharacterCardFields: () => {
        const character = getCharacter();
        return character
          ? {
              name: character.name,
              description: character.description,
              personality: character.personality,
              scenario: character.scenario,
              first_mes: character.firstMessage,
              mes_example: character.messageExample,
            }
          : null;
      },
      getWorldbookNames,
      getWorldBooks: listWorldBookRecords,
      saveWorldInfo,
      substituteParams: (value: unknown) => substitudeMacros(value),
      getGlobalWorldbookNames,
      getWorldbook,
      loadWorldInfo,
      createOrReplaceWorldbook,
      replaceWorldbook,
      deleteWorldbook,
      rebindGlobalWorldbooks,
      getOrCreateChatWorldbook,
      getLorebooks,
      getLorebookEntries,
      getLorebookSettings,
      getCharWorldbookNames,
      getCharLorebooks,
      getCurrentCharPrimaryLorebook,
      worldbookManager,
      lorebookManager: worldbookManager,
      registerMacro: registerMacroLike,
      unregisterMacro: (registration: unknown) =>
        isRecord(registration) && typeof registration.unregister === "function"
          ? registration.unregister()
          : false,
      unregisterFunctionTool: () => true,
      callGenericPopup: async (
        _content: unknown,
        popupType: unknown,
        defaultValue: unknown,
      ) => (popupType === 1 || popupType === "input" ? String(defaultValue ?? "") : true),
      POPUP_TYPE: { TEXT: 0, INPUT: 1, CONFIRM: 2 },
      POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0, CUSTOM1: 2 },
      ToolManager: {
        isToolCallingSupported: () => true,
        getTools: () => [],
      },
      chatCompletionSettings,
    };
    Object.defineProperties(sillyTavern, {
      chat: { get: () => this.getSillyTavernChat(), configurable: true },
      characters: { get: () => this.getSillyTavernCharacters(), configurable: true },
      characterId: { get: () => (this.adapter.getCharacter() ? "0" : undefined), configurable: true },
      this_chid: { get: () => (this.adapter.getCharacter() ? 0 : undefined), configurable: true },
      name1: { get: () => this.adapter.getUserName() || "User", configurable: true },
      name2: { get: () => this.adapter.getCharacter()?.name || "Assistant", configurable: true },
      chatId: { get: () => this.adapter.getChatId(), configurable: true },
      generating: { get: () => this.adapter.isGenerating?.() ?? false, configurable: true },
    });

    const waitGlobalInitialized = async (name = "Mvu", timeout = 30000) =>
      await this.waitForGlobal(String(name), Number(timeout) || 30000);
    const injectedPrompts = this.promptInjections;
    const uninjectPrompts = (ids: unknown) => this.uninjectPrompts(ids);
    const injectPrompts = (prompts: unknown, options: unknown = {}) => this.injectPrompts(prompts, options);
    const getModelList = async (config: unknown = {}) => {
      const normalized = isRecord(config) ? config : {};
      const apiBaseUrl = String(normalized.apiurl ?? normalized.apiBaseUrl ?? "")
        .trim()
        .replace(/\/+$/, "");
      if (!apiBaseUrl) {
        const modelId = this.adapter.getModelId?.() ?? "";
        return modelId ? [modelId] : [];
      }
      const response = await fetch("/api/providers/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiBaseUrl,
          apiKey: String(normalized.key ?? normalized.apiKey ?? ""),
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        data?: Array<{ id?: string }>;
        models?: Array<string | { id?: string; name?: string }>;
        error?: unknown;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `模型列表请求失败：HTTP ${response.status}`,
        );
      }
      return Array.from(
        new Set([
          ...(payload.data ?? []).map((model) => model.id),
          ...(payload.models ?? []).map((model) =>
            typeof model === "string" ? model : model.id ?? model.name,
          ),
        ].filter((model): model is string => Boolean(model))),
      );
    };
    const getInput = () => this.adapter.getInput?.() ?? "";
    const setInput = (value: unknown) => this.adapter.setInput?.(String(value ?? ""));
    const appendInput = (value: unknown) => this.adapter.appendInput?.(String(value ?? ""));
    const sendMessage = async (value: unknown = getInput()) => {
      if (!this.adapter.sendMessage) throw new Error("Renge 会话发送接口尚未初始化。");
      return await this.adapter.sendMessage(String(value ?? ""));
    };
    const triggerSlash = async (command: unknown) => {
      if (!this.adapter.triggerSlash) throw new Error("Renge 斜杠命令接口尚未初始化。");
      return await this.adapter.triggerSlash(String(command ?? ""));
    };
    const generate = async (config?: unknown, rawMode = false) => {
      if (!this.adapter.generate) throw new Error("Renge 独立生成接口尚未初始化。");
      const normalizedConfig: Record<string, unknown> = isRecord(config)
        ? cloneValue(config)
        : { user_input: config };
      const generationId =
        typeof normalizedConfig.generation_id === "string" && normalizedConfig.generation_id.trim()
          ? normalizedConfig.generation_id.trim()
          : crypto.randomUUID();
      normalizedConfig.generation_id = generationId;
      await emitFromScript(
        TAVERN_HELPER_IFRAME_EVENTS.GENERATION_REQUESTED,
        generationId,
        rawMode ? "generateRaw" : "generate",
        cloneValue(normalizedConfig),
      );
      if (
        !rawMode &&
        typeof normalizedConfig.preset_name === "string" &&
        normalizedConfig.preset_name.trim() &&
        normalizedConfig.preset_name.trim() !== "in_use"
      ) {
        const namedPreset = getPreset(normalizedConfig.preset_name.trim());
        const presetPrompts = (Array.isArray(namedPreset.prompts) ? namedPreset.prompts : [])
          .filter(isRecord)
          .filter((prompt) => prompt.enabled !== false);
        const placeholderToMarker: Record<string, string> = {
          worldInfoBefore: "world_info_before",
          personaDescription: "persona_description",
          charDescription: "char_description",
          charPersonality: "char_personality",
          scenario: "scenario",
          worldInfoAfter: "world_info_after",
          dialogueExamples: "dialogue_examples",
          chatHistory: "chat_history",
        };
        const orderedPrompts: unknown[] = [];
        const inChatInjects: Array<Record<string, unknown>> = [];
        presetPrompts.forEach((prompt) => {
          const position = isRecord(prompt.position) ? prompt.position : {};
          const role = prompt.role === "user" || prompt.role === "assistant" ? prompt.role : "system";
          if (position.type === "in_chat") {
            const content = substitudeMacros(prompt.content ?? "");
            if (content.trim()) {
              inChatInjects.push({
                position: "in_chat",
                depth: Math.max(0, Math.trunc(Number(position.depth ?? 4) || 0)),
                order: Number(position.order ?? 100) || 0,
                role,
                content,
              });
            }
            return;
          }
          if (isPresetPlaceholderPrompt(prompt)) {
            const marker = placeholderToMarker[String(prompt.id ?? "")];
            if (marker) orderedPrompts.push(marker);
            return;
          }
          const content = substitudeMacros(prompt.content ?? "");
          if (content.trim()) orderedPrompts.push({ role, content });
        });
        if (!orderedPrompts.includes("user_input")) orderedPrompts.push("user_input");
        normalizedConfig.ordered_prompts = orderedPrompts;
        normalizedConfig.injects = [
          ...(Array.isArray(normalizedConfig.injects) ? normalizedConfig.injects : []),
          ...inChatInjects,
        ];
        const settings = isRecord(namedPreset.settings) ? namedPreset.settings : {};
        const customApiPatch: Record<string, unknown> = isRecord(normalizedConfig.custom_api)
          ? { ...normalizedConfig.custom_api }
          : {};
        if (typeof settings.max_completion_tokens === "number" && customApiPatch.max_tokens === undefined) {
          customApiPatch.max_tokens = settings.max_completion_tokens;
        }
        if (typeof settings.temperature === "number" && customApiPatch.temperature === undefined) {
          customApiPatch.temperature = settings.temperature;
        }
        if (typeof settings.frequency_penalty === "number" && customApiPatch.frequency_penalty === undefined) {
          customApiPatch.frequency_penalty = settings.frequency_penalty;
        }
        if (typeof settings.presence_penalty === "number" && customApiPatch.presence_penalty === undefined) {
          customApiPatch.presence_penalty = settings.presence_penalty;
        }
        if (typeof settings.top_p === "number" && customApiPatch.top_p === undefined) {
          customApiPatch.top_p = settings.top_p;
        }
        if (typeof settings.top_k === "number" && customApiPatch.top_k === undefined) {
          customApiPatch.top_k = settings.top_k;
        }
        if (Object.keys(customApiPatch).length > 0) normalizedConfig.custom_api = customApiPatch;
      }
      const configuredApiUrl = [
        chatCompletionSettings.custom_url,
        chatCompletionSettings.reverse_proxy,
        chatCompletionSettings.apiBaseUrl,
        chatCompletionSettings.apiurl,
      ].find((value) => typeof value === "string" && value.trim()) as string | undefined;
      const configuredModel = [
        chatCompletionSettings.custom_model,
        chatCompletionSettings.model,
        chatCompletionSettings.openai_model,
        chatCompletionSettings.model_openai,
      ].find((value) => typeof value === "string" && value.trim()) as string | undefined;
      if (
        !isRecord(normalizedConfig.custom_api) &&
        configuredApiUrl &&
        configuredModel
      ) {
        normalizedConfig.custom_api = {
          apiurl: configuredApiUrl,
          key:
            chatCompletionSettings.proxy_password ??
            chatCompletionSettings.api_key ??
            chatCompletionSettings.key,
          model: configuredModel,
          max_tokens: chatCompletionSettings.max_tokens,
          temperature: chatCompletionSettings.temperature,
          frequency_penalty: chatCompletionSettings.frequency_penalty,
          presence_penalty: chatCompletionSettings.presence_penalty,
          top_p: chatCompletionSettings.top_p,
          top_k: chatCompletionSettings.top_k,
          custom_include_body: chatCompletionSettings.custom_include_body,
          custom_exclude_body: chatCompletionSettings.custom_exclude_body,
        };
      }
      if (isRecord(normalizedConfig.custom_api)) {
        const customApi = normalizedConfig.custom_api;
        delete customApi.custom_include_headers;
        delete customApi.customIncludeHeaders;
        delete customApi.headers;
        if (
          configuredApiUrl &&
          ![
            customApi.apiurl,
            customApi.apiBaseUrl,
            customApi.base_url,
            customApi.custom_url,
            customApi.reverse_proxy,
            customApi.endpoint,
            customApi.url,
          ].some((value) => typeof value === "string" && value.trim())
        ) {
          customApi.apiurl = configuredApiUrl;
        }
        if (
          configuredModel &&
          ![customApi.model, customApi.modelId, customApi.model_id].some(
            (value) => typeof value === "string" && value.trim(),
          )
        ) {
          customApi.model = configuredModel;
        }
        if (
          ![customApi.key, customApi.apiKey, customApi.api_key, customApi.proxy_password].some(
            (value) => typeof value === "string" && value,
          )
        ) {
          customApi.key =
            chatCompletionSettings.proxy_password ??
            chatCompletionSettings.api_key ??
            chatCompletionSettings.key;
        }
        [
          "custom_include_body",
          "custom_exclude_body",
        ].forEach((key) => {
          if (customApi[key] === undefined && chatCompletionSettings[key] !== undefined) {
            customApi[key] = cloneValue(chatCompletionSettings[key]);
          }
        });
      }
      delete normalizedConfig.custom_include_headers;
      delete normalizedConfig.customIncludeHeaders;
      if (normalizedConfig.quiet === true) {
        const prompts = await this.getPromptInjections();
        const ordered = Array.isArray(normalizedConfig.ordered_prompts)
          ? normalizedConfig.ordered_prompts : Array.isArray(normalizedConfig.prompt)
            ? normalizedConfig.prompt : ["user_input"];
        normalizedConfig.ordered_prompts = [...prompts, ...ordered];
      }
      try {
        return await this.adapter.generate(normalizedConfig);
      } finally {
        Array.from(injectedPrompts.entries()).forEach(([id, injection]) => {
          if (injection.once) injectedPrompts.delete(id);
        });
      }
    };
    // Tavern Helper returns { content, reasoning? } when reasoning is requested.
    const generateWithResultShape = async (config?: unknown, rawMode = false) => {
      const content = await generate(config, rawMode);
      return isRecord(config) && config.should_return_reasoning === true ? { content } : content;
    };
    const stopAllGeneration = () => {
      const generating = this.adapter.isGenerating?.() ?? true;
      void Promise.resolve(this.adapter.stopGeneration?.()).catch(() => undefined);
      return generating;
    };

    // ---- Tavern Helper 4: characters, presets, personas ------------------
    const flushPersistence = async () => {
      await this.adapter.flushPersistence?.();
    };
    const toTargetName = (value: unknown, fallback: string) => String(value ?? "").trim() || fallback;
    const runUpdater = async <T>(updater: unknown, current: T): Promise<T> => {
      if (typeof updater !== "function") return current;
      const updated = await (updater as (value: T) => unknown)(current);
      return (isRecord(updated) ? updated : current) as T;
    };

    const getCharacterNames = () => {
      const names = this.adapter.getCharacterNames?.();
      if (names) return [...names];
      const current = this.adapter.getCharacter();
      return current ? [current.name] : [];
    };
    const getCharacterIds = () => {
      const summaries = this.adapter.getCharacterSummaries?.();
      if (summaries) return summaries.map((summary) => `${summary.id}.png`);
      const current = this.adapter.getCharacter();
      return current ? [`${current.id}.png`] : [];
    };
    const getCurrentCharacterName = () =>
      this.adapter.getCurrentCharacterName?.() ?? this.adapter.getCharacter()?.name ?? null;
    const getCurrentCharacterId = () => {
      const current = this.adapter.getCharacter();
      return current ? `${current.id}.png` : null;
    };
    const findTavernCharacter = (name: unknown) =>
      this.adapter.getTavernCharacter?.(toTargetName(name, "current")) ?? null;
    const readTavernCharacter = async (name: unknown) => {
      const character = findTavernCharacter(name);
      if (!character) throw new Error(`角色卡 '${toTargetName(name, "current")}' 不存在`);
      return this.localizePlaceholderImages(cloneValue(character));
    };
    const saveTavernCharacter = async (name: unknown, character: unknown, mode: TavernHelperSaveMode) => {
      if (!this.adapter.saveTavernCharacter) throw new Error("当前环境不支持修改角色卡。");
      const saved = this.adapter.saveTavernCharacter(
        toTargetName(name, "current"),
        this.restorePlaceholderImages(cloneValue(isRecord(character) ? character : {})),
        mode,
      );
      if (saved) await flushPersistence();
      return saved;
    };
    const createCharacter = async (name: unknown, character: unknown = {}) =>
      await saveTavernCharacter(name, character, "create");
    const createOrReplaceCharacter = async (name: unknown, character: unknown = {}) => {
      const existed = Boolean(findTavernCharacter(name));
      const saved = await saveTavernCharacter(name, character, "upsert");
      return saved && !existed;
    };
    const replaceCharacter = async (name: unknown, character: unknown) => {
      if (!await saveTavernCharacter(name, character, "replace")) {
        throw new Error(`角色卡 '${toTargetName(name, "current")}' 不存在`);
      }
    };
    const updateCharacterWith = async (name: unknown, updater: unknown) => {
      await replaceCharacter(name, await runUpdater(updater, await readTavernCharacter(name)));
      return await readTavernCharacter(name);
    };
    const deleteCharacter = async (name: unknown) => {
      const deleted = this.adapter.deleteTavernCharacter?.(toTargetName(name, "current")) ?? false;
      if (deleted) await flushPersistence();
      return deleted;
    };

    const getCharData = (name: unknown = "current") => {
      const target = toTargetName(name, "current");
      if (this.adapter.getCharacterData) {
        const data = this.adapter.getCharacterData(target, (rawExtensions) =>
          this.localizePlaceholderImages(cloneValue(rawExtensions)),
        );
        if (data && typeof data.avatar === "string") {
          data.avatar = this.localizePlaceholderImages(data.avatar);
        }
        return data;
      }
      const current = this.adapter.getCharacter();
      if (!current || (target !== "current" && target !== current.name)) return null;
      return this.getSillyTavernCharacters()[0] ?? null;
    };
    const getCharAvatarPath = (name: unknown = "current") => {
      const target = toTargetName(name, "current");
      const path = this.adapter.getCharacterAvatarPath?.(target);
      if (path !== undefined) return path ? this.localizePlaceholderImages(path) : null;
      const current = this.adapter.getCharacter();
      return current && (target === "current" || target === current.name)
        ? this.localizePlaceholderImages(current.avatarDataUrl) || null
        : null;
    };
    const getChatHistoryBrief = async (name: unknown = "current") => {
      const target = toTargetName(name, "current");
      const characterName = target === "current" ? getCurrentCharacterName() : target;
      if (!characterName || !getCharacterNames().includes(characterName)) return null;
      return cloneValue(this.adapter.getChatHistory?.(characterName) ?? []);
    };
    const getChatHistoryDetail = async (data: unknown) => {
      if (!Array.isArray(data)) return null;
      return Object.fromEntries(
        data.filter(isRecord).map((item, index) => [
          String(item.file_name ?? item.chat_id ?? index),
          cloneValue(Array.isArray(item.messages) ? item.messages : []),
        ]),
      );
    };
    const readNestedRecord = (value: unknown, ...path: string[]) => {
      let cursor: unknown = value;
      for (const key of path) cursor = isRecord(cursor) ? cursor[key] : undefined;
      return cursor;
    };
    class RawCharacter {
      private readonly characterData: Record<string, unknown>;
      constructor(characterData: unknown) {
        this.characterData = isRecord(characterData) ? characterData : {};
      }
      static find(options: unknown = {}) {
        return getCharData(isRecord(options) ? options.name ?? "current" : "current");
      }
      static findIndex(name: unknown) {
        return getCharacterNames().indexOf(String(name ?? ""));
      }
      static async getChatsFromFiles(data: unknown, _isGroupChat?: unknown) {
        return (await getChatHistoryDetail(data)) ?? {};
      }
      getCardData() {
        return this.characterData;
      }
      getAvatarId() {
        return String(this.characterData.avatar ?? "");
      }
      getRegexScripts() {
        const scripts = readNestedRecord(this.characterData, "data", "extensions", "regex_scripts");
        return Array.isArray(scripts) ? scripts : [];
      }
      getCharacterBook() {
        const book = readNestedRecord(this.characterData, "data", "character_book");
        return isRecord(book) ? book : null;
      }
      getWorldName() {
        return String(readNestedRecord(this.characterData, "data", "extensions", "world") ?? "");
      }
    }

    const default_preset = createTavernHelperDefaultPreset();
    const getPresetNames = () => ["in_use", ...(this.adapter.getPresetNames?.() ?? [])];
    const getLoadedPresetName = () => this.adapter.getLoadedPresetName?.() ?? "";
    const loadPreset = (name: unknown) => this.adapter.loadPreset?.(String(name ?? "")) ?? false;
    const getPreset = (name: unknown = "in_use") => {
      const target = toTargetName(name, "in_use");
      const preset = this.adapter.getTavernPreset?.(target);
      if (preset) return cloneValue(preset);
      // Renge can chat without a preset; Tavern always has one in use.
      if (target === "in_use") return cloneValue(default_preset) as Record<string, unknown>;
      throw new Error(`预设 '${target}' 不存在`);
    };
    const hasPreset = (name: unknown) => {
      const target = toTargetName(name, "in_use");
      return target === "in_use" || Boolean(this.adapter.getTavernPreset?.(target));
    };
    const saveTavernPreset = async (name: unknown, preset: unknown, mode: TavernHelperSaveMode) => {
      if (!this.adapter.saveTavernPreset) throw new Error("当前环境不支持修改预设。");
      const saved = this.adapter.saveTavernPreset(
        toTargetName(name, "in_use"),
        cloneValue(isRecord(preset) ? preset : default_preset),
        mode,
      );
      if (saved) {
        syncChatCompletionSettingsFromPreset();
        this.parentApiBridge?.syncPresetManager();
        await flushPersistence();
      }
      return saved;
    };
    const createPreset = async (name: unknown, preset: unknown = default_preset) =>
      !hasPreset(name) && await saveTavernPreset(name, preset, "create");
    const createOrReplacePreset = async (name: unknown, preset: unknown = default_preset) => {
      const existed = hasPreset(name);
      await saveTavernPreset(name, preset, "upsert");
      return !existed;
    };
    const deletePreset = async (name: unknown) => {
      const deleted = this.adapter.deleteTavernPreset?.(String(name ?? "")) ?? false;
      if (deleted) await flushPersistence();
      return deleted;
    };
    const renamePreset = async (name: unknown, newName: unknown) => {
      const renamed = this.adapter.renameTavernPreset?.(String(name ?? ""), String(newName ?? "")) ?? false;
      if (renamed) await flushPersistence();
      return renamed;
    };
    const replacePreset = async (name: unknown, preset: unknown) => {
      if (!hasPreset(name)) throw new Error(`预设 '${toTargetName(name, "in_use")}' 不存在`);
      await saveTavernPreset(name, preset, "replace");
    };
    const updatePresetWith = async (name: unknown, updater: unknown) => {
      if (!hasPreset(name)) throw new Error(`预设 '${toTargetName(name, "in_use")}' 不存在`);
      const preset = await runUpdater(updater, getPreset(name));
      await replacePreset(name, preset);
      return preset;
    };
    const setPreset = async (name: unknown, preset: unknown) =>
      await updatePresetWith(name, (current: Record<string, unknown>) => {
        const patch = isRecord(preset) ? preset : {};
        return {
          settings: mergeVariableRecords(
            isRecord(current.settings) ? current.settings : {},
            isRecord(patch.settings) ? patch.settings : {},
          ),
          prompts: patch.prompts ?? current.prompts,
          prompts_unused: patch.prompts_unused ?? current.prompts_unused,
          extensions: mergeVariableRecords(
            isRecord(current.extensions) ? current.extensions : {},
            isRecord(patch.extensions) ? patch.extensions : {},
          ),
        };
      });

    const getPersonaRecords = () =>
      this.adapter.getPersonas?.() ?? [
        {
          avatar_id: "user-default.png",
          avatar: "",
          name: this.adapter.getUserName() || "User",
          title: "",
          description: this.adapter.getPersonaDescription?.() ?? "",
          position: 0,
          depth: 2,
          role: 0,
          lorebook: "",
          connections: [],
          is_default: true,
        },
      ];
    const getPersonaNames = () => getPersonaRecords().map((persona) => String(persona.name ?? ""));
    const getPersonaIds = () => getPersonaRecords().map((persona) => String(persona.avatar_id ?? ""));
    const getCurrentPersonaId = () => this.adapter.getCurrentPersonaId?.() || getPersonaIds()[0] || null;
    const findPersona = (id: unknown) => {
      const requested = toTargetName(id, "current");
      const target = requested === "current" ? getCurrentPersonaId() : requested;
      const personas = getPersonaRecords();
      return (
        personas.find((persona) => persona.avatar_id === target) ??
        personas.find((persona) => persona.name === target) ??
        null
      );
    };
    const getCurrentPersonaName = () => {
      const persona = findPersona("current");
      return persona ? String(persona.name ?? "") : null;
    };
    const getPersonaAvatarPath = (id: unknown = "current") => {
      const avatar = findPersona(id)?.avatar;
      return typeof avatar === "string" && avatar ? avatar : null;
    };
    const getPersona = (id: unknown = "current") => {
      const persona = findPersona(id);
      if (!persona) throw new Error(`用户角色 '${toTargetName(id, "current")}' 不存在`);
      return cloneValue(persona);
    };
    const saveTavernPersona = async (id: unknown, persona: unknown, mode: TavernHelperSaveMode) => {
      if (!this.adapter.saveTavernPersona) throw new Error("当前环境不支持修改用户角色。");
      const savedId = this.adapter.saveTavernPersona(
        toTargetName(id, "current"),
        cloneValue(isRecord(persona) ? persona : {}),
        mode,
      );
      if (savedId) await flushPersistence();
      return savedId;
    };
    const createPersona = async (name: unknown, persona: unknown = {}) => {
      if (findPersona(name)) return false;
      const value = isRecord(persona) ? persona : {};
      return Boolean(await saveTavernPersona(name, { ...value, name: value.name ?? String(name ?? "") }, "create"));
    };
    const createOrReplacePersona = async (name: unknown, persona: unknown = {}) => {
      const existed = Boolean(findPersona(name));
      const value = isRecord(persona) ? persona : {};
      await saveTavernPersona(name, existed ? value : { ...value, name: value.name ?? String(name ?? "") }, "upsert");
      return !existed;
    };
    const deletePersona = async (id: unknown) => {
      const deleted = this.adapter.deleteTavernPersona?.(toTargetName(id, "current")) ?? false;
      if (deleted) await flushPersistence();
      return deleted;
    };
    const replacePersona = async (id: unknown, persona: unknown) => {
      if (!findPersona(id) || !await saveTavernPersona(id, persona, "replace")) {
        throw new Error(`用户角色 '${toTargetName(id, "current")}' 不存在`);
      }
    };
    const updatePersonaWith = async (id: unknown, updater: unknown) => {
      await replacePersona(id, await runUpdater(updater, getPersona(id)));
      return getPersona(id);
    };

    // ---- Tavern Helper 4: displayed messages, builtin, misc ---------------
    const resolveDisplayedMessageId = (value: unknown) => {
      const messages = this.adapter.getMessages();
      const findLast = (role: TavernRuntimeMessage["role"]) => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index].role === role) return index;
        }
        return messages.length - 1;
      };
      if (value === "last" || value == null) return messages.length - 1;
      if (value === "last_user") return findLast("user");
      if (value === "last_char") return findLast("assistant");
      return normalizeMessageId(value, messages);
    };
    const formatAsDisplayedMessage = (text: unknown, options: unknown = {}) => {
      const source = isRecord(text) ? String(text.message ?? text.mes ?? text.content ?? "") : String(text ?? "");
      const messageId = resolveDisplayedMessageId(isRecord(options) ? options.message_id : undefined);
      const rendered = this.adapter.formatDisplayedMessage?.(source, messageId);
      if (typeof rendered === "string") return rendered;
      const depth = Math.max(0, this.adapter.getMessages().length - 1 - messageId);
      return formatAsTavernRegexedString(source, "ai_output", "display", { depth });
    };
    const retrieveDisplayedMessage = (messageId: unknown) => {
      const selector = `[mesid="${resolveDisplayedMessageId(messageId)}"] .mes_text`;
      const jquery = (win.jQuery ?? (this.hostWindow as unknown as Record<string, unknown>).jQuery) as
        | ((target: unknown) => { find(query: string): unknown })
        | undefined;
      return typeof jquery === "function"
        ? jquery(this.hostWindow.document).find(selector)
        : this.hostWindow.document.querySelector(selector);
    };
    const reloadChat = async () => {
      this.refreshSillyTavernChatCache();
      await this.adapter.reloadChat?.();
    };
    const refreshOneMessage = async (_messageId?: unknown) => await reloadChat();
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
        collection: (Array.isArray(getPreset("in_use").prompts) ? getPreset("in_use").prompts as unknown[] : [])
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
              ...(isRecord(prompt.extra) ? { extra: cloneValue(prompt.extra) } : {}),
              forbid_overrides: false,
            };
          }),
      }),
      render: () => undefined,
      renderDebounced: () => undefined,
      saveServiceSettings: async () => {
        await saveSettingsDebounced();
      },
    };
    const builtin = {
      addOneMessage: (message: unknown) => {
        // Tavern renders a message that is already part of `chat`; here the
        // chat list is rendered from stored messages, so store the cache.
        if (isRecord(message) && this.sillyTavernChatCache.includes(message)) {
          this.persistSillyTavernChatCache();
        }
      },
      copyText: (text: unknown) => {
        void this.hostWindow.navigator.clipboard?.writeText(String(text ?? "")).catch(() => undefined);
      },
      duringGenerating: () => this.adapter.isGenerating?.() ?? false,
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
        await saveSettingsDebounced();
        await flushPersistence();
      },
      uuidv4: () => crypto.randomUUID(),
    };

    const TAVERN_HELPER_EXTENSION_ID = "JS-Slash-Runner";
    const normalizeExtensionId = (value: unknown) =>
      String(value ?? "").trim().replace(/^third-party\//, "");
    const isInstalledExtension = (extensionId: unknown) => {
      const id = normalizeExtensionId(extensionId);
      return id === TAVERN_HELPER_EXTENSION_ID || (this.adapter.getInstalledExtensionIds?.() ?? []).includes(id);
    };
    const unsupportedExtensionOperation = async () =>
      new Response(JSON.stringify({ error: "Renge 仅支持在设置中管理扩展。" }), {
        status: 501,
        headers: { "Content-Type": "application/json" },
      });

    const getTavernFile = async (path: unknown) =>
      await fetch(String(path ?? "").replace(/^\/?(?:users?\/files\/)?/, "/user/files/"), { cache: "no-store" });
    const uploadTavernFile = async (fileName: unknown, base64: unknown) => {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: String(fileName ?? ""), data: String(base64 ?? "") }),
      });
      const payload = await response.json().catch(() => ({})) as { path?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || `文件上传失败（HTTP ${response.status}）`);
      if (!payload.path) throw new Error("文件上传响应缺少路径");
      return payload.path.replace(/^\/?users?\/files\//, "");
    };
    const deleteTavernFile = async (fileName: unknown) => {
      const response = await fetch("/api/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: String(fileName ?? "").replace(/^\/?users?\/files\//, "") }),
      });
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`文件删除失败（HTTP ${response.status}）`);
      return true;
    };

    const importRawFile = async (
      kind: "character" | "chat" | "preset" | "worldbook",
      fileName: unknown,
      content: unknown,
    ) => {
      const imported = await this.adapter.importRawFile?.(
        kind,
        String(fileName ?? ""),
        content instanceof Blob || (isRecord(content) && typeof (content as { arrayBuffer?: unknown }).arrayBuffer === "function")
          ? (content as Blob)
          : String(content ?? ""),
      ) ?? false;
      if (imported) await flushPersistence();
      return imported;
    };
    const importRawResponse = async (kind: "character" | "chat" | "worldbook", fileName: unknown, content: unknown) => {
      let imported = false;
      let message = "";
      try {
        imported = await importRawFile(kind, fileName, content);
      } catch (error) {
        message = toErrorMessage(error);
      }
      return new Response(JSON.stringify(imported ? { ok: true } : { error: message || "Renge 无法导入该文件。" }), {
        status: imported ? 200 : message ? 400 : 501,
        headers: { "Content-Type": "application/json" },
      });
    };

    const getAllEnabledScriptButtons = () =>
      Object.fromEntries(
        this.scripts
          .filter((script) => isTavernScriptEnabled(script) && script.buttonEnabled)
          .map((script) => [
            script.id,
            (this.scriptButtons.get(script.id) ?? [])
              .filter((button) => button.visible)
              .map((button) => ({
                button_id: this.getButtonEventName(script.id, button.name),
                button_name: button.name,
              })),
          ]),
      );
    const initializeGlobal = (name: unknown, value: unknown) => {
      const key = String(name ?? "");
      if (!key) return;
      win[key] = value;
      if (!this.apiOnly) (this.hostWindow as unknown as Record<string, unknown>)[key] = value;
      void emitFromScript(`global_${key}_initialized`);
    };
    this.audioPlayer?.destroy();
    const audioPlayer = createTavernAudioPlayer(this.hostWindow);
    this.audioPlayer = audioPlayer;
    const { destroy: _destroyAudioPlayer, ...audioApi } = audioPlayer;

    const api = {
      ...createTavernScriptTreeApi({
        get: (scope) => this.adapter.getScriptTrees?.(scope) ?? [],
        replace: (trees, scope) => {
          if (!this.adapter.replaceScriptTrees) throw new Error("当前环境不支持修改酒馆脚本库。");
          this.adapter.replaceScriptTrees(trees, scope);
        },
      }),
      getChatMessages,
      setChatMessages,
      setChatMessage,
      createChatMessages,
      deleteChatMessages,
      getLastMessageId: () => this.adapter.getMessages().length - 1,
      getCurrentMessageId: () => this.adapter.getMessages().length - 1,
      getVariables,
      getAllVariables,
      Mvu: mvu,
      errorCatched,
      setVariables: replaceVariables,
      replaceVariables,
      updateVariablesWith,
      insertOrAssignVariables,
      insertVariables,
      deleteVariable,
      registerVariableSchema,
      registerMvuSchema: registerVariableSchema,
      eventOn,
      eventOnce,
      eventEmit: emitFromScript,
      eventEmitAndWait: emitFromScript,
      eventOff: eventRemoveListener,
      eventRemoveListener,
      eventMakeFirst: (eventName: string, callback: (...args: unknown[]) => unknown) =>
        registerEventHandler(eventName, callback, -1),
      eventMakeLast: (eventName: string, callback: (...args: unknown[]) => unknown) =>
        registerEventHandler(eventName, callback, 1),
      eventClearEvent: (eventName: unknown) => this.eventHandlers.delete(normalizeTavernEventName(eventName)),
      eventClearListener,
      eventClearAll: () => this.eventHandlers.clear(),
      getCharData,
      getCharAvatarPath,
      getChatHistoryBrief,
      getChatHistoryDetail,
      RawCharacter,
      getCharacterNames,
      getCharacterIds,
      getCurrentCharacterName,
      getCurrentCharacterId,
      getCharacter: readTavernCharacter,
      createCharacter,
      createOrReplaceCharacter,
      replaceCharacter,
      updateCharacterWith,
      deleteCharacter,
      default_preset,
      getLoadedPresetName,
      getPreset,
      createPreset,
      createOrReplacePreset,
      deletePreset,
      renamePreset,
      replacePreset,
      updatePresetWith,
      setPreset,
      isPresetNormalPrompt,
      isPresetSystemPrompt,
      isPresetPlaceholderPrompt,
      builtin_prompt_default_order: TAVERN_BUILTIN_PROMPT_DEFAULT_ORDER,
      placeholder_prompt_default_order: TAVERN_BUILTIN_PROMPT_DEFAULT_ORDER,
      getProxyPresetNames: () => [] as string[],
      getPersonaNames,
      getPersonaIds,
      getCurrentPersonaId,
      getCurrentPersonaName,
      getPersonaAvatarPath,
      getPersona,
      createPersona,
      createOrReplacePersona,
      deletePersona,
      replacePersona,
      updatePersonaWith,
      formatAsDisplayedMessage,
      retrieveDisplayedMessage,
      refreshOneMessage,
      builtin,
      ...audioApi,
      audioEnable: (args: unknown) => {
        if (!isRecord(args)) return "";
        const enabled = !/^(?:0|false|off|no)$/i.test(String(args.state ?? "true").trim());
        audioPlayer.setAudioSettings(args.type, { enabled });
        return "";
      },
      audioPlay: (args: unknown) => {
        if (!isRecord(args)) return "";
        const play = !/^(?:0|false|off|no)$/i.test(String(args.play ?? "true").trim());
        if (!play) audioPlayer.pauseAudio(args.type);
        else {
          const current = audioPlayer.getCurrentAudio(args.type).src || audioPlayer.getAudioList(args.type)[0]?.url;
          if (current) audioPlayer.playAudio(args.type, current);
        }
        return "";
      },
      audioMode: (args: unknown) => {
        if (!isRecord(args)) return "";
        const modeMap: Record<string, TavernAudioMode> = {
          single: "repeat_one",
          repeat: "repeat_all",
          random: "shuffle",
          stop: "play_one_and_stop",
        };
        const mapped = modeMap[String(args.mode ?? "").trim().toLowerCase()];
        if (mapped) audioPlayer.setAudioSettings(args.type, { mode: mapped });
        return "";
      },
      audioImport: (args: unknown, url: unknown) => {
        const options = isRecord(args) ? args : {};
        const urls = String(url ?? options.url ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        if (urls.length === 0) return "";
        audioPlayer.appendAudioList(options.type, urls);
        if (!/^(?:0|false|off|no)$/i.test(String(options.play ?? "true").trim())) {
          audioPlayer.playAudio(options.type, urls[0]);
        }
        return "";
      },
      audioSelect: (args: unknown, url: unknown) => {
        const options = isRecord(args) ? args : {};
        const target = String(url ?? options.url ?? "").trim();
        if (target) audioPlayer.playAudio(options.type, target);
        return "";
      },
      isAdmin: () => true,
      getTavernHelperExtensionId: () => TAVERN_HELPER_EXTENSION_ID,
      getExtensionType: (extensionId: unknown) => (isInstalledExtension(extensionId) ? "local" : null),
      getExtensionInstallationInfo: async () => null,
      getExtensionStatus: async () => null,
      isInstalledExtension,
      installExtension: unsupportedExtensionOperation,
      uninstallExtension: unsupportedExtensionOperation,
      reinstallExtension: unsupportedExtensionOperation,
      updateExtension: unsupportedExtensionOperation,
      getTavernFile,
      uploadTavernFile,
      deleteTavernFile,
      importRawCharacter: async (fileName: unknown, content: unknown) =>
        await importRawResponse("character", fileName, content),
      importRawChat: async (fileName: unknown, content: unknown) =>
        await importRawResponse("chat", fileName, content),
      importRawWorldbook: async (fileName: unknown, content: unknown) =>
        await importRawResponse("worldbook", fileName, content),
      importRawPreset: async (fileName: unknown, content: unknown) =>
        await importRawFile("preset", fileName, content),
      getAllEnabledScriptButtons,
      initializeGlobal,
      rotateChatMessages,
      unregisterMacroLike: macroRegistry.unregisterMacroLike,
      iframe_events: TAVERN_HELPER_IFRAME_EVENTS,
      createWorldbook,
      saveWorldInfo,
      rebindCharWorldbooks,
      getChatWorldbookName,
      rebindChatWorldbook,
      enableGlobalWorldbooks,
      replaceLorebookEntries,
      updateLorebookEntriesWith,
      setCurrentCharLorebooks,
      getChatLorebook,
      setChatLorebook,
      getOrCreateChatLorebook,
      createLorebook,
      deleteLorebook: deleteWorldbook,
      getIframeName: () => `TH-script--${getScript()?.name ?? "script"}--${getScriptId()}`,
      getMessageId: (iframeName: unknown) => {
        const match = /^TH-message--(\d+)--\d+$/.exec(String(iframeName ?? ""));
        return match ? Number(match[1]) : this.adapter.getMessages().length - 1;
      },
      reloadIframe: () => undefined,
      eventOnButton: (name: unknown, callback: unknown) =>
        eventOn(
          this.getButtonEventName(resolveButtonScript([name])?.id ?? getScriptId(), String(name)),
          callback,
        ),
      getWorldbookNames,
      getGlobalWorldbookNames,
      getWorldbook,
      loadWorldInfo,
      createOrReplaceWorldbook,
      replaceWorldbook,
      deleteWorldbook,
      rebindGlobalWorldbooks,
      getOrCreateChatWorldbook,
      getLorebooks,
      getCharLorebooks,
      getCharWorldbookNames,
      getCurrentCharPrimaryLorebook,
      getLorebookEntries,
      getLorebookSettings,
      setLorebookSettings,
      setLorebookEntries,
      createLorebookEntry,
      createLorebookEntries,
      deleteLorebookEntry,
      updateWorldbookWith,
      createWorldbookEntries,
      deleteWorldbookEntries,
      deleteLorebookEntries,
      updateWorldbookEntry,
      getWorldbookEntry,
      getWorldbookEntryByKey,
      getTavernRegexes,
      formatAsTavernRegexedString,
      isCharacterTavernRegexesEnabled: () =>
        getTavernRegexes({ scope: "character", enable_state: "all" }).length > 0,
      importRawTavernRegex,
      createTavernRegex,
      replaceTavernRegexes,
      updateTavernRegexesWith,
      deleteTavernRegex,
      substitudeMacros,
      registerMacroLike,
      injectPrompts,
      uninjectPrompts,
      getScriptId,
      getScriptName,
      getScriptInfo,
      replaceScriptInfo,
      getScriptButtons,
      replaceScriptButtons,
      updateScriptButtonsWith,
      appendInexistentScriptButtons,
      getButtonEvent: (name: unknown) =>
        this.getButtonEventName(
          resolveButtonScript([name])?.id ?? getScriptId(),
          String(name),
        ),
      waitGlobalInitialized,
      getModelList,
      getChatCompletionModel,
      getPresetNames,
      loadPreset,
      getTavernHelperVersion: () => TAVERN_HELPER_VERSION,
      getFrontendVersion: () => TAVERN_HELPER_VERSION,
      updateTavernHelper: async () => false,
      updateFrontendVersion: async () => false,
      getTavernVersion: () => SILLYTAVERN_VERSION,
      getVersion: () => sillyTavern.versionInfo,
      getContext,
      saveChat,
      deleteLastMessage,
      updateChatMetadata,
      chatCompletionSettings,
      chat_completion_settings: chatCompletionSettings,
      oai_settings: chatCompletionSettings,
      extension_settings: extensionSettings,
      saveSettingsDebounced,
      getInput,
      setInput,
      appendInput,
      sendMessage,
      triggerSlash,
      triggerSlashWithResult: triggerSlash,
      generate: (config?: unknown) => generateWithResultShape(config, false),
      generateRaw: (config?: unknown) => generateWithResultShape(config, true),
      stopAllGeneration,
      stopGenerationById: stopAllGeneration,
      toastr,
      tavern_events: TAVERN_EVENTS,
      eventSource,
      SillyTavern: sillyTavern,
    };
    Object.assign(win, api);
    Object.defineProperties(win, {
      chat: { get: () => this.getSillyTavernChat(), configurable: true },
      characters: { get: () => this.getSillyTavernCharacters(), configurable: true },
      this_chid: { get: () => (this.adapter.getCharacter() ? 0 : undefined), configurable: true },
      name1: { get: () => this.adapter.getUserName() || "User", configurable: true },
      name2: { get: () => this.adapter.getCharacter()?.name || "Assistant", configurable: true },
    });
    const promptTemplateApi = (
      globalThis as typeof globalThis & { EjsTemplate?: Record<string, unknown> }
    ).EjsTemplate;
    if (promptTemplateApi) win.EjsTemplate = promptTemplateApi;
    win.worldbookManager = worldbookManager;
    win.lorebookManager = worldbookManager;
    win.TavernHelper = api;
    win.tavernHelper = api;
    win.tavernHelperAPI = api;
    win.th = api;
    win.getvar = (path: unknown, fallback?: unknown) =>
      getPath(getVariables(), String(path), fallback);
    win.setvar = async (path: unknown, value: unknown) => {
      const variables = getVariables();
      setPath(variables, String(path), value);
      return await replaceVariables(variables);
    };
    this.api = api as unknown as Record<string, unknown>;
    this.macroSubstitute = substitudeMacros;
    if (this.apiOnly) return;
    const presetManagerAdapter: TavernPresetManagerAdapter = {
      getPrompts: () =>
        (syncChatCompletionSettingsFromPreset()?.prompts ?? []).map((prompt) => ({
          identifier: prompt.identifier,
          name: prompt.name,
          enabled: prompt.enabled,
        })),
      setPromptEnabled: (identifier, enabled) => {
        if (Array.isArray(chatCompletionSettings.prompts)) {
          const prompt = chatCompletionSettings.prompts
            .filter(isRecord)
            .find((candidate) =>
              String(candidate.identifier ?? candidate.id ?? "") === identifier,
            );
          if (prompt) prompt.enabled = enabled;
        }
        this.adapter.setPresetPromptEnabled?.(identifier, enabled);
      },
      getTopP: () => {
        const value = Number(
          chatCompletionSettings.top_p_openai ?? chatCompletionSettings.top_p ?? 1,
        );
        return Number.isFinite(value) ? value : 1;
      },
      setTopP: (value) => {
        chatCompletionSettings.top_p_openai = value;
        chatCompletionSettings.top_p = value;
        this.adapter.setPresetTopP?.(value);
      },
      savePreset: saveSettingsDebounced,
    };
    this.parentApiBridge?.cleanup();
    this.parentApiBridge = installParentTavernApiBridge(
      this.hostWindow,
      api,
      sillyTavern,
      eventSource as unknown as Record<string, unknown>,
      toastr,
      presetManagerAdapter,
      (error) => this.writeRuntimeLog(
        "error",
        `酒馆兼容控件操作失败：${toErrorMessage(error)}`,
      ),
    );
  }

  private resolveVariables(option: unknown, scriptId: string) {
    const messages = this.adapter.getMessages();
    const normalized: VariableOption = isRecord(option)
      ? option
      : typeof option === "number" || typeof option === "string"
        ? { type: "message", message_id: option }
        : { type: "chat" };
    const type = String(normalized.type ?? "chat").toLowerCase();
    if (type === "global") return this.adapter.getGlobalVariables();
    if (type === "chat") return this.adapter.getChatVariables();
    if (type === "character" || type === "char") {
      return this.adapter.getCharacterVariables();
    }
    if (type === "preset") return this.adapter.getPresetVariables?.() ?? {};
    if (type === "extension") {
      const extensionId = String(normalized.extension_id ?? "").trim();
      const extensionSettings = this.adapter.getExtensionSettings?.() ?? getPath(
        this.adapter.getGlobalVariables(),
        TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY,
        {},
      );
      return extensionId && isRecord(extensionSettings) && isRecord(extensionSettings[extensionId])
        ? extensionSettings[extensionId]
        : {};
    }
    if (type === "script" || type === "local") return this.adapter.getScriptData(scriptId);
    const index = normalizeMessageId(normalized.message_id, messages);
    return messages[index]?.variables ?? {};
  }

  private async initializeMvuMessageVariables(swipeIndex = 0) {
    const win = this.runtimeWindow;
    if (!win) return;
    const yaml = isRecord(win.YAML) ? win.YAML : {};
    const yamlDefault = isRecord(yaml.default) ? yaml.default : {};
    const parseYaml = yaml.parse ?? yamlDefault.parse;
    if (typeof parseYaml !== "function") return;
    const substituteMacros =
      typeof win.substitudeMacros === "function"
        ? (source: string) =>
            String((win.substitudeMacros as (value: unknown) => unknown)(source))
        : undefined;
    const result = initializeTavernMvuMessages(
      this.adapter.getMessages(),
      (source) => (parseYaml as (value: string) => unknown)(source),
      substituteMacros,
    );
    result.errors.forEach((error) => {
      this.writeRuntimeLog(
        "warn",
        `消息 ${error.messageIndex} 的第 ${error.blockIndex} 个 initvar 块解析失败：${error.message}`,
      );
    });
    if (result.initializations.length === 0) return;

    this.adapter.setMessages(result.messages);
    this.refreshSillyTavernChatCache();
    const mvu = isRecord(win.Mvu) ? win.Mvu : {};
    const events = isRecord(mvu.events) ? mvu.events : {};
    const initializedEvent = String(
      events.VARIABLE_INITIALIZED ?? "mag_variable_initialized",
    );
    for (const initialization of result.initializations) {
      const eventVariables = cloneValue(initialization.variables);
      await this.emit(initializedEvent, eventVariables, swipeIndex);
      const messages = this.adapter.getMessages().map((message) => cloneValue(message));
      if (messages[initialization.messageIndex]) {
        messages[initialization.messageIndex].variables = eventVariables;
        this.adapter.setMessages(messages);
      }
    }
    this.refreshSillyTavernChatCache();
    this.writeRuntimeLog(
      "info",
      `已从 initvar 补齐 ${result.initializations.length} 条消息的 MVU 初始变量。`,
    );
  }

  private saveVariables(
    option: unknown,
    scriptId: string,
    variables: Record<string, unknown>,
  ) {
    const next = this.restorePlaceholderImages(cloneValue(variables));
    const messages = this.adapter.getMessages();
    const normalized: VariableOption = isRecord(option)
      ? option
      : typeof option === "number" || typeof option === "string"
        ? { type: "message", message_id: option }
        : { type: "chat" };
    const type = String(normalized.type ?? "chat").toLowerCase();
    if (type === "global") {
      this.adapter.setGlobalVariables(next);
      return;
    }
    if (type === "chat") {
      this.adapter.setChatVariables(next);
      return;
    }
    if (type === "character" || type === "char") {
      this.adapter.setCharacterVariables(next);
      return;
    }
    if (type === "preset") {
      this.adapter.setPresetVariables?.(next);
      return;
    }
    if (type === "extension") {
      const extensionId = String(normalized.extension_id ?? "").trim();
      if (!extensionId) return;
      if (this.adapter.getExtensionSettings && this.adapter.setExtensionSettings) {
        const extensionSettings = this.adapter.getExtensionSettings();
        extensionSettings[extensionId] = next;
        this.adapter.setExtensionSettings(extensionSettings);
        return;
      }
      const globalVariables = cloneValue(this.adapter.getGlobalVariables());
      const storedSettings = getPath(
        globalVariables,
        TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY,
        {},
      );
      const extensionSettings = isRecord(storedSettings) ? cloneValue(storedSettings) : {};
      extensionSettings[extensionId] = next;
      globalVariables[TAVERN_EXTENSION_SETTINGS_VARIABLE_KEY] = extensionSettings;
      this.adapter.setGlobalVariables(globalVariables);
      return;
    }
    if (type === "script" || type === "local") {
      this.adapter.setScriptData(scriptId, next);
      return;
    }
    const index = normalizeMessageId(normalized.message_id, messages);
    if (!messages[index]) return;
    const updated = messages.map((message, messageIndex) =>
      messageIndex === index ? { ...message, variables: next } : message,
    );
    this.adapter.setMessages(updated);
    this.refreshSillyTavernChatCache();
  }

  private formatHelperMessage(message: TavernRuntimeMessage, index: number) {
    const character = this.adapter.getCharacter();
    const extra = cloneValue(message.extra ?? {});
    const isSystem = extra.tavernIsSystem === true;
    const isHidden = extra.tavernIsHidden === true;
    const tavernName =
      typeof extra.tavernName === "string" ? extra.tavernName.trim() : "";
    const swipeState = getTavernMessageSwipeState(
      message,
      this.adapter.getGreetingState?.(),
    );
    return {
      ...extra,
      message_id: index,
      mesid: index,
      id: index,
      ...(isRecord(message.aiIdentity)
        ? { aiIdentity: cloneValue(message.aiIdentity) }
        : {}),
      name:
        tavernName || (message.role === "user"
          ? this.adapter.getUserName() || "User"
          : character?.name || "Assistant"),
      role: isSystem ? "system" : message.role,
      is_user: message.role === "user" && !isSystem,
      is_system: isSystem,
      is_hidden: isHidden,
      message: message.content,
      mes: message.content,
      data: this.localizePlaceholderImages(cloneValue(message.variables ?? {})),
      variables: this.localizePlaceholderImages(cloneValue(message.variables ?? {})),
      extra,
      swipe_id: swipeState.swipeId,
      swipes: swipeState.swipes,
      swipes_data: swipeState.swipesData,
      swipes_info: swipeState.swipesInfo,
    };
  }

  private refreshSillyTavernChatCache() {
    const formattedMessages = this.adapter.getMessages().map((message, index) => {
      const formatted = this.formatHelperMessage(message, index);
      return {
        ...formatted,
        variables: this.localizePlaceholderImages(cloneValue(formatted.swipes_data)),
      };
    });
    this.sillyTavernChatCache.splice(
      0,
      this.sillyTavernChatCache.length,
      ...formattedMessages,
    );
    return this.sillyTavernChatCache;
  }

  private getSillyTavernChat() {
    return this.sillyTavernChatCache;
  }

  private persistSillyTavernChatCache() {
    const previousMessages = this.adapter.getMessages();
    const reservedKeys = new Set([
      "message_id",
      "mesid",
      "id",
      "name",
      "role",
      "is_user",
      "is_system",
      "is_hidden",
      "message",
      "mes",
      "content",
      "data",
      "variables",
      "extra",
      "swipe_id",
      "swipes",
      "swipes_data",
      "swipes_info",
      "aiIdentity",
    ]);
    const nextMessages = this.sillyTavernChatCache.map((rawMessage, index) => {
      const previous = previousMessages[index];
      const contentCandidates = [
        rawMessage.mes,
        rawMessage.message,
        rawMessage.content,
        Array.isArray(rawMessage.swipes)
          ? rawMessage.swipes[Number(rawMessage.swipe_id) || 0]
          : undefined,
      ].filter((value): value is string => typeof value === "string");
      const content =
        contentCandidates.find((value) => value !== previous?.content) ??
        contentCandidates[0] ??
        previous?.content ??
        "";
      const previousExtra = isRecord(previous?.extra) ? previous.extra : {};
      const rawExtra = isRecord(rawMessage.extra) ? rawMessage.extra : {};
      const extra: Record<string, unknown> = {};
      Object.entries(rawMessage).forEach(([key, value]) => {
        if (!reservedKeys.has(key)) extra[key] = cloneValue(value);
      });
      const customKeys = new Set([
        ...Object.keys(previousExtra),
        ...Object.keys(rawExtra),
        ...Object.keys(extra),
      ]);
      customKeys.forEach((key) => {
        const previousHas = Object.prototype.hasOwnProperty.call(previousExtra, key);
        const nestedHas = Object.prototype.hasOwnProperty.call(rawExtra, key);
        const topLevelHas = Object.prototype.hasOwnProperty.call(rawMessage, key);
        const nestedChanged =
          nestedHas !== previousHas ||
          (nestedHas && previousHas && !valuesEqual(rawExtra[key], previousExtra[key]));
        const topLevelChanged =
          topLevelHas !== previousHas ||
          (topLevelHas && previousHas && !valuesEqual(rawMessage[key], previousExtra[key]));

        if (nestedChanged && !topLevelChanged) {
          if (nestedHas) extra[key] = cloneValue(rawExtra[key]);
          else delete extra[key];
          return;
        }
        if (topLevelChanged) {
          if (topLevelHas) extra[key] = cloneValue(rawMessage[key]);
          else delete extra[key];
          return;
        }
        if (previousHas) extra[key] = cloneValue(previousExtra[key]);
        else delete extra[key];
      });
      if (rawMessage.is_system === true || rawMessage.role === "system") {
        extra.tavernIsSystem = true;
      } else {
        delete extra.tavernIsSystem;
      }
      if (rawMessage.is_hidden === true) extra.tavernIsHidden = true;
      else delete extra.tavernIsHidden;
      const defaultName =
        previous?.role === "user"
          ? this.adapter.getUserName() || "User"
          : this.adapter.getCharacter()?.name || "Assistant";
      if (
        typeof rawMessage.name === "string" &&
        rawMessage.name.trim() &&
        (rawMessage.is_system === true ||
          rawMessage.is_hidden === true ||
          rawMessage.name.trim() !== defaultName)
      ) {
        extra.tavernName = rawMessage.name.trim();
      } else {
        delete extra.tavernName;
      }
      const swipeIndex = Number(rawMessage.swipe_id) || 0;
      const variableValue = Array.isArray(rawMessage.variables)
        ? rawMessage.variables[swipeIndex]
        : isRecord(rawMessage.variables)
          ? rawMessage.variables
          : isRecord(rawMessage.data)
            ? rawMessage.data
            : previous?.variables;
      const aiIdentity = isRecord(rawMessage.aiIdentity)
        ? cloneValue(rawMessage.aiIdentity)
        : isRecord(previous?.aiIdentity)
          ? cloneValue(previous.aiIdentity)
          : undefined;
      return {
        id: previous?.id ?? crypto.randomUUID(),
        ...(previous?.source ? { source: previous.source } : {}),
        role:
          rawMessage.is_user === true || rawMessage.role === "user"
            ? ("user" as const)
            : ("assistant" as const),
        content,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        ...(isRecord(variableValue)
          ? { variables: this.restorePlaceholderImages(cloneValue(variableValue)) }
          : {}),
        ...(aiIdentity ? { aiIdentity } : {}),
        ...(Object.keys(extra).length > 0 ? { extra } : {}),
      };
    });
    this.adapter.setMessages(nextMessages);
    this.refreshSillyTavernChatCache();
    return true;
  }

  private getSillyTavernCharacters() {
    const character = this.adapter.getCharacter();
    const otherCharacters = (this.adapter.getCharacterSummaries?.() ?? [])
      .filter((entry) => entry.id !== character?.id)
      .map((entry) => ({
        name: entry.name,
        avatar: entry.avatarDataUrl || `${entry.id}.png`,
        data: { name: entry.name },
      }));
    if (!character) return otherCharacters;
    // Identity polling should not copy bundled scripts and extension databases.
    // Materialize an isolated, mutable extension snapshot only when it is read.
    let extensions: Record<string, unknown> | undefined;
    const localizeExtensions = () => this.localizePlaceholderImages(cloneValue(character.extensions));
    const readExtensions = () =>
      (extensions ??= {
        ...localizeExtensions(),
        ...(character.worldBook ? { world: character.worldBook.name } : {}),
      });
    const writeExtensions = (value: Record<string, unknown>) => {
      extensions = value;
    };
    return [
      {
        name: character.name,
        description: character.description,
        personality: character.personality,
        scenario: character.scenario,
        first_mes: character.firstMessage,
        mes_example: character.messageExample,
        creatorcomment: character.creatorNotes ?? "",
        tags: [...(character.tags ?? [])],
        talkativeness: 0.5,
        fav: false,
        avatar: this.localizePlaceholderImages(character.avatarDataUrl) || `${character.id}.png`,
        chat: this.adapter.getChatId(),
        get extensions() {
          return readExtensions();
        },
        set extensions(value: Record<string, unknown>) {
          writeExtensions(value);
        },
        data: {
          name: character.name,
          description: character.description,
          character_version: character.characterVersion ?? "",
          personality: character.personality,
          scenario: character.scenario,
          first_mes: character.firstMessage,
          mes_example: character.messageExample,
          creator_notes: character.creatorNotes ?? "",
          tags: [...(character.tags ?? [])],
          system_prompt: character.systemPrompt ?? "",
          post_history_instructions: character.postHistoryInstructions ?? "",
          creator: character.creator ?? "",
          alternate_greetings: [...(character.alternateGreetings ?? [])],
          get extensions() {
            return readExtensions();
          },
          set extensions(value: Record<string, unknown>) {
            writeExtensions(value);
          },
          character_book: character.worldBook,
        },
      },
      ...otherCharacters,
    ];
  }

  private localizePlaceholderImages<T>(value: T): T {
    return mapTavernVariableStrings(value, (text) => {
      const localized = buildLocalTavernPlaceholderImage(text);
      if (localized !== text) this.localPlaceholderImageSources.set(localized, text);
      return localized;
    });
  }

  private restorePlaceholderImages<T>(value: T): T {
    return mapTavernVariableStrings(
      value,
      (text) => this.localPlaceholderImageSources.get(text) ?? text,
    );
  }

  private normalizeRuntimeButtons(values: unknown[], scriptId: string) {
    return values
      .map((value, index): TavernScriptButton | null => {
        if (!isRecord(value)) return null;
        const name = String(value.name ?? value.label ?? "").trim();
        if (!name) return null;
        return {
          id: String(value.id ?? `${scriptId}-runtime-button-${index + 1}`),
          name,
          visible: typeof value.visible === "boolean" ? value.visible : true,
        };
      })
      .filter((button): button is TavernScriptButton => Boolean(button));
  }

  private publishButtons() {
    const buttons = this.scripts.flatMap((script) =>
      isTavernScriptEnabled(script) && script.buttonEnabled
        ? (this.scriptButtons.get(script.id) ?? [])
            .filter((button) => button.visible)
            .map((button) => ({
              ...cloneValue(button),
              scriptId: script.id,
              scriptName: script.name,
            }))
        : [],
    );
    this.adapter.onButtonsChange?.(buttons);
  }

  private getButtonEventName(scriptId: string, buttonName: string) {
    return `tavern_script_button:${scriptId}:${buttonName}`;
  }

  private ensureScriptMarker(scriptId: string) {
    const document = this.runtimeWindow?.document;
    if (!document) return;
    const container = document.querySelector("#tavern_helper");
    if (!container || container.querySelector(`[data-script-id="${CSS.escape(scriptId)}"]`)) return;
    const marker = document.createElement("div");
    marker.dataset.scriptId = scriptId;
    container.appendChild(marker);
  }

  private appendExecutableScript(script: TavernScript) {
    const document = this.runtimeWindow?.document;
    if (!document) return Promise.reject(new Error("酒馆脚本文档不存在。"));
    const usesModuleSyntax = usesTavernModuleSyntax(script.content);
    return new Promise<void>((resolve, reject) => {
      const element = document.createElement("script");
      if (usesModuleSyntax) element.type = "module";
      element.dataset.rengeTavernScriptId = script.id;
      const completionEventName = `renge-tavern-script-loaded:${script.id}:${crypto.randomUUID()}`;
      const executableContent = usesModuleSyntax
        ? proxyTavernModuleUrls(script.content, window.location.origin)
        : script.content;
      element.textContent = usesModuleSyntax
        ? `${executableContent}\n;window.dispatchEvent(new Event(${JSON.stringify(completionEventName)}));\n//# sourceURL=renge-tavern-script-${encodeURIComponent(script.name)}.js`
        : `${scopeTavernClassicScript(executableContent)}\n//# sourceURL=renge-tavern-script-${encodeURIComponent(script.name)}.js`;
      let settled = false;
      const timeoutId = usesModuleSyntax
        ? window.setTimeout(
            () => finish(new Error(`脚本「${script.name}」的模块加载超时。`)),
            10000,
          )
        : undefined;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        this.runtimeWindow?.removeEventListener("error", handleError);
        this.runtimeWindow?.removeEventListener(completionEventName, handleComplete);
        if (error) reject(error);
        else resolve();
      };
      const handleComplete = () => finish();
      const handleError = (event: ErrorEvent) => {
        event.preventDefault();
        finish(new Error(event.message || `脚本「${script.name}」执行失败。`));
      };
      this.runtimeWindow?.addEventListener("error", handleError);
      if (usesModuleSyntax) {
        this.runtimeWindow?.addEventListener(completionEventName, handleComplete, { once: true });
        element.addEventListener(
          "error",
          () => finish(new Error(`脚本「${script.name}」的模块或依赖加载失败。`)),
          { once: true },
        );
      }
      document.body.appendChild(element);
      if (!usesModuleSyntax) window.setTimeout(() => finish(), 0);
    });
  }

  private waitForGlobal(name: string, timeout: number) {
    const startedAt = Date.now();
    return new Promise<unknown>((resolve, reject) => {
      const check = () => {
        if (this.destroyed) {
          reject(new Error("脚本运行时已销毁。"));
          return;
        }
        const runtimeValue = this.runtimeWindow?.[name];
        const parentValue = (this.hostWindow as unknown as Window & Record<string, unknown>)[name];
        if (runtimeValue != null || parentValue != null) {
          resolve(runtimeValue ?? parentValue);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          reject(new Error(`等待 ${name} 初始化超时。`));
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  private writeLog(
    level: TavernRuntimeLog["level"],
    script: TavernScript,
    message: string,
  ) {
    this.adapter.onLog?.({
      id: crypto.randomUUID(),
      level,
      scriptId: script.id,
      scriptName: script.name,
      message,
      createdAt: new Date().toISOString(),
    });
  }

  private writeRuntimeLog(level: TavernRuntimeLog["level"], message: string) {
    const script =
      this.scripts.find(
        (candidate) => candidate.id === (this.currentScriptId || this.lastScriptId),
      ) ?? this.scripts[0];
    if (script) this.writeLog(level, script, message);
  }

  private reportStatus(state: TavernRuntimeStatus["state"], message: string) {
    if (this.apiOnly) return;
    this.adapter.onStatus?.({ state, message });
  }
}

export { TAVERN_EVENTS };
