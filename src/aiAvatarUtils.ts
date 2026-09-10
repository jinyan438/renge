export type AiAvatarProfile = {
  id: string;
  modelId: string;
  avatarImages: string[];
  activeAvatarIndex: number;
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeImageSources(value: unknown) {
  const sources = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      sources
        .filter((source): source is string => typeof source === "string")
        .map((source) => source.trim())
        .filter(Boolean),
    ),
  );
}

function getProfileId(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getProfileModelId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function createAiAvatarProfile(modelId = ""): AiAvatarProfile {
  const fallbackId = `ai-avatar-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: globalThis.crypto?.randomUUID?.() ?? fallbackId,
    modelId: modelId.trim(),
    avatarImages: [],
    activeAvatarIndex: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeAiAvatarProfiles(rawValue: unknown): AiAvatarProfile[] {
  if (!Array.isArray(rawValue)) return [];

  const usedIds = new Set<string>();
  return rawValue.reduce<AiAvatarProfile[]>((profiles, value, index) => {
    if (!isRecord(value)) return profiles;

    const rawImages = [
      ...(Array.isArray(value.avatarImages) ? value.avatarImages : []),
      ...(Array.isArray(value.avatars) ? value.avatars : []),
      value.avatarImage,
      value.avatar,
    ];
    const avatarImages = normalizeImageSources(rawImages);
    const baseId = getProfileId(value.id, `ai-avatar-${index + 1}`);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    const parsedActiveIndex = Number(value.activeAvatarIndex);
    const activeAvatarIndex = avatarImages.length > 0 && Number.isFinite(parsedActiveIndex)
      ? Math.min(Math.max(Math.floor(parsedActiveIndex), 0), avatarImages.length - 1)
      : 0;

    profiles.push({
      id,
      modelId: getProfileModelId(value.modelId ?? value.model_id),
      avatarImages,
      activeAvatarIndex,
      updatedAt:
        typeof value.updatedAt === "string" && value.updatedAt.trim()
          ? value.updatedAt
          : new Date().toISOString(),
    });
    return profiles;
  }, []);
}

export function getAiModeAvatarImage(
  profiles: readonly AiAvatarProfile[],
  modelId: string,
) {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return "";

  const profile = profiles.find(
    (candidate) =>
      candidate.modelId.trim().toLowerCase() === normalizedModelId &&
      candidate.avatarImages.length > 0,
  );
  if (!profile) return "";

  const activeIndex = Number.isFinite(profile.activeAvatarIndex)
    ? Math.min(Math.max(Math.floor(profile.activeAvatarIndex), 0), profile.avatarImages.length - 1)
    : 0;
  return profile.avatarImages[activeIndex] ?? profile.avatarImages[0] ?? "";
}
