// Pure data-format helpers shared by the Tavern script runtime and the HTML
// preview bridge. They translate Renge's stored models into the shapes that
// Tavern Helper 4.x and SillyTavern 1.19 expose to character-card code.
import type { ChatPreset, ChatPresetPrompt } from "./presetUtils";
import type { CharacterCard } from "./characterCardUtils";
import type { UserProfile } from "./userProfileUtils";

export const TAVERN_HELPER_VERSION = "4.12.2";
export const SILLYTAVERN_VERSION = "1.19.1";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(/[,，\n]+/).map((item) => item.trim()).filter(Boolean);
}

/** Event names exactly as SillyTavern 1.19 defines them in `event_types`. */
export const SILLYTAVERN_EVENT_TYPES = Object.freeze({
  APP_INITIALIZED: "app_initialized",
  APP_READY: "app_ready",
  EXTRAS_CONNECTED: "extras_connected",
  MESSAGE_SWIPED: "message_swiped",
  MESSAGE_SENT: "message_sent",
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_EDITED: "message_edited",
  MESSAGE_DELETED: "message_deleted",
  MESSAGE_UPDATED: "message_updated",
  MESSAGE_FILE_EMBEDDED: "message_file_embedded",
  MESSAGE_REASONING_EDITED: "message_reasoning_edited",
  MESSAGE_REASONING_DELETED: "message_reasoning_deleted",
  MESSAGE_SWIPE_DELETED: "message_swipe_deleted",
  MORE_MESSAGES_LOADED: "more_messages_loaded",
  IMPERSONATE_READY: "impersonate_ready",
  CHAT_CHANGED: "chat_id_changed",
  CHAT_LOADED: "chatLoaded",
  GENERATION_AFTER_COMMANDS: "GENERATION_AFTER_COMMANDS",
  GENERATION_STARTED: "generation_started",
  GENERATION_STOPPED: "generation_stopped",
  GENERATION_ENDED: "generation_ended",
  SD_PROMPT_PROCESSING: "sd_prompt_processing",
  EXTENSIONS_FIRST_LOAD: "extensions_first_load",
  EXTENSION_SETTINGS_LOADED: "extension_settings_loaded",
  SETTINGS_LOADED: "settings_loaded",
  SETTINGS_UPDATED: "settings_updated",
  GROUP_UPDATED: "group_updated",
  MOVABLE_PANELS_RESET: "movable_panels_reset",
  SETTINGS_LOADED_BEFORE: "settings_loaded_before",
  SETTINGS_LOADED_AFTER: "settings_loaded_after",
  CHATCOMPLETION_SOURCE_CHANGED: "chatcompletion_source_changed",
  CHATCOMPLETION_MODEL_CHANGED: "chatcompletion_model_changed",
  OAI_PRESET_CHANGED_BEFORE: "oai_preset_changed_before",
  OAI_PRESET_CHANGED_AFTER: "oai_preset_changed_after",
  OAI_PRESET_EXPORT_READY: "oai_preset_export_ready",
  OAI_PRESET_IMPORT_READY: "oai_preset_import_ready",
  WORLDINFO_SETTINGS_UPDATED: "worldinfo_settings_updated",
  WORLDINFO_UPDATED: "worldinfo_updated",
  CHARACTER_EDITOR_OPENED: "character_editor_opened",
  CHARACTER_EDITED: "character_edited",
  CHARACTER_PAGE_LOADED: "character_page_loaded",
  CHARACTER_GROUP_OVERLAY_STATE_CHANGE_BEFORE: "character_group_overlay_state_change_before",
  CHARACTER_GROUP_OVERLAY_STATE_CHANGE_AFTER: "character_group_overlay_state_change_after",
  USER_MESSAGE_RENDERED: "user_message_rendered",
  CHARACTER_MESSAGE_RENDERED: "character_message_rendered",
  FORCE_SET_BACKGROUND: "force_set_background",
  CHAT_DELETED: "chat_deleted",
  CHAT_CREATED: "chat_created",
  CHAT_RENAMED: "chat_renamed",
  GROUP_CHAT_DELETED: "group_chat_deleted",
  GROUP_CHAT_CREATED: "group_chat_created",
  GENERATE_BEFORE_COMBINE_PROMPTS: "generate_before_combine_prompts",
  GENERATE_AFTER_COMBINE_PROMPTS: "generate_after_combine_prompts",
  GENERATE_AFTER_DATA: "generate_after_data",
  GROUP_MEMBER_DRAFTED: "group_member_drafted",
  GROUP_WRAPPER_STARTED: "group_wrapper_started",
  GROUP_WRAPPER_FINISHED: "group_wrapper_finished",
  WORLD_INFO_ACTIVATED: "world_info_activated",
  TEXT_COMPLETION_SETTINGS_READY: "text_completion_settings_ready",
  CHAT_COMPLETION_SETTINGS_READY: "chat_completion_settings_ready",
  CHAT_COMPLETION_PROMPT_READY: "chat_completion_prompt_ready",
  CHARACTER_FIRST_MESSAGE_SELECTED: "character_first_message_selected",
  CHARACTER_DELETED: "characterDeleted",
  CHARACTER_DUPLICATED: "character_duplicated",
  CHARACTER_RENAMED: "character_renamed",
  CHARACTER_RENAMED_IN_PAST_CHAT: "character_renamed_in_past_chat",
  SMOOTH_STREAM_TOKEN_RECEIVED: "stream_token_received",
  STREAM_TOKEN_RECEIVED: "stream_token_received",
  STREAM_REASONING_DONE: "stream_reasoning_done",
  FILE_ATTACHMENT_DELETED: "file_attachment_deleted",
  WORLDINFO_FORCE_ACTIVATE: "worldinfo_force_activate",
  OPEN_CHARACTER_LIBRARY: "open_character_library",
  ONLINE_STATUS_CHANGED: "online_status_changed",
  IMAGE_SWIPED: "image_swiped",
  CONNECTION_PROFILE_LOADED: "connection_profile_loaded",
  CONNECTION_PROFILE_CREATED: "connection_profile_created",
  CONNECTION_PROFILE_DELETED: "connection_profile_deleted",
  CONNECTION_PROFILE_UPDATED: "connection_profile_updated",
  TOOL_CALLS_PERFORMED: "tool_calls_performed",
  TOOL_CALLS_RENDERED: "tool_calls_rendered",
  CHARACTER_MANAGEMENT_DROPDOWN: "charManagementDropdown",
  SECRET_WRITTEN: "secret_written",
  SECRET_DELETED: "secret_deleted",
  SECRET_ROTATED: "secret_rotated",
  SECRET_EDITED: "secret_edited",
  PRESET_CHANGED: "preset_changed",
  PRESET_DELETED: "preset_deleted",
  PRESET_RENAMED: "preset_renamed",
  PRESET_RENAMED_BEFORE: "preset_renamed_before",
  MAIN_API_CHANGED: "main_api_changed",
  WORLDINFO_ENTRIES_LOADED: "worldinfo_entries_loaded",
  WORLDINFO_SCAN_DONE: "worldinfo_scan_done",
  MEDIA_ATTACHMENT_DELETED: "media_attachment_deleted",
  PERSONA_CHANGED: "persona_changed",
  PERSONA_CREATED: "persona_created",
  PERSONA_UPDATED: "persona_updated",
  PERSONA_RENAMED: "persona_renamed",
  PERSONA_DELETED: "persona_deleted",
  TTS_JOB_STARTED: "tts_job_started",
  TTS_AUDIO_READY: "tts_audio_ready",
  TTS_JOB_COMPLETE: "tts_job_complete",
  ITEMIZED_PROMPTS_LOADED: "itemized_prompts_loaded",
  ITEMIZED_PROMPTS_SAVED: "itemized_prompts_saved",
  ITEMIZED_PROMPTS_DELETED: "itemized_prompts_deleted",
});

