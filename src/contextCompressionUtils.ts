export type ContextCompressionModelLimit = {
  id: string;
  modelId: string;
  maxContextTokens: number;
};

export type ContextCompressionSettings = {
  enabled: boolean;
  modelLimits: ContextCompressionModelLimit[];
};

export type ContextCompressionMessage = {
  role: string;
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export type ContextCompressionPlan<T extends ContextCompressionMessage> = {
  maxContextTokens: number;
  inputBudgetTokens: number;
  estimatedInputTokens: number;
  summaryTokenBudget: number;
  removedMessages: T[];
  keptMessages: T[];
  summaryInsertIndex: number;
};

export type ContextCompressionTokenBudget = {
  maxContextTokens: number;
  outputReserveTokens: number;
  inputBudgetTokens: number;
  safetyThresholdTokens: number;
};

export const MIN_CONTEXT_LIMIT_TOKENS = 512;
export const MAX_CONTEXT_LIMIT_TOKENS = 4_000_000;
export const DEFAULT_CONTEXT_COMPRESSION_SETTINGS: ContextCompressionSettings = {
  enabled: false,
  modelLimits: [],
};

const SUMMARY_MARKER = "【自动上下文压缩摘要】";
const MIN_RECENT_CONVERSATION_MESSAGES = 4;
const INPUT_TRIGGER_RATIO = 0.9;
const INPUT_TARGET_RATIO = 0.68;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeModelId(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function clampContextLimit(value: unknown, fallback = 128_000) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_CONTEXT_LIMIT_TOKENS, Math.max(MIN_CONTEXT_LIMIT_TOKENS, parsed));
}

export function normalizeContextCompressionSettings(
  value: unknown,
): ContextCompressionSettings {
  if (!isRecord(value)) return { ...DEFAULT_CONTEXT_COMPRESSION_SETTINGS };
  const rawLimits = Array.isArray(value.modelLimits)
    ? value.modelLimits
    : Array.isArray(value.model_limits)
      ? value.model_limits
      : [];
  const normalizedLimits: ContextCompressionModelLimit[] = [];
  const seen = new Set<string>();

  for (let index = rawLimits.length - 1; index >= 0; index -= 1) {
    const rawLimit = rawLimits[index];
    if (!isRecord(rawLimit)) continue;
    const modelId = String(rawLimit.modelId ?? rawLimit.model_id ?? "").trim();
    const normalizedId = normalizeModelId(modelId);
    if (!normalizedId || seen.has(normalizedId)) continue;
    seen.add(normalizedId);
    normalizedLimits.unshift({
      id: String(rawLimit.id ?? `context-model-${index + 1}`),
      modelId,
      maxContextTokens: clampContextLimit(
        rawLimit.maxContextTokens ?? rawLimit.max_context_tokens ?? rawLimit.maxContext,
      ),
    });
  }

  return {
    enabled: value.enabled === true,
    modelLimits: normalizedLimits,
  };
}

export function resolveContextCompressionLimit(
  settings: ContextCompressionSettings,
  modelId: string,
) {
  if (!settings.enabled) return null;
  const normalizedId = normalizeModelId(modelId);
  if (!normalizedId) return null;
  for (let index = settings.modelLimits.length - 1; index >= 0; index -= 1) {
    const limit = settings.modelLimits[index];
    if (normalizeModelId(limit.modelId) !== normalizedId) continue;
    return clampContextLimit(limit.maxContextTokens);
  }
  return null;
}

export function estimateContextTextTokens(value: string) {
  if (!value) return 0;
  if (/^data:image\//i.test(value)) return 1_200;
  let asciiUnits = 0;
  let nonAsciiTokens = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) asciiUnits += 1;
    else if (
      (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7af)
    ) {
      nonAsciiTokens += 1;
    } else {
      nonAsciiTokens += 1.5;
    }
  }
  return Math.ceil(asciiUnits / 4 + nonAsciiTokens);
}

export function estimateContextValueTokens(value: unknown, depth = 0): number {
  if (value == null) return 0;
  if (typeof value === "string") return estimateContextTextTokens(value);
  if (typeof value === "number" || typeof value === "boolean") return 1;
  if (depth >= 8) return estimateContextTextTokens(String(value));
  if (Array.isArray(value)) {
    return value.reduce(
      (total, entry) => total + estimateContextValueTokens(entry, depth + 1) + 1,
      0,
    );
  }
  if (isRecord(value)) {
    return Object.entries(value).reduce(
      (total, [key, entry]) =>
        total + estimateContextTextTokens(key) + estimateContextValueTokens(entry, depth + 1) + 1,
      0,
    );
  }
  return estimateContextTextTokens(String(value));
}

export function estimateContextMessageTokens(message: ContextCompressionMessage) {
  return (
    4 +
    estimateContextTextTokens(message.role) +
    estimateContextTextTokens(message.name ?? "") +
    estimateContextValueTokens(message.content) +
    estimateContextTextTokens(message.tool_call_id ?? "") +
    estimateContextValueTokens(message.tool_calls)
  );
}

