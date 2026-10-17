import { randomUUID } from "node:crypto";

/** Pi's text/RPC UI contract. Terminal component factories require TUI mode. */
export function createPiExtensionUi({ emit, signal, onUnsupported }) {
  const pending = new Map();
  let editorText = "";
  const send = (method, fields = {}) => emit({ type: "extension_ui_request", method, ...fields });
  const dialog = (method, fields, options = {}) => {
    const fallback = method === "confirm" ? false : undefined;
    if (signal.aborted || options.signal?.aborted) return Promise.resolve(fallback);
    const id = randomUUID();
    return new Promise((resolve) => {
      let timer;
      const finish = (response, cancelled = false) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        options.signal?.removeEventListener("abort", cancel);
        pending.delete(id);
        if (cancelled) emit({ type: "extension_ui_cancel", id });
        if (cancelled || response?.cancelled) return resolve(fallback);
        if (method === "confirm") return resolve(response?.confirmed === true);
        const value = typeof response?.value === "string" ? response.value : undefined;
        resolve(method === "select" && !fields.options.includes(value) ? undefined : value);
      };
      const cancel = () => finish(undefined, true);
      pending.set(id, finish);
      signal.addEventListener("abort", cancel, { once: true });
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.timeout > 0) timer = setTimeout(cancel, options.timeout);
      send(method, { id, ...fields });
    });
  };
  const unsupportedCalls = new Set();
  const unsupported = (method) => () => {
    const source = new Error().stack?.split("\n").find(line =>
      !line.includes("extension-ui.mjs") && /node_modules|extensions|file:\/\//.test(line),
    )?.trim() ?? "";
    const key = `${method}\n${source}`;
    if (unsupportedCalls.has(key)) return;
    unsupportedCalls.add(key);
    // Terminal decorations are optional in RPC. Keep attribution in diagnostics
    // without inserting a synthetic assistant reply or a warning every turn.
    try { onUnsupported?.({ method, source }); } catch { /* Diagnostics cannot fail an extension. */ }
  };
  const plainTheme = {
    name: "renge-text", appearance: "light",
    colors: new Proxy(Object.freeze({}), { get: () => "#666666" }),
    style: (text) => text,
    fg: (_color, text) => text, bg: (_color, text) => text,
    bold: (text) => text, italic: (text) => text, underline: (text) => text,
    inverse: (text) => text, strikethrough: (text) => text,
    getFgAnsi: () => "", getBgAnsi: () => "",
  };
  return {
    respond(id, response) {
      const finish = pending.get(id);
      if (!finish) return false;
      finish(response);
      return true;
    },
    context: {
      select: (title, options, opts) => dialog("select", { title, options }, opts),
      confirm: (title, message, opts) => dialog("confirm", { title, message }, opts),
      input: (title, placeholder, opts) => dialog("input", { title, placeholder }, opts),
      editor: (title, prefill) => dialog("editor", { title, prefill }),
      notify: (message, notifyType = "info") => send("notify", { message, notifyType }),
      setStatus: (statusKey, statusText) => send("setStatus", { statusKey, statusText }),
      setWorkingMessage: (message) => send("setWorkingMessage", { message }),
      setWidget: (widgetKey, widgetLines) => {
        if (widgetLines === undefined || Array.isArray(widgetLines)) send("setWidget", { widgetKey, widgetLines });
        else unsupported("setWidget")();
      },
      setEditorText(text) { editorText = text; send("set_editor_text", { text }); },
      pasteToEditor(text) { this.setEditorText(editorText + text); },
      getEditorText: () => editorText,
      onTerminalInput: () => () => {},
      setWorkingVisible() {}, setWorkingIndicator() {}, setHiddenThinkingLabel() {},
      setFooter: unsupported("setFooter"), setHeader: unsupported("setHeader"), setTitle() {},
      custom: async () => { unsupported("custom")(); return undefined; },
      addAutocompleteProvider: unsupported("addAutocompleteProvider"), setEditorComponent: unsupported("setEditorComponent"),
      getEditorComponent: () => undefined,
      theme: plainTheme, getAllThemes: () => [], getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "终端主题不适用于网页界面" }),
      getToolsExpanded: () => false, setToolsExpanded() {},
    },
  };
}

// Slash commands run before the SDK starts an agent turn, so ctx.signal may
// be undefined. Supply the HTTP run's signal to make their network work stoppable.
export function bindPiCommandSignals(extensions, signal) {
  for (const extension of extensions) {
    for (const command of extension.commands.values()) {
      const handler = command.handler;
      command.handler = (args, ctx) => handler(args, new Proxy(ctx, {
        get(target, key, receiver) {
          if (key === "signal") return Reflect.get(target, key, receiver) ?? signal;
          return Reflect.get(target, key, receiver);
        },
      }));
    }
  }
}
