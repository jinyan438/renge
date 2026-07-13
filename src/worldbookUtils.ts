export type WorldBookPosition =
  | "before_char"
  | "after_char"
  | "before_an"
  | "after_an"
  | "at_depth";

export type WorldBookEntry = {
  id: string;
  uid: string;
  comment: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  selectiveLogic: number;
  position: WorldBookPosition;
  depth: number;
  scanDepth: number | null;
  order: number;
  probability: number;
  useProbability: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useRegex: boolean;
};

export type WorldBook = {
  id: string;
  name: string;
  description: string;
  sourceFormat: "renge" | "sillytavern";
  sourceFileName: string;
  entries: WorldBookEntry[];
  createdAt: string;
  updatedAt: string;
};

export type WorldBookChatMessage = {
  role?: string;
  content: string;
};

export type BuildWorldBookPromptOptions = {
  userName?: string;
  characterName?: string;
  defaultScanDepth?: number;
};

type UnknownRecord = Record<string, unknown>;

const DEFAULT_SCAN_DEPTH = 8;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null);
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toFiniteNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizePosition(value: unknown): WorldBookPosition {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "before_char" || normalized === "0") return "before_char";
  if (normalized === "after_char" || normalized === "1") return "after_char";
  if (normalized === "before_an" || normalized === "2" || normalized === "5") return "before_an";
  if (normalized === "after_an" || normalized === "3" || normalized === "6") return "after_an";
  if (normalized === "at_depth" || normalized === "4") return "at_depth";
  return "after_char";
}

function getEntryExtensions(rawEntry: UnknownRecord) {
  return isRecord(rawEntry.extensions) ? rawEntry.extensions : {};
}

export function createWorldBookEntry(index = 0): WorldBookEntry {
  return {
    id: createId("worldbook-entry"),
    uid: String(index),
    comment: `新条目 ${index + 1}`,
    keys: [],
    secondaryKeys: [],
    content: "",
    enabled: true,
    constant: false,
    selective: false,
    selectiveLogic: 0,
    position: "after_char",
    depth: 4,
    scanDepth: null,
    order: 100,
    probability: 100,
    useProbability: false,
    caseSensitive: false,
    matchWholeWords: false,
    useRegex: false,
  };
}

export function normalizeWorldBookEntry(rawValue: unknown, index = 0): WorldBookEntry {
  const rawEntry = isRecord(rawValue) ? rawValue : {};
  const extensions = getEntryExtensions(rawEntry);
  const fallback = createWorldBookEntry(index);
  const rawEnabled = firstDefined(rawEntry.enabled, rawEntry.disable === undefined ? undefined : !rawEntry.disable);
  return {
    ...fallback,
    id: typeof rawEntry.id === "string" && rawEntry.id.trim() ? rawEntry.id : fallback.id,
    uid: String(firstDefined(rawEntry.uid, rawEntry.id, index) ?? index),
    comment: String(firstDefined(rawEntry.comment, rawEntry.name, rawEntry.memo, "") ?? ""),
    keys: toStringArray(firstDefined(rawEntry.keys, rawEntry.key)),
    secondaryKeys: toStringArray(
      firstDefined(rawEntry.secondaryKeys, rawEntry.secondary_keys, rawEntry.keysecondary),
    ),
    content: String(rawEntry.content ?? ""),
    enabled: toBoolean(rawEnabled, true),
    constant: toBoolean(rawEntry.constant, false),
    selective: toBoolean(rawEntry.selective, false),
    selectiveLogic: Math.max(
      0,
      Math.round(toFiniteNumber(firstDefined(rawEntry.selectiveLogic, extensions.selectiveLogic), 0)),
    ),
    position: normalizePosition(firstDefined(rawEntry.position, extensions.position)),
    depth: Math.max(0, Math.round(toFiniteNumber(firstDefined(rawEntry.depth, extensions.depth), 4))),
    scanDepth:
      firstDefined(rawEntry.scanDepth, rawEntry.scan_depth, extensions.scan_depth) === undefined
        ? null
        : firstDefined(rawEntry.scanDepth, rawEntry.scan_depth, extensions.scan_depth) === null
          ? null
          : Math.max(
              1,
              Math.round(
                toFiniteNumber(
                  firstDefined(rawEntry.scanDepth, rawEntry.scan_depth, extensions.scan_depth),
                  DEFAULT_SCAN_DEPTH,
                ),
              ),
            ),
    order: Math.round(
      toFiniteNumber(firstDefined(rawEntry.order, rawEntry.insertion_order, rawEntry.priority), 100),
    ),
    probability: Math.min(
      100,
      Math.max(0, toFiniteNumber(firstDefined(rawEntry.probability, extensions.probability), 100)),
    ),
    useProbability: toBoolean(
      firstDefined(rawEntry.useProbability, extensions.useProbability),
      false,
    ),
    caseSensitive: toBoolean(
      firstDefined(rawEntry.caseSensitive, rawEntry.case_sensitive, extensions.case_sensitive),
      false,
    ),
    matchWholeWords: toBoolean(
      firstDefined(rawEntry.matchWholeWords, rawEntry.match_whole_words, extensions.match_whole_words),
      false,
    ),
    useRegex: toBoolean(firstDefined(rawEntry.useRegex, rawEntry.use_regex, extensions.use_regex), false),
  };
}