/** Events Renge emits in addition to the SillyTavern set. */
export const RENGE_TAVERN_EVENT_EXTRAS = Object.freeze({
  MESSAGE_RENDERED: "message_rendered",
  MESSAGE_SENDING: "message_sending",
  MESSAGE_RECEIVING: "message_receiving",
  CHARACTER_SELECTED: "character_selected",
  VARIABLE_CHANGED: "variable_changed",
});

export const TAVERN_EVENT_TYPES = Object.freeze({
  ...SILLYTAVERN_EVENT_TYPES,
  ...RENGE_TAVERN_EVENT_EXTRAS,
});

/** Tavern Helper's own generation and iframe lifecycle events. */
export const TAVERN_HELPER_IFRAME_EVENTS = Object.freeze({
  MESSAGE_IFRAME_RENDER_STARTED: "message_iframe_render_started",
  MESSAGE_IFRAME_RENDER_ENDED: "message_iframe_render_ended",
  GENERATION_REQUESTED: "js_generation_requested",
  GENERATION_STARTED: "js_generation_started",
  STREAM_TOKEN_RECEIVED_FULLY: "js_stream_token_received_fully",
  STREAM_TOKEN_RECEIVED_INCREMENTALLY: "js_stream_token_received_incrementally",
  GENERATION_ENDED: "js_generation_ended",
});

// Names older Renge builds used for events whose SillyTavern value differs.
const LEGACY_TAVERN_EVENT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  chat_changed: SILLYTAVERN_EVENT_TYPES.CHAT_CHANGED,
  generation_after_commands: SILLYTAVERN_EVENT_TYPES.GENERATION_AFTER_COMMANDS,
  character_deleted: SILLYTAVERN_EVENT_TYPES.CHARACTER_DELETED,
});

/** Maps legacy Renge event names onto the SillyTavern names used internally. */
export function normalizeTavernEventName(eventName: unknown) {
  const name = String(eventName);
  return Object.prototype.hasOwnProperty.call(LEGACY_TAVERN_EVENT_ALIASES, name)
    ? LEGACY_TAVERN_EVENT_ALIASES[name]
    : name;
}

/** Events whose first argument Tavern Helper coerces to a numeric message id. */
export const TAVERN_MESSAGE_ID_EVENTS: ReadonlySet<string> = new Set([
  SILLYTAVERN_EVENT_TYPES.MESSAGE_SWIPED,
  SILLYTAVERN_EVENT_TYPES.MESSAGE_SENT,
  SILLYTAVERN_EVENT_TYPES.MESSAGE_RECEIVED,
  SILLYTAVERN_EVENT_TYPES.MESSAGE_EDITED,
  SILLYTAVERN_EVENT_TYPES.MESSAGE_UPDATED,
  SILLYTAVERN_EVENT_TYPES.USER_MESSAGE_RENDERED,
  SILLYTAVERN_EVENT_TYPES.CHARACTER_MESSAGE_RENDERED,
]);

// ---------------------------------------------------------------------------
// Worldbooks
// ---------------------------------------------------------------------------

export type TavernCompatWorldbookPosition =
  | "before_char"
  | "after_char"
  | "before_examples"
  | "after_examples"
  | "before_an"
  | "after_an"
  | "at_depth";

export type TavernCompatWorldbookEntry = {
  extra?: UnknownRecord;
  id: string;
  uid: string;
  comment: string;
  content: string;
  enabled: boolean;
  keys: string[];
  secondaryKeys: string[];
  constant: boolean;
  selective: boolean;
  selectiveLogic: number;
  position: TavernCompatWorldbookPosition;
  depth: number;
  scanDepth: number | null;
  order: number;
  probability: number;
  useProbability: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useRegex: boolean;
};

/** Entry fields Tavern Helper exposes that Renge does not model natively. */
export const TAVERN_WORLDBOOK_META_KEY = "__tavern_helper";

