import type { TavernScriptExportSnapshots } from "./tavernScriptExports";

function installHtmlPreviewScriptExports(
  snapshot: { scriptExports?: TavernScriptExportSnapshots },
  request: (operation: string, data: Record<string, unknown>) => Promise<unknown>,
  clone: <T>(value: T) => T,
) {
  const facades = new Map<string, object>();
  const install = () => {
    Object.keys(snapshot.scriptExports ?? {}).forEach(name => {
      if (facades.has(name)) return;
      const facade = new Proxy({}, {
        get(_target, property) {
          if (typeof property !== "string" || property === "then") return undefined;
          const current = snapshot.scriptExports?.[name];
          if (!current) return undefined;
          if (Object.prototype.hasOwnProperty.call(current.values, property)) return clone(current.values[property]);
          if (!Object.prototype.hasOwnProperty.call(current.methods, property)) return undefined;
          return (...args: unknown[]) => {
            const cached = snapshot.scriptExports?.[name]?.methods[property]?.find(read => JSON.stringify(read.args) === JSON.stringify(args));
            if (cached) return clone(cached.value);
            return request("scriptExport", { name, method: property, args: clone(args) }).then(raw => {
              const response = raw as { result?: unknown; scriptExports?: TavernScriptExportSnapshots };
              if (response.scriptExports) snapshot.scriptExports = response.scriptExports;
              install();
              return clone(response.result);
            });
          };
        },
      });
      facades.set(name, facade);
      Object.defineProperty(window, name, { configurable: true, get: () => snapshot.scriptExports?.[name] ? facade : undefined });
    });
  };
  install();
  let pending: Promise<void> | undefined;
  return {
    refresh: () => {
      if (!Object.keys(snapshot.scriptExports ?? {}).length) return Promise.resolve();
      return pending ??= request("scriptExportSnapshots", {}).then(raw => {
        snapshot.scriptExports = raw as TavernScriptExportSnapshots;
        install();
      }).finally(() => { pending = undefined; });
    },
  };
}

export const HTML_PREVIEW_SCRIPT_EXPORTS_SOURCE =
  `((__name) => (${installHtmlPreviewScriptExports.toString()}))((target, value) => Object.defineProperty(target, "name", { value, configurable: true }))`;
