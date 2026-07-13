export type ChatPresetPromptRole = "system" | "user" | "assistant";

export type ChatPresetPrompt = {
  identifier: string;
  name: string;
  role: ChatPresetPromptRole;
  content: string;
  enabled: boolean;
  marker: boolean;
  systemPrompt: boolean;
  injectionPosition: 0 | 1 | 2;
  injectionDepth: number;
  injectionOrder: number;
};

export type ChatPreset = {
  id: string;
  name: string;
  sourceFormat: "renge" | "sillytavern";
  sourceFileName: string;
  temperature: number;
  topP: number;
  topK: number;
  topA: number;
  minP: number;
  repetitionPenalty: number;
  frequencyPenalty: number;
  presencePenalty: number;
  maxTokens: number;
  maxContext: number;
  squashSystemMessages: boolean;
  prompts: ChatPresetPrompt[];
  backupPrompts: ChatPresetPrompt[];
  createdAt: string;
  updatedAt: string;
};

export type ChatPresetMacroContext = {
  user: string;
  char: string;
  description: string;
  persona: string;
  lastUserMessage: string;
};

type PresetCompatibleMessage = {
  role: string;
  content?: unknown;
};

type PresetInjectedMessage = {
  role: ChatPresetPromptRole;
  content: string;
};

