import { normalizePocketPromptOverrides, type PocketPromptOverrides } from "./pocketPhonePrompts.ts";

export const POCKET_PROMPTS_STORAGE_KEY = "renge_pocket_prompts_v1";
const PHONE_STORAGE_PREFIX = "renge_pocket_phone_v1:";
const PROMPTS_CHANGED = "renge-pocket-prompts-changed";
const STORAGE_WARNING = "手机提示词存储不可用，改动暂未保存。请保留当前页面。";
type PromptStorage = Pick<Storage, "getItem" | "setItem" | "key" | "length">;
export type PocketPromptSettings = { prompts: PocketPromptOverrides; storageWarning: string };
let unsavedSettings: PocketPromptSettings | undefined;

function parseGlobalSettings(raw: string): PocketPromptOverrides {
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || !value.prompts || typeof value.prompts !== "object" || Array.isArray(value.prompts)) throw new Error("手机提示词数据格式有误。");
  return normalizePocketPromptOverrides(value.prompts);
}

export function writePocketPromptSettings(storage: PromptStorage, prompts: PocketPromptOverrides): PocketPromptSettings {
  const normalized = normalizePocketPromptOverrides(prompts);
  try {
    // Save even an empty map: resetting defaults must never reimport old sessions.
    storage.setItem(POCKET_PROMPTS_STORAGE_KEY, JSON.stringify({ version: 1, prompts: normalized }));
    return { prompts: normalized, storageWarning: "" };
  } catch { return { prompts: normalized, storageWarning: STORAGE_WARNING }; }
}

export function readPocketPromptSettings(storage: PromptStorage, currentPhoneKey: string): PocketPromptSettings {
  let prompts: PocketPromptOverrides = {};
  try {
    const global = storage.getItem(POCKET_PROMPTS_STORAGE_KEY);
    if (global !== null) return { prompts: parseGlobalSettings(global), storageWarning: "" };
    // Migrate once. Current-session edits win conflicts; other saved sessions
    // fill missing entries without changing their contacts or message histories.
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => !!key && key.startsWith(PHONE_STORAGE_PREFIX) && key !== currentPhoneKey).sort();
    for (const key of [currentPhoneKey, ...keys]) {
      let legacy;
      try { legacy = JSON.parse(storage.getItem(key) || "null"); } catch { continue; }
      if (legacy?.version !== 1) continue;
      const entries = normalizePocketPromptOverrides(legacy.settings?.promptOverrides);
      prompts = { ...entries, ...prompts };
    }
    return writePocketPromptSettings(storage, prompts);
  } catch { return { prompts, storageWarning: "手机提示词读取失败，暂时使用已读取的设置。请保留当前页面。" }; }
}

export function loadGlobalPocketPrompts(currentPhoneKey: string): PocketPromptSettings {
  if (unsavedSettings) return unsavedSettings;
  let settings: PocketPromptSettings;
  try { settings = readPocketPromptSettings(localStorage, currentPhoneKey); }
  catch { settings = { prompts: {}, storageWarning: STORAGE_WARNING }; }
  if (settings.storageWarning) unsavedSettings = settings;
  return settings;
}

export function saveGlobalPocketPrompts(prompts: PocketPromptOverrides): PocketPromptSettings {
  let settings: PocketPromptSettings;
  try { settings = writePocketPromptSettings(localStorage, prompts); }
  catch { settings = { prompts: normalizePocketPromptOverrides(prompts), storageWarning: STORAGE_WARNING }; }
  unsavedSettings = settings.storageWarning ? settings : undefined;
  window.dispatchEvent(new CustomEvent<PocketPromptSettings>(PROMPTS_CHANGED, { detail: settings }));
  return settings;
}

export function subscribeGlobalPocketPrompts(receive: (settings: PocketPromptSettings) => void) {
  const changed = (event: Event) => receive((event as CustomEvent<PocketPromptSettings>).detail);
  const stored = (event: StorageEvent) => {
    if (event.storageArea !== localStorage || event.key !== POCKET_PROMPTS_STORAGE_KEY && event.key !== null) return;
    try {
      const prompts = event.newValue === null ? {} : parseGlobalSettings(event.newValue);
      unsavedSettings = undefined;
      receive({ prompts, storageWarning: "" });
    } catch { /* Preserve current edits when another window writes malformed data. */ }
  };
  window.addEventListener(PROMPTS_CHANGED, changed);
  window.addEventListener("storage", stored);
  return () => { window.removeEventListener(PROMPTS_CHANGED, changed); window.removeEventListener("storage", stored); };
}