const WORLDBOOK_POSITION_NAMES: Readonly<Record<TavernCompatWorldbookPosition, string>> = {
  before_char: "before_character_definition",
  after_char: "after_character_definition",
  before_examples: "before_example_messages",
  after_examples: "after_example_messages",
  before_an: "before_author_note",
  after_an: "after_author_note",
  at_depth: "at_depth",
};

const WORLDBOOK_LOGIC_NAMES = ["and_any", "not_all", "not_any", "and_all"] as const;

/**
 * Tavern Helper identifies entries by a numeric uid. Renge ids may be opaque
 * strings, so entries without a usable number receive the lowest free one.
 */
export function assignTavernWorldbookUids(entries: ReadonlyArray<{ uid?: unknown }>) {
  const used = new Set<number>();
  const assigned = entries.map((entry) => {
    const raw = String(entry.uid ?? "").trim();
    if (!/^\d{1,15}$/.test(raw)) return null;
    const uid = Number(raw);
    if (used.has(uid)) return null;
    used.add(uid);
    return uid;
  });
  let next = 0;
  return assigned.map((uid) => {
    if (uid !== null) return uid;
    while (used.has(next)) next += 1;
    used.add(next);
    return next;
  });
}

function readWorldbookMeta(entry: { extra?: UnknownRecord }) {
  const meta = entry.extra?.[TAVERN_WORLDBOOK_META_KEY];
  return isRecord(meta) ? meta : {};
}

function publicWorldbookExtra(entry: { extra?: UnknownRecord }) {
  const extra = clone(entry.extra ?? {});
  delete extra[TAVERN_WORLDBOOK_META_KEY];
  return extra;
}

