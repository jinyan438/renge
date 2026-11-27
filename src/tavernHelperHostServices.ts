// Host-side implementation of the Tavern Helper character, preset and persona
// families. The app supplies accessors for its stores; this module owns the
// name resolution and the conversion to and from Tavern Helper's data shapes.
import type { CharacterCard } from "./characterCardUtils";
import type { ChatPreset } from "./presetUtils";
import type { RegexScript } from "./regexUtils";
import type { UserProfile, UserProfileState } from "./userProfileUtils";
import {
  applyTavernHelperCharacter,
  applyTavernHelperPersona,
  applyTavernHelperPreset,
  toSillyTavernCharacterData,
  toTavernHelperCharacter,
  toTavernHelperPersona,
  toTavernHelperPreset,
} from "./tavernHelperCompat";

export type TavernHelperSaveMode = "create" | "replace" | "upsert";

export type TavernHelperHostServices = {
  getCharacterNames(): string[];
  getCurrentCharacterName(): string | null;
  getTavernCharacter(name: string): Record<string, unknown> | null;
  saveTavernCharacter(name: string, character: unknown, mode: TavernHelperSaveMode): boolean;
  deleteTavernCharacter(name: string): boolean;
  getCharacterData(name: string): Record<string, unknown> | null;
  getCharacterAvatarPath(name: string): string | null;
  setCharacterWorldbookName(name: string, worldbookName: string | null): boolean;
  getLoadedPresetName(): string;
  getTavernPreset(name: string): Record<string, unknown> | null;
  saveTavernPreset(name: string, preset: unknown, mode: TavernHelperSaveMode): boolean;
  deleteTavernPreset(name: string): boolean;
  renameTavernPreset(name: string, newName: string): boolean;
  getPersonas(): Array<Record<string, unknown>>;
  getCurrentPersonaId(): string;
  saveTavernPersona(id: string, persona: unknown, mode: TavernHelperSaveMode): string | null;
  deleteTavernPersona(id: string): boolean;
};

export type TavernHelperHostStores = {
  getCards(): CharacterCard[];
  setCards(cards: CharacterCard[]): void;
  getCurrentCard(): CharacterCard | undefined;
  /** Name of the worldbook a card resolves to in the current session. */
  getCardWorldbookName(card: CharacterCard): string | null;
  createCard(name: string): CharacterCard;
  getPresets(): ChatPreset[];
  setPresets(presets: ChatPreset[]): void;
  /** The preset used for generation, or undefined when presets are off. */
  getActivePreset(): ChatPreset | undefined;
  createPreset(name: string): ChatPreset;
  getUserProfileState(): UserProfileState;
  setUserProfileState(state: UserProfileState): void;
  createUserProfile(name: string): UserProfile;
};

function serializeRegexScript(script: RegexScript) {
  return {
    id: script.id,
    scriptName: script.scriptName,
    findRegex: script.findRegex,
    replaceString: script.replaceString,
    trimStrings: [...script.trimStrings],
    placement: [...script.placement],
    disabled: script.disabled,
    markdownOnly: script.markdownOnly,
    promptOnly: script.promptOnly,
    runOnEdit: script.runOnEdit,
    substituteRegex: script.substituteRegex,
    minDepth: script.minDepth,
    maxDepth: script.maxDepth,
  };
}

/** Tavern Helper's `TavernRegex` view of a stored regex script. */
export function toTavernHelperRegex(script: RegexScript, scope: "global" | "character" | "preset") {
  return {
    id: script.id,
    script_name: script.scriptName,
    enabled: !script.disabled,
    scope,
    find_regex: script.findRegex,
    replace_string: script.replaceString,
    trim_strings: [...script.trimStrings],
    source: {
      user_input: script.placement.includes(1),
      ai_output: script.placement.includes(2),
      slash_command: script.placement.includes(3),
      world_info: script.placement.includes(5),
      reasoning: script.placement.includes(6),
    },
    destination: { display: script.markdownOnly, prompt: script.promptOnly },
    run_on_edit: script.runOnEdit,
    min_depth: script.minDepth,
    max_depth: script.maxDepth,
  };
}

const stripAvatarExtension = (name: string) => name.replace(/\.png$/i, "");

