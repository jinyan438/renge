export type TavernScriptRunOn = "startup" | "message" | "manual";

export type TavernScriptSourceFormat = "renge" | "sillytavern";

export type TavernScriptButton = {
  id: string;
  name: string;
  visible: boolean;
};

export type TavernScript = {
  id: string;
  sourceId: string;
  type: "script";
  name: string;
  content: string;
  info: string;
  enabled: boolean;
  autoRun: boolean;
  runOn: TavernScriptRunOn;
  buttonEnabled: boolean;
  buttons: TavernScriptButton[];
  data: Record<string, unknown>;
  exportWith: {
    data: boolean;
    button: boolean;
  };
  sourceFormat: TavernScriptSourceFormat;
  sourceFileName: string;
  createdAt: string;
  updatedAt: string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return { ...value };
  }
}

function nestedValue(root: unknown, path: string[]) {
  let value = root;
  for (const segment of path) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
}

function normalizeRunOn(value: unknown, fallback: TavernScriptRunOn = "startup") {
  const normalized = stringValue(value).trim().toLowerCase();
  if (normalized === "manual") return "manual";
  if (
    normalized === "message" ||
    normalized === "message_received" ||
    normalized === "message-received"
  ) {
    return "message";
  }
  return fallback;
}

function unwrapScript(value: unknown) {
  if (!isRecord(value)) return {};
  if (value.type === "script" && isRecord(value.value)) return value.value;
  return value;
}

function normalizeButtons(value: unknown, scriptId: string) {
  if (!Array.isArray(value)) return [];
  return value
    .map((button, index): TavernScriptButton | null => {
      if (!isRecord(button)) return null;
      const name = stringValue(button.name ?? button.label).trim();
      if (!name) return null;
      return {
        id: stringValue(button.id).trim() || `${scriptId}-button-${index + 1}`,
        name,
        visible: booleanValue(button.visible, true),
      };
    })
    .filter((button): button is TavernScriptButton => Boolean(button));
}

