export type TavernCompatibilityErrorReporter = (error: unknown) => void;

export type ParsedTavernSlashCommand =
  | { type: "set-input"; text: string; append: boolean; submit: boolean }
  | {
      type: "message";
      text: string;
      role: "user" | "assistant";
      name: string;
      system: boolean;
      hidden: boolean;
      compact: boolean;
      generate: boolean;
    }
  | {
      type: "echo";
      text: string;
      title: string;
      severity: "info" | "success" | "warning" | "error";
      duration: number;
    }
  | { type: "trigger" };

function readTavernCommandOption(remainder: string) {
  const match =
    /^(severity|title|duration|timeout|name|compact|at|return|raw)=(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+))(?:\s+|$)/i.exec(
      remainder,
    );
  if (!match) return null;
  const quotedValue = match[2] ?? match[3];
  return {
    name: match[1].toLowerCase(),
    value: (quotedValue ?? match[4] ?? "").replace(/\\([\\"'])/g, "$1"),
    length: match[0].length,
  };
}

function readLeadingTavernCommandOptions(
  remainder: string,
  allowedOptions: ReadonlySet<string>,
) {
  const options: Record<string, string> = {};
  let text = remainder.trim();
  while (text) {
    const option = readTavernCommandOption(text);
    if (!option || !allowedOptions.has(option.name)) break;
    options[option.name] = option.value;
    text = text.slice(option.length).trimStart();
  }
  return { options, text };
}

function parseTavernBoolean(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback;
  return /^(?:1|true|yes|on)$/i.test(value);
}

/** Parses the common message/composer commands used by character-card frontends. */
export function parseTavernSlashCommand(command: string): ParsedTavernSlashCommand | null {
  const normalized = command.trim();
  if (!normalized) return null;
  const parts = normalized.split(/\s*\|\s*(?=\/)/);
  const primary = parts.shift()?.trim() ?? "";
  const hasTrigger = parts.some((part) => /^\/(?:trigger|gen)\b/i.test(part.trim()));

  const echoMatch = /^\/echo\b(?:\s+([\s\S]*))?$/i.exec(primary);
  if (echoMatch) {
    const parsed = readLeadingTavernCommandOptions(
      echoMatch[1] ?? "",
      new Set(["severity", "title", "duration", "timeout"]),
    );
    const normalizedSeverity = (parsed.options.severity ?? "").toLowerCase();
    const severity =
      normalizedSeverity === "success" || normalizedSeverity === "positive"
        ? "success"
        : normalizedSeverity === "warning" || normalizedSeverity === "warn"
          ? "warning"
          : normalizedSeverity === "error" ||
              normalizedSeverity === "danger" ||
              normalizedSeverity === "negative"
            ? "error"
            : "info";
    const rawDuration = Number(parsed.options.duration ?? parsed.options.timeout ?? 0);
    const duration =
      Number.isFinite(rawDuration) && rawDuration > 0
        ? Math.min(Math.round(rawDuration), 60_000)
        : 0;
    return {
      type: "echo",
      text: parsed.text,
      title: parsed.options.title ?? "",
      severity,
      duration,
    };
  }

  const sendAsMatch = /^\/sendas\b(?:\s+([\s\S]*))?$/i.exec(primary);
  if (sendAsMatch) {
    const parsed = readLeadingTavernCommandOptions(
      sendAsMatch[1] ?? "",
      new Set(["name", "raw"]),
    );
    return parsed.text
      ? {
          type: "message",
          text: parsed.text,
          role: "assistant",
          name: parsed.options.name ?? "",
          system: false,
          hidden: false,
          compact: false,
          generate: hasTrigger,
        }
      : null;
  }

  const systemMatch = /^\/(?:sys|narrator)\b(?:\s+([\s\S]*))?$/i.exec(primary);
  if (systemMatch) {
    const parsed = readLeadingTavernCommandOptions(
      systemMatch[1] ?? "",
      new Set(["name", "compact", "at", "return", "raw"]),
    );
    return parsed.text
      ? {
          type: "message",
          text: parsed.text,
          role: "assistant",
          name: parsed.options.name ?? "System",
          system: true,
          hidden: false,
          compact: parseTavernBoolean(parsed.options.compact),
          generate: true,
        }
      : null;
  }

  const commentMatch = /^\/(?:comment|note)\b(?:\s+([\s\S]*))?$/i.exec(primary);
  if (commentMatch) {
    const parsed = readLeadingTavernCommandOptions(
      commentMatch[1] ?? "",
      new Set(["name", "compact", "at", "return", "raw"]),
    );
    return parsed.text
      ? {
          type: "message",
          text: parsed.text,
          role: "assistant",
          name: parsed.options.name ?? "Comment",
          system: true,
          hidden: true,
          compact: parseTavernBoolean(parsed.options.compact, true),
          generate: false,
        }
      : null;
  }

  const setInputMatch = /^\/setinput(?:\s+([\s\S]*))?$/i.exec(primary);
  if (setInputMatch) {
    return {
      type: "set-input",
      text: setInputMatch[1] ?? "",
      append: false,
      submit: hasTrigger,
    };
  }

  const appendInputMatch = /^\/appendinput(?:\s+([\s\S]*))?$/i.exec(primary);
  if (appendInputMatch) {
    return {
      type: "set-input",
      text: appendInputMatch[1] ?? "",
      append: true,
      submit: hasTrigger,
    };
  }

  const sendMatch = /^\/send(?:\s+([\s\S]*))?$/i.exec(primary);
  if (sendMatch) {
    return {
      type: "set-input",
      text: sendMatch[1] ?? "",
      append: false,
      submit: true,
    };
  }

  if (/^\/(?:trigger|gen)\b/i.test(primary)) return { type: "trigger" };
  return null;
}

export type TavernContextHeaderSegment =
  | { type: "text"; content: string }
  | {
      type: "context";
      content: string;
      label: string;
      items: string[];
    };

const TAVERN_CONTEXT_HEADER_PATTERN =
  /^[ \t]*<([A-Za-z\u3400-\u9fff][A-Za-z0-9_\-\u3400-\u9fff]{0,31})>[ \t]*\r?\n[ \t]*```[ \t]*([^\r\n`]{2,300}?)[ \t]*```[ \t]*(?=\r?\n|$)/gm;

function looksLikeTavernContextHeader(value: string) {
  return /(?:\d{4}\s*年|\d{4}[-/]\d{1,2}[-/]\d{1,2}|星期[一二三四五六日天]|周[一二三四五六日天]|\d{1,2}[:：]\d{2})/.test(
    value,
  );
}

/**
 * Extracts the compact context header emitted by Chinese Tavern presets. These
 * presets often wrap a location/date line in same-line triple backticks, which
 * is neither a valid fenced block nor useful raw text in the rendered chat.
 */
export function splitTavernContextHeaders(content: string): TavernContextHeaderSegment[] {
  const segments: TavernContextHeaderSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  TAVERN_CONTEXT_HEADER_PATTERN.lastIndex = 0;

  while ((match = TAVERN_CONTEXT_HEADER_PATTERN.exec(content))) {
    const value = match[2].trim();
    if (!looksLikeTavernContextHeader(value)) continue;
    if (match.index > cursor) {
      segments.push({ type: "text", content: content.slice(cursor, match.index) });
    }
    segments.push({
      type: "context",
      content: value,
      label: match[1],
      items: value.split(/[\u00b7\u2022|\uff5c]/).map((item) => item.trim()).filter(Boolean),
    });
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) return [{ type: "text", content }];
  if (cursor < content.length) {
    segments.push({ type: "text", content: content.slice(cursor) });
  }
  return segments;
}

const TAVERN_SCRIPT_SOURCE_MARKERS = [
  "/api/tavern-module-proxy?url=",
  "/renge-tavern-script-",
  "renge-tavern-script-",
];

/** Identifies the character-card module that called a global TavernHelper API. */
export function getTavernCallerScriptSource(stack: string | undefined) {
  if (!stack) return "";
  for (const line of stack.split(/\r?\n/)) {
    const suffix = /:\d+:\d+\)?\s*$/.exec(line);
    if (!suffix || suffix.index === undefined) continue;
    const prefix = line.slice(0, suffix.index);
    const httpStart = Math.max(prefix.lastIndexOf("http://"), prefix.lastIndexOf("https://"));
    const scriptStart = prefix.lastIndexOf("renge-tavern-script-");
    const start = httpStart >= 0 ? httpStart : scriptStart;
    if (start < 0) continue;
    const source = prefix.slice(start).replace(/^\(+|\)+$/g, "");
    if (TAVERN_SCRIPT_SOURCE_MARKERS.some((marker) => source.includes(marker))) return source;
  }
  return "";
}

/**
 * Preserves script ownership when an imported module resumes through a promise
 * after the root character-card script has finished evaluating.
 */
export function resolveTavernCallerScriptId(
  stack: string | undefined,
  activeScriptId: string,
  fallbackScriptId: string,
  sourceOwners: Map<string, string>,
) {
  const source = getTavernCallerScriptSource(stack);
  const knownOwner = source ? sourceOwners.get(source) : undefined;
  if (knownOwner) return knownOwner;
  const scriptId = activeScriptId || fallbackScriptId;
  if (source && activeScriptId) sourceOwners.set(source, activeScriptId);
  return scriptId;
}

export type TavernButtonOwnerCandidate = {
  id: string;
  buttonNames: string[];
};

/** Resolves a script from the unique strongest overlap with an imported button set. */
export function resolveTavernButtonOwnerId(
  buttonNames: string[],
  fallbackScriptId: string,
  candidates: TavernButtonOwnerCandidate[],
) {
  const requestedNames = new Set(buttonNames.map((name) => name.trim()).filter(Boolean));
  if (requestedNames.size === 0) return fallbackScriptId;
  let bestScore = 0;
  let bestIds: string[] = [];
  for (const candidate of candidates) {
    const candidateNames = new Set(candidate.buttonNames);
    const score = [...requestedNames].filter((name) => candidateNames.has(name)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIds = [candidate.id];
    } else if (score > 0 && score === bestScore) {
      bestIds.push(candidate.id);
    }
  }
  return bestIds.length === 1 ? bestIds[0] : fallbackScriptId;
}

export type TavernPresetManagerPrompt = {
  identifier: string;
  name: string;
  enabled: boolean;
};

export type TavernPresetManagerAdapter = {
  getPrompts(): TavernPresetManagerPrompt[];
  setPromptEnabled(identifier: string, enabled: boolean): unknown;
  getTopP(): number;
  setTopP(value: number): unknown;
  savePreset(): unknown;
};

export type TavernPresetManagerControls = {
  sync(): void;
  cleanup(): void;
};

const PRESET_MANAGER_BRIDGE_ATTRIBUTE = "data-renge-tavern-preset-bridge";
const PRESET_PROMPT_DISABLED_CLASS = "completion_prompt_manager_prompt_disabled";

function markPresetManagerBridgeElement(element: HTMLElement) {
  element.hidden = true;
  element.setAttribute("aria-hidden", "true");
  element.setAttribute(PRESET_MANAGER_BRIDGE_ATTRIBUTE, "true");
}

/**
 * Installs the hidden preset-manager DOM expected by SillyTavern preset scripts.
 * The controls remain backed by Renge's active preset even when its editor is closed.
 */
export function installTavernPresetManagerControls(
  document: Document,
  adapter: TavernPresetManagerAdapter,
  reportError: TavernCompatibilityErrorReporter = () => undefined,
): TavernPresetManagerControls {
  const root = document.body ?? document.documentElement;
  const ownedElements: HTMLElement[] = [];
  const promptToggleListeners = new Map<
    HTMLButtonElement,
    { listener: () => void; identifier: string }
  >();

  const own = <T extends HTMLElement>(element: T) => {
    markPresetManagerBridgeElement(element);
    ownedElements.push(element);
    return element;
  };

  let promptList = document.getElementById("completion_prompt_manager_list") as
    | HTMLElement
    | null;
  if (!promptList && root) {
    promptList = own(document.createElement("ul"));
    promptList.id = "completion_prompt_manager_list";
    root.append(promptList);
  }

  let saveButton = document.getElementById("update_oai_preset") as
    | HTMLButtonElement
    | null;
  if (!saveButton && root) {
    saveButton = own(document.createElement("button"));
    saveButton.id = "update_oai_preset";
    saveButton.type = "button";
    root.append(saveButton);
  }

  const createTopPInput = (id: string, type: "range" | "number") => {
    const existing = document.getElementById(id) as HTMLInputElement | null;
    if (existing || !root) return existing;
    const input = own(document.createElement("input"));
    input.id = id;
    input.type = type;
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    root.append(input);
    return input;
  };
  const topPSlider = createTopPInput("top_p_openai", "range");
  const topPCounter = createTopPInput("top_p_counter_openai", "number");
  const ownsPromptList = Boolean(promptList && ownedElements.includes(promptList));
  const ownsSaveButton = Boolean(saveButton && ownedElements.includes(saveButton));
  const ownsTopPSlider = Boolean(topPSlider && ownedElements.includes(topPSlider));
  const ownsTopPCounter = Boolean(topPCounter && ownedElements.includes(topPCounter));

  const report = (error: unknown) => {
    try {
      reportError(error);
    } catch {}
  };
  const save = () => {
    try {
      void Promise.resolve(adapter.savePreset()).catch(report);
    } catch (error) {
      report(error);
    }
  };
  if (ownsSaveButton) saveButton?.addEventListener("click", save);

  const setTopP = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement | null;
    const value = Number(input?.value);
    if (!Number.isFinite(value)) return;
    if (ownsTopPSlider && topPSlider && topPSlider !== input) {
      topPSlider.value = String(value);
    }
    if (ownsTopPCounter && topPCounter && topPCounter !== input) {
      topPCounter.value = String(value);
    }
    try {
      void Promise.resolve(adapter.setTopP(value)).catch(report);
    } catch (error) {
      report(error);
    }
  };
  if (ownsTopPSlider) topPSlider?.addEventListener("input", setTopP);
  if (ownsTopPCounter) topPCounter?.addEventListener("input", setTopP);

  const removePromptItem = (item: HTMLLIElement) => {
    const toggle = item.querySelector<HTMLButtonElement>(".prompt-manager-toggle-action");
    const registration = toggle ? promptToggleListeners.get(toggle) : undefined;
    if (toggle && registration) {
      toggle.removeEventListener("click", registration.listener);
      promptToggleListeners.delete(toggle);
    }
    item.remove();
  };

  const sync = () => {
    if (promptList && ownsPromptList) {
      const existingItems = new Map<string, HTMLLIElement>();
      promptList.querySelectorAll<HTMLLIElement>("li[data-pm-identifier]").forEach((item) => {
        const identifier = item.getAttribute("data-pm-identifier") ?? "";
        if (identifier && !existingItems.has(identifier)) existingItems.set(identifier, item);
        else removePromptItem(item);
      });
      const nextItems: HTMLLIElement[] = [];
      adapter.getPrompts().forEach((prompt) => {
        const identifier = String(prompt.identifier);
        let item = existingItems.get(identifier);
        if (item) existingItems.delete(identifier);
        else {
          item = document.createElement("li");
          item.setAttribute("data-pm-identifier", identifier);
          const name = document.createElement("span");
          name.setAttribute("data-pm-name", "");
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.classList.add("prompt-manager-toggle-action");
          item.append(name, toggle);
        }

        item.setAttribute("data-pm-identifier", identifier);
        item.classList.toggle(PRESET_PROMPT_DISABLED_CLASS, !prompt.enabled);
        const name = item.querySelector<HTMLElement>("[data-pm-name]");
        name?.setAttribute("data-pm-name", prompt.name);
        const toggle = item.querySelector<HTMLButtonElement>(".prompt-manager-toggle-action");
        if (toggle) {
          const previous = promptToggleListeners.get(toggle);
          if (!previous || previous.identifier !== identifier) {
            if (previous) toggle.removeEventListener("click", previous.listener);
            const listener = () => {
              const wasEnabled = !item?.classList.contains(PRESET_PROMPT_DISABLED_CLASS);
              const nextEnabled = !wasEnabled;
              item?.classList.toggle(PRESET_PROMPT_DISABLED_CLASS, !nextEnabled);
              try {
                void Promise.resolve(
                  adapter.setPromptEnabled(identifier, nextEnabled),
                ).catch((error) => {
                  item?.classList.toggle(PRESET_PROMPT_DISABLED_CLASS, !wasEnabled);
                  report(error);
                });
              } catch (error) {
                item?.classList.toggle(PRESET_PROMPT_DISABLED_CLASS, !wasEnabled);
                report(error);
              }
            };
            toggle.addEventListener("click", listener);
            promptToggleListeners.set(toggle, { listener, identifier });
          }
        }
        nextItems.push(item);
      });
      existingItems.forEach(removePromptItem);
      promptList.append(...nextItems);
    }

    const topP = Number(adapter.getTopP());
    if (Number.isFinite(topP)) {
      if (ownsTopPSlider && topPSlider) topPSlider.value = String(topP);
      if (ownsTopPCounter && topPCounter) topPCounter.value = String(topP);
    }
  };

  sync();

  return {
    sync,
    cleanup: () => {
      if (ownsSaveButton) saveButton?.removeEventListener("click", save);
      if (ownsTopPSlider) topPSlider?.removeEventListener("input", setTopP);
      if (ownsTopPCounter) topPCounter?.removeEventListener("input", setTopP);
      promptToggleListeners.forEach(({ listener }, toggle) =>
        toggle.removeEventListener("click", listener),
      );
      promptToggleListeners.clear();
      ownedElements.reverse().forEach((element) => element.remove());
    },
  };
}

/**
 * Installs the legacy SillyTavern composer elements used by character-card
 * scripts that submit through window.parent.document.
 */
export function installLegacyTavernSendControls(
  document: Document,
  sendMessage: (value: string) => unknown,
  reportError: TavernCompatibilityErrorReporter = () => undefined,
) {
  const root = document.body ?? document.documentElement;
  if (
    !root ||
    document.getElementById("send_textarea") ||
    document.getElementById("send_but")
  ) {
    return () => undefined;
  }

  const textarea = document.createElement("textarea");
  textarea.id = "send_textarea";
  textarea.hidden = true;
  textarea.setAttribute("aria-hidden", "true");

  const sendButton = document.createElement("button");
  sendButton.id = "send_but";
  sendButton.type = "button";
  sendButton.hidden = true;
  sendButton.setAttribute("aria-hidden", "true");

  const submit = () => {
    const value = textarea.value;
    if (!value.trim()) return;
    try {
      void Promise.resolve(sendMessage(value)).catch(reportError);
    } catch (error) {
      reportError(error);
    }
  };

  sendButton.addEventListener("click", submit);
  root.append(textarea, sendButton);

  return () => {
    sendButton.removeEventListener("click", submit);
    textarea.remove();
    sendButton.remove();
  };
}

export type TavernMacroContext = Record<string, unknown>;

export function createTavernMacroRegistry(
  getContext: () => TavernMacroContext = () => ({}),
) {
  const entries = new Set<{
    matcher: string | RegExp;
    resolver: (context: TavernMacroContext, match: string) => unknown;
  }>();

  const registerMacroLike = (matcher: unknown, resolver: unknown) => {
    const isRegex = Object.prototype.toString.call(matcher) === "[object RegExp]";
    if (!(typeof matcher === "string" || isRegex)) {
      throw new TypeError("registerMacroLike 需要字符串或正则表达式。");
    }
    if (typeof resolver !== "function") {
      throw new TypeError("registerMacroLike 需要回调函数。");
    }
    const entry = {
      matcher: typeof matcher === "string"
        ? matcher
        : new RegExp(
            String((matcher as RegExp).source),
            String((matcher as RegExp).flags),
          ),
      resolver: resolver as (context: TavernMacroContext, match: string) => unknown,
    };
    entries.add(entry);
    const unregister = () => entries.delete(entry);
    return { unregister, stop: unregister };
  };

  const substitute = (value: unknown, context: TavernMacroContext = getContext()) => {
    let result = String(value ?? "");
    entries.forEach(({ matcher, resolver }) => {
      const replace = (match: string) => {
        try {
          return String(resolver(context, match) ?? "");
        } catch {
          return match;
        }
      };
      result = typeof matcher === "string"
        ? result.replaceAll(matcher, replace(matcher))
        : result.replace(matcher, replace);
    });
    return result;
  };

  return { registerMacroLike, substitute };
}

const JSDELIVR_MODULE_URL_PATTERN =
  /https:\/\/(?:testingcf|cdn|fastly)\.jsdelivr\.net\/[^'"`\s)]+/g;
