import {
  normalizeWorldBook,
  type WorldBook,
  type WorldBookEntry,
} from "./worldbookUtils";
import { normalizeRegexScript, type RegexScript } from "./regexUtils";

export type CharacterCardSourceFormat =
  | "renge"
  | "sillytavern-json"
  | "sillytavern-png";

export type CharacterCard = {
  id: string;
  spec: "chara_card_v2" | "chara_card_v3";
  specVersion: string;
  name: string;
  nickname: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  messageExample: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  alternateGreetings: string[];
  groupOnlyGreetings: string[];
  tags: string[];
  creator: string;
  characterVersion: string;
  avatarDataUrl: string;
  sourceFileName: string;
  sourceFormat: CharacterCardSourceFormat;
  characterBook: WorldBook | null;
  regexScripts: RegexScript[];
  extensions: Record<string, unknown>;
  extraData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CharacterTranslationField = {
  key: string;
  label: string;
  value: string;
};

type UnknownRecord = Record<string, unknown>;

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const EMPTY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAE/wJ/l4eKXwAAAABJRU5ErkJggg==";
const CHARACTER_CARD_DATABASE_NAME = "renge-character-cards";
const CHARACTER_CARD_STORE_NAME = "cards";

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

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item).trim()).filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function cloneRecord(value: unknown) {
  if (!isRecord(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value)) as UnknownRecord;
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

function getCharacterData(rawValue: unknown) {
  if (!isRecord(rawValue)) throw new Error("角色卡 JSON 顶层必须是对象。");
  const data = isRecord(rawValue.data) ? rawValue.data : rawValue;
  return { root: rawValue, data };
}

function normalizeCharacterBook(
  rawBookValue: unknown,
  characterName: string,
  sourceFileName: string,
) {
  if (!isRecord(rawBookValue)) return null;
  const rawEntries = Array.isArray(rawBookValue.entries)
    ? rawBookValue.entries
    : isRecord(rawBookValue.entries)
      ? Object.values(rawBookValue.entries)
      : [];
  if (rawEntries.length === 0) return null;
  const timestamp = new Date().toISOString();
  return {
    ...normalizeWorldBook(
      {
        ...rawBookValue,
        id: createId("character-worldbook"),
        name:
          stringValue(rawBookValue.name).trim() ||
          `${characterName || "角色"}的内置世界书`,
        sourceFormat: "sillytavern",
        sourceFileName,
        entries: rawEntries,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      0,
    ),
    id: createId("character-worldbook"),
    sourceFormat: "sillytavern" as const,
    sourceFileName,
  };
}

function extractCharacterRegexScripts(
  root: UnknownRecord,
  data: UnknownRecord,
  sourceFileName: string,
) {
  const paths = [
    ["extensions", "chub", "extensions", "regex_scripts"],
    ["extensions", "chub", "extensions", "regexScripts"],
    ["extensions", "SPreset", "RegexBinding", "regexes"],
    ["extensions", "RegexBinding", "regexes"],
    ["extensions", "regex_scripts"],
    ["extensions", "regexScripts"],
    ["regex_scripts"],
    ["regexScripts"],
  ];
  const values: unknown[] = [];
  [data, root].forEach((container) => {
    paths.forEach((path) => {
      const candidate = nestedValue(container, path);
      if (Array.isArray(candidate)) values.push(...candidate);
    });
  });

  const seen = new Set<string>();
  return values
    .map((value, index) => ({
      ...normalizeRegexScript(value, index, sourceFileName),
      id: createId("character-regex"),
      sourceFormat: "sillytavern" as const,
      sourceFileName,
    }))
    .filter((script) => {
      if (!script.findRegex.trim()) return false;
      const identity = [
        script.scriptName,
        script.findRegex,
        script.replaceString,
        script.placement.join(","),
      ].join("\u0000");
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

export function createCharacterCard(name = "新角色") : CharacterCard {
  const timestamp = new Date().toISOString();
  return {
    id: createId("character"),
    spec: "chara_card_v2",
    specVersion: "2.0",
    name,
    nickname: "",
    description: "",
    personality: "",
    scenario: "",
    firstMessage: "",
    messageExample: "",
    creatorNotes: "",
    systemPrompt: "",
    postHistoryInstructions: "",
    alternateGreetings: [],
    groupOnlyGreetings: [],
    tags: [],
    creator: "",
    characterVersion: "",
    avatarDataUrl: "",
    sourceFileName: "",
    sourceFormat: "renge",
    characterBook: null,
    regexScripts: [],
    extensions: {},
    extraData: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeCharacterCard(
  rawValue: unknown,
  index = 0,
  options: {
    sourceFileName?: string;
    sourceFormat?: CharacterCardSourceFormat;
    avatarDataUrl?: string;
    preserveId?: boolean;
  } = {},
): CharacterCard {
  const { root, data } = getCharacterData(rawValue);
  const fallback = createCharacterCard(`角色 ${index + 1}`);
  const sourceFileName = options.sourceFileName ?? stringValue(data.sourceFileName);
  const importedSpec = stringValue(root.spec ?? data.spec).toLowerCase();
  const spec = importedSpec.includes("v3") ? "chara_card_v3" : "chara_card_v2";
  const specVersion = stringValue(
    root.spec_version ?? root.specVersion ?? data.spec_version ?? data.specVersion,
    spec === "chara_card_v3" ? "3.0" : "2.0",
  );
  const name = stringValue(data.name, fallback.name).trim() || fallback.name;
  const rawBook = data.character_book ?? data.characterBook;
  const alreadyNormalizedBook = isRecord(rawBook) && "sourceFormat" in rawBook;
  const normalizedBook = alreadyNormalizedBook
    ? {
        ...normalizeWorldBook(rawBook),
        id: stringValue(rawBook.id).trim() || createId("character-worldbook"),
      }
    : normalizeCharacterBook(rawBook, name, sourceFileName);
  const storedRegexScripts = Array.isArray(data.regexScripts)
    ? data.regexScripts.map((script, scriptIndex) =>
        normalizeRegexScript(script, scriptIndex, sourceFileName),
      )
    : null;
  const embeddedRegexScripts = extractCharacterRegexScripts(root, data, sourceFileName);
  const timestamp = new Date().toISOString();
  const importedAvatar =
    options.avatarDataUrl ?? stringValue(data.avatarDataUrl ?? data.avatar);

  const knownKeys = new Set([
    "id", "spec", "spec_version", "specVersion", "name", "nickname", "description",
    "personality", "scenario", "first_mes", "firstMessage", "mes_example",
    "messageExample", "creator_notes", "creatorNotes", "system_prompt", "systemPrompt",
    "post_history_instructions", "postHistoryInstructions", "alternate_greetings",
    "alternateGreetings", "group_only_greetings", "groupOnlyGreetings", "tags", "creator",
    "character_version", "characterVersion", "avatar", "avatarDataUrl", "sourceFileName",
    "sourceFormat", "character_book", "characterBook", "regex_scripts", "regexScripts",
    "extensions", "extraData", "createdAt", "updatedAt",
  ]);
  const importedExtraData = cloneRecord(data.extraData);
  Object.entries(data).forEach(([key, value]) => {
    if (!knownKeys.has(key)) importedExtraData[key] = value;
  });

  return {
    ...fallback,
    id:
      options.preserveId !== false && stringValue(data.id).trim()
        ? stringValue(data.id).trim()
        : fallback.id,
    spec,
    specVersion,
    name,
    nickname: stringValue(data.nickname),
    description: stringValue(data.description),
    personality: stringValue(data.personality),
    scenario: stringValue(data.scenario),
    firstMessage: stringValue(data.first_mes ?? data.firstMessage),
    messageExample: stringValue(data.mes_example ?? data.messageExample),
    creatorNotes: stringValue(data.creator_notes ?? data.creatorNotes),
    systemPrompt: stringValue(data.system_prompt ?? data.systemPrompt),
    postHistoryInstructions: stringValue(
      data.post_history_instructions ?? data.postHistoryInstructions,
    ),
    alternateGreetings: stringArray(data.alternate_greetings ?? data.alternateGreetings),
    groupOnlyGreetings: stringArray(data.group_only_greetings ?? data.groupOnlyGreetings),
    tags: uniqueStrings(stringArray(data.tags)),
    creator: stringValue(data.creator),
    characterVersion: stringValue(data.character_version ?? data.characterVersion),
    avatarDataUrl: importedAvatar.startsWith("data:image/") ? importedAvatar : "",
    sourceFileName,
    sourceFormat:
      options.sourceFormat ??
      (data.sourceFormat === "sillytavern-json" ||
      data.sourceFormat === "sillytavern-png" ||
      data.sourceFormat === "renge"
        ? data.sourceFormat
        : "renge"),
    characterBook: normalizedBook,
    regexScripts: storedRegexScripts ?? embeddedRegexScripts,
    extensions: cloneRecord(data.extensions),
    extraData: importedExtraData,
    createdAt: stringValue(data.createdAt, timestamp),
    updatedAt: stringValue(data.updatedAt, timestamp),
  };
}

export function loadCharacterCardsFromStorage(storageKey: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.map((card, index) => normalizeCharacterCard(card, index))
      : [];
  } catch {
    return [];
  }
}

function openCharacterCardDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持 IndexedDB。"));
      return;
    }
    const request = indexedDB.open(CHARACTER_CARD_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CHARACTER_CARD_STORE_NAME)) {
        database.createObjectStore(CHARACTER_CARD_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("角色卡数据库打开失败。"));
  });
}

export async function loadCharacterCardsFromDatabase() {
  try {
    const database = await openCharacterCardDatabase();
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(CHARACTER_CARD_STORE_NAME, "readonly");
      const request = transaction.objectStore(CHARACTER_CARD_STORE_NAME).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error ?? new Error("角色卡数据库读取失败。"));
    });
    database.close();
    return values.map((card, index) => normalizeCharacterCard(card, index));
  } catch {
    return [];
  }
}

