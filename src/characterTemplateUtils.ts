export type CharacterRegexTemplateConfig = {
  sourceKey: string;
  template: string;
  customRegex: string;
  disableParsers: boolean;
  limitToRecentMessages: boolean;
  recentMessageCount: number;
  skipFirstMessage: boolean;
};

type UnknownRecord = Record<string, unknown>;

const DEFAULT_CHARACTER_TEMPLATE_REGEX =
  String.raw`\[([^\]]+)\]([\s\S]*?)(?:\[\/\1\]|(?=\[(?!\/\1\])[^\]]+\])|$)`;
const KNOWN_CHARACTER_TEMPLATE_EXTENSION_KEYS = [
  "xiaobaix-template",
  "xiaobaix_template",
  "xiaobaixTemplate",
];

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function positiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(100, Math.floor(number))
    : fallback;
}

function normalizeTemplateConfig(
  sourceKey: string,
  value: unknown,
): CharacterRegexTemplateConfig | null {
  if (!isRecord(value) || value.enabled === false) return null;
  const template = typeof value.template === "string" ? value.template.trim() : "";
  if (!template) return null;
  return {
    sourceKey,
    template,
    customRegex:
      typeof value.customRegex === "string" && value.customRegex.trim()
        ? value.customRegex.trim()
        : DEFAULT_CHARACTER_TEMPLATE_REGEX,
    disableParsers: booleanValue(value.disableParsers, false),
    limitToRecentMessages: booleanValue(value.limitToRecentMessages, false),
    recentMessageCount: positiveInteger(value.recentMessageCount, 5),
    skipFirstMessage: booleanValue(value.skipFirstMessage, false),
  };
}

/** Finds XiaobaiX and compatible custom-regex HTML template extensions. */
export function getCharacterRegexTemplateConfig(
  extensions: unknown,
): CharacterRegexTemplateConfig | null {
  if (!isRecord(extensions)) return null;
  const checkedKeys = new Set<string>();
  for (const key of KNOWN_CHARACTER_TEMPLATE_EXTENSION_KEYS) {
    checkedKeys.add(key);
    const config = normalizeTemplateConfig(key, extensions[key]);
    if (config) return config;
  }
  for (const [key, value] of Object.entries(extensions)) {
    if (checkedKeys.has(key)) continue;
    const config = normalizeTemplateConfig(key, value);
    if (config && isRecord(value) && typeof value.customRegex === "string") {
      return config;
    }
  }
  return null;
}

function createTemplateMatcher(pattern: string) {
  const literal = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(pattern.trim());
  const source = literal?.[1] ?? pattern;
  const suppliedFlags = literal?.[2] ?? "";
  const flags = Array.from(new Set(`${suppliedFlags.replace(/y/g, "")}g`)).join("");
  return new RegExp(source, flags);
}

function collectTemplateVariables(content: string, pattern: string) {
  let matcher: RegExp;
  try {
    matcher = createTemplateMatcher(pattern);
  } catch {
    return {};
  }

  const variables: Record<string, string> = {};
  let match: RegExpExecArray | null;
  let matches = 0;
  while ((match = matcher.exec(content)) && matches < 2_000) {
    matches += 1;
    const key = String(match[1] ?? "").trim();
    if (key && !key.startsWith("/")) {
      const value = String(match[2] ?? "").trim();
      variables[key] = variables[key] ? `${variables[key]}\n${value}` : value;
      const normalizedKey = key.toLowerCase();
      variables[normalizedKey] = variables[key];
    }
    if (match[0] === "") matcher.lastIndex += 1;
  }
  return variables;
}

export function parseCharacterRegexTemplateVariables(
  content: string,
  customRegex: string,
) {
  const variables = collectTemplateVariables(content, customRegex);
  return Object.keys(variables).length > 0
    ? variables
    : collectTemplateVariables(content, DEFAULT_CHARACTER_TEMPLATE_REGEX);
}

function serializeTemplateValue(value: unknown) {
  return (JSON.stringify(value) ?? "null")
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function injectCharacterRegexTemplateVariables(
  template: string,
  variables: Record<string, string>,
) {
  const bootstrap = [
    '<script data-renge-character-regex-template="true">',
    "(() => {",
    `const values=${serializeTemplateValue(variables)};`,
    "let attempts=0;",
    "const apply=()=>{",
    "  if(typeof window.updateTemplateVariables==='function') {",
    "    window.updateTemplateVariables(values);",
    "    return;",
    "  }",
    "  attempts+=1;",
    "  if(attempts<100) window.setTimeout(apply,20);",
    "};",
    "if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true});",
    "else queueMicrotask(apply);",
    "})();",
    "</script>",
  ].join("");
  const closingBodyIndex = template.toLowerCase().lastIndexOf("</body>");
  return closingBodyIndex >= 0
    ? `${template.slice(0, closingBodyIndex)}${bootstrap}${template.slice(closingBodyIndex)}`
    : `${template}${bootstrap}`;
}

export function renderCharacterRegexTemplate(
  content: string,
  config: CharacterRegexTemplateConfig,
) {
  const variables = parseCharacterRegexTemplateVariables(content, config.customRegex);
  return Object.keys(variables).length > 0
    ? injectCharacterRegexTemplateVariables(config.template, variables)
    : null;
}

export function isCharacterRegexTemplateMessageEligible(
  config: CharacterRegexTemplateConfig,
  messageIndex: number,
  messageCount: number,
  firstAssistantMessageIndex: number,
) {
  if (config.skipFirstMessage && messageIndex === firstAssistantMessageIndex) return false;
  return (
    !config.limitToRecentMessages ||
    messageIndex >= Math.max(0, messageCount - config.recentMessageCount)
  );
}
