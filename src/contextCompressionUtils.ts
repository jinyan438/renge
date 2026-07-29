export type ContextCompressionModelLimit = {
  id: string;
  modelId: string;
  maxContextTokens: number;
};

export type ContextCompressionSettings = {
  enabled: boolean;
  astPruningEnabled: boolean;
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

export type ContextPriorityCompressionResult<T extends ContextCompressionMessage> = {
  messages: T[];
  compressedMessageCount: number;
  originalTokens: number;
  compressedTokens: number;
};

export type ContextAstPruningResult<T extends ContextCompressionMessage> = {
  messages: T[];
  prunedMessageCount: number;
  prunedBlockCount: number;
};

export const MIN_CONTEXT_LIMIT_TOKENS = 512;
export const MAX_CONTEXT_LIMIT_TOKENS = 4_000_000;
export const DEFAULT_CONTEXT_COMPRESSION_SETTINGS: ContextCompressionSettings = {
  enabled: false,
  astPruningEnabled: false,
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

  const enabled = value.enabled === true;
  return {
    enabled,
    astPruningEnabled:
      enabled && (value.astPruningEnabled === true || value.ast_pruning_enabled === true),
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

const SOURCE_CODE_FENCE_LANGUAGES = new Set([
  "bash",
  "c",
  "c++",
  "cpp",
  "cs",
  "csharp",
  "css",
  "go",
  "html",
  "java",
  "javascript",
  "js",
  "jsx",
  "kotlin",
  "php",
  "powershell",
  "ps1",
  "py",
  "python",
  "rb",
  "ruby",
  "rs",
  "rust",
  "scala",
  "scss",
  "sh",
  "sql",
  "swift",
  "svelte",
  "ts",
  "tsx",
  "typescript",
  "vue",
]);
const TYPESCRIPT_AST_LANGUAGES = new Set([
  "javascript",
  "js",
  "jsx",
  "ts",
  "tsx",
  "typescript",
]);
const MACHINE_COMPRESSION_MIN_TOKENS = 320;
const MACHINE_COMPRESSION_TARGET_RATIO = 0.1;

function getContextMessageTextFragments(message: ContextCompressionMessage) {
  if (typeof message.content === "string") return [message.content];
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter(
      (part): part is Record<string, unknown> =>
        isRecord(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => String(part.text));
}

function getFencedCodeBlocks(value: string) {
  return Array.from(value.matchAll(/```([^\r\n`]*)\r?\n([\s\S]*?)```/g));
}

export function isLikelySourceCodeText(value: string) {
  const text = value.trim();
  if (!text) return false;

  const fencedBlocks = getFencedCodeBlocks(text);
  if (
    fencedBlocks.some((match) => {
      const language = String(match[1] ?? "").trim().toLowerCase().split(/\s+/)[0];
      return SOURCE_CODE_FENCE_LANGUAGES.has(language) ||
        (!language && isLikelySourceCodeText(String(match[2] ?? "")));
    })
  ) {
    return true;
  }
  if (
    /^(?:export\s+)?(?:async\s+)?function\s+[\w$]+\s*\([^)]*\)\s*(?::\s*[^={]+)?\s*\{|^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|^(?:class|interface|enum)\s+[\w$]+\s*[{<]|^#include\s*[<"]|^def\s+\w+\s*\([^)]*\)\s*:/m.test(
      text,
    )
  ) {
    return true;
  }
  if (text.split(/\r?\n/).length < 3) return false;

  let score = 0;
  if (
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|enum|namespace|const|let|var|def|from\s+\S+\s+import|import\s+\S+|#include|public\s+(?:static\s+)?|private\s+|protected\s+|func\s+|fn\s+|package\s+)\b/m.test(
      text,
    )
  ) {
    score += 2;
  }
  if ((text.match(/[;{}]\s*(?:\r?\n|$)/g)?.length ?? 0) >= 3) score += 1;
  if (/=>|===|!==|\b(?:await|return|throws?|implements|extends)\b|::|->/.test(text)) score += 1;
  if (/^\s{2,}[\w$.[\]"']+\s*(?:=|:|\+=|-=)/m.test(text)) score += 1;
  if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b[\s\S]+\b(?:FROM|INTO|TABLE)\b/im.test(text)) {
    score += 3;
  }
  return score >= 3;
}

export function isContextSourceCodeMessage(message: ContextCompressionMessage) {
  return getContextMessageTextFragments(message).some(isLikelySourceCodeText);
}

function isPriorityMachineText(value: string, role: string) {
  const text = value.trim();
  if (estimateContextTextTokens(text) < MACHINE_COMPRESSION_MIN_TOKENS) return false;
  if (role === "tool") return true;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") return true;
  } catch {
    // Continue with log and machine-output heuristics.
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const machineLineCount = lines.filter((line) =>
    /^(?:\s*(?:\[?\d{4}-\d{2}-\d{2}[T\s]|\d{2}:\d{2}:\d{2}|\[(?:trace|debug|info|warn|error|fatal)\]|(?:trace|debug|info|warn|error|fatal)\b|at\s+\S+|File\s+"|\$\s|>\s)|\s*[{}\][,]|\s*<\/?[\w:-]+)|(?:stdout|stderr|exit code|stack trace|request id|response status)\s*[:=]/i.test(
      line,
    ),
  ).length;
  return (
    machineLineCount >= Math.max(4, Math.floor(lines.length * 0.35)) ||
    /(?:^|\n)\s*(?:Caused by:|Traceback \(most recent call last\):|\w+(?:Error|Exception):)/m.test(
      text,
    ) ||
    (lines.length >= 12 && new Set(lines.map((line) => line.slice(0, 24))).size < lines.length * 0.7)
  );
}

export function compactPriorityMachineText(value: string) {
  const normalized = value.trim();
  const originalTokens = estimateContextTextTokens(normalized);
  if (originalTokens < MACHINE_COMPRESSION_MIN_TOKENS) return value;
  const targetTokens = Math.max(
    1,
    Math.floor(originalTokens * MACHINE_COMPRESSION_TARGET_RATIO),
  );
  const lines = normalized.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const highSignalLines = lines.filter((line) =>
    /\b(?:error|exception|fatal|failed|failure|warning|warn|exit code|status)\b|错误|异常|失败|警告|退出码|(?:[A-Za-z]:\\|\/(?:home|usr|var|tmp|workspace)\/)[^\s]+/i.test(
      line,
    ),
  );
  const selectedLines = Array.from(
    new Set([
      ...lines.slice(0, 1),
      ...highSignalLines.slice(0, 5),
      ...lines.slice(-2),
    ]),
  );
  const compacted = [
    `【机器文本已高压缩：原约 ${originalTokens.toLocaleString("zh-CN")} Token，${lines.length.toLocaleString("zh-CN")} 行】`,
    ...selectedLines,
  ].join("\n");
  return truncateContextSummary(compacted, targetTokens);
}

export function compactPriorityContextMessages<T extends ContextCompressionMessage>(
  messages: T[],
): ContextPriorityCompressionResult<T> {
  let compressedMessageCount = 0;
  let originalTokens = 0;
  let compressedTokens = 0;
  const nextMessages = messages.map((message) => {
    if (message.role === "system" || isContextSourceCodeMessage(message)) return message;
    const transformText = (text: string) => {
      if (!isPriorityMachineText(text, message.role)) return text;
      const compacted = compactPriorityMachineText(text);
      if (compacted === text) return text;
      originalTokens += estimateContextTextTokens(text);
      compressedTokens += estimateContextTextTokens(compacted);
      return compacted;
    };
    if (typeof message.content === "string") {
      const content = transformText(message.content);
      if (content === message.content) return message;
      compressedMessageCount += 1;
      return { ...message, content };
    }
    if (!Array.isArray(message.content)) return message;
    let changed = false;
    const content = message.content.map((part) => {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return part;
      const text = transformText(part.text);
      if (text === part.text) return part;
      changed = true;
      return { ...part, text };
    });
    if (!changed) return message;
    compressedMessageCount += 1;
    return { ...message, content } as T;
  });
  return { messages: nextMessages, compressedMessageCount, originalTokens, compressedTokens };
}

async function pruneTypeScriptSourceWithAst(source: string, language: string) {
  const ts = await import("typescript");
  const normalizedLanguage = language.toLowerCase();
  const scriptKind =
    normalizedLanguage === "tsx"
      ? ts.ScriptKind.TSX
      : normalizedLanguage === "jsx"
        ? ts.ScriptKind.JSX
        : normalizedLanguage === "js" || normalizedLanguage === "javascript"
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    `context.${normalizedLanguage || "ts"}`,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const parseDiagnostics = (
    sourceFile as typeof sourceFile & { parseDiagnostics?: readonly unknown[] }
  ).parseDiagnostics;
  if (parseDiagnostics && parseDiagnostics.length > 0) {
    return { source, prunedBlockCount: 0 };
  }

  const replacements: Array<{ start: number; end: number; replacement: string }> = [];
  const visit = (node: import("typescript").Node) => {
    const functionLike =
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node);
    if (functionLike) {
      const body = node.body;
      if (body) {
        replacements.push({
          start: body.getStart(sourceFile),
          end: body.end,
          replacement: ts.isBlock(body)
            ? "{ /* AST 已剪枝：函数体省略 */ }"
            : "undefined /* AST 已剪枝：表达式函数体省略 */",
        });
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (replacements.length === 0) return { source, prunedBlockCount: 0 };

  let prunedSource = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    prunedSource = `${prunedSource.slice(0, replacement.start)}${replacement.replacement}${prunedSource.slice(replacement.end)}`;
  }
  if (prunedSource.length >= source.length) return { source, prunedBlockCount: 0 };
  return { source: prunedSource, prunedBlockCount: replacements.length };
}

function isLikelyJavaScriptTypeScriptText(value: string) {
  return (
    isLikelySourceCodeText(value) &&
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|enum|namespace|const|let|var|import|type)\b|=>|\b(?:implements|extends)\b/m.test(
      value,
    )
  );
}

async function pruneTextSourceCodeWithAst(value: string) {
  const fencedCodePattern = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
  let cursor = 0;
  let output = "";
  let prunedBlockCount = 0;
  let foundSupportedFence = false;
  for (const match of value.matchAll(fencedCodePattern)) {
    const matchIndex = match.index ?? 0;
    const languageLabel = String(match[1] ?? "").trim();
    const language = languageLabel.toLowerCase().split(/\s+/)[0];
    if (!TYPESCRIPT_AST_LANGUAGES.has(language)) continue;
    foundSupportedFence = true;
    const source = String(match[2] ?? "");
    const pruned = await pruneTypeScriptSourceWithAst(source, language);
    output += value.slice(cursor, matchIndex);
    output += `\`\`\`${languageLabel}\n${pruned.source}\`\`\``;
    cursor = matchIndex + match[0].length;
    prunedBlockCount += pruned.prunedBlockCount;
  }
  if (foundSupportedFence) {
    output += value.slice(cursor);
    return { text: prunedBlockCount > 0 ? output : value, prunedBlockCount };
  }
  if (!isLikelyJavaScriptTypeScriptText(value)) {
    return { text: value, prunedBlockCount: 0 };
  }
  const pruned = await pruneTypeScriptSourceWithAst(value, "ts");
  return { text: pruned.source, prunedBlockCount: pruned.prunedBlockCount };
}

export async function pruneContextSourceCodeWithAst<T extends ContextCompressionMessage>(
  messages: T[],
): Promise<ContextAstPruningResult<T>> {
  let prunedMessageCount = 0;
  let prunedBlockCount = 0;
  const nextMessages: T[] = [];
  for (const message of messages) {
    if (!isContextSourceCodeMessage(message)) {
      nextMessages.push(message);
      continue;
    }
    if (typeof message.content === "string") {
      const pruned = await pruneTextSourceCodeWithAst(message.content);
      if (pruned.prunedBlockCount === 0) {
        nextMessages.push(message);
        continue;
      }
      prunedMessageCount += 1;
      prunedBlockCount += pruned.prunedBlockCount;
      nextMessages.push({ ...message, content: pruned.text });
      continue;
    }
    if (!Array.isArray(message.content)) {
      nextMessages.push(message);
      continue;
    }
    let changed = false;
    const content: unknown[] = [];
    for (const part of message.content) {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") {
        content.push(part);
        continue;
      }
      const pruned = await pruneTextSourceCodeWithAst(part.text);
      if (pruned.prunedBlockCount > 0) {
        changed = true;
        prunedBlockCount += pruned.prunedBlockCount;
        content.push({ ...part, text: pruned.text });
      } else {
        content.push(part);
      }
    }
    if (!changed) {
      nextMessages.push(message);
      continue;
    }
    prunedMessageCount += 1;
    nextMessages.push({ ...message, content } as T);
  }
  return { messages: nextMessages, prunedMessageCount, prunedBlockCount };
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

function expandKeepIndexesForToolProtocol<T extends ContextCompressionMessage>(
  messages: T[],
  keepIndexes: Set<number>,
) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const index of Array.from(keepIndexes)) {
      const message = messages[index];
      if (message?.role === "tool") {
        for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
          const candidate = messages[candidateIndex];
          if (candidate.role !== "assistant") continue;
          if (!keepIndexes.has(candidateIndex)) {
            keepIndexes.add(candidateIndex);
            changed = true;
          }
          break;
        }
      }
      if (message?.role === "assistant" && message.tool_calls?.length) {
        for (
          let candidateIndex = index + 1;
          candidateIndex < messages.length && messages[candidateIndex].role === "tool";
          candidateIndex += 1
        ) {
          if (!keepIndexes.has(candidateIndex)) {
            keepIndexes.add(candidateIndex);
            changed = true;
          }
        }
      }
    }
  }
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
  const protectedIndexes = new Set<number>();
  const candidateConversationIndexes: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === "system") systemIndexes.add(index);
    else if (isContextSourceCodeMessage(message)) protectedIndexes.add(index);
    else candidateConversationIndexes.push(index);
  });

  const fixedIndexes = new Set([...systemIndexes, ...protectedIndexes]);
  expandKeepIndexesForToolProtocol(messages, fixedIndexes);
  const conversationIndexes = candidateConversationIndexes.filter(
    (index) => !fixedIndexes.has(index),
  );
  if (conversationIndexes.length < 2) return null;
  const fixedTokens = messages.reduce(
    (total, message, index) =>
      total + (fixedIndexes.has(index) ? estimateContextMessageTokens(message) : 0),
    0,
  );
  const targetMessageTokens = Math.max(
    256,
    Math.floor(inputBudgetTokens * INPUT_TARGET_RATIO) - additionalTokens,
  );
  const keepIndexes = new Set<number>(fixedIndexes);
  let keptTokens = fixedTokens;
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
  expandKeepIndexesForToolProtocol(messages, keepIndexes);

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