export async function saveCharacterCardsToDatabase(cards: CharacterCard[]) {
  try {
    const database = await openCharacterCardDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(CHARACTER_CARD_STORE_NAME, "readwrite");
      const store = transaction.objectStore(CHARACTER_CARD_STORE_NAME);
      store.clear();
      cards.forEach((card) => store.put(card));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("角色卡数据库保存失败。"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("角色卡数据库保存已中止。"));
    });
    database.close();
  } catch {
    // The server-side app-data store and compact localStorage copy remain as fallbacks.
  }
}

function bytesToLatin1(bytes: Uint8Array) {
  let result = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return result;
}

function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function encodeBase64Utf8(value: string) {
  return btoa(bytesToLatin1(new TextEncoder().encode(value)));
}

function decodeBase64Utf8(value: string) {
  const compact = value.trim().replace(/\s+/g, "");
  const binary = atob(compact);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return decodeUtf8(bytes);
}

function decodeMetadataValue(value: string) {
  const trimmed = value.trim().replace(/^\uFEFF/, "");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  try {
    return decodeBase64Utf8(trimmed);
  } catch {
    return trimmed;
  }
}

function hasPngSignature(bytes: Uint8Array) {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

type PngChunk = {
  type: string;
  data: Uint8Array;
  start: number;
  end: number;
};

function parsePngChunks(bytes: Uint8Array) {
  if (!hasPngSignature(bytes)) throw new Error("文件不是有效的 PNG 图片。");
  const chunks: PngChunk[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("PNG 数据块不完整。");
    const type = bytesToLatin1(bytes.subarray(offset + 4, offset + 8));
    chunks.push({ type, data: bytes.slice(offset + 8, offset + 8 + length), start: offset, end });
    offset = end;
    if (type === "IEND") break;
  }
  if (!chunks.some((chunk) => chunk.type === "IEND")) {
    throw new Error("PNG 缺少 IEND 数据块。");
  }
  return chunks;
}

function readTextChunk(chunk: PngChunk) {
  if (chunk.type === "tEXt") {
    const separator = chunk.data.indexOf(0);
    if (separator < 0) return null;
    return {
      keyword: bytesToLatin1(chunk.data.subarray(0, separator)),
      value: bytesToLatin1(chunk.data.subarray(separator + 1)),
    };
  }
  if (chunk.type === "iTXt") {
    let cursor = chunk.data.indexOf(0);
    if (cursor < 0 || cursor + 2 >= chunk.data.length) return null;
    const keyword = bytesToLatin1(chunk.data.subarray(0, cursor));
    const compressionFlag = chunk.data[cursor + 1];
    cursor += 3;
    const languageEnd = chunk.data.indexOf(0, cursor);
    if (languageEnd < 0) return null;
    cursor = languageEnd + 1;
    const translatedEnd = chunk.data.indexOf(0, cursor);
    if (translatedEnd < 0 || compressionFlag !== 0) return null;
    cursor = translatedEnd + 1;
    return { keyword, value: decodeUtf8(chunk.data.subarray(cursor)) };
  }
  return null;
}

export function extractCharacterCardMetadataFromPng(bytes: Uint8Array) {
  const chunks = parsePngChunks(bytes);
  const candidates = chunks
    .map(readTextChunk)
    .filter((item): item is { keyword: string; value: string } => Boolean(item))
    .filter((item) => ["chara", "ccv3"].includes(item.keyword.toLowerCase()))
    .sort((left, right) => Number(right.keyword.toLowerCase() === "ccv3") - Number(left.keyword.toLowerCase() === "ccv3"));
  for (const candidate of candidates) {
    try {
      return JSON.parse(decodeMetadataValue(candidate.value)) as unknown;
    } catch {
      // Try the next compatible metadata chunk.
    }
  }
  throw new Error("PNG 中没有找到可读取的酒馆角色卡元数据（chara/ccv3）。");
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("文件读取失败。"));
    reader.readAsDataURL(file);
  });
}