export function createWorldBook(name = "新世界书"): WorldBook {
  const timestamp = new Date().toISOString();
  return {
    id: createId("worldbook"),
    name,
    description: "",
    sourceFormat: "renge",
    sourceFileName: "",
    entries: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeWorldBook(rawValue: unknown, index = 0): WorldBook {
  const rawBook = isRecord(rawValue) ? rawValue : {};
  const fallback = createWorldBook(`世界书 ${index + 1}`);
  const rawEntries = Array.isArray(rawBook.entries)
    ? rawBook.entries
    : isRecord(rawBook.entries)
      ? Object.values(rawBook.entries)
      : [];
  return {
    ...fallback,
    id: typeof rawBook.id === "string" && rawBook.id.trim() ? rawBook.id : fallback.id,
    name: String(rawBook.name ?? fallback.name).trim() || fallback.name,
    description: String(rawBook.description ?? ""),
    sourceFormat: rawBook.sourceFormat === "sillytavern" ? "sillytavern" : "renge",
    sourceFileName: String(rawBook.sourceFileName ?? ""),
    entries: rawEntries.map(normalizeWorldBookEntry),
    createdAt: typeof rawBook.createdAt === "string" ? rawBook.createdAt : fallback.createdAt,
    updatedAt: typeof rawBook.updatedAt === "string" ? rawBook.updatedAt : fallback.updatedAt,
  };
}

export function importSillyTavernWorldBook(rawValue: unknown, fileName: string): WorldBook {
  if (!isRecord(rawValue)) throw new Error("世界书 JSON 顶层必须是对象。");
  const originalData = isRecord(rawValue.originalData) ? rawValue.originalData : null;
  const preferredEntries = originalData && Array.isArray(originalData.entries)
    ? originalData.entries
    : Array.isArray(rawValue.entries)
      ? rawValue.entries
      : isRecord(rawValue.entries)
        ? Object.values(rawValue.entries)
        : [];
  if (preferredEntries.length === 0) throw new Error("没有找到可导入的世界书条目。");

  const timestamp = new Date().toISOString();
  const fallbackName = fileName.replace(/\.json$/i, "").trim() || "导入的世界书";
  const rawName = firstDefined(originalData?.name, rawValue.name, fallbackName);
  return {
    id: createId("worldbook"),
    name: String(rawName ?? fallbackName).trim() || fallbackName,
    description: String(firstDefined(originalData?.description, rawValue.description, "") ?? ""),
    sourceFormat: "sillytavern",
    sourceFileName: fileName,
    entries: preferredEntries.map(normalizeWorldBookEntry),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function loadWorldBooksFromStorage(storageKey: string): WorldBook[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map(normalizeWorldBook) : [];
  } catch {
    return [];
  }
}

export function normalizeActiveWorldBookIds(ids: unknown, books: WorldBook[]): string[] {
  if (!Array.isArray(ids)) return [];
  const availableIds = new Set(books.map((book) => book.id));
  return Array.from(new Set(ids.map(String).filter((id) => availableIds.has(id))));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordMatches(
  text: string,
  keyword: string,
  entry: Pick<WorldBookEntry, "caseSensitive" | "matchWholeWords" | "useRegex">,
) {
  if (!keyword) return false;
  const flags = entry.caseSensitive ? "u" : "iu";
  if (entry.useRegex) {
    try {
      return new RegExp(keyword, flags).test(text);
    } catch {
      // Invalid imported regular expressions fall back to literal matching.
    }
  }
  if (entry.matchWholeWords) {
    try {
      return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(keyword)}(?=$|[^\\p{L}\\p{N}_])`, flags).test(text);
    } catch {
      // Older WebViews without Unicode property escapes still support literal matching below.
    }
  }
  return entry.caseSensitive
    ? text.includes(keyword)
    : text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

function entryMatchesContext(entry: WorldBookEntry, context: string) {
  if (entry.constant) return true;
  if (entry.keys.length === 0) return false;
  if (!entry.keys.some((keyword) => keywordMatches(context, keyword, entry))) return false;
  if (!entry.selective || entry.secondaryKeys.length === 0) return true;

  const secondaryMatches = entry.secondaryKeys.map((keyword) => keywordMatches(context, keyword, entry));
  switch (entry.selectiveLogic) {
    case 1:
      return !secondaryMatches.every(Boolean);
    case 2:
      return !secondaryMatches.some(Boolean);
    case 3:
      return secondaryMatches.every(Boolean);
    default:
      return secondaryMatches.some(Boolean);
  }
}

function stableProbabilityPass(entry: WorldBookEntry, context: string) {
  if (!entry.useProbability || entry.probability >= 100) return true;
  if (entry.probability <= 0) return false;
  let hash = 2166136261;
  const seed = `${entry.uid}\u0000${context}`;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100 < entry.probability;
}

function applyWorldBookMacros(content: string, userName: string, characterName: string) {
  return content
    .replace(/{{\s*user\s*}}/gi, userName)
    .replace(/{{\s*char\s*}}/gi, characterName);
}

function getEntryContext(
  messages: WorldBookChatMessage[],
  entry: WorldBookEntry,
  defaultScanDepth: number,
) {
  const scanDepth = entry.scanDepth ?? defaultScanDepth;
  return messages
    .slice(-Math.max(1, scanDepth))
    .map((message) => message.content)
    .join("\n");
}

function getPositionOrder(position: WorldBookPosition) {
  switch (position) {
    case "before_char":
      return 0;
    case "after_char":
      return 1;
    case "before_an":
      return 2;
    case "after_an":
      return 3;
    case "at_depth":
      return 4;
  }
}

export function getMatchedWorldBookEntries(
  books: WorldBook[],
  activeBookIds: string[],
  messages: WorldBookChatMessage[],
  options: BuildWorldBookPromptOptions = {},
) {
  const activeIds = new Set(activeBookIds);
  const defaultScanDepth = Math.max(1, options.defaultScanDepth ?? DEFAULT_SCAN_DEPTH);
  return books
    .filter((book) => activeIds.has(book.id))
    .flatMap((book, bookIndex) =>
      book.entries
        .map((entry, entryIndex) => ({ book, bookIndex, entry, entryIndex }))
        .filter(({ entry }) => {
          if (!entry.enabled || !entry.content.trim()) return false;
          const context = getEntryContext(messages, entry, defaultScanDepth);
          return entryMatchesContext(entry, context) && stableProbabilityPass(entry, context);
        }),
    )
    .sort(
      (left, right) =>
        getPositionOrder(left.entry.position) - getPositionOrder(right.entry.position) ||
        left.entry.order - right.entry.order ||
        left.bookIndex - right.bookIndex ||
        left.entryIndex - right.entryIndex,
    );
}

export function buildWorldBookPrompt(
  books: WorldBook[],
  activeBookIds: string[],
  messages: WorldBookChatMessage[],
  options: BuildWorldBookPromptOptions = {},
) {
  const userName = options.userName?.trim() || "用户";
  const characterName = options.characterName?.trim() || "助手";
  const matchedEntries = getMatchedWorldBookEntries(books, activeBookIds, messages, options);
  if (matchedEntries.length === 0) return "";

  const groups: Array<{ book: WorldBook; matches: typeof matchedEntries }> = [];
  matchedEntries.forEach((match) => {
    const current = groups[groups.length - 1];
    if (current?.book.id === match.book.id) {
      current.matches.push(match);
    } else {
      groups.push({ book: match.book, matches: [match] });
    }
  });

  const sections = groups.map(({ book, matches }) => {
    const entries = matches.map(({ entry }) => {
      const title = entry.comment.trim() ? `【条目：${entry.comment.trim()}】\n` : "";
      return `${title}${applyWorldBookMacros(entry.content.trim(), userName, characterName)}`;
    });
    const description = book.description.trim() ? `\n${book.description.trim()}` : "";
    return `【世界书：${book.name}】${description}\n\n${entries.join("\n\n")}`;
  });

  return [
    "以下是当前对话已触发的世界书设定。请将其作为事实、规则与背景约束自然应用；不要向用户复述世界书或触发过程。",
    ...sections,
  ].join("\n\n");
}