const TAVERN_MODULE_PROXY_VERSION = "2";

/** Routes jsDelivr ES-module graphs through Renge's server-side loader. */
export function proxyTavernModuleUrls(source: string, origin: string) {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  return source.replace(JSDELIVR_MODULE_URL_PATTERN, (remoteUrl) =>
    `${normalizedOrigin}/api/tavern-module-proxy?url=${encodeURIComponent(remoteUrl)}&v=${TAVERN_MODULE_PROXY_VERSION}`,
  );
}

export type TavernEventSubscription = ((...args: unknown[]) => unknown) & {
  stop: () => boolean;
  unsubscribe: () => boolean;
};

/** Adds the disposable controls returned by TavernHelper event subscriptions. */
export function attachTavernSubscriptionControls(
  callback: (...args: unknown[]) => unknown,
  stop: () => boolean,
): TavernEventSubscription {
  const subscription = callback as TavernEventSubscription;
  Object.defineProperties(subscription, {
    stop: { configurable: true, value: stop },
    unsubscribe: { configurable: true, value: stop },
  });
  return subscription;
}

/**
 * Reproduces TavernHelper's errorCatched higher-order callback helper.
 *
 * Character-card modules commonly wrap lifecycle and event callbacks with this
 * global. Keeping the wrapper independent of a specific window also lets the
 * runtime expose the same implementation in its iframe and parent-page bridge.
 */
export function createTavernErrorCatched(
  reportError: TavernCompatibilityErrorReporter,
) {
  return (callback: unknown) => {
    if (typeof callback !== "function") return callback;

    return async function errorCatchedCallback(this: unknown, ...args: unknown[]) {
      try {
        return await Reflect.apply(callback, this, args);
      } catch (error) {
        try {
          reportError(error);
        } catch {
          // An error reporter must never turn a guarded card callback back into
          // an unhandled rejection.
        }
        return null;
      }
    };
  };
}
