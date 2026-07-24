export type ProviderReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type ReasoningProviderConfig = {
  name?: string;
  apiBaseUrl?: string;
  modelId?: string;
  reasoningEnabled?: boolean;
  reasoningEffort?: unknown;
};

export type ReasoningMessageStreamMode = "unknown" | "delta" | "cumulative";

type ReasoningWireMode = "delta" | "cumulative";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeProviderText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeProviderReasoningEffort(
  value: unknown,
): ProviderReasoningEffort {
  const normalizedValue = normalizeProviderText(value).replace(/[-\s]+/g, "_");

  if (
    normalizedValue === "xhigh" ||
    normalizedValue === "x_high" ||
    normalizedValue === "extra_high" ||
    normalizedValue === "very_high" ||
    normalizedValue === "ultra" ||
    normalizedValue === "ultra_high"
  ) {
    return "xhigh";
  }

  if (normalizedValue === "high") return "high";
  if (normalizedValue === "low") return "low";
  return "medium";
}

function detectReasoningFormat(provider?: ReasoningProviderConfig) {
  const apiBaseUrl = normalizeProviderText(provider?.apiBaseUrl);
  const modelId = normalizeProviderText(provider?.modelId);

  if (apiBaseUrl.includes("openrouter.ai")) return "openrouter" as const;
  if (apiBaseUrl.includes("opencode.ai/zen/go/")) {
    if (isDeepSeekV4Model(modelId)) return "deepseek" as const;
    if (modelId.includes("qwen")) return "qwen" as const;
    return "opencode" as const;
  }
  if (apiBaseUrl.includes("opencode.ai/zen/")) return "opencode" as const;
  if (apiBaseUrl.includes("api.together.ai") || apiBaseUrl.includes("api.together.xyz")) {
    return "together" as const;
  }
  if (apiBaseUrl.includes("api.ant-ling.com")) return "ant-ling" as const;
  if (apiBaseUrl.includes("api.z.ai") || apiBaseUrl.includes("open.bigmodel.cn")) {
    return "zai" as const;
  }
  if (apiBaseUrl.includes("deepseek.com")) return "deepseek" as const;
  return "openai" as const;
}

function getModelSlug(modelId: string) {
  return modelId.split("/").pop() ?? modelId;
}

function isDeepSeekV4ProModel(modelId: string) {
  return getModelSlug(modelId) === "deepseek-v4-pro";
}

function isDeepSeekV4FlashModel(modelId: string) {
  return getModelSlug(modelId) === "deepseek-v4-flash";
}

function isDeepSeekV4FlashFreeModel(modelId: string) {
  return getModelSlug(modelId) === "deepseek-v4-flash-free";
}

function isDeepSeekV4Model(modelId: string) {
  return (
    isDeepSeekV4ProModel(modelId) ||
    isDeepSeekV4FlashModel(modelId) ||
    isDeepSeekV4FlashFreeModel(modelId)
  );
}

function isGlm52Model(modelId: string) {
  return /(?:^|[/_-])glm[-_.]?5[-_.]?2(?:$|[-_.:/])/.test(modelId);
}

function mapReasoningEffort(
  provider: ReasoningProviderConfig,
  format: ReturnType<typeof detectReasoningFormat>,
  effort: ProviderReasoningEffort,
) {
  const modelId = normalizeProviderText(provider.modelId);
  if (
    isDeepSeekV4Model(modelId) &&
    (format === "deepseek" || format === "openrouter" || format === "opencode")
  ) {
    if (format === "openrouter") return effort === "xhigh" ? "xhigh" : "high";
    return effort === "xhigh" ? "max" : "high";
  }
  if (isGlm52Model(modelId)) return effort === "xhigh" ? "max" : "high";
  return effort === "xhigh" ? "high" : effort;
}

function getReasoningModelDefaultMaxTokens(
  provider: ReasoningProviderConfig,
  format: ReturnType<typeof detectReasoningFormat>,
) {
  const modelId = normalizeProviderText(provider.modelId);
  if (format !== "deepseek" && format !== "openrouter" && format !== "opencode") {
    return undefined;
  }
  if (isDeepSeekV4ProModel(modelId)) return 384_000;
  if (isDeepSeekV4FlashFreeModel(modelId)) {
    return format === "opencode" ? 128_000 : undefined;
  }
  if (isDeepSeekV4FlashModel(modelId)) {
    return format === "openrouter" ? 65_536 : 384_000;
  }
  return undefined;
}

export function providerRequiresReasoningContentReplay(
  provider?: ReasoningProviderConfig,
) {
  if (!provider?.reasoningEnabled) return false;
  const format = detectReasoningFormat(provider);
  const modelId = normalizeProviderText(provider.modelId);
  return (
    format === "deepseek" ||
    (isDeepSeekV4Model(modelId) && (format === "openrouter" || format === "opencode"))
  );
}

export function buildProviderReasoningReplay(
  provider: ReasoningProviderConfig | undefined,
  reasoning: string,
) {
  if (providerRequiresReasoningContentReplay(provider)) {
    return { reasoning_content: reasoning };
  }
  return {};
}