export function estimateContextMessagesTokens(messages: ContextCompressionMessage[]) {
  return messages.reduce((total, message) => total + estimateContextMessageTokens(message), 2);
}

function getOutputReserve(maxContextTokens: number, requestedOutputTokens: number) {
  const configuredOutput = Number.isFinite(requestedOutputTokens)
    ? Math.max(0, Math.floor(requestedOutputTokens))
    : 0;
  const defaultReserve = Math.min(8_192, Math.max(1_024, Math.floor(maxContextTokens * 0.1)));
  return Math.min(
    Math.max(256, maxContextTokens - 256),
    Math.max(defaultReserve, configuredOutput),
  );
}

export function getContextCompressionTokenBudget(
  settings: ContextCompressionSettings,
  modelId: string,
  requestedOutputTokens = 0,
): ContextCompressionTokenBudget | null {
  const maxContextTokens = resolveContextCompressionLimit(settings, modelId);
  if (!maxContextTokens) return null;
  const outputReserveTokens = getOutputReserve(maxContextTokens, requestedOutputTokens);
  const inputBudgetTokens = Math.max(256, maxContextTokens - outputReserveTokens);
  return {
    maxContextTokens,
    outputReserveTokens,
    inputBudgetTokens,
    safetyThresholdTokens: Math.floor(inputBudgetTokens * INPUT_TRIGGER_RATIO),
  };
}

function findLeadingSystemCount(messages: ContextCompressionMessage[]) {
  let count = 0;
  while (count < messages.length && messages[count].role === "system") count += 1;
  return count;
}

function adjustKeepBoundaryForToolProtocol<T extends ContextCompressionMessage>(
  messages: T[],
  initialBoundary: number,
) {
  let boundary = initialBoundary;
  while (boundary > 0 && messages[boundary]?.role === "tool") boundary -= 1;
  if (messages[initialBoundary]?.role === "tool" && messages[boundary]?.role === "assistant") {
    return boundary;
  }
  return initialBoundary;
}

export function createContextCompressionPlan<T extends ContextCompressionMessage>(
  messages: T[],
  settings: ContextCompressionSettings,
  modelId: string,
  options: { additionalTokens?: number; requestedOutputTokens?: number } = {},
): ContextCompressionPlan<T> | null {
  const tokenBudget = getContextCompressionTokenBudget(
    settings,
    modelId,
    Number(options.requestedOutputTokens ?? 0),
  );
  if (!tokenBudget || messages.length < 2) return null;

  const additionalTokens = Math.max(0, Math.floor(options.additionalTokens ?? 0));
  const { inputBudgetTokens, maxContextTokens, safetyThresholdTokens } = tokenBudget;
  const estimatedInputTokens = estimateContextMessagesTokens(messages) + additionalTokens;
  if (estimatedInputTokens <= safetyThresholdTokens) return null;

  const systemIndexes = new Set<number>();
  const conversationIndexes: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === "system") systemIndexes.add(index);
    else conversationIndexes.push(index);
  });
  if (conversationIndexes.length < 2) return null;

  const systemTokens = messages.reduce(
    (total, message, index) =>
      total + (systemIndexes.has(index) ? estimateContextMessageTokens(message) : 0),
    0,
  );
  const targetMessageTokens = Math.max(
    256,
    Math.floor(inputBudgetTokens * INPUT_TARGET_RATIO) - additionalTokens,
  );
  const keepIndexes = new Set<number>(systemIndexes);
  let keptTokens = systemTokens;
  let keptConversationCount = 0;

  for (let index = conversationIndexes.length - 1; index >= 0; index -= 1) {
    const messageIndex = conversationIndexes[index];
    const messageTokens = estimateContextMessageTokens(messages[messageIndex]);
    const mustKeep = keptConversationCount < MIN_RECENT_CONVERSATION_MESSAGES;
    if (!mustKeep && keptTokens + messageTokens > targetMessageTokens) break;
    if (mustKeep && keptTokens + messageTokens > targetMessageTokens && keptConversationCount > 0) {
      break;
    }
    keepIndexes.add(messageIndex);
    keptTokens += messageTokens;
    keptConversationCount += 1;
  }

  if (keptConversationCount === 0) {
    keepIndexes.add(conversationIndexes[conversationIndexes.length - 1]);
  }

  const firstKeptConversationIndex = conversationIndexes.find((index) => keepIndexes.has(index));
  if (firstKeptConversationIndex !== undefined) {
    const adjustedBoundary = adjustKeepBoundaryForToolProtocol(
      messages,
      firstKeptConversationIndex,
    );
    for (let index = adjustedBoundary; index < firstKeptConversationIndex; index += 1) {
      if (messages[index].role !== "system") keepIndexes.add(index);
    }
  }

  const removedMessages = messages.filter((_, index) => !keepIndexes.has(index));
  if (removedMessages.length === 0) return null;
  const keptMessages = messages.filter((_, index) => keepIndexes.has(index));
  const leadingSystemCount = findLeadingSystemCount(messages);
  const summaryInsertIndex = messages
    .slice(0, leadingSystemCount)
    .reduce((count, _, index) => count + (keepIndexes.has(index) ? 1 : 0), 0);
  const summaryTokenBudget = Math.min(
    2_048,
    Math.max(256, Math.floor(inputBudgetTokens * 0.12)),
  );

  return {
    maxContextTokens,
    inputBudgetTokens,
    estimatedInputTokens,
    summaryTokenBudget,
    removedMessages,
    keptMessages,
    summaryInsertIndex,
  };
}