export async function importCharacterCardFile(file: File) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".png") || file.type === "image/png") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadata = extractCharacterCardMetadataFromPng(bytes);
    return normalizeCharacterCard(metadata, 0, {
      sourceFileName: file.name,
      sourceFormat: "sillytavern-png",
      avatarDataUrl: await readFileAsDataUrl(file),
      preserveId: false,
    });
  }
  if (lowerName.endsWith(".json") || file.type.includes("json") || !file.type) {
    let rawValue: unknown;
    try {
      rawValue = JSON.parse(await file.text()) as unknown;
    } catch {
      throw new Error("角色卡 JSON 无法解析。");
    }
    return normalizeCharacterCard(rawValue, 0, {
      sourceFileName: file.name,
      sourceFormat: "sillytavern-json",
      preserveId: false,
    });
  }
  throw new Error("仅支持 PNG 或 JSON 角色卡。");
}

function exportWorldBookEntry(entry: WorldBookEntry, index: number) {
  return {
    id: index,
    keys: entry.keys,
    secondary_keys: entry.secondaryKeys,
    comment: entry.comment,
    content: entry.content,
    constant: entry.constant,
    selective: entry.selective,
    insertion_order: entry.order,
    enabled: entry.enabled,
    position: entry.position,
    use_regex: entry.useRegex,
    extensions: {
      position: entry.position,
      probability: entry.probability,
      useProbability: entry.useProbability,
      depth: entry.depth,
      scan_depth: entry.scanDepth,
      selectiveLogic: entry.selectiveLogic,
      case_sensitive: entry.caseSensitive,
      match_whole_words: entry.matchWholeWords,
    },
  };
}