export function createTavernScript(name = "新酒馆脚本"): TavernScript {
  const timestamp = new Date().toISOString();
  const id = createId("tavern-script");
  return {
    id,
    sourceId: "",
    type: "script",
    name,
    content: "",
    info: "",
    enabled: true,
    autoRun: true,
    runOn: "startup",
    buttonEnabled: true,
    buttons: [],
    data: {},
    exportWith: { data: true, button: true },
    sourceFormat: "renge",
    sourceFileName: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeTavernScript(
  rawValue: unknown,
  index = 0,
  sourceFileName = "",
  options: {
    preserveId?: boolean;
    sourceFormat?: TavernScriptSourceFormat;
  } = {},
): TavernScript {
  const raw = unwrapScript(rawValue);
  const fallback = createTavernScript(`酒馆脚本 ${index + 1}`);
  const button = isRecord(raw.button) ? raw.button : {};
  const exportWith = isRecord(raw.export_with)
    ? raw.export_with
    : isRecord(raw.exportWith)
      ? raw.exportWith
      : {};
  const importedId = stringValue(raw.id).trim();
  const storedSourceFormat = stringValue(raw.sourceFormat);
  const normalizedSourceFormat: TavernScriptSourceFormat =
    options.sourceFormat ??
    (storedSourceFormat === "sillytavern" || storedSourceFormat === "renge"
      ? storedSourceFormat
      : sourceFileName
        ? "sillytavern"
        : "renge");
  const id =
    options.preserveId !== false &&
    storedSourceFormat &&
    stringValue(raw.id).trim()
      ? stringValue(raw.id).trim()
      : fallback.id;
  const buttons = normalizeButtons(
    Array.isArray(button.buttons) ? button.buttons : raw.buttons,
    id,
  );
  const timestamp = new Date().toISOString();

  return {
    ...fallback,
    id,
    sourceId: stringValue(raw.sourceId).trim() || importedId,
    name:
      stringValue(raw.name ?? raw.scriptName, fallback.name).trim() || fallback.name,
    content: stringValue(raw.content ?? raw.code ?? raw.script),
    info: stringValue(raw.info ?? raw.description ?? raw.comment),
    enabled: booleanValue(raw.enabled, true),
    autoRun: booleanValue(raw.autoRun, true),
    runOn: normalizeRunOn(raw.runOn ?? raw.trigger),
    buttonEnabled: booleanValue(button.enabled ?? raw.buttonEnabled, true),
    buttons,
    data: cloneRecord(raw.data),
    exportWith: {
      data: booleanValue(exportWith.data, true),
      button: booleanValue(exportWith.button, true),
    },
    sourceFormat: normalizedSourceFormat,
    sourceFileName: sourceFileName || stringValue(raw.sourceFileName),
    createdAt: stringValue(raw.createdAt, timestamp),
    updatedAt: stringValue(raw.updatedAt, timestamp),
  };
}

function collectScriptArrays(root: UnknownRecord, data: UnknownRecord) {
  const paths = [
    ["extensions", "tavern_helper", "scripts"],
    ["extensions", "tavernHelper", "scripts"],
    ["extensions", "TavernHelper_scripts"],
    ["extensions", "tavern_helper_scripts"],
    ["extensions", "chub", "extensions", "TavernHelper_scripts"],
    ["TavernHelper_scripts"],
    ["tavern_helper", "scripts"],
    ["tavernHelper", "scripts"],
  ];
  const values: unknown[] = [];
  [data, root].forEach((container) => {
    paths.forEach((path) => {
      const candidate = nestedValue(container, path);
      if (Array.isArray(candidate)) values.push(...candidate);
    });
  });
  return values;
}

function flattenScriptValues(values: unknown[], parentEnabled = true): unknown[] {
  return values.flatMap((value) => {
    if (!isRecord(value)) return [];
    const isFolder = value.type === "folder" || Array.isArray(value.scripts);
    if (!isFolder || !Array.isArray(value.scripts)) return [value];
    const folderEnabled = parentEnabled && booleanValue(value.enabled, true);
    return flattenScriptValues(value.scripts, folderEnabled).map((script) =>
      isRecord(script)
        ? {
            ...script,
            enabled: folderEnabled && booleanValue(script.enabled, true),
          }
        : script,
    );
  });
}

function extractTavernHelperScripts(
  root: Record<string, unknown>,
  data: Record<string, unknown>,
  sourceFileName: string,
) {
  const seen = new Set<string>();
  return flattenScriptValues(collectScriptArrays(root, data))
    .map((script, index) =>
      normalizeTavernScript(script, index, sourceFileName, {
        preserveId: false,
        sourceFormat: "sillytavern",
      }),
    )
    .filter((script) => {
      if (!script.content.trim()) return false;
      const identity = `${script.sourceId}\u0000${script.name}\u0000${script.content}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

export function extractCharacterTavernScripts(
  root: Record<string, unknown>,
  data: Record<string, unknown>,
  sourceFileName: string,
) {
  return extractTavernHelperScripts(root, data, sourceFileName);
}

export function extractPresetTavernScripts(
  root: Record<string, unknown>,
  sourceFileName: string,
) {
  return extractTavernHelperScripts(root, root, sourceFileName);
}

export function extractCharacterTavernVariables(
  root: Record<string, unknown>,
  data: Record<string, unknown>,
) {
  const paths = [
    ["extensions", "tavern_helper", "variables"],
    ["extensions", "tavernHelper", "variables"],
    ["extensions", "TavernHelper_variables"],
    ["tavern_helper", "variables"],
  ];
  for (const container of [data, root]) {
    for (const path of paths) {
      const candidate = nestedValue(container, path);
      if (isRecord(candidate)) return cloneRecord(candidate);
    }
  }
  return {};
}

function getImportCandidates(value: unknown) {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.scripts)) return value.scripts;
  if (Array.isArray(nestedValue(value, ["tavern_helper", "scripts"]))) {
    return nestedValue(value, ["tavern_helper", "scripts"]) as unknown[];
  }
  return [value];
}

export async function importSillyTavernScriptFile(file: File) {
  let rawValue: unknown;
  try {
    rawValue = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("酒馆脚本 JSON 无法解析。");
  }
  const scripts = getImportCandidates(rawValue)
    .map((script, index) =>
      normalizeTavernScript(script, index, file.name, {
        preserveId: false,
        sourceFormat: "sillytavern",
      }),
    )
    .filter((script) => script.content.trim());
  if (scripts.length === 0) {
    throw new Error("文件中没有找到可执行的酒馆脚本内容。");
  }
  return scripts;
}

export function serializeTavernScript(script: TavernScript) {
  return {
    type: "script",
    enabled: script.enabled,
    name: script.name,
    id: script.sourceId || script.id,
    content: script.content,
    info: script.info,
    button: {
      enabled: script.buttonEnabled,
      buttons: script.buttons.map((button) => ({
        name: button.name,
        visible: button.visible,
      })),
    },
    data: script.exportWith.data ? cloneRecord(script.data) : {},
    export_with: {
      data: script.exportWith.data,
      button: script.exportWith.button,
    },
  };
}

export function exportTavernScriptJson(script: TavernScript) {
  return JSON.stringify(serializeTavernScript(script), null, 2);
}

export function exportTavernScriptCollectionJson(scripts: TavernScript[]) {
  return JSON.stringify(
    {
      version: "1.0",
      scripts: scripts.map(serializeTavernScript),
    },
    null,
    2,
  );
}

export function loadTavernScriptsFromStorage(storageKey: string) {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.map((script, index) => normalizeTavernScript(script, index))
      : [];
  } catch {
    return [];
  }
}

export function normalizeTavernVariables(value: unknown) {
  return cloneRecord(value);
}
