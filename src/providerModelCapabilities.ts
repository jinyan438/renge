export type ModelInputMode = "text" | "image";
export type ProviderModelInputModes = Record<string, ModelInputMode[]>;

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