/** Formats an entry as a Tavern Helper 4 `WorldbookEntry`. */
export function formatTavernHelperWorldbookEntry(entry: TavernCompatWorldbookEntry, uid: number) {
  const meta = readWorldbookMeta(entry);
  const recursion = isRecord(meta.recursion) ? meta.recursion : {};
  const effect = isRecord(meta.effect) ? meta.effect : {};
  const extra = publicWorldbookExtra(entry);
  const outletName = typeof meta.outlet_name === "string" ? meta.outlet_name : "";
  return {
    uid,
    name: entry.comment,
    enabled: entry.enabled,
    strategy: {
      type: meta.vectorized === true ? "vectorized" : entry.constant ? "constant" : "selective",
      keys: [...entry.keys],
      keys_secondary: {
        logic: WORLDBOOK_LOGIC_NAMES[entry.selectiveLogic] ?? "and_any",
        keys: [...entry.secondaryKeys],
      },
      scan_depth: entry.scanDepth == null ? "same_as_global" : entry.scanDepth,
    },
    position: {
      type: meta.outlet === true ? "outlet" : WORLDBOOK_POSITION_NAMES[entry.position] ?? "after_character_definition",
      role: meta.role === "assistant" || meta.role === "user" ? meta.role : "system",
      depth: entry.depth,
      order: entry.order,
      ...(outletName ? { outlet_name: outletName } : {}),
    },
    content: entry.content,
    probability: entry.useProbability ? entry.probability : 100,
    recursion: {
      prevent_incoming: recursion.prevent_incoming === true,
      prevent_outgoing: recursion.prevent_outgoing === true,
      delay_until: typeof recursion.delay_until === "number" ? recursion.delay_until : null,
    },
    effect: {
      sticky: typeof effect.sticky === "number" ? effect.sticky : null,
      cooldown: typeof effect.cooldown === "number" ? effect.cooldown : null,
      delay: typeof effect.delay === "number" ? effect.delay : null,
    },
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

const WORLDBOOK_POSITION_CODES: Readonly<Record<TavernCompatWorldbookPosition, number>> = {
  before_char: 0,
  after_char: 1,
  before_an: 2,
  after_an: 3,
  at_depth: 4,
  before_examples: 5,
  after_examples: 6,
};

/** Formats an entry as SillyTavern's raw world-info entry (`loadWorldInfo`). */
export function formatSillyTavernWorldInfoEntry(
  entry: TavernCompatWorldbookEntry,
  uid: number,
  displayIndex: number,
) {
  const meta = readWorldbookMeta(entry);
  const recursion = isRecord(meta.recursion) ? meta.recursion : {};
  const effect = isRecord(meta.effect) ? meta.effect : {};
  const extra = publicWorldbookExtra(entry);
  return {
    uid,
    key: [...entry.keys],
    keysecondary: [...entry.secondaryKeys],
    comment: entry.comment,
    content: entry.content,
    constant: entry.constant,
    vectorized: meta.vectorized === true,
    selective: entry.selective,
    selectiveLogic: entry.selectiveLogic,
    addMemo: true,
    order: entry.order,
    position: meta.outlet === true ? 7 : WORLDBOOK_POSITION_CODES[entry.position] ?? 1,
    disable: !entry.enabled,
    excludeRecursion: recursion.prevent_incoming === true,
    preventRecursion: recursion.prevent_outgoing === true,
    delayUntilRecursion: typeof recursion.delay_until === "number" ? recursion.delay_until : false,
    probability: entry.probability,
    useProbability: entry.useProbability,
    depth: entry.depth,
    group: "",
    groupOverride: false,
    groupWeight: 100,
    scanDepth: entry.scanDepth,
    caseSensitive: entry.caseSensitive ? true : null,
    matchWholeWords: entry.matchWholeWords ? true : null,
    useGroupScoring: null,
    automationId: "",
    role: entry.position === "at_depth" ? (meta.role === "user" ? 1 : meta.role === "assistant" ? 2 : 0) : null,
    sticky: typeof effect.sticky === "number" ? effect.sticky : 0,
    cooldown: typeof effect.cooldown === "number" ? effect.cooldown : 0,
    delay: typeof effect.delay === "number" ? effect.delay : 0,
    displayIndex,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

/** Formats an entry as the deprecated Tavern Helper `LorebookEntry`. */
export function formatTavernHelperLorebookEntry(
  entry: TavernCompatWorldbookEntry,
  uid: number,
  displayIndex: number,
) {
  const meta = readWorldbookMeta(entry);
  const recursion = isRecord(meta.recursion) ? meta.recursion : {};
  const effect = isRecord(meta.effect) ? meta.effect : {};
  const role = meta.role === "assistant" || meta.role === "user" ? meta.role : "system";
  return {
    uid,
    display_index: displayIndex,
    comment: entry.comment,
    enabled: entry.enabled,
    type: meta.vectorized === true ? "vectorized" : entry.constant ? "constant" : "selective",
    position:
      entry.position === "at_depth"
        ? `at_depth_as_${role}`
        : WORLDBOOK_POSITION_NAMES[entry.position] ?? "after_character_definition",
    depth: entry.position === "at_depth" ? entry.depth : null,
    order: entry.order,
    probability: entry.useProbability ? entry.probability : 100,
    keys: [...entry.keys],
    logic: WORLDBOOK_LOGIC_NAMES[entry.selectiveLogic] ?? "and_any",
    filters: [...entry.secondaryKeys],
    scan_depth: entry.scanDepth == null ? "same_as_global" : entry.scanDepth,
    case_sensitive: entry.caseSensitive ? true : "same_as_global",
    match_whole_words: entry.matchWholeWords ? true : "same_as_global",
    use_group_scoring: "same_as_global",
    automation_id: null,
    exclude_recursion: recursion.prevent_incoming === true,
    prevent_recursion: recursion.prevent_outgoing === true,
    delay_until_recursion: typeof recursion.delay_until === "number" ? recursion.delay_until : false,
    content: entry.content,
    group: "",
    group_prioritized: false,
    group_weight: 100,
    sticky: typeof effect.sticky === "number" ? effect.sticky : null,
    cooldown: typeof effect.cooldown === "number" ? effect.cooldown : null,
    delay: typeof effect.delay === "number" ? effect.delay : null,
  };
}

function normalizeWorldbookPositionName(value: unknown): TavernCompatWorldbookPosition | null {
  const name = String(value ?? "").trim().toLowerCase();
  if (!name) return null;
  if (name === "before_char" || name === "before_character_definition" || name === "0") return "before_char";
  if (name === "after_char" || name === "after_character_definition" || name === "1") return "after_char";
  if (name === "before_examples" || name === "before_example_messages" || name === "5") return "before_examples";
  if (name === "after_examples" || name === "after_example_messages" || name === "6") return "after_examples";
  if (name === "before_an" || name === "before_author_note" || name === "2") return "before_an";
  if (name === "after_an" || name === "after_author_note" || name === "3") return "after_an";
  if (name === "at_depth" || name.startsWith("at_depth_as_") || name === "4") return "at_depth";
  if (name === "outlet" || name === "7") return "after_char";
  return null;
}

function normalizeWorldbookLogic(value: unknown, fallback: number) {
  if (typeof value === "string") {
    const index = WORLDBOOK_LOGIC_NAMES.indexOf(value.trim().toLowerCase() as (typeof WORLDBOOK_LOGIC_NAMES)[number]);
    if (index >= 0) return index;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 3 ? parsed : fallback;
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null);
}

/**
 * Reads an entry written by character-card code. Accepts the Tavern Helper 4
 * `WorldbookEntry`, the deprecated `LorebookEntry`, SillyTavern's raw
 * world-info entry and Renge's own flat shape, falling back to `fallback` for
 * anything the caller left out (partial entries are allowed everywhere).
 */
export function readTavernHelperWorldbookEntry(
  value: unknown,
  index: number,
  fallback?: TavernCompatWorldbookEntry,
  createId: () => string = () => `worldbook-entry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
): TavernCompatWorldbookEntry {
  const raw = isRecord(value) ? value : {};
  const strategy = isRecord(raw.strategy) ? raw.strategy : {};
  const position = isRecord(raw.position) ? raw.position : {};
  const secondary = isRecord(strategy.keys_secondary) ? strategy.keys_secondary : {};
  const recursionInput = isRecord(raw.recursion) ? raw.recursion : {};
  const effectInput = isRecord(raw.effect) ? raw.effect : {};
  const previousMeta = fallback ? readWorldbookMeta(fallback) : {};
  const previousRecursion = isRecord(previousMeta.recursion) ? previousMeta.recursion : {};
  const previousEffect = isRecord(previousMeta.effect) ? previousMeta.effect : {};

  const rawId = raw.id !== undefined && typeof raw.uid !== "number" ? raw.id : undefined;
  const id = String(fallback?.id ?? rawId ?? raw.uid ?? createId());
  const uid = String(firstDefined(raw.uid, fallback?.uid, raw.id, id));

  const typeName = String(firstDefined(strategy.type, typeof raw.type === "string" ? raw.type : undefined) ?? "")
    .trim()
    .toLowerCase();
  const constant = typeName
    ? typeName === "constant"
    : toBoolean(raw.constant, fallback?.constant ?? false);
  const selective = typeName
    ? typeName === "selective"
    : toBoolean(raw.selective, fallback?.selective ?? !constant);
  const vectorized = typeName ? typeName === "vectorized" : previousMeta.vectorized === true || raw.vectorized === true;

  const positionValue = isRecord(raw.position) ? position.type : raw.position;
  const positionName = String(positionValue ?? "").trim().toLowerCase();
  const normalizedPosition = normalizeWorldbookPositionName(positionValue) ?? fallback?.position ?? "after_char";
  const outlet = positionName ? positionName === "outlet" || positionName === "7" : previousMeta.outlet === true;
  const roleFromPosition = /^at_depth_as_(system|assistant|user)$/.exec(positionName)?.[1];
  const rawRole = firstDefined(position.role, roleFromPosition, typeof raw.role === "string" ? raw.role : undefined);
  const numericRole = typeof raw.role === "number" ? ["system", "user", "assistant"][raw.role] : undefined;
  const role = String(firstDefined(rawRole, numericRole, previousMeta.role) ?? "system");

  const rawScanDepth = firstDefined(strategy.scan_depth, raw.scanDepth, raw.scan_depth);
  const scanDepth =
    rawScanDepth === undefined
      ? (fallback?.scanDepth ?? null)
      : rawScanDepth === "same_as_global"
        ? null
        : Math.max(1, Math.round(finiteNumber(rawScanDepth, fallback?.scanDepth ?? 8)));

  const rawProbability = firstDefined(raw.probability, strategy.probability);
  const probability = Math.min(100, Math.max(0, finiteNumber(rawProbability, fallback?.probability ?? 100)));
  const explicitUseProbability = firstDefined(raw.useProbability, raw.use_probability, strategy.use_probability);
  const useProbability =
    explicitUseProbability !== undefined
      ? toBoolean(explicitUseProbability, false)
      : rawProbability !== undefined
        ? probability < 100
        : (fallback?.useProbability ?? false);

  const rawDisabled = firstDefined(raw.disable, raw.disabled);
  const rawEnabled = firstDefined(raw.enabled, rawDisabled === undefined ? undefined : !toBoolean(rawDisabled, false));
  const rawSecondaryKeys = firstDefined(
    Array.isArray(strategy.keys_secondary) ? strategy.keys_secondary : secondary.keys,
    raw.filters,
    raw.secondaryKeys,
    raw.secondary_keys,
    raw.keysecondary,
  );
  const rawKeys = firstDefined(strategy.keys, raw.keys, raw.key);

  const meta: UnknownRecord = {};
  if (vectorized) meta.vectorized = true;
  if (outlet) {
    meta.outlet = true;
    const outletName = firstDefined(position.outlet_name, raw.outletName, previousMeta.outlet_name);
    if (typeof outletName === "string" && outletName) meta.outlet_name = outletName;
  }
  if (role === "assistant" || role === "user") meta.role = role;
  const recursion = {
    prevent_incoming: toBoolean(
      firstDefined(recursionInput.prevent_incoming, raw.exclude_recursion, raw.excludeRecursion),
      previousRecursion.prevent_incoming === true,
    ),
    prevent_outgoing: toBoolean(
      firstDefined(recursionInput.prevent_outgoing, raw.prevent_recursion, raw.preventRecursion),
      previousRecursion.prevent_outgoing === true,
    ),
    delay_until: (() => {
      const candidate = firstDefined(
        "delay_until" in recursionInput ? recursionInput.delay_until ?? false : undefined,
        raw.delay_until_recursion,
        raw.delayUntilRecursion,
      );
      if (candidate === undefined) return typeof previousRecursion.delay_until === "number" ? previousRecursion.delay_until : null;
      if (candidate === true) return 1;
      return typeof candidate === "number" && candidate > 0 ? candidate : null;
    })(),
  };
  if (recursion.prevent_incoming || recursion.prevent_outgoing || recursion.delay_until !== null) {
    meta.recursion = recursion;
  }
  const readEffect = (name: "sticky" | "cooldown" | "delay") => {
    const candidate = name in effectInput ? effectInput[name] : name in raw ? raw[name] : previousEffect[name];
    return typeof candidate === "number" && candidate > 0 ? candidate : null;
  };
  const effect = { sticky: readEffect("sticky"), cooldown: readEffect("cooldown"), delay: readEffect("delay") };
  if (effect.sticky !== null || effect.cooldown !== null || effect.delay !== null) meta.effect = effect;

  const extra: UnknownRecord = isRecord(raw.extra)
    ? clone(raw.extra)
    : fallback
      ? publicWorldbookExtra(fallback)
      : {};
  delete extra[TAVERN_WORLDBOOK_META_KEY];
  if (Object.keys(meta).length > 0) extra[TAVERN_WORLDBOOK_META_KEY] = meta;

  return {
    id,
    uid,
    extra,
    comment: String(firstDefined(raw.name, raw.comment, raw.memo, fallback?.comment) ?? `条目 ${index + 1}`),
    content: String(firstDefined(raw.content, fallback?.content) ?? ""),
    enabled: toBoolean(rawEnabled, fallback?.enabled ?? true),
    keys: rawKeys === undefined ? [...(fallback?.keys ?? [])] : stringList(rawKeys),
    secondaryKeys:
      rawSecondaryKeys === undefined ? [...(fallback?.secondaryKeys ?? [])] : stringList(rawSecondaryKeys),
    constant,
    selective,
    selectiveLogic: normalizeWorldbookLogic(
      firstDefined(secondary.logic, raw.logic, raw.selectiveLogic, raw.selective_logic, strategy.selective_logic),
      fallback?.selectiveLogic ?? 0,
    ),
    position: normalizedPosition,
    depth: Math.max(0, Math.round(finiteNumber(firstDefined(position.depth, raw.depth), fallback?.depth ?? 4))),
    scanDepth,
    order: Math.round(
      finiteNumber(
        firstDefined(position.order, raw.order, raw.insertion_order, raw.priority),
        fallback?.order ?? 100,
      ),
    ),
    probability,
    useProbability,
    caseSensitive: toBoolean(
      firstDefined(raw.caseSensitive, raw.case_sensitive, strategy.case_sensitive),
      fallback?.caseSensitive ?? false,
    ),
    matchWholeWords: toBoolean(
      firstDefined(raw.matchWholeWords, raw.match_whole_words, strategy.match_whole_words),
      fallback?.matchWholeWords ?? false,
    ),
    useRegex: toBoolean(firstDefined(raw.useRegex, raw.use_regex, strategy.use_regex), fallback?.useRegex ?? false),
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

// Tavern Helper keeps SillyTavern's prompt identifiers as `PresetPrompt.id`.
const PRESET_SYSTEM_PROMPT_IDS: ReadonlySet<string> = new Set(["main", "nsfw", "jailbreak", "enhanceDefinitions"]);

const PRESET_PLACEHOLDER_PROMPT_IDS: ReadonlySet<string> = new Set([
  "worldInfoBefore",
  "personaDescription",
  "charDescription",
  "charPersonality",
  "scenario",
  "worldInfoAfter",
  "dialogueExamples",
  "chatHistory",
]);

// Tavern Helper's own documentation spells the builtin ids in snake_case, so
// cards written against it pass e.g. `world_info_before`.
const PRESET_PROMPT_ID_ALIASES: Readonly<Record<string, string>> = {
  enhance_definitions: "enhanceDefinitions",
  world_info_before: "worldInfoBefore",
  persona_description: "personaDescription",
  char_description: "charDescription",
  char_personality: "charPersonality",
  world_info_after: "worldInfoAfter",
  dialogue_examples: "dialogueExamples",
  chat_history: "chatHistory",
};

const canonicalPresetPromptId = (id: unknown) => {
  const text = String(id ?? "");
  return PRESET_PROMPT_ID_ALIASES[text] ?? text;
};

export function isPresetSystemPrompt(prompt: unknown) {
  return isRecord(prompt) && PRESET_SYSTEM_PROMPT_IDS.has(canonicalPresetPromptId(prompt.id));
}

export function isPresetPlaceholderPrompt(prompt: unknown) {
  return isRecord(prompt) && PRESET_PLACEHOLDER_PROMPT_IDS.has(canonicalPresetPromptId(prompt.id));
}

export function isPresetNormalPrompt(prompt: unknown) {
  return isRecord(prompt) && !isPresetSystemPrompt(prompt) && !isPresetPlaceholderPrompt(prompt);
}

/** Tavern Helper's `builtin_prompt_default_order`. */
export const TAVERN_BUILTIN_PROMPT_DEFAULT_ORDER = Object.freeze([
  "world_info_before",
  "persona_description",
  "char_description",
  "char_personality",
  "scenario",
  "world_info_after",
  "dialogue_examples",
  "chat_history",
  "user_input",
]);

function toTavernHelperPresetPrompt(prompt: ChatPresetPrompt) {
  const id = prompt.identifier;
  const position =
    prompt.injectionPosition === 0
      ? { type: "relative" as const }
      : { type: "in_chat" as const, depth: prompt.injectionDepth, order: prompt.injectionOrder };
  if (PRESET_PLACEHOLDER_PROMPT_IDS.has(id)) {
    return { id, name: prompt.name, enabled: prompt.enabled, position, role: prompt.role };
  }
  return {
    id,
    name: prompt.name,
    enabled: prompt.enabled,
    ...(PRESET_SYSTEM_PROMPT_IDS.has(id) ? {} : { position }),
    role: prompt.role,
    content: prompt.content,
  };
}

/** Formats a Renge preset as a Tavern Helper 4 `Preset`. */
export function toTavernHelperPreset(preset: ChatPreset) {
  return {
    settings: {
      max_context: preset.maxContext,
      max_completion_tokens: preset.maxTokens,
      reply_count: 1,
      should_stream: true,
      temperature: preset.temperature,
      frequency_penalty: preset.frequencyPenalty,
      presence_penalty: preset.presencePenalty,
      top_p: preset.topP,
      repetition_penalty: preset.repetitionPenalty,
      min_p: preset.minP,
      top_k: preset.topK,
      top_a: preset.topA,
      seed: -1,
      squash_system_messages: preset.squashSystemMessages,
      reasoning_effort: "auto",
      request_thoughts: true,
      request_images: false,
      enable_function_calling: true,
      enable_web_search: false,
      allow_sending_images: "auto",
      allow_sending_videos: false,
      character_name_prefix: "none",
      wrap_user_messages_in_quotes: false,
    },
    prompts: preset.prompts.map(toTavernHelperPresetPrompt),
    prompts_unused: preset.backupPrompts.map(toTavernHelperPresetPrompt),
    extensions: {
      regex_scripts: [] as unknown[],
      tavern_helper: { scripts: [] as unknown[], variables: clone(preset.tavernVariables ?? {}) },
    },
  };
}

/** Tavern Helper's `default_preset`; also stands in for `'in_use'` when presets are off. */
export function createTavernHelperDefaultPreset() {
  const placeholder = (id: string, name: string) => ({
    id,
    name,
    enabled: true,
    position: { type: "relative" as const },
    role: "system" as const,
  });
  return {
    settings: {
      max_context: 2000000,
      max_completion_tokens: 300,
      reply_count: 1,
      should_stream: false,
      temperature: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      repetition_penalty: 1,
      top_p: 1,
      min_p: 0,
      top_k: 0,
      top_a: 0,
      seed: -1,
      squash_system_messages: false,
      reasoning_effort: "auto",
      request_thoughts: false,
      request_images: false,
      enable_function_calling: false,
      enable_web_search: false,
      allow_sending_images: "disabled",
      allow_sending_videos: false,
      character_name_prefix: "none",
      wrap_user_messages_in_quotes: false,
    },
    prompts: [
      placeholder("worldInfoBefore", "World Info (before) - 角色定义之前"),
      placeholder("personaDescription", "Persona Description - 玩家描述"),
      placeholder("charDescription", "Char Description - 角色描述"),
      placeholder("charPersonality", "Char Personality - 角色性格"),
      placeholder("scenario", "Scenario - 情景"),
      placeholder("worldInfoAfter", "World Info (after) - 角色定义之后"),
      placeholder("dialogueExamples", "Chat Examples - 对话示例"),
      placeholder("chatHistory", "Chat History - 聊天记录"),
    ],
    prompts_unused: [] as unknown[],
    extensions: {
      tavern_helper: { scripts: [] as unknown[], variables: {} as Record<string, unknown> },
    } as Record<string, unknown>,
  };
}

function fromTavernHelperPresetPrompt(
  value: unknown,
  index: number,
  previous: ReadonlyMap<string, ChatPresetPrompt>,
): ChatPresetPrompt | null {
  if (!isRecord(value)) return null;
  const identifier =
    canonicalPresetPromptId(String(value.id ?? value.identifier ?? "").trim()) || `prompt-${index + 1}`;
  const existing = previous.get(identifier);
  const position = isRecord(value.position) ? value.position : null;
  const inChat = position ? position.type === "in_chat" : existing ? existing.injectionPosition !== 0 : false;
  const role = value.role === "user" || value.role === "assistant" || value.role === "system"
    ? value.role
    : existing?.role ?? "system";
  return {
    identifier,
    name: String(value.name ?? existing?.name ?? identifier),
    role,
    content: typeof value.content === "string" ? value.content : existing?.content ?? "",
    enabled: typeof value.enabled === "boolean" ? value.enabled : existing?.enabled ?? true,
    marker: existing?.marker ?? PRESET_PLACEHOLDER_PROMPT_IDS.has(identifier),
    systemPrompt:
      existing?.systemPrompt ??
      (PRESET_SYSTEM_PROMPT_IDS.has(identifier) || PRESET_PLACEHOLDER_PROMPT_IDS.has(identifier)),
    injectionPosition: inChat ? 2 : 0,
    injectionDepth: Math.max(
      0,
      Math.floor(finiteNumber(position?.depth, existing?.injectionDepth ?? (inChat ? 4 : 0))),
    ),
    injectionOrder: finiteNumber(position?.order, existing?.injectionOrder ?? 100),
  };
}

/** Applies a (possibly partial) Tavern Helper `Preset` onto a Renge preset. */
export function applyTavernHelperPreset(base: ChatPreset, value: unknown): ChatPreset {
  if (!isRecord(value)) return base;
  const settings = isRecord(value.settings) ? value.settings : {};
  const previous = new Map(
    [...base.backupPrompts, ...base.prompts].map((prompt) => [prompt.identifier, prompt]),
  );
  const readPrompts = (list: unknown, fallback: ChatPresetPrompt[]) =>
    Array.isArray(list)
      ? list
          .map((prompt, index) => fromTavernHelperPresetPrompt(prompt, index, previous))
          .filter((prompt): prompt is ChatPresetPrompt => Boolean(prompt))
      : fallback;
  const extensions = isRecord(value.extensions) ? value.extensions : {};
  const helperExtension = isRecord(extensions.tavern_helper) ? extensions.tavern_helper : {};
  return {
    ...base,
    maxContext: Math.max(0, Math.floor(finiteNumber(settings.max_context, base.maxContext))),
    maxTokens: Math.max(0, Math.floor(finiteNumber(settings.max_completion_tokens, base.maxTokens))),
    temperature: finiteNumber(settings.temperature, base.temperature),
    frequencyPenalty: finiteNumber(settings.frequency_penalty, base.frequencyPenalty),
    presencePenalty: finiteNumber(settings.presence_penalty, base.presencePenalty),
    topP: finiteNumber(settings.top_p, base.topP),
    repetitionPenalty: finiteNumber(settings.repetition_penalty, base.repetitionPenalty),
    minP: finiteNumber(settings.min_p, base.minP),
    topK: finiteNumber(settings.top_k, base.topK),
    topA: finiteNumber(settings.top_a, base.topA),
    squashSystemMessages:
      typeof settings.squash_system_messages === "boolean"
        ? settings.squash_system_messages
        : base.squashSystemMessages,
    prompts: readPrompts(value.prompts, base.prompts),
    backupPrompts: readPrompts(value.prompts_unused, base.backupPrompts),
    tavernVariables: isRecord(helperExtension.variables)
      ? clone(helperExtension.variables)
      : base.tavernVariables,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export type TavernCompatCharacterOptions = {
  /** Name of the worldbook bound to the card, when one exists. */
  worldbookName?: string | null;
  /** Avatar reference handed to scripts (a URL, data URL or file name). */
  avatar?: string;
  /** Already formatted Tavern regexes that belong to the card. */
  regexScripts?: unknown[];
  /** Serialized Tavern Helper script trees embedded in the card. */
  scripts?: unknown[];
};

/** Formats a card as a Tavern Helper 4 `Character`. */
export function toTavernHelperCharacter(card: CharacterCard, options: TavernCompatCharacterOptions = {}) {
  return {
    avatar: options.avatar ?? card.avatarDataUrl ?? "",
    version: card.characterVersion,
    creator: card.creator,
    creator_notes: card.creatorNotes,
    worldbook: options.worldbookName ?? card.characterBook?.name ?? null,
    description: card.description,
    first_messages: [card.firstMessage, ...card.alternateGreetings],
    extensions: {
      ...clone(card.extensions ?? {}),
      regex_scripts: clone(options.regexScripts ?? []),
      tavern_helper: {
        scripts: clone(options.scripts ?? []),
        variables: clone(card.tavernVariables ?? {}),
      },
    },
  };
}

/** Applies a (possibly partial) Tavern Helper `Character` onto a card. */
export function applyTavernHelperCharacter(card: CharacterCard, value: unknown): CharacterCard {
  if (!isRecord(value)) return card;
  const firstMessages = Array.isArray(value.first_messages) ? value.first_messages.map(String) : null;
  const extensions = isRecord(value.extensions) ? value.extensions : null;
  const helperExtension = extensions && isRecord(extensions.tavern_helper) ? extensions.tavern_helper : null;
  const nextExtensions = extensions ? clone(extensions) : card.extensions;
  if (extensions) {
    delete nextExtensions.regex_scripts;
    delete nextExtensions.tavern_helper;
  }
  const avatar = typeof value.avatar === "string" && /^(?:data:image\/|\/api\/app-data\/assets\/)/.test(value.avatar)
    ? value.avatar
    : card.avatarDataUrl;
  return {
    ...card,
    avatarDataUrl: avatar,
    characterVersion: typeof value.version === "string" ? value.version : card.characterVersion,
    creator: typeof value.creator === "string" ? value.creator : card.creator,
    creatorNotes: typeof value.creator_notes === "string" ? value.creator_notes : card.creatorNotes,
    description: typeof value.description === "string" ? value.description : card.description,
    firstMessage: firstMessages ? firstMessages[0] ?? "" : card.firstMessage,
    alternateGreetings: firstMessages ? firstMessages.slice(1) : card.alternateGreetings,
    extensions: nextExtensions,
    tavernVariables:
      helperExtension && isRecord(helperExtension.variables)
        ? clone(helperExtension.variables)
        : card.tavernVariables,
    updatedAt: new Date().toISOString(),
  };
}

/** Formats a card as SillyTavern's `v1CharData` (what `getCharData` returns). */
export function toSillyTavernCharacterData(card: CharacterCard, options: TavernCompatCharacterOptions = {}) {
  const avatar = options.avatar ?? (card.avatarDataUrl || `${card.id}.png`);
  const worldName = options.worldbookName ?? card.characterBook?.name ?? "";
  const extensions = {
    talkativeness: "0.5",
    fav: false,
    ...clone(card.extensions ?? {}),
    ...(worldName ? { world: worldName } : {}),
    regex_scripts: clone(options.regexScripts ?? []),
  };
  return {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.firstMessage,
    mes_example: card.messageExample,
    creatorcomment: card.creatorNotes,
    tags: [...card.tags],
    talkativeness: 0.5,
    fav: false,
    create_date: card.createdAt,
    avatar,
    chat: "",
    data: {
      name: card.name,
      description: card.description,
      character_version: card.characterVersion,
      personality: card.personality,
      scenario: card.scenario,
      first_mes: card.firstMessage,
      mes_example: card.messageExample,
      creator_notes: card.creatorNotes,
      tags: [...card.tags],
      system_prompt: card.systemPrompt,
      post_history_instructions: card.postHistoryInstructions,
      creator: card.creator,
      alternate_greetings: [...card.alternateGreetings],
      group_only_greetings: [...(card.groupOnlyGreetings ?? [])],
      character_book: card.characterBook
        ? { name: card.characterBook.name, entries: clone(card.characterBook.entries) }
        : undefined,
      extensions,
    },
  };
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

/** Formats a Renge user profile as a Tavern Helper `Persona`. */
export function toTavernHelperPersona(profile: UserProfile, isDefault: boolean) {
  return {
    avatar_id: profile.id,
    avatar: profile.avatarImage,
    name: profile.nickname,
    title: "",
    description: profile.bio,
    // SillyTavern's persona_description_positions: 0 = in prompt, 9 = none.
    position: profile.sendToAi ? 0 : 9,
    depth: 2,
    role: 0,
    lorebook: "",
    connections: [],
    is_default: isDefault,
  };
}

/** Applies a (possibly partial) Tavern Helper `Persona` onto a user profile. */
export function applyTavernHelperPersona(profile: UserProfile, value: unknown): UserProfile {
  if (!isRecord(value)) return profile;
  const avatar = typeof value.avatar === "string" && /^(?:data:image\/|\/api\/app-data\/assets\/)/.test(value.avatar)
    ? value.avatar
    : profile.avatarImage;
  return {
    ...profile,
    nickname: typeof value.name === "string" && value.name.trim() ? value.name : profile.nickname,
    bio: typeof value.description === "string" ? value.description : profile.bio,
    avatarImage: avatar,
    sendToAi: typeof value.position === "number" ? value.position !== 9 : profile.sendToAi,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Chat messages
// ---------------------------------------------------------------------------

/**
 * Resolves the message range syntax accepted by `getChatMessages`: a single
 * id, `"start-end"`, negative ids counted from the end, and the
 * `{{lastMessageId}}` macro. Returns inclusive, ordered bounds or `null`.
 */
export function resolveTavernMessageRange(range: unknown, messageCount: number, currentMessageId = messageCount - 1) {
  const last = messageCount - 1;
  const toIndex = (value: number) => (value < 0 ? messageCount + value : value);
  if (range == null || range === "") return messageCount > 0 ? { start: 0, end: last } : null;
  if (typeof range === "number") {
    if (!Number.isInteger(range)) return null;
    const index = toIndex(range);
    return index >= 0 && index <= last ? { start: index, end: index } : null;
  }
  const text = String(range)
    .trim()
    .replace(/\{\{\s*lastMessageId\s*\}\}/gi, String(last))
    .replace(/\{\{\s*currentMessageId\s*\}\}/gi, String(currentMessageId));
  if (/^-?\d+$/.test(text)) {
    const index = toIndex(Number(text));
    return index >= 0 && index <= last ? { start: index, end: index } : null;
  }
  const match = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(text);
  if (!match) return null;
  const first = toIndex(Number(match[1]));
  const second = toIndex(Number(match[2]));
  const start = Math.max(0, Math.min(first, second));
  const end = Math.min(last, Math.max(first, second));
  return start <= end ? { start, end } : null;
}

/** Rotates `[begin, middle) [middle, end)` like `std::rotate`. */
export function rotateTavernMessages<T>(items: readonly T[], begin: number, middle: number, end: number) {
  const count = items.length;
  const clamp = (value: number) => Math.min(count, Math.max(0, Math.trunc(Number(value)) || 0));
  const first = clamp(begin);
  const last = Math.max(first, clamp(end));
  const pivot = Math.min(last, Math.max(first, clamp(middle)));
  return [
    ...items.slice(0, first),
    ...items.slice(pivot, last),
    ...items.slice(first, pivot),
    ...items.slice(last),
  ];
}
