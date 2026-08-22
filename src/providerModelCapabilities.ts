export type ModelInputMode = "text" | "image";
export type ProviderModelInputModes = Record<string, ModelInputMode[]>;

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