function exportRegexScript(script: RegexScript) {
  return {
    id: script.id,
    scriptName: script.scriptName,
    findRegex: script.findRegex,
    replaceString: script.replaceString,
    trimStrings: script.trimStrings,
    placement: script.placement,
    disabled: script.disabled,
    markdownOnly: script.markdownOnly,
    promptOnly: script.promptOnly,
    runOnEdit: script.runOnEdit,
    substituteRegex: script.substituteRegex,
    minDepth: script.minDepth,
    maxDepth: script.maxDepth,
  };
}

export function serializeCharacterCard(card: CharacterCard) {
  const regexScripts = card.regexScripts.map(exportRegexScript);
  const extensions = cloneRecord(card.extensions);
  if (regexScripts.length > 0) extensions.regex_scripts = regexScripts;
  return {
    spec: card.spec,
    spec_version: card.specVersion || (card.spec === "chara_card_v3" ? "3.0" : "2.0"),
    data: {
      ...cloneRecord(card.extraData),
      name: card.name,
      nickname: card.nickname || undefined,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      first_mes: card.firstMessage,
      mes_example: card.messageExample,
      creator_notes: card.creatorNotes,
      system_prompt: card.systemPrompt,
      post_history_instructions: card.postHistoryInstructions,
      alternate_greetings: card.alternateGreetings,
      group_only_greetings: card.groupOnlyGreetings,
      tags: card.tags,
      creator: card.creator,
      character_version: card.characterVersion,
      extensions,
      character_book: card.characterBook
        ? {
            name: card.characterBook.name,
            description: card.characterBook.description,
            entries: card.characterBook.entries.map(exportWorldBookEntry),
          }
        : undefined,
    },
  };
}

