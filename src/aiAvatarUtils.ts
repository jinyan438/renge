export type AiAvatarImage = {
  id: string;
  dataUrl: string;
  updatedAt: string;
};

export type AiAvatarModelProfile = {
  id: string;
  modelId: string;
  avatarId: string;
  updatedAt: string;
};

export type AiAvatarSettings = {
  images: AiAvatarImage[];
  modelProfiles: AiAvatarModelProfile[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function createId(prefix: string) {
  return (
    globalThis.crypto?.randomUUID?.() ??
    prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2)
  );
}

function getUniqueId(baseId: string, usedIds: Set<string>) {
  let id = baseId || "ai-avatar-" + (usedIds.size + 1);
  let suffix = 2;
  while (usedIds.has(id)) {
    id = (baseId || "ai-avatar") + "-" + suffix;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function normalizeTimestamp(value: unknown) {
  return getString(value) || new Date().toISOString();
}

function getImageDataUrl(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";

  return (
    getString(value.dataUrl) ||
    getString(value.avatarImage) ||
    getString(value.image) ||
    getString(value.source)
  );
}

function getImageSources(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values
        .map((entry) => getImageDataUrl(entry))
        .filter(Boolean),
    ),
  );
}

function clampIndex(value: unknown, length: number) {
  const parsed = Number(value);
  if (length <= 0 || !Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(Math.floor(parsed), 0), length - 1);
}

export function createAiAvatarSettings(): AiAvatarSettings {
  return { images: [], modelProfiles: [] };
}

export function createAiAvatarImage(dataUrl = ""): AiAvatarImage {
  return {
    id: createId("ai-avatar-image"),
    dataUrl: dataUrl.trim(),
    updatedAt: new Date().toISOString(),
  };
}

export function createAiAvatarModelProfile(modelId = ""): AiAvatarModelProfile {
  return {
    id: createId("ai-avatar-model"),
    modelId: modelId.trim(),
    avatarId: "",
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeAiAvatarSettings(rawValue: unknown): AiAvatarSettings {
  const root = isRecord(rawValue) ? rawValue : null;
  const legacyProfiles = Array.isArray(rawValue)
    ? rawValue
    : Array.isArray(root?.aiAvatarProfiles)
      ? root.aiAvatarProfiles
      : [];
  const rawImages = root
    ? Array.isArray(root.images)
      ? root.images
      : Array.isArray(root.avatarImages)
        ? root.avatarImages
        : Array.isArray(root.avatars)
          ? root.avatars
          : []
    : [];

  const images: AiAvatarImage[] = [];
  const imageIdBySource = new Map<string, string>();
  const usedImageIds = new Set<string>();
  const imageIds = new Set<string>();
  const addImage = (
    value: unknown,
    fallbackId = "ai-avatar-image-" + (images.length + 1),
  ) => {
    const dataUrl = getImageDataUrl(value);
    if (!dataUrl) return "";
    const existingId = imageIdBySource.get(dataUrl);
    if (existingId) return existingId;

    const imageId = getUniqueId(
      getString(isRecord(value) ? value.id : "") || fallbackId,
      usedImageIds,
    );
    images.push({
      id: imageId,
      dataUrl,
      updatedAt: normalizeTimestamp(isRecord(value) ? value.updatedAt : undefined),
    });
    imageIds.add(imageId);
    imageIdBySource.set(dataUrl, imageId);
    return imageId;
  };

  rawImages.forEach((value, index) => {
    addImage(value, "ai-avatar-image-" + (index + 1));
  });

  const modelProfiles: AiAvatarModelProfile[] = [];
  const usedModelProfileIds = new Set<string>();
  const addModelProfile = (value: unknown, fallbackId: string, avatarId = "") => {
    if (!isRecord(value)) return;
    let normalizedAvatarId = getString(value.avatarId ?? value.avatar_id) || avatarId;
    if (!imageIds.has(normalizedAvatarId)) {
      normalizedAvatarId = imageIdBySource.get(normalizedAvatarId) ?? "";
    }

    modelProfiles.push({
      id: getUniqueId(getString(value.id) || fallbackId, usedModelProfileIds),
      modelId: getString(value.modelId ?? value.model_id),
      avatarId: imageIds.has(normalizedAvatarId) ? normalizedAvatarId : "",
      updatedAt: normalizeTimestamp(value.updatedAt),
    });
  };

  const rawModelProfiles = root
    ? Array.isArray(root.modelProfiles)
      ? root.modelProfiles
      : Array.isArray(root.modelMappings)
        ? root.modelMappings
        : Array.isArray(root.mappings)
          ? root.mappings
          : []
    : [];
  rawModelProfiles.forEach((value, index) => {
    if (!isRecord(value)) return;
    const source = getImageDataUrl(value.avatarImage ?? value.avatar);
    const avatarId = source ? addImage(source) : "";
    addModelProfile(value, "ai-avatar-model-" + (index + 1), avatarId);
  });

  if (rawModelProfiles.length === 0) {
    legacyProfiles.forEach((value, profileIndex) => {
      if (!isRecord(value)) return;
      const legacyImages = getImageSources([
        ...(Array.isArray(value.avatarImages) ? value.avatarImages : []),
        ...(Array.isArray(value.avatars) ? value.avatars : []),
        value.avatarImage,
        value.avatar,
      ]);
      const legacyImageIds = legacyImages.map((source, imageIndex) =>
        addImage(
          source,
          "ai-avatar-image-" + (profileIndex + 1) + "-" + (imageIndex + 1),
        ),
      );
      const selectedImageId =
        legacyImageIds[clampIndex(value.activeAvatarIndex, legacyImageIds.length)] ?? "";
      addModelProfile(
        value,
        "ai-avatar-model-" + (profileIndex + 1),
        selectedImageId,
      );
    });
  }

  return { images, modelProfiles };
}

export function getAiModeAvatarImage(
  settings: AiAvatarSettings,
  modelId: string,
) {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return "";

  const profile = settings.modelProfiles.find(
    (candidate) =>
      candidate.modelId.trim().toLowerCase() === normalizedModelId &&
      candidate.avatarId,
  );
  if (!profile) return "";

  return settings.images.find((image) => image.id === profile.avatarId)?.dataUrl ?? "";
}
