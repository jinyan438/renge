type Settings = Record<string, unknown>;

function cloneSettings(value: unknown): Settings {
  return value && typeof value === "object" && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value)) as Settings
    : {};
}

/** Keep the exported settings root alive across module imports and runtime restarts. */
export function createTavernSettingsStore(initial: unknown) {
  const root = cloneSettings(initial);
  let snapshot = cloneSettings(root);
  return {
    root,
    snapshot: () => snapshot,
    restore(value: unknown) {
      const next = cloneSettings(value);
      Object.keys(root).forEach((key) => delete root[key]);
      Object.assign(root, next);
      snapshot = cloneSettings(root);
      return snapshot;
    },
    capture(value: unknown = root) {
      if (value !== root) this.restore(value);
      snapshot = cloneSettings(root);
      return snapshot;
    },
  };
}