export function exportCharacterCardJson(card: CharacterCard) {
  return JSON.stringify(serializeCharacterCard(card), null, 2);
}

let crcTable: Uint32Array | null = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let number = 0; number < 256; number += 1) {
    let value = number;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[number] = value >>> 0;
  }
  return crcTable;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  const table = getCrcTable();
  bytes.forEach((byte) => {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function createPngChunk(type: string, data: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length, false);
  result.set(typeBytes, 4);
  result.set(data, 8);
  view.setUint32(8 + data.length, crc32(concatBytes([typeBytes, data])), false);
  return result;
}

function decodeDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("封面不是有效的数据 URL。");
  const binary = atob(match[2]);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function imageDataUrlToPngBytes(dataUrl: string) {
  const bytes = decodeDataUrl(dataUrl);
  if (hasPngSignature(bytes)) return bytes;
  if (typeof document === "undefined") throw new Error("当前环境无法将封面转换为 PNG。");
  return new Promise<Uint8Array>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || 1;
      canvas.height = image.naturalHeight || 1;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("无法创建封面画布。"));
      context.drawImage(image, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error("封面 PNG 转换失败。"));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, "image/png");
    };
    image.onerror = () => reject(new Error("封面图片无法加载。"));
    image.src = dataUrl;
  });
}

export function embedCharacterCardMetadataInPng(
  pngBytes: Uint8Array,
  metadata: unknown,
) {
  const chunks = parsePngChunks(pngBytes);
  const serializedMetadata = JSON.stringify(metadata);
  const encodedMetadata = encodeBase64Utf8(serializedMetadata);
  const metadataBytes = new TextEncoder().encode(`chara\u0000${encodedMetadata}`);
  const ccv3MetadataBytes = new TextEncoder().encode(`ccv3\u0000${encodedMetadata}`);
  const isV3Metadata =
    isRecord(metadata) && stringValue(metadata.spec).toLowerCase().includes("v3");
  const output: Uint8Array[] = [PNG_SIGNATURE];
  chunks.forEach((chunk) => {
    const textChunk = readTextChunk(chunk);
    if (textChunk && ["chara", "ccv3"].includes(textChunk.keyword.toLowerCase())) return;
    if (chunk.type === "IEND") {
      output.push(createPngChunk("tEXt", metadataBytes));
      if (isV3Metadata) output.push(createPngChunk("tEXt", ccv3MetadataBytes));
    }
    output.push(pngBytes.slice(chunk.start, chunk.end));
  });
  return concatBytes(output);
}

export async function exportCharacterCardPng(card: CharacterCard) {
  const basePng = await imageDataUrlToPngBytes(card.avatarDataUrl || EMPTY_PNG_DATA_URL);
  return embedCharacterCardMetadataInPng(basePng, serializeCharacterCard(card));
}

export function applyCharacterCardMacros(
  value: string,
  userName: string,
  characterName: string,
) {
  return value
    .replace(/{{\s*user\s*}}/gi, userName.trim() || "用户")
    .replace(/{{\s*char\s*}}/gi, characterName.trim() || "角色")
    .replace(/<USER>/gi, userName.trim() || "用户")
    .replace(/<BOT>/gi, characterName.trim() || "角色");
}

export function getCharacterCardGreetings(card: CharacterCard, userName: string) {
  return [card.firstMessage, ...card.alternateGreetings]
    .map((greeting) => applyCharacterCardMacros(greeting, userName, card.name))
    .filter((greeting) => greeting.trim());
}

