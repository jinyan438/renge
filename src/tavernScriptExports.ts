export type TavernScriptExportSnapshot = {
  values: Record<string, unknown>;
  methods: Record<string, Array<{ args: unknown[]; value: unknown }>>;
};
export type TavernScriptExportSnapshots = Record<string, TavernScriptExportSnapshot>;

const forbidden = new Set(["__proto__", "constructor", "prototype", "then", "Mvu", "SillyTavern", "TavernHelper", "tavernHelper", "tavernHelperAPI", "th"]);
const readMethod = /^(?:get(?:[A-Z_$]|$)|read(?:[A-Z_$]|$)|view$|latest(?:[A-Z_$]|$)|list(?:[A-Z_$]|$)|is[A-Z]|has[A-Z]|can[A-Z])/;

/** Only globals created by this runtime's scripts may cross the preview bridge. */
export function createTavernScriptExports(host: Record<string, unknown>, baseline: Set<string>) {
  const resolve = (name: string): Record<string, unknown> | null => {
    if (baseline.has(name) || forbidden.has(name) || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
    const value = Object.getOwnPropertyDescriptor(host, name)?.value;
    return value && Object.prototype.toString.call(value) === "[object Object]" &&
      Object.values(value).some(method => typeof method === "function") ? value : null;
  };
  const clone = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  return {
    snapshot(names: string[], messageIndex: number): TavernScriptExportSnapshots {
      const exports: TavernScriptExportSnapshots = {};
      for (const name of names) {
        const owner = resolve(name);
        if (!owner) continue;
        const values: Record<string, unknown> = {};
        const methods: TavernScriptExportSnapshot["methods"] = {};
        for (const [key, value] of Object.entries(owner)) {
          if (forbidden.has(key)) continue;
          if (typeof value !== "function") {
            try { values[key] = clone(value); } catch { /* DOM and private closures are not transferable. */ }
            continue;
          }
          const reads: Array<{ args: unknown[]; value: unknown }> = [];
          methods[key] = reads;
          // Common synchronous queries read either the current floor or no
          // arguments. Actions always run through RPC, never during discovery.
          if (!readMethod.test(key) || value.constructor?.name === "AsyncFunction" || value.length > 1) continue;
          for (const args of [[], [messageIndex]]) {
            try {
              const result = Reflect.apply(value, owner, args);
              if (result && typeof result.then === "function") { void result.catch(() => {}); continue; }
              reads.push({ args, value: clone(result) });
            } catch { /* An optional query may require a different argument. */ }
          }
        }
        exports[name] = { values, methods };
      }
      return exports;
    },
    async call(name: string, method: string, args: unknown[]) {
      const owner = resolve(name);
      const fn = owner && !forbidden.has(method) ? Object.getOwnPropertyDescriptor(owner, method)?.value : null;
      if (typeof fn !== "function") throw new Error(`脚本接口 ${name}.${method} 不存在。`);
      return await Reflect.apply(fn, owner, args);
    },
  };
}
