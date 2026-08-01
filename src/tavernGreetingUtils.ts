export type TavernGreetingMessage = {
  content: string;
  source?: string;
  variables?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

export type TavernGreetingState = {
  index: number;
  greetings: string[];
};

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

export function getTavernMessageSwipeState(
  message: TavernGreetingMessage,
  greetingState?: TavernGreetingState | null,
) {
  if (message.source !== "roleplay-greeting" || !greetingState?.greetings.length) {
    return {
      swipeId: 0,
      swipes: [message.content],
      swipesData: [cloneValue(message.variables ?? {})],
      swipesInfo: [cloneValue(message.extra ?? {})],
    };
  }

  const swipeId = Math.max(
    0,
    Math.min(Math.floor(Number(greetingState.index) || 0), greetingState.greetings.length - 1),
  );
  return {
    swipeId,
    swipes: greetingState.greetings.slice(),
    swipesData: greetingState.greetings.map((_, index) =>
      index === swipeId ? cloneValue(message.variables ?? {}) : {},
    ),
    swipesInfo: greetingState.greetings.map((_, index) =>
      index === swipeId ? cloneValue(message.extra ?? {}) : {},
    ),
  };
}

export function getTavernGreetingSwipeIndex(
  message: TavernGreetingMessage,
  update: Record<string, unknown>,
) {
  if (message.source !== "roleplay-greeting" || update.swipe_id == null) return null;
  const swipeIndex = Number(update.swipe_id);
  if (!Number.isInteger(swipeIndex)) return null;
  const normalizedIndex = Math.max(0, swipeIndex);
  const hasExplicitSwipeContent =
    typeof update.mes === "string" ||
    typeof update.message === "string" ||
    typeof update.content === "string" ||
    (Array.isArray(update.swipes) && typeof update.swipes[normalizedIndex] === "string");
  return hasExplicitSwipeContent ? null : normalizedIndex;
}