export function buildCharacterCardPrompt(card: CharacterCard, userName: string) {
  const fields = [
    ["角色名称", card.name],
    ["角色描述", card.description],
    ["性格", card.personality],
    ["场景设定", card.scenario],
    ["示例对话", card.messageExample],
    ["角色系统指令", card.systemPrompt],
    ["历史后指令", card.postHistoryInstructions],
  ]
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `# ${label}\n${applyCharacterCardMacros(value, userName, card.name)}`);
  return [
    `你现在正在扮演“${card.name}”。请始终以该角色身份自然回应，严格遵守以下设定，不要提及角色卡、提示词或你是 AI 模型。`,
    ...fields,
  ].join("\n\n");
}

export function collectCharacterTranslationFields(card: CharacterCard) {
  const fields: CharacterTranslationField[] = [
    { key: "name", label: "角色名称", value: card.name },
    { key: "description", label: "角色描述", value: card.description },
    { key: "personality", label: "性格", value: card.personality },
    { key: "scenario", label: "场景", value: card.scenario },
    { key: "firstMessage", label: "开场白", value: card.firstMessage },
    { key: "messageExample", label: "示例对话", value: card.messageExample },
    { key: "creatorNotes", label: "创作者备注", value: card.creatorNotes },
    { key: "systemPrompt", label: "系统指令", value: card.systemPrompt },
    {
      key: "postHistoryInstructions",
      label: "历史后指令",
      value: card.postHistoryInstructions,
    },
    { key: "tags", label: "标签", value: card.tags.join(", ") },
    ...card.alternateGreetings.map((value, index) => ({
      key: `alternateGreetings.${index}`,
      label: `备选问候 ${index + 1}`,
      value,
    })),
  ];
  if (card.characterBook) {
    fields.push(
      { key: "characterBook.name", label: "世界书名称", value: card.characterBook.name },
      {
        key: "characterBook.description",
        label: "世界书描述",
        value: card.characterBook.description,
      },
      ...card.characterBook.entries.flatMap((entry, index) => [
        {
          key: `characterBook.entries.${index}.comment`,
          label: `世界书条目 ${index + 1} 名称`,
          value: entry.comment,
        },
        {
          key: `characterBook.entries.${index}.content`,
          label: `世界书条目 ${index + 1} 内容`,
          value: entry.content,
        },
        {
          key: `characterBook.entries.${index}.keys`,
          label: `世界书条目 ${index + 1} 主关键词`,
          value: entry.keys.join(", "),
        },
        {
          key: `characterBook.entries.${index}.secondaryKeys`,
          label: `世界书条目 ${index + 1} 次关键词`,
          value: entry.secondaryKeys.join(", "),
        },
      ]),
    );
  }
  return fields.filter((field) => field.value.trim());
}

export function applyCharacterTranslations(
  card: CharacterCard,
  translations: Record<string, string>,
) {
  const nextCard = normalizeCharacterCard(card);
  const simpleKeys = [
    "name", "description", "personality", "scenario", "firstMessage", "messageExample",
    "creatorNotes", "systemPrompt", "postHistoryInstructions",
  ] as const;
  simpleKeys.forEach((key) => {
    if (typeof translations[key] === "string") nextCard[key] = translations[key];
  });
  if (typeof translations.tags === "string") {
    nextCard.tags = translations.tags.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean);
  }
  nextCard.alternateGreetings = nextCard.alternateGreetings.map(
    (value, index) => translations[`alternateGreetings.${index}`] ?? value,
  );
  if (nextCard.characterBook) {
    nextCard.characterBook.name =
      translations["characterBook.name"] ?? nextCard.characterBook.name;
    nextCard.characterBook.description =
      translations["characterBook.description"] ?? nextCard.characterBook.description;
    nextCard.characterBook.entries = nextCard.characterBook.entries.map((entry, index) => ({
      ...entry,
      comment: translations[`characterBook.entries.${index}.comment`] ?? entry.comment,
      content: translations[`characterBook.entries.${index}.content`] ?? entry.content,
      keys:
        translations[`characterBook.entries.${index}.keys`]
          ?.split(/[,，\n]/)
          .map((value) => value.trim())
          .filter(Boolean) ?? entry.keys,
      secondaryKeys:
        translations[`characterBook.entries.${index}.secondaryKeys`]
          ?.split(/[,，\n]/)
          .map((value) => value.trim())
          .filter(Boolean) ?? entry.secondaryKeys,
    }));
  }
  nextCard.updatedAt = new Date().toISOString();
  return nextCard;
}