const markerIdentifiers = new Set([
  "chatHistory",
  "worldInfoBefore",
  "worldInfoAfter",
  "charDescription",
  "charPersonality",
  "scenario",
  "personaDescription",
  "dialogueExamples",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerNumber(value: unknown, fallback: number) {
  return Math.max(0, Math.floor(finiteNumber(value, fallback)));
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeRole(value: unknown): ChatPresetPromptRole {
  return value === "user" || value === "assistant" ? value : "system";
}

function normalizeInjectionPosition(value: unknown): 0 | 1 | 2 {
  const position = finiteNumber(value, 0);
  return position === 2 ? 2 : position === 1 ? 1 : 0;
}

function fileNameWithoutExtension(fileName: string) {
  return fileName.replace(/\.json$/i, "").trim() || "导入的预设";
}

export function createDefaultChatPreset(name = "默认预设"): ChatPreset {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    sourceFormat: "renge",
    sourceFileName: "",
    temperature: 0.7,
    topP: 1,
    topK: 0,
    topA: 0,
    minP: 0,
    repetitionPenalty: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    maxTokens: 4096,
    maxContext: 128000,
    squashSystemMessages: false,
    prompts: [],
    backupPrompts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeChatPresetPrompt(
  rawPrompt: unknown,
  index: number,
  enabledOverride?: boolean,
): ChatPresetPrompt {
  const prompt = isRecord(rawPrompt) ? rawPrompt : {};
  const identifier = String(prompt.identifier ?? prompt.id ?? `prompt-${index + 1}`).trim();
  return {
    identifier: identifier || `prompt-${index + 1}`,
    name: String(prompt.name ?? prompt.identifier ?? `提示词模块 ${index + 1}`),
    role: normalizeRole(prompt.role),
    content: typeof prompt.content === "string" ? prompt.content : "",
    enabled:
      enabledOverride ??
      (typeof prompt.enabled === "boolean"
        ? prompt.enabled
        : typeof prompt.disabled === "boolean"
          ? !prompt.disabled
          : true),
    marker: Boolean(prompt.marker),
    systemPrompt: Boolean(prompt.systemPrompt ?? prompt.system_prompt),
    injectionPosition: normalizeInjectionPosition(
      prompt.injectionPosition ?? prompt.injection_position,
    ),
    injectionDepth: integerNumber(prompt.injectionDepth ?? prompt.injection_depth, 0),
    injectionOrder: finiteNumber(prompt.injectionOrder ?? prompt.injection_order, index),
  };
}

export function normalizeChatPreset(rawPreset: unknown, index = 0): ChatPreset {
  const raw = isRecord(rawPreset) ? rawPreset : {};
  const fallback = createDefaultChatPreset(`预设 ${index + 1}`);
  const prompts = Array.isArray(raw.prompts)
    ? raw.prompts.map((prompt, promptIndex) => normalizeChatPresetPrompt(prompt, promptIndex))
    : [];
  const rawBackupPrompts = raw.backupPrompts ?? raw.backup_prompts;
  const backupPrompts = Array.isArray(rawBackupPrompts)
    ? rawBackupPrompts.map((prompt, promptIndex) =>
        normalizeChatPresetPrompt(prompt, promptIndex),
      )
    : [];

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : fallback.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : fallback.name,
    sourceFormat: raw.sourceFormat === "sillytavern" ? "sillytavern" : "renge",
    sourceFileName: typeof raw.sourceFileName === "string" ? raw.sourceFileName : "",
    temperature: finiteNumber(raw.temperature, fallback.temperature),
    topP: finiteNumber(raw.topP ?? raw.top_p, fallback.topP),
    topK: integerNumber(raw.topK ?? raw.top_k, fallback.topK),
    topA: finiteNumber(raw.topA ?? raw.top_a, fallback.topA),
    minP: finiteNumber(raw.minP ?? raw.min_p, fallback.minP),
    repetitionPenalty: finiteNumber(
      raw.repetitionPenalty ?? raw.repetition_penalty,
      fallback.repetitionPenalty,
    ),
    frequencyPenalty: finiteNumber(
      raw.frequencyPenalty ?? raw.frequency_penalty,
      fallback.frequencyPenalty,
    ),
    presencePenalty: finiteNumber(
      raw.presencePenalty ?? raw.presence_penalty,
      fallback.presencePenalty,
    ),
    maxTokens: integerNumber(raw.maxTokens ?? raw.openai_max_tokens, fallback.maxTokens),
    maxContext: integerNumber(raw.maxContext ?? raw.openai_max_context, fallback.maxContext),
    squashSystemMessages: booleanValue(
      raw.squashSystemMessages ?? raw.squash_system_messages,
      fallback.squashSystemMessages,
    ),
    prompts,
    backupPrompts,
    createdAt:
      typeof raw.createdAt === "string" ? raw.createdAt : fallback.createdAt,
    updatedAt:
      typeof raw.updatedAt === "string" ? raw.updatedAt : fallback.updatedAt,
  };
}

export function loadChatPresetsFromStorage(storageKey: string) {
  try {
    const rawValue = localStorage.getItem(storageKey);
    if (!rawValue) return [createDefaultChatPreset()];
    const parsed = JSON.parse(rawValue) as unknown;
    const presets = Array.isArray(parsed)
      ? parsed.map((preset, index) => normalizeChatPreset(preset, index))
      : [];
    return presets.length > 0 ? presets : [createDefaultChatPreset()];
  } catch {
    return [createDefaultChatPreset()];
  }
}

export function importSillyTavernPreset(rawPreset: unknown, fileName: string): ChatPreset {
  if (!isRecord(rawPreset)) throw new Error("预设 JSON 顶层必须是对象。");

  const rawPrompts = Array.isArray(rawPreset.prompts) ? rawPreset.prompts : [];
  const rawPromptOrders = Array.isArray(rawPreset.prompt_order) ? rawPreset.prompt_order : [];
  const hasRecognizedSettings = [
    "temperature",
    "top_p",
    "openai_max_tokens",
    "openai_max_context",
  ].some((key) => key in rawPreset);
  if (rawPrompts.length === 0 && !hasRecognizedSettings) {
    throw new Error("没有找到酒馆预设的 prompts 或采样参数。");
  }

  const promptMap = new Map<string, unknown>();
  rawPrompts.forEach((rawPrompt, index) => {
    const prompt = isRecord(rawPrompt) ? rawPrompt : {};
    const identifier = String(prompt.identifier ?? prompt.id ?? `prompt-${index + 1}`);
    promptMap.set(identifier, rawPrompt);
  });

  const longestOrder = rawPromptOrders.reduce<Record<string, unknown> | null>(
    (longest, candidate) => {
      if (!isRecord(candidate) || !Array.isArray(candidate.order)) return longest;
      if (!longest || !Array.isArray(longest.order) || candidate.order.length > longest.order.length) {
        return candidate;
      }
      return longest;
    },
    null,
  );
  const orderItems = longestOrder && Array.isArray(longestOrder.order) ? longestOrder.order : [];
  const orderedPrompts: ChatPresetPrompt[] = [];
  const usedIdentifiers = new Set<string>();

  orderItems.forEach((rawOrderItem, index) => {
    if (!isRecord(rawOrderItem)) return;
    const identifier = String(rawOrderItem.identifier ?? "");
    const prompt = promptMap.get(identifier);
    if (!identifier || !prompt) return;
    orderedPrompts.push(
      normalizeChatPresetPrompt(
        prompt,
        index,
        typeof rawOrderItem.enabled === "boolean" ? rawOrderItem.enabled : undefined,
      ),
    );
    usedIdentifiers.add(identifier);
  });

  if (orderedPrompts.length === 0) {
    rawPrompts.forEach((prompt, index) => {
      orderedPrompts.push(normalizeChatPresetPrompt(prompt, index));
      const promptRecord = isRecord(prompt) ? prompt : {};
      usedIdentifiers.add(
        String(promptRecord.identifier ?? promptRecord.id ?? `prompt-${index + 1}`),
      );
    });
  }

  const backupPrompts = rawPrompts
    .filter((rawPrompt, index) => {
      const prompt = isRecord(rawPrompt) ? rawPrompt : {};
      const identifier = String(prompt.identifier ?? prompt.id ?? `prompt-${index + 1}`);
      return !usedIdentifiers.has(identifier);
    })
    .map((prompt, index) => normalizeChatPresetPrompt(prompt, index));
  const fallback = createDefaultChatPreset(fileNameWithoutExtension(fileName));
  const timestamp = new Date().toISOString();

  return {
    ...fallback,
    name:
      typeof rawPreset.name === "string" && rawPreset.name.trim()
        ? rawPreset.name.trim()
        : fileNameWithoutExtension(fileName),
    sourceFormat: "sillytavern",
    sourceFileName: fileName,
    temperature: finiteNumber(rawPreset.temperature, fallback.temperature),
    topP: finiteNumber(rawPreset.top_p, fallback.topP),
    topK: integerNumber(rawPreset.top_k, fallback.topK),
    topA: finiteNumber(rawPreset.top_a, fallback.topA),
    minP: finiteNumber(rawPreset.min_p, fallback.minP),
    repetitionPenalty: finiteNumber(rawPreset.repetition_penalty, fallback.repetitionPenalty),
    frequencyPenalty: finiteNumber(rawPreset.frequency_penalty, fallback.frequencyPenalty),
    presencePenalty: finiteNumber(rawPreset.presence_penalty, fallback.presencePenalty),
    maxTokens: integerNumber(rawPreset.openai_max_tokens, fallback.maxTokens),
    maxContext: integerNumber(rawPreset.openai_max_context, fallback.maxContext),
    squashSystemMessages: booleanValue(rawPreset.squash_system_messages, false),
    prompts: orderedPrompts,
    backupPrompts,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function expandPromptContent(
  content: string,
  macroContext: ChatPresetMacroContext,
  variables: Map<string, string>,
) {
  return content
    .replace(/\{\{\/\/.*?\}\}/gs, "")
    .replace(/\{\{setvar::(.*?)::(.*?)\}\}/gs, (_match, key: string, value: string) => {
      variables.set(key.trim(), value.trim());
      return "";
    })
    .replace(/\{\{getvar::(.*?)\}\}/gs, (_match, key: string) => variables.get(key.trim()) ?? "")
    .replace(/\{\{user\}\}/gi, macroContext.user)
    .replace(/\{\{char\}\}/gi, macroContext.char)
    .replace(/\{\{description\}\}/gi, macroContext.description)
    .replace(/\{\{persona\}\}/gi, macroContext.persona)
    .replace(/\{\{lastUserMessage\}\}/gi, macroContext.lastUserMessage)
    .trim();
}

function mergeConsecutiveSystemMessages<T extends PresetCompatibleMessage>(
  messages: Array<T | PresetInjectedMessage>,
) {
  return messages.reduce<Array<T | PresetInjectedMessage>>((merged, message) => {
    const previous = merged.at(-1);
    if (
      previous?.role === "system" &&
      message.role === "system" &&
      typeof previous.content === "string" &&
      typeof message.content === "string"
    ) {
      merged[merged.length - 1] = {
        role: "system",
        content: [previous.content, message.content].filter(Boolean).join("\n\n"),
      };
      return merged;
    }
    merged.push(message);
    return merged;
  }, []);
}

export function applyChatPresetToMessages<T extends PresetCompatibleMessage>(
  preset: ChatPreset,
  baseSystemPrompt: string,
  history: T[],
  macroContext: ChatPresetMacroContext,
): Array<T | PresetInjectedMessage> {
  const messages: Array<T | PresetInjectedMessage> = [];
  const variables = new Map<string, string>();
  const relativePrompts = preset.prompts.filter(
    (prompt) => prompt.enabled && prompt.injectionPosition !== 2,
  );
  const inChatPrompts = preset.prompts.filter(
    (prompt) => prompt.enabled && prompt.injectionPosition === 2,
  );
  let insertedBaseSystemPrompt = false;
  let insertedHistory = false;

  const appendBaseSystemPrompt = () => {
    if (!insertedBaseSystemPrompt && baseSystemPrompt.trim()) {
      messages.push({ role: "system", content: baseSystemPrompt.trim() });
    }
    insertedBaseSystemPrompt = true;
  };
  const appendHistory = () => {
    if (!insertedHistory) messages.push(...history);
    insertedHistory = true;
  };

  relativePrompts.forEach((prompt) => {
    if (prompt.identifier === "chatHistory") {
      appendHistory();
      return;
    }

    const content = expandPromptContent(prompt.content, macroContext, variables);
    if (prompt.identifier === "main") {
      if (content) messages.push({ role: prompt.role, content });
      appendBaseSystemPrompt();
      return;
    }

    if (prompt.marker || markerIdentifiers.has(prompt.identifier)) return;
    if (content) messages.push({ role: prompt.role, content });
  });

  if (!insertedBaseSystemPrompt) {
    const insertionIndex = messages.findIndex((message) => message.role !== "system");
    const baseMessage: PresetInjectedMessage | null = baseSystemPrompt.trim()
      ? { role: "system", content: baseSystemPrompt.trim() }
      : null;
    if (baseMessage) {
      messages.splice(insertionIndex >= 0 ? insertionIndex : 0, 0, baseMessage);
    }
  }
  appendHistory();

  inChatPrompts
    .sort((first, second) => first.injectionOrder - second.injectionOrder)
    .forEach((prompt) => {
      const content = expandPromptContent(prompt.content, macroContext, variables);
      if (!content) return;
      const insertionIndex = Math.max(0, messages.length - prompt.injectionDepth);
      messages.splice(insertionIndex, 0, { role: prompt.role, content });
    });

  return preset.squashSystemMessages
    ? mergeConsecutiveSystemMessages(messages)
    : messages;
}

export function buildChatPresetRequestParameters(preset: ChatPreset) {
  return {
    temperature: preset.temperature,
    max_tokens: preset.maxTokens,
    top_p: preset.topP,
    frequency_penalty: preset.frequencyPenalty,
    presence_penalty: preset.presencePenalty,
    ...(preset.topK > 0 ? { top_k: preset.topK } : {}),
    ...(preset.repetitionPenalty !== 1
      ? { repetition_penalty: preset.repetitionPenalty }
      : {}),
    ...(preset.topA > 0 ? { top_a: preset.topA } : {}),
    ...(preset.minP > 0 ? { min_p: preset.minP } : {}),
  };
}
