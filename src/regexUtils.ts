export type RegexScript = {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: number[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
  substituteRegex: number;
  minDepth: number | null;
  maxDepth: number | null;
  sourceFormat: "renge" | "sillytavern";
  sourceFileName: string;
  createdAt: string;
  updatedAt: string;
};

export type ApplyRegexScriptsOptions = {
  placement?: number;
  depth?: number;
  destination?: "display" | "prompt";
  userName?: string;
  characterName?: string;
  messageVariables?: Record<string, unknown>;
};

const SILLY_TAVERN_STATUS_PLACEHOLDER = "<StatusPlaceHolderImpl/>";

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

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

function toPlacementArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map(Number)
        .filter((placement) => Number.isFinite(placement))
        .map((placement) => Math.round(placement)),
    ),
  );
}

function getNestedValue(root: UnknownRecord, path: string[]) {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function getLegacyPlacements(raw: UnknownRecord) {
  if (!isRecord(raw.source)) return [];
  const placements: number[] = [];
  if (raw.source.user_input !== false) placements.push(1);
  if (raw.source.ai_output !== false) placements.push(2);
  if (raw.source.slash_command !== false) placements.push(3);
  if (raw.source.world_info !== false) placements.push(5);
  return placements;
}

export function createRegexScript(name = "新正则规则"): RegexScript {
  const timestamp = new Date().toISOString();
  return {
    id: createId("regex"),
    scriptName: name,
    findRegex: "",
    replaceString: "",
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    sourceFormat: "renge",
    sourceFileName: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeRegexScript(
  rawValue: unknown,
  index = 0,
  sourceFileName = "",
): RegexScript {
  const raw = isRecord(rawValue) ? rawValue : {};
  const fallback = createRegexScript(`正则规则 ${index + 1}`);
  const placements = toPlacementArray(raw.placement);
  const legacyPlacements = getLegacyPlacements(raw);
  const rawEnabled = typeof raw.enabled === "boolean" ? raw.enabled : undefined;
  return {
    ...fallback,
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id
        : fallback.id,
    scriptName:
      String(raw.scriptName ?? raw.script_name ?? raw.name ?? fallback.scriptName).trim() ||
      fallback.scriptName,
    findRegex: String(raw.findRegex ?? raw.find_regex ?? raw.pattern ?? ""),
    replaceString: String(
      raw.replaceString ?? raw.replace_string ?? raw.replacement ?? "",
    ),
    trimStrings: toStringArray(raw.trimStrings ?? raw.trim_strings),
    placement:
      placements.length > 0
        ? placements
        : legacyPlacements.length > 0
          ? legacyPlacements
          : [2],
    disabled:
      rawEnabled !== undefined
        ? !rawEnabled
        : toBoolean(raw.disabled, false),
    markdownOnly: toBoolean(raw.markdownOnly ?? raw.markdown_only, true),
    promptOnly: toBoolean(raw.promptOnly ?? raw.prompt_only, false),
    runOnEdit: toBoolean(raw.runOnEdit ?? raw.run_on_edit, true),
    substituteRegex: Math.max(
      0,
      Math.round(Number(raw.substituteRegex ?? raw.substitute_regex ?? 0) || 0),
    ),
    minDepth: toNullableNumber(raw.minDepth ?? raw.min_depth),
    maxDepth: toNullableNumber(raw.maxDepth ?? raw.max_depth),
    sourceFormat:
      raw.sourceFormat === "sillytavern" || sourceFileName
        ? "sillytavern"
        : "renge",
    sourceFileName:
      sourceFileName || (typeof raw.sourceFileName === "string" ? raw.sourceFileName : ""),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : fallback.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : fallback.updatedAt,
  };
}

function getStandaloneRegexValues(rawValue: unknown): unknown[] {
  if (Array.isArray(rawValue)) return rawValue;
  if (!isRecord(rawValue)) return [];
  for (const key of ["regexes", "regexScripts", "regex_scripts", "scripts", "global"]) {
    if (Array.isArray(rawValue[key])) return rawValue[key];
  }
  if (
    "findRegex" in rawValue ||
    "find_regex" in rawValue ||
    "pattern" in rawValue
  ) {
    return [rawValue];
  }
  return [];
}

export function importSillyTavernRegexFile(rawValue: unknown, fileName: string) {
  const values = getStandaloneRegexValues(rawValue);
  if (values.length === 0) {
    throw new Error("没有找到酒馆正则脚本。支持单个脚本对象、脚本数组或 regexes 容器。");
  }
  const scripts = values.map((value, index) => ({
    ...normalizeRegexScript(value, index, fileName),
    id: createId("regex"),
  }));
  if (scripts.every((script) => !script.findRegex.trim())) {
    throw new Error("正则脚本缺少 findRegex 查找表达式。");
  }
  return scripts;
}

export function extractSillyTavernPresetRegexScripts(
  rawPresetValue: unknown,
  sourceFileName: string,
) {
  if (!isRecord(rawPresetValue)) return [];
  const paths = [
    ["extensions", "SPreset", "RegexBinding", "regexes"],
    ["extensions", "RegexBinding", "regexes"],
    ["extensions", "regex_scripts"],
    ["extensions", "regexScripts"],
    ["regexes"],
    ["regex_scripts"],
    ["regexScripts"],
  ];
  const values: unknown[] = [];
  paths.forEach((path) => {
    const candidate = getNestedValue(rawPresetValue, path);
    if (Array.isArray(candidate)) values.push(...candidate);
  });

  const seen = new Set<string>();
  return values
    .map((value, index) => normalizeRegexScript(value, index, sourceFileName))
    .filter((script) => {
      const identity = `${script.id}\u0000${script.findRegex}\u0000${script.replaceString}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return Boolean(script.findRegex.trim());
    })
    .map((script) => ({ ...script, id: createId("regex") }));
}

export function loadRegexScriptsFromStorage(storageKey: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.map((script, index) => normalizeRegexScript(script, index))
      : [];
  } catch {
    return [];
  }
}

function replaceRegexMacros(value: string, options: ApplyRegexScriptsOptions) {
  return value
    .replace(/{{\s*user\s*}}/gi, options.userName?.trim() || "用户")
    .replace(/{{\s*char\s*}}/gi, options.characterName?.trim() || "助手");
}

function formatMessageVariable(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function replaceMessageVariableMacros(
  value: string,
  variables: Record<string, unknown> | undefined,
) {
  if (!variables) return value;
  return value.replace(
    /{{\s*format_message_variable\s*::\s*([^{}]+?)\s*}}/gi,
    (_match, rawPath: string) =>
      formatMessageVariable(
        getNestedValue(
          variables,
          rawPath
            .split(".")
            .map((segment) => segment.trim())
            .filter(Boolean),
        ),
      ),
  );
}

function compileRegex(findRegex: string) {
  const slashExpression = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(findRegex);
  if (slashExpression) {
    return new RegExp(slashExpression[1], slashExpression[2]);
  }
  return new RegExp(findRegex, "g");
}

function expandRegexReplacement(
  replacement: string,
  replaceArguments: unknown[],
) {
  const wholeMatch = String(replaceArguments[0] ?? "");
  const possibleGroups = replaceArguments[replaceArguments.length - 1];
  const namedGroups =
    possibleGroups && typeof possibleGroups === "object" && !Array.isArray(possibleGroups)
      ? (possibleGroups as Record<string, unknown>)
      : null;
  const captureCount = Math.max(
    0,
    replaceArguments.length - (namedGroups ? 4 : 3),
  );

  return replacement
    .replace(/{{match}}/gi, "$0")
    .replace(/\$(\d+)|\$<([^>]+)>/g, (token, captureIndex, captureName) => {
      if (captureName) {
        return namedGroups && captureName in namedGroups
          ? String(namedGroups[captureName] ?? "")
          : token;
      }
      const index = Number(captureIndex);
      if (!Number.isInteger(index) || index < 0) return token;
      return index === 0
        ? wholeMatch
        : index <= captureCount
          ? String(replaceArguments[index] ?? "")
          : token;
    });
}

export function getRegexScriptError(script: RegexScript) {
  if (!script.findRegex.trim()) return "请输入查找正则。";
  try {
    compileRegex(script.findRegex);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "无效的正则表达式。";
  }
}

export function applyRegexScripts(
  content: string,
  scripts: RegexScript[],
  options: ApplyRegexScriptsOptions = {},
) {
  const placement = options.placement ?? 2;
  const depth = Math.max(0, options.depth ?? 0);
  const destination = options.destination ?? "display";
  const applicableScripts = scripts.filter((script) => {
    if (script.disabled || !script.findRegex.trim()) return false;
    if (!script.placement.includes(placement)) return false;
    const hasExplicitDestination = script.markdownOnly || script.promptOnly;
    if (destination === "display" && hasExplicitDestination && !script.markdownOnly) {
      return false;
    }
    if (destination === "prompt" && hasExplicitDestination && !script.promptOnly) {
      return false;
    }
    if (script.minDepth !== null && depth < script.minDepth) return false;
    if (script.maxDepth !== null && depth > script.maxDepth) return false;
    return true;
  });
  const orderedScripts =
    destination === "display"
      ? [
          ...applicableScripts.filter((script) => !script.markdownOnly),
          ...applicableScripts.filter((script) => script.markdownOnly),
        ]
      : applicableScripts;

  const result = orderedScripts.reduce((currentResult, script) => {

    try {
      const findRegex = script.substituteRegex
        ? replaceRegexMacros(script.findRegex, options)
        : script.findRegex;
      const replaceString = script.substituteRegex
        ? replaceRegexMacros(script.replaceString, options)
        : script.replaceString;
      let nextResult = currentResult.replace(
        compileRegex(findRegex),
        (...replaceArguments: unknown[]) =>
          expandRegexReplacement(replaceString, replaceArguments),
      );
      script.trimStrings.forEach((trimString) => {
        if (trimString) nextResult = nextResult.split(trimString).join("");
      });
      return nextResult;
    } catch {
      return currentResult;
    }
  }, content);

  return destination === "display"
    ? replaceMessageVariableMacros(result, options.messageVariables)
    : result;
}

export function appendSillyTavernStatusPlaceholderToGreeting(
  content: string,
  scripts: RegexScript[],
  options: ApplyRegexScriptsOptions = {},
) {
  if (/StatusPlaceHolderImpl/i.test(content)) return content;

  const statusRendererScripts = scripts.filter((script) =>
    /StatusPlaceHolderImpl/i.test(script.findRegex),
  );
  if (statusRendererScripts.length === 0) return content;

  const renderedPlaceholder = applyRegexScripts(
    SILLY_TAVERN_STATUS_PLACEHOLDER,
    statusRendererScripts,
    {
      ...options,
      placement: 2,
      destination: "display",
    },
  );
  if (
    renderedPlaceholder === SILLY_TAVERN_STATUS_PLACEHOLDER ||
    !renderedPlaceholder.trim()
  ) {
    return content;
  }

  return `${content.trimEnd()}\n${SILLY_TAVERN_STATUS_PLACEHOLDER}`;
}
