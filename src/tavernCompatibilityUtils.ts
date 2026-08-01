export type TavernCompatibilityErrorReporter = (error: unknown) => void;

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

/** Routes jsDelivr ES-module graphs through Renge's server-side loader. */
export function proxyTavernModuleUrls(source: string, origin: string) {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  return source.replace(JSDELIVR_MODULE_URL_PATTERN, (remoteUrl) =>
    `${normalizedOrigin}/api/tavern-module-proxy?url=${encodeURIComponent(remoteUrl)}`,
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