export function buildProviderReasoningRequest(
  provider?: ReasoningProviderConfig,
  options: { stream?: boolean } = {},
): Record<string, unknown> {
  if (!provider?.reasoningEnabled) return {};

  const format = detectReasoningFormat(provider);
  const effort = normalizeProviderReasoningEffort(provider.reasoningEffort);
  const mappedEffort = mapReasoningEffort(provider, format, effort);
  const defaultMaxTokens = getReasoningModelDefaultMaxTokens(provider, format);
  const streamOptions = options.stream
    ? { stream_options: { include_usage: true } }
    : {};
  const maxTokens = defaultMaxTokens ? { max_tokens: defaultMaxTokens } : {};

  if (format === "openrouter") {
    return {
      ...maxTokens,
      reasoning: { effort: mappedEffort },
      ...streamOptions,
    };
  }

  if (format === "deepseek") {
    return {
      ...maxTokens,
      thinking: { type: "enabled" },
      reasoning_effort: mappedEffort,
      ...streamOptions,
    };
  }

  if (format === "zai") {
    return {
      ...maxTokens,
      thinking: { type: "enabled", clear_thinking: false },
      ...(isGlm52Model(normalizeProviderText(provider.modelId))
        ? { reasoning_effort: mappedEffort }
        : {}),
      ...streamOptions,
    };
  }

  if (format === "qwen") {
    return {
      ...maxTokens,
      enable_thinking: true,
      ...streamOptions,
    };
  }

  if (format === "together") {
    return {
      ...maxTokens,
      reasoning: { enabled: true },
      ...streamOptions,
    };
  }

  if (format === "ant-ling") {
    return {
      ...maxTokens,
      reasoning: { effort: mappedEffort },
      ...streamOptions,
    };
  }

  if (format === "opencode") {
    return {
      ...maxTokens,
      reasoning_effort: mappedEffort,
      ...streamOptions,
    };
  }

  const apiBaseUrl = normalizeProviderText(provider.apiBaseUrl);
  return {
    ...maxTokens,
    reasoning_effort: mappedEffort,
    ...(apiBaseUrl.includes("api.openai.com") ? {} : { include_reasoning: true }),
    ...streamOptions,
  };
}

export function buildProviderReasoningDisableRequest(
  provider?: ReasoningProviderConfig,
): Record<string, unknown> {
  if (!provider) return {};
  const format = detectReasoningFormat(provider);
  if (format === "deepseek") {
    return { thinking: { type: "disabled" } };
  }
  return {};
}

export function getReasoningTextFromValue(
  value: unknown,
  options: { preserveWhitespace?: boolean } = {},
): string {
  const preserveWhitespace = options.preserveWhitespace === true;
  const normalize = (text: string) => (preserveWhitespace ? text : text.trim());

  if (typeof value === "string") return normalize(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => getReasoningTextFromValue(item, options))
      .filter((item) => (preserveWhitespace ? item.length > 0 : Boolean(item)));
    return normalize(parts.join("\n\n"));
  }
  if (!isRecord(value)) return "";

  return getFirstReasoningText(
    [
      value.text,
      value.content,
      value.reasoning,
      value.reasoning_content,
      value.reasoning_text,
      value.summary,
    ],
    options,
  );
}

export function getFirstReasoningText(
  values: unknown[],
  options: { preserveWhitespace?: boolean } = {},
) {
  const preserveWhitespace = options.preserveWhitespace === true;
  for (const value of values) {
    const text = getReasoningTextFromValue(value, options);
    if (preserveWhitespace ? text.length > 0 : Boolean(text)) return text;
  }
  return "";
}

function findTextOverlap(current: string, incoming: string) {
  const maxLength = Math.min(current.length, incoming.length);
  for (let length = maxLength; length > 0; length -= 1) {
    if (current.endsWith(incoming.slice(0, length))) return length;
  }
  return 0;
}

export function mergeReasoningStreamChunk(
  currentText: string,
  incomingText: string,
  wireMode: ReasoningWireMode,
  messageMode: ReasoningMessageStreamMode = "unknown",
) {
  if (!incomingText) {
    return { text: currentText, delta: "", messageMode };
  }

  if (wireMode === "delta") {
    return {
      text: `${currentText}${incomingText}`,
      delta: incomingText,
      messageMode,
    };
  }

  if (!currentText) {
    return {
      text: incomingText,
      delta: incomingText,
      messageMode: "cumulative" as const,
    };
  }

  if (incomingText.startsWith(currentText)) {
    return {
      text: incomingText,
      delta: incomingText.slice(currentText.length),
      messageMode: "cumulative" as const,
    };
  }

  if (currentText.startsWith(incomingText) || currentText.endsWith(incomingText)) {
    return {
      text: currentText,
      delta: "",
      messageMode: "cumulative" as const,
    };
  }

  const overlapLength = findTextOverlap(currentText, incomingText);
  if (overlapLength > 0) {
    const delta = incomingText.slice(overlapLength);
    return {
      text: `${currentText}${delta}`,
      delta,
      messageMode,
    };
  }

  if (messageMode === "cumulative") {
    return { text: currentText, delta: "", messageMode };
  }

  return {
    text: `${currentText}${incomingText}`,
    delta: incomingText,
    messageMode: "delta" as const,
  };
}

export function splitSseFrames(buffer: string, flush = false) {
  const frames: string[] = [];
  const separator = /\r?\n\r?\n/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(buffer))) {
    frames.push(buffer.slice(cursor, match.index));
    cursor = match.index + match[0].length;
  }

  const tail = buffer.slice(cursor);
  if (flush && tail.trim()) {
    frames.push(tail);
    return { frames, rest: "" };
  }
  return { frames, rest: tail };
}