function contentToSummaryText(value: unknown): string {
  if (typeof value === "string") {
    return /^data:image\//i.test(value) ? "[图片数据]" : value;
  }
  if (!Array.isArray(value)) return value == null ? "" : JSON.stringify(value);
  return value
    .map((part) => {
      if (!isRecord(part)) return String(part ?? "");
      if (part.type === "text") return String(part.text ?? "");
      if (part.type === "image_url") return "[图片]";
      return `[${String(part.type ?? "内容")}]`;
    })
    .filter(Boolean)
    .join("\n");
}

export function renderContextMessagesForSummary(messages: ContextCompressionMessage[]) {
  return messages
    .map((message, index) => {
      const details = [
        contentToSummaryText(message.content),
        message.tool_calls?.length
          ? `工具调用：${JSON.stringify(message.tool_calls)}`
          : "",
        message.tool_call_id ? `工具调用 ID：${message.tool_call_id}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return `#${index + 1} ${message.role}${message.name ? ` (${message.name})` : ""}\n${details}`;
    })
    .join("\n\n");
}

export function splitContextSummaryTranscript(transcript: string, maxTokens: number) {
  const maxCharacters = Math.max(1_000, Math.floor(maxTokens * 3));
  if (transcript.length <= maxCharacters) return [transcript];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < transcript.length) {
    let end = Math.min(transcript.length, cursor + maxCharacters);
    if (end < transcript.length) {
      const paragraphBoundary = transcript.lastIndexOf("\n\n#", end);
      if (paragraphBoundary > cursor + Math.floor(maxCharacters * 0.5)) {
        end = paragraphBoundary;
      }
    }
    chunks.push(transcript.slice(cursor, end).trim());
    cursor = end;
  }
  return chunks.filter(Boolean);
}

export function truncateContextSummary(value: string, maxTokens: number) {
  const normalized = value.trim();
  if (estimateContextTextTokens(normalized) <= maxTokens) return normalized;
  const suffix = "\n[摘要已按上下文预算截断]";
  const suffixTokens = estimateContextTextTokens(suffix);
  const contentBudget = Math.max(1, maxTokens - suffixTokens);
  let low = 0;
  let high = normalized.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateContextTextTokens(normalized.slice(0, middle)) <= contentBudget) low = middle;
    else high = middle - 1;
  }
  return `${normalized.slice(0, low).trimEnd()}${suffix}`;
}

export function buildFallbackContextSummary(
  messages: ContextCompressionMessage[],
  maxTokens: number,
) {
  if (messages.length === 0) return "较早对话已压缩。";
  const perMessageCharacters = Math.max(
    120,
    Math.floor((Math.max(256, maxTokens) * 2.4) / messages.length),
  );
  const lines = messages.map((message, index) => {
    const content = contentToSummaryText(message.content).replace(/\s+/g, " ").trim();
    const clipped =
      content.length > perMessageCharacters
        ? `${content.slice(0, perMessageCharacters).trimEnd()}…`
        : content || "[无文本内容]";
    return `${index + 1}. ${message.role}：${clipped}`;
  });
  return truncateContextSummary(lines.join("\n"), maxTokens);
}

export function applyContextCompressionSummary<T extends ContextCompressionMessage>(
  plan: ContextCompressionPlan<T>,
  summary: string,
) {
  const summaryContent = `${SUMMARY_MARKER}\n以下摘要代表已从请求中移除的较早对话。将其作为连续会话事实使用，不要向用户复述压缩过程。\n\n${truncateContextSummary(summary, plan.summaryTokenBudget)}`;
  const leadingSystemMessages = plan.keptMessages.slice(0, plan.summaryInsertIndex);
  if (leadingSystemMessages.length > 0) {
    const mergedSystemMessage = {
      ...leadingSystemMessages[0],
      content: [
        ...leadingSystemMessages.map((message) => contentToSummaryText(message.content)),
        summaryContent,
      ]
        .filter(Boolean)
        .join("\n\n"),
    } as T;
    return [mergedSystemMessage, ...plan.keptMessages.slice(plan.summaryInsertIndex)];
  }

  const summaryMessage = { role: "system", content: summaryContent } as T;
  return [
    summaryMessage,
    ...plan.keptMessages,
  ];
}

export function createContextSummaryCacheKey(
  modelId: string,
  messages: ContextCompressionMessage[],
) {
  const source = `${normalizeModelId(modelId)}\n${renderContextMessagesForSummary(messages)}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${normalizeModelId(modelId)}:${(hash >>> 0).toString(16)}:${source.length}`;
}
