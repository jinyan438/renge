export function createShallowReferencePatch<T extends object>(
  current: T,
  previous: T | null,
  omittedKeys: ReadonlySet<keyof T> = new Set(),
): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(current) as Array<keyof T>) {
    if (omittedKeys.has(key)) continue;
    if (previous && current[key] === previous[key]) continue;
    patch[key] = current[key];
  }
  return patch;
}

export function createPersistentReferenceBaseline<T extends object>(
  current: T,
  persisted: Partial<T>,
  dirtyKeys: ReadonlySet<keyof T> = new Set(),
) {
  const baseline = { ...current };
  for (const key of Object.keys(baseline) as Array<keyof T>) {
    if (
      dirtyKeys.has(key) ||
      !Object.prototype.hasOwnProperty.call(persisted, key) ||
      !areJsonValuesEqual(current[key], persisted[key])
    ) {
      delete baseline[key];
    }
  }
  return baseline;
}

export function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    (typeof left === "number" && !Number.isFinite(left) && right === null) ||
    (typeof right === "number" && !Number.isFinite(right) && left === null)
  ) {
    return true;
  }
  if (typeof left !== typeof right || !left || !right) return false;
  if (typeof left !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    const normalizeArrayValue = (value: unknown) =>
      value === undefined || typeof value === "function" || typeof value === "symbol"
        ? null
        : value;
    for (let index = 0; index < left.length; index += 1) {
      if (
        !areJsonValuesEqual(
          normalizeArrayValue(left[index]),
          normalizeArrayValue(right[index]),
        )
      ) {
        return false;
      }
    }
    return true;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const isPersistedObjectValue = (value: unknown) =>
    value !== undefined && typeof value !== "function" && typeof value !== "symbol";
  const leftKeys = Object.keys(leftRecord).filter((key) =>
    isPersistedObjectValue(leftRecord[key]),
  );
  const rightKeys = Object.keys(rightRecord).filter((key) =>
    isPersistedObjectValue(rightRecord[key]),
  );
  return leftKeys.length === rightKeys.length && leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      areJsonValuesEqual(leftRecord[key], rightRecord[key]),
  );
}

export function hasMeaningfulPatchChanges<T extends object>(
  patch: Partial<T>,
  ignoredKeys: ReadonlySet<keyof T>,
) {
  return (Object.keys(patch) as Array<keyof T>).some((key) => !ignoredKeys.has(key));
}

export type ChatSessionPatch<T> = {
  upserts: Array<{ session: T; expectedVersion: string | null }>;
  deletes: Array<{ id: string; expectedVersion: string | null }>;
};

export function createChatSessionPatch<T extends { id: string }>(
  current: readonly T[],
  previous: readonly T[],
  versions: Readonly<Record<string, string>>,
): ChatSessionPatch<T> {
  const oldById = new Map(previous.map((session) => [session.id, session]));
  const currentIds = new Set(current.map((session) => session.id));
  return {
    upserts: current.filter((session) => !areJsonValuesEqual(session, oldById.get(session.id)))
      .map((session) => ({ session, expectedVersion: versions[session.id] ?? null })),
    deletes: previous.filter((session) => !currentIds.has(session.id))
      .map((session) => ({ id: session.id, expectedVersion: versions[session.id] ?? null })),
  };
}

export function canPreservePersistentCharacterCards(
  cards: ReadonlyArray<{ avatarDataUrl?: unknown }>,
) {
  return cards.length > 0 && !cards.some(
    (card) =>
      typeof card.avatarDataUrl === "string" &&
      card.avatarDataUrl.startsWith("data:image/"),
  );
}

export function compactCharacterCardsForPersistentStore<
  Card extends { avatarDataUrl?: unknown },
>(cards: readonly Card[]): Card[] {
  return cards.map((card) =>
    typeof card.avatarDataUrl === "string" && card.avatarDataUrl.startsWith("data:image/")
      ? { ...card, avatarDataUrl: "" }
      : card,
  );
}