export function createTavernHelperHostServices(stores: TavernHelperHostStores): TavernHelperHostServices {
  const findCard = (name: string) => {
    const normalized = String(name ?? "").trim();
    if (!normalized || normalized === "current") return stores.getCurrentCard();
    const cards = stores.getCards();
    const bare = stripAvatarExtension(normalized);
    return (
      cards.find((card) => card.name === normalized) ??
      cards.find((card) => card.id === normalized || card.id === bare) ??
      cards.find((card) => card.name === bare) ??
      cards.find((card) => card.avatarDataUrl !== "" && card.avatarDataUrl === normalized)
    );
  };
  const characterOptions = (card: CharacterCard) => ({
    worldbookName: stores.getCardWorldbookName(card),
    avatar: card.avatarDataUrl || `${card.id}.png`,
  });

  const findPreset = (name: string) => {
    const normalized = String(name ?? "").trim();
    if (!normalized || normalized === "in_use") return stores.getActivePreset();
    return stores.getPresets().find((preset) => preset.name.trim() === normalized);
  };

  const findProfile = (id: string) => {
    const state = stores.getUserProfileState();
    const normalized = String(id ?? "").trim();
    if (!normalized || normalized === "current") {
      return state.userProfiles.find((profile) => profile.id === state.activeUserProfileId) ?? state.userProfiles[0];
    }
    return (
      state.userProfiles.find((profile) => profile.id === normalized) ??
      state.userProfiles.find((profile) => profile.nickname === normalized)
    );
  };

  return {
    getCharacterNames: () => stores.getCards().map((card) => card.name),
    getCurrentCharacterName: () => stores.getCurrentCard()?.name ?? null,
    getTavernCharacter: (name) => {
      const card = findCard(name);
      return card
        ? toTavernHelperCharacter(card, {
            ...characterOptions(card),
            regexScripts: card.regexScripts.map((script) => toTavernHelperRegex(script, "character")),
          })
        : null;
    },
    saveTavernCharacter: (name, character, mode) => {
      const existing = findCard(name);
      if (existing) {
        if (mode === "create") return false;
        const updated = applyTavernHelperCharacter(existing, character);
        stores.setCards(stores.getCards().map((card) => (card.id === existing.id ? updated : card)));
        return true;
      }
      const normalized = String(name ?? "").trim();
      if (mode === "replace" || !normalized || normalized === "current") return false;
      const created = applyTavernHelperCharacter(stores.createCard(stripAvatarExtension(normalized)), character);
      stores.setCards([...stores.getCards(), created]);
      return true;
    },
    deleteTavernCharacter: (name) => {
      const existing = findCard(name);
      if (!existing) return false;
      stores.setCards(stores.getCards().filter((card) => card.id !== existing.id));
      return true;
    },
    getCharacterData: (name) => {
      const card = findCard(name);
      return card
        ? toSillyTavernCharacterData(card, {
            ...characterOptions(card),
            regexScripts: card.regexScripts.map(serializeRegexScript),
          })
        : null;
    },
    getCharacterAvatarPath: (name) => {
      const card = findCard(name);
      return card ? card.avatarDataUrl || null : null;
    },
    setCharacterWorldbookName: (name, worldbookName) => {
      const existing = findCard(name);
      if (!existing) return false;
      const extensions = { ...existing.extensions };
      if (worldbookName) extensions.world = worldbookName;
      else delete extensions.world;
      const updated: CharacterCard = {
        ...existing,
        extensions,
        // A named binding replaces the embedded book; unbinding clears both.
        characterBook:
          worldbookName && existing.characterBook?.name === worldbookName ? existing.characterBook : null,
        updatedAt: new Date().toISOString(),
      };
      stores.setCards(stores.getCards().map((card) => (card.id === existing.id ? updated : card)));
      return true;
    },
    getLoadedPresetName: () => stores.getActivePreset()?.name ?? "",
    getTavernPreset: (name) => {
      const preset = findPreset(name);
      return preset ? toTavernHelperPreset(preset) : null;
    },
    saveTavernPreset: (name, preset, mode) => {
      const existing = findPreset(name);
      if (existing) {
        if (mode === "create") return false;
        const updated = applyTavernHelperPreset(existing, preset);
        stores.setPresets(stores.getPresets().map((item) => (item.id === existing.id ? updated : item)));
        return true;
      }
      const normalized = String(name ?? "").trim();
      if (mode === "replace" || !normalized || normalized === "in_use") return false;
      stores.setPresets([...stores.getPresets(), applyTavernHelperPreset(stores.createPreset(normalized), preset)]);
      return true;
    },
    deleteTavernPreset: (name) => {
      const normalized = String(name ?? "").trim();
      if (!normalized || normalized === "in_use") return false;
      const existing = findPreset(normalized);
      if (!existing) return false;
      stores.setPresets(stores.getPresets().filter((preset) => preset.id !== existing.id));
      return true;
    },
    renameTavernPreset: (name, newName) => {
      const nextName = String(newName ?? "").trim();
      const existing = findPreset(name);
      if (!existing || !nextName || nextName === "in_use") return false;
      if (stores.getPresets().some((preset) => preset.id !== existing.id && preset.name.trim() === nextName)) {
        return false;
      }
      stores.setPresets(
        stores.getPresets().map((preset) =>
          preset.id === existing.id ? { ...preset, name: nextName, updatedAt: new Date().toISOString() } : preset,
        ),
      );
      return true;
    },
    getPersonas: () => {
      const state = stores.getUserProfileState();
      return state.userProfiles.map((profile) =>
        toTavernHelperPersona(profile, profile.id === state.activeUserProfileId),
      );
    },
    getCurrentPersonaId: () => findProfile("current")?.id ?? "",
    saveTavernPersona: (id, persona, mode) => {
      const state = stores.getUserProfileState();
      const existing = findProfile(id);
      if (existing) {
        if (mode === "create") return null;
        const updated = applyTavernHelperPersona(existing, persona);
        stores.setUserProfileState({
          ...state,
          userProfiles: state.userProfiles.map((profile) => (profile.id === existing.id ? updated : profile)),
        });
        return existing.id;
      }
      const normalized = String(id ?? "").trim();
      if (mode === "replace" || normalized === "current") return null;
      const requestedName =
        persona && typeof persona === "object" && typeof (persona as { name?: unknown }).name === "string"
          ? String((persona as { name: string }).name)
          : normalized;
      const created = applyTavernHelperPersona(stores.createUserProfile(requestedName || "User"), persona);
      const unique =
        normalized && !state.userProfiles.some((profile) => profile.id === normalized)
          ? { ...created, id: normalized }
          : created;
      stores.setUserProfileState({ ...state, userProfiles: [...state.userProfiles, unique] });
      return unique.id;
    },
    deleteTavernPersona: (id) => {
      const state = stores.getUserProfileState();
      const existing = findProfile(id);
      // The app always needs one profile to act as the user.
      if (!existing || state.userProfiles.length <= 1) return false;
      const userProfiles = state.userProfiles.filter((profile) => profile.id !== existing.id);
      stores.setUserProfileState({
        userProfiles,
        activeUserProfileId:
          state.activeUserProfileId === existing.id ? userProfiles[0].id : state.activeUserProfileId,
      });
      return true;
    },
  };
}
