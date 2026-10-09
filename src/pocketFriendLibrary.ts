import { normalizePocketState, type PocketContact, type PocketState } from "./pocketPhoneState.ts";
import { pocketFriendName, pocketFriendProfile, type PocketFriendProfile } from "./pocketFriendGeneration.ts";

export const POCKET_FRIEND_LIBRARY_KEY = "renge_pocket_friend_library_v1";
const CHANGED = "renge-pocket-friend-library-changed";
const WARNING = "角色库存储不可用，改动暂未保存。请保留当前页面。";
type LibraryStorage = Pick<Storage, "getItem" | "setItem" | "key" | "length">;
export type PocketLibraryCharacter = PocketFriendProfile & { id: string; createdAt: string; updatedAt: string };
export type PocketFriendLibrary = { characters: PocketLibraryCharacter[]; storageWarning: string };
let unsavedLibrary: PocketFriendLibrary | undefined;

export function pocketLibraryContacts(state: PocketState) {
  return [...state.contacts, ...Object.values(state.characterPhones || {}).flatMap(phone => phone.contacts)].filter(person => !person.syncedOwnerId && !person.app);
}

function parseLibrary(raw: string): PocketLibraryCharacter[] {
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.characters)) throw new Error("角色库格式有误。");
  const names = new Set<string>();
  const ids = new Set<string>();
  return data.characters.flatMap((item: Record<string, unknown>) => {
    const profile = pocketFriendProfile(item);
    if (!profile || typeof item.id !== "string" || !item.id || ids.has(item.id) || names.has(pocketFriendName(profile.name))) return [];
    ids.add(item.id); names.add(pocketFriendName(profile.name));
    return [{ ...profile, id: item.id, createdAt: typeof item.createdAt === "string" ? item.createdAt : "", updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "" }];
  });
}

export function writePocketFriendLibrary(storage: LibraryStorage, characters: PocketLibraryCharacter[]): PocketFriendLibrary {
  try { storage.setItem(POCKET_FRIEND_LIBRARY_KEY, JSON.stringify({ version: 1, characters })); return { characters, storageWarning: "" }; }
  catch { return { characters, storageWarning: WARNING }; }
}

export function mergePocketLibraryContacts(characters: PocketLibraryCharacter[], contacts: PocketContact[]) {
  const result = [...characters];
  for (const contact of contacts) {
    const profile = pocketFriendProfile(contact);
    if (!profile || contact.syncedOwnerId || contact.app) continue;
    const index = result.findIndex(person => person.id === contact.id || pocketFriendName(person.name) === pocketFriendName(profile.name));
    const previous = result[index];
    if (previous && JSON.stringify(pocketFriendProfile(previous)) === JSON.stringify(profile)) continue;
    const entry = { ...profile, id: previous?.id || contact.id, createdAt: previous?.createdAt || contact.createdAt, updatedAt: new Date().toISOString() };
    if (index < 0) result.push(entry); else result[index] = entry;
  }
  return result;
}

export function readPocketFriendLibrary(storage: LibraryStorage, currentPhoneKey: string): PocketFriendLibrary {
  try {
    const raw = storage.getItem(POCKET_FRIEND_LIBRARY_KEY);
    if (raw !== null) return { characters: parseLibrary(raw), storageWarning: "" };
    // Migrate once, including contacts created before the global library existed.
    // A saved empty library prevents deleted roles from returning on reload.
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => !!key && key.startsWith("renge_pocket_phone_v1:") && key !== currentPhoneKey).sort();
    let characters: PocketLibraryCharacter[] = [];
    for (const key of [...keys, currentPhoneKey]) {
      try { characters = mergePocketLibraryContacts(characters, pocketLibraryContacts(normalizePocketState(JSON.parse(storage.getItem(key) || "null")))); }
      catch { /* An invalid old phone must not block migration of other sessions. */ }
    }
    return writePocketFriendLibrary(storage, characters);
  } catch { return { characters: [], storageWarning: "角色库读取失败，原数据已保留。请保留当前页面。" }; }
}

export function loadPocketFriendLibrary(currentPhoneKey: string): PocketFriendLibrary {
  if (unsavedLibrary) return unsavedLibrary;
  let result;
  try { result = readPocketFriendLibrary(localStorage, currentPhoneKey); }
  catch { result = { characters: [], storageWarning: WARNING }; }
  if (result.storageWarning) unsavedLibrary = result;
  return result;
}

export function changePocketFriendLibrary(currentPhoneKey: string, change: (characters: PocketLibraryCharacter[]) => PocketLibraryCharacter[]): PocketFriendLibrary {
  const previous = loadPocketFriendLibrary(currentPhoneKey);
  // Preserve malformed persisted data instead of overwriting it with an empty list.
  if (previous.storageWarning.includes("读取失败")) return previous;
  const characters = change(previous.characters);
  let result;
  try { result = writePocketFriendLibrary(localStorage, characters); }
  catch { result = { characters, storageWarning: WARNING }; }
  unsavedLibrary = result.storageWarning ? result : undefined;
  window.dispatchEvent(new CustomEvent<PocketFriendLibrary>(CHANGED, { detail: result }));
  return result;
}

export function changedPocketLibraryContacts(previous: PocketState, next: PocketState) {
  const prior = new Map(pocketLibraryContacts(previous).map(person => [person.id, JSON.stringify(pocketFriendProfile(person))]));
  return pocketLibraryContacts(next).filter(person => prior.get(person.id) !== JSON.stringify(pocketFriendProfile(person)));
}

export function subscribePocketFriendLibrary(receive: (value: PocketFriendLibrary) => void) {
  const changed = (event: Event) => receive((event as CustomEvent<PocketFriendLibrary>).detail);
  const stored = (event: StorageEvent) => {
    if (event.storageArea !== localStorage || event.key !== POCKET_FRIEND_LIBRARY_KEY && event.key !== null) return;
    try { const characters = event.newValue === null ? [] : parseLibrary(event.newValue); unsavedLibrary = undefined; receive({ characters, storageWarning: "" }); }
    catch { /* Retain the mounted library if another window writes invalid data. */ }
  };
  window.addEventListener(CHANGED, changed); window.addEventListener("storage", stored);
  return () => { window.removeEventListener(CHANGED, changed); window.removeEventListener("storage", stored); };
}
