export type ModelInputMode = "text" | "image";
export type ProviderModelInputModes = Record<string, ModelInputMode[]>;
export type ProviderModelMaxOutputTokens = Record<string, number>;

export const DEFAULT_PROVIDER_MODEL_MAX_OUTPUT_TOKENS = 65_536;

type MessageWithContent = {
  content: unknown;
};

function normalizeModelId(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeModes(value: unknown): ModelInputMode[] {
  const modes = Array.isArray(value) ? value : [];
  const normalized: ModelInputMode[] = ["text"];
  if (modes.some((mode) => mode === "image")) normalized.push("image");
  return normalized;
}

export function normalizeProviderModelInputModes(value: unknown): ProviderModelInputModes {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: ProviderModelInputModes = {};
  Object.entries(value).forEach(([modelId, modes]) => {
    const key = normalizeModelId(modelId);
    if (!key) return;
    normalized[key] = normalizeModes(modes);
  });
  return normalized;
}

export function providerModelSupportsImages(value: unknown, modelId: string) {
  const key = normalizeModelId(modelId);
  if (!key) return false;
  const normalized = normalizeProviderModelInputModes(value);
  return normalized[key]?.includes("image") ?? false;
}

export function setProviderModelImageSupport(
  value: unknown,
  modelId: string,
  enabled: boolean,
) {
  const key = normalizeModelId(modelId);
  const normalized = normalizeProviderModelInputModes(value);
  if (!key) return normalized;
  normalized[key] = enabled ? ["text", "image"] : ["text"];
  return normalized;
}

export function ensureProviderModelInputModes(value: unknown, modelIds: string[]) {
  const normalized = normalizeProviderModelInputModes(value);
  modelIds.forEach((modelId) => {
    const key = normalizeModelId(modelId);
    if (key && !normalized[key]) normalized[key] = ["text"];
  });
  return normalized;
}

function normalizeMaxOutputTokens(value: unknown) {
  const parsed = Math.floor(Number(value));
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_PROVIDER_MODEL_MAX_OUTPUT_TOKENS;
}

export function normalizeProviderModelMaxOutputTokens(
  value: unknown,
): ProviderModelMaxOutputTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: ProviderModelMaxOutputTokens = {};
  Object.entries(value).forEach(([modelId, maxOutputTokens]) => {
    const key = normalizeModelId(modelId);
    if (!key) return;
    normalized[key] = normalizeMaxOutputTokens(maxOutputTokens);
  });
  return normalized;
}

export function getProviderModelMaxOutputTokens(value: unknown, modelId: string) {
  const key = normalizeModelId(modelId);
  if (!key) return DEFAULT_PROVIDER_MODEL_MAX_OUTPUT_TOKENS;
  return normalizeProviderModelMaxOutputTokens(value)[key]
    ?? DEFAULT_PROVIDER_MODEL_MAX_OUTPUT_TOKENS;
}

export function setProviderModelMaxOutputTokens(
  value: unknown,
  modelId: string,
  maxOutputTokens: unknown,
) {
  const key = normalizeModelId(modelId);
  const normalized = normalizeProviderModelMaxOutputTokens(value);
  if (!key) return normalized;
  normalized[key] = normalizeMaxOutputTokens(maxOutputTokens);
  return normalized;
}

export function ensureProviderModelMaxOutputTokens(value: unknown, modelIds: string[]) {
  const normalized = normalizeProviderModelMaxOutputTokens(value);
  modelIds.forEach((modelId) => {
    const key = normalizeModelId(modelId);
    if (key && normalized[key] === undefined) {
      normalized[key] = DEFAULT_PROVIDER_MODEL_MAX_OUTPUT_TOKENS;
    }
  });
  return normalized;
}

function isImageContentPart(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === "image_url" || type === "input_image" || type === "image";
}

export function stripUnsupportedImageInputs<T extends MessageWithContent>(
  messages: T[],
  allowImages: boolean,
) {
  if (allowImages) return messages;

  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const content = message.content.filter((part) => !isImageContentPart(part));
    if (content.length === message.content.length) return message;
    return {
      ...message,
      content:
        content.length > 0
          ? content
          : [{ type: "text", text: "图片内容未发送给当前文本模型。" }],
    };
  });
}
