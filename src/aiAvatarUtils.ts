export type AiAvatarImage = {
  id: string;
  dataUrl: string;
  updatedAt: string;
  archived?: boolean;
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

export type StoredAiAvatarIdentity = {
  modelId: string;
  modelName: string;
  avatarId?: string;
  avatarImage?: string;
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
    const explicitId = getString(isRecord(value) ? value.id : "");
    // Explicit IDs can already be referenced by historical messages. Preserve
    // both records even when their image bytes happen to be identical.
    if (existingId && !explicitId) return existingId;

    const imageId = getUniqueId(
      explicitId || fallbackId,
      usedImageIds,
    );
    const archived = isRecord(value) && value.archived === true;
    images.push({
      id: imageId,
      dataUrl,
      updatedAt: normalizeTimestamp(isRecord(value) ? value.updatedAt : undefined),
      ...(archived ? { archived: true } : {}),
    });
    if (!archived) imageIds.add(imageId);
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
  const avatarId = getAiModeAvatarId(settings, modelId);
  return settings.images.find((image) => image.id === avatarId)?.dataUrl ?? "";
}

export function getAiModeAvatarId(
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

  return settings.images.some(
    (image) => image.id === profile.avatarId && !image.archived,
  )
    ? profile.avatarId
    : "";
}

export function getSelectableAiAvatarImages(settings: AiAvatarSettings) {
  return settings.images.filter((image) => !image.archived);
}

export function pruneArchivedAiAvatarImages(
  settings: AiAvatarSettings,
  referencedImageIds: ReadonlySet<string>,
) {
  if (!settings.images.some((image) => image.archived)) return settings;
  const images = settings.images.filter(
    (image) => !image.archived || referencedImageIds.has(image.id),
  );
  return images.length === settings.images.length ? settings : { ...settings, images };
}

export function compactAiAvatarMessageIdentities<
  Message extends { aiIdentity?: StoredAiAvatarIdentity },
  Session extends { messages: Message[] },
>(sessions: Session[], settings: AiAvatarSettings) {
  let images = settings.images;
  let settingsChanged = false;
  let sessionsChanged = false;
  const imageIdBySource = new Map(images.map((image) => [image.dataUrl, image.id]));
  const validImageIds = new Set(images.map((image) => image.id));

  const nextSessions = sessions.map((session) => {
    let messagesChanged = false;
    const messages = session.messages.map((message) => {
      const identity = message.aiIdentity;
      if (!identity) return message;

      let avatarId = identity.avatarId && validImageIds.has(identity.avatarId)
        ? identity.avatarId
        : "";
      if (!avatarId && identity.avatarImage) {
        avatarId = imageIdBySource.get(identity.avatarImage) ?? "";
        if (!avatarId) {
          const image = createAiAvatarImage(identity.avatarImage);
          images = [...images, image];
          imageIdBySource.set(image.dataUrl, image.id);
          validImageIds.add(image.id);
          avatarId = image.id;
          settingsChanged = true;
        }
      }

      if (identity.avatarImage === undefined && identity.avatarId === avatarId) {
        return message;
      }
      messagesChanged = true;
      return {
        ...message,
        aiIdentity: {
          modelId: identity.modelId,
          modelName: identity.modelName,
          ...(avatarId ? { avatarId } : {}),
        },
      } as Message;
    });
    if (!messagesChanged) return session;
    sessionsChanged = true;
    return { ...session, messages };
  });

  return {
    sessions: sessionsChanged ? nextSessions : sessions,
    settings: settingsChanged ? { ...settings, images } : settings,
  };
}
