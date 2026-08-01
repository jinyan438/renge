export type TavernMvuInitMessage = {
  content: string;
  variables?: Record<string, unknown>;
};

export type TavernMvuInitialization = {
  messageIndex: number;
  variables: Record<string, unknown>;
};

export type TavernMvuInitializationError = {
  messageIndex: number;
  blockIndex: number;
  message: string;
};

type ParseYaml = (source: string) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
  ) as T;
}

function mergeRecords(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
) {
  const result = cloneValue(base);
  Object.entries(overlay).forEach(([key, value]) => {
    result[key] =
      isRecord(result[key]) && isRecord(value)
        ? mergeRecords(result[key], value)
        : cloneValue(value);
  });
  return result;
}

function stripCodeFence(source: string) {
  const trimmed = source.trim();
  const match = /^```[^\r\n]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "YAML 解析失败");
}

export function extractTavernMvuInitVariables(
  content: string,
  parseYaml: ParseYaml,
  substituteMacros: (source: string) => string = (source) => source,
) {
  const pattern = /<initvar\b[^>]*>([\s\S]*?)<\/initvar\s*>/gi;
  let variables: Record<string, unknown> | null = null;
  const errors: Array<{ blockIndex: number; message: string }> = [];
  let blockIndex = 0;

  for (const match of content.matchAll(pattern)) {
    blockIndex += 1;
    try {
      const parsed = parseYaml(stripCodeFence(substituteMacros(match[1])));
      if (!isRecord(parsed)) {
        throw new Error("initvar 顶层必须是 YAML 对象");
      }
      variables = mergeRecords(variables ?? {}, parsed);
    } catch (error) {
      errors.push({ blockIndex, message: errorMessage(error) });
    }
  }

  return { variables, errors };
}

export function initializeTavernMvuMessages<T extends TavernMvuInitMessage>(
  messages: T[],
  parseYaml: ParseYaml,
  substituteMacros?: (source: string) => string,
) {
  const nextMessages = messages.slice();
  const initializations: TavernMvuInitialization[] = [];
  const errors: TavernMvuInitializationError[] = [];

  messages.forEach((message, messageIndex) => {
    if (isRecord(message.variables) && Object.keys(message.variables).length > 0) return;
    const extracted = extractTavernMvuInitVariables(
      message.content,
      parseYaml,
      substituteMacros,
    );
    errors.push(
      ...extracted.errors.map((error) => ({ messageIndex, ...error })),
    );
    if (!extracted.variables) return;

    const variables = {
      display_data: {},
      initialized_lorebooks: {},
      stat_data: extracted.variables,
      delta_data: {},
      schema: { type: "object", properties: {} },
    };
    nextMessages[messageIndex] = { ...message, variables };
    initializations.push({ messageIndex, variables: cloneValue(variables) });
  });

  return { messages: nextMessages, initializations, errors };
}
