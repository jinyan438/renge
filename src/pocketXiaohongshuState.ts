import { POCKET_AVATARS, safePocketAvatar, type PocketContextDeletion } from "./pocketPhoneState";

export const RED_PROFILE_TONES = ["ocean", "forest", "sunset", "violet"] as const;
export type RedActorProfile = { handle: string; bio: string; gender: string; age: number; location: string; following: number; followers: number; receivedLikes: number; background: typeof RED_PROFILE_TONES[number] };
export type RedActor = { id: string; name: string; nickname?: string; avatar: string; personality: string; sourceCharacterCardId?: string; origin?: "community"; profile?: RedActorProfile };
export type RedNote = {
  id: string; title: string; content: string; tags: string[]; images: string[];
  author: string; avatar: string; authorId?: string; generated?: boolean; createdAt?: string;
  likes: number; saves: number; comments: number; category: string; location: string; time: string;
  coverText?: string; coverTone?: RedCoverTone; music?: string; activity?: string;
};
export type RedComment = {
  id: string; noteId: string; author: string; avatar: string; content: string;
  time: string; location: string; likes: number; authorLiked?: boolean;
  isAuthor?: boolean; parentId?: string; actorId?: string; generated?: boolean; createdAt?: string;
  replyToId?: string; responseToId?: string;
};
export const RED_COVER_TONES = ["mint", "cream", "rose", "blue", "lavender", "white"] as const;
export type RedCoverTone = typeof RED_COVER_TONES[number];
export const RED_CONTEXT_ID = "__renge_xiaohongshu_feed__";
export type RedState = {
  version: 2; liked: string[]; saved: string[]; followed: string[]; likedComments: string[];
  hidden: string[]; history: string[]; notes: RedNote[]; comments: RedComment[];
  actors: RedActor[]; deletedContextMessages: PocketContextDeletion[];
  pendingReplies: string[]; selectedRoleIds: string[];
};

export function emptyRedState(): RedState {
  return { version: 2, liked: [], saved: [], followed: [], likedComments: [], hidden: [], history: [], notes: [], comments: [], actors: [], deletedContextMessages: [], pendingReplies: [], selectedRoleIds: [] };
}
// Keep the storage key so existing user-published notes migrate in place.
export function redStorageKey(sessionId: string) { return `renge_pocket_red_v1:${sessionId || "default"}`; }
export function toggleRedItem(items: string[], id: string) { return items.includes(id) ? items.filter(item => item !== id) : [...items, id]; }
export function randomRedAvatar(random: () => number = Math.random) { return POCKET_AVATARS[Math.min(POCKET_AVATARS.length - 1, Math.max(0, Math.floor(random() * POCKET_AVATARS.length)))]; }
export function safeRedImage(value: unknown): value is string {
  return typeof value === "string" && (POCKET_AVATARS.includes(value) || /^\/api\/app-data\/assets\/[\w.-]+$/.test(value) || /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z\d+/=\s]+$/i.test(value));
}
export function redText(value: unknown, limit = 3000) { return typeof value === "string" ? value.trim().slice(0, limit) : ""; }
export function redActorNickname(actor: Pick<RedActor, "id" | "name" | "nickname">): string {
  const nickname = redText(actor.nickname, 30);
  if (nickname && nickname !== actor.name) return nickname;
  // Stable account names also cover previously saved people before their next generation.
  const names = ["云朵收集员", "橘子汽水", "晚风来信", "山间听雨", "一颗小青柠", "月亮邮递员", "半颗草莓", "睡不醒的猫", "落日放映室", "慢慢生长"];
  const hash = [...actor.id].reduce((value, char) => (Math.imul(value, 31) + char.codePointAt(0)!) >>> 0, 0);
  return `${names[hash % names.length]}${100 + hash % 900}`;
}
export function redCount(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? Math.min(1_000_000, Math.max(0, Math.floor(value))) : 0; }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function redActorProfile(value: unknown, id: string): RedActorProfile {
  const raw = record(value) ? value : {};
  const handle = redText(raw.handle, 24);
  return { handle: /^[a-z\d_]{3,24}$/i.test(handle) ? handle : `red_${id.replace(/[^a-z\d]/gi, "").slice(-8)}`, bio: redText(raw.bio, 200), gender: redText(raw.gender, 10), age: Math.min(120, redCount(raw.age)), location: redText(raw.location, 30), following: redCount(raw.following), followers: redCount(raw.followers), receivedLikes: redCount(raw.receivedLikes), background: RED_PROFILE_TONES.includes(raw.background as RedActorProfile["background"]) ? raw.background as RedActorProfile["background"] : "ocean" };
}
export function isRedCommunityActor(actor: Pick<RedActor, "id" | "origin">) { return actor.origin === "community" || actor.id.startsWith("community:") || /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(actor.id); }

export function normalizeRedState(value: unknown): RedState {
  const state = emptyRedState();
  if (!record(value) || ![1, 2].includes(Number(value.version))) return state;
  const legacy = value.version === 1;
  state.selectedRoleIds = [...new Set((Array.isArray(value.selectedRoleIds) ? value.selectedRoleIds : []).map(id => redText(id, 100)).filter(Boolean))];
  const retired = new Set(["game", "mall", "work", "gemini"]);
  const seenActors = new Set<string>();
  for (const actor of Array.isArray(value.actors) ? value.actors : []) {
    if (!record(actor)) continue;
    const id = redText(actor.id, 100); const name = redText(actor.name, 30);
    if (!id || !name || seenActors.has(id)) continue;
    seenActors.add(id);
    state.actors.push({ id, name, nickname: redActorNickname({ id, name, nickname: redText(actor.nickname, 30) }), avatar: safeRedImage(actor.avatar) ? actor.avatar : randomRedAvatar(), personality: redText(actor.personality, 6000), ...(redText(actor.sourceCharacterCardId, 100) ? { sourceCharacterCardId: redText(actor.sourceCharacterCardId, 100) } : {}), ...(isRedCommunityActor({ id, origin: actor.origin === "community" ? "community" : undefined }) ? { origin: "community" as const } : {}), ...(record(actor.profile) ? { profile: redActorProfile(actor.profile, id) } : {}) });
  }
  const seenNotes = new Set<string>();
  for (const note of Array.isArray(value.notes) ? value.notes : []) {
    if (!record(note)) continue;
    const id = redText(note.id, 100); const title = redText(note.title, 40);
    if (!id || !title || seenNotes.has(id) || legacy && retired.has(id)) continue;
    seenNotes.add(id);
    const actor = state.actors.find(actor => actor.id === note.authorId);
    state.notes.push({
      id, title, content: redText(note.content), images: (Array.isArray(note.images) ? note.images : []).filter(safeRedImage).slice(0, 9),
      tags: [...new Set((Array.isArray(note.tags) ? note.tags : []).map(tag => redText(tag, 30)).filter(Boolean))].slice(0, 10),
      author: actor ? redActorNickname(actor) : redText(note.author, 30) || "我", avatar: actor?.avatar || safePocketAvatar(note.avatar),
      ...(actor ? { authorId: actor.id } : note.authorId === "self" ? { authorId: "self" } : {}),
      generated: !legacy && note.generated === true, createdAt: redText(note.createdAt, 50) || "",
      likes: redCount(note.likes), saves: redCount(note.saves), comments: 0,
      category: redText(note.category, 20) || "生活", location: redText(note.location, 30), time: redText(note.time, 50) || "刚刚",
      ...(redText(note.coverText, 120) ? { coverText: redText(note.coverText, 120) } : {}),
      coverTone: RED_COVER_TONES.includes(note.coverTone as RedCoverTone) ? note.coverTone as RedCoverTone : "cream",
      ...(redText(note.music, 50) ? { music: redText(note.music, 50) } : {}), ...(redText(note.activity, 50) ? { activity: redText(note.activity, 50) } : {}),
    });
  }
  const seenComments = new Set<string>();
  for (const comment of Array.isArray(value.comments) ? value.comments : []) {
    if (!record(comment)) continue;
    const id = redText(comment.id, 100); const noteId = redText(comment.noteId, 100); const content = redText(comment.content, 1000);
    if (!id || !content || seenComments.has(id) || !seenNotes.has(noteId)) continue;
    seenComments.add(id);
    const actor = state.actors.find(actor => actor.id === comment.actorId);
    state.comments.push({ id, noteId, content, author: actor ? redActorNickname(actor) : redText(comment.author, 30) || "我", avatar: actor?.avatar || safePocketAvatar(comment.avatar), time: redText(comment.time, 50) || "刚刚", location: redText(comment.location, 30), likes: redCount(comment.likes), generated: !legacy && comment.generated === true, createdAt: redText(comment.createdAt, 50), ...(actor ? { actorId: actor.id } : comment.actorId === "self" ? { actorId: "self" } : {}), ...(comment.isAuthor === true ? { isAuthor: true } : {}), ...(comment.authorLiked === true ? { authorLiked: true } : {}), ...(redText(comment.parentId, 100) ? { parentId: redText(comment.parentId, 100) } : {}), ...(redText(comment.replyToId, 100) ? { replyToId: redText(comment.replyToId, 100) } : {}), ...(redText(comment.responseToId, 100) ? { responseToId: redText(comment.responseToId, 100) } : {}) });
  }
  state.comments = state.comments.filter(comment => !comment.parentId || state.comments.some(parent => parent.id === comment.parentId && parent.noteId === comment.noteId && !parent.parentId));
  for (const key of ["liked", "saved", "followed", "likedComments", "hidden", "history"] as const) {
    const items = [...new Set((Array.isArray(value[key]) ? value[key] : []).filter((id): id is string => typeof id === "string" && id.length <= 200))];
    state[key] = key === "followed" ? [...new Set(items.map(name => { const actor = state.actors.find(actor => actor.name === name || actor.id === name || actor.nickname === name); return actor ? redActorNickname(actor) : name; }))] : items.filter(id => key === "likedComments" ? state.comments.some(comment => comment.id === id) : seenNotes.has(id));
  }
  state.deletedContextMessages = (Array.isArray(value.deletedContextMessages) ? value.deletedContextMessages : []).flatMap(item => record(item) && item.contactId === RED_CONTEXT_ID && redText(item.messageId, 120) ? [{ contactId: RED_CONTEXT_ID, messageId: redText(item.messageId, 120) }] : []);
  state.pendingReplies = [...new Set((Array.isArray(value.pendingReplies) ? value.pendingReplies : []).filter((id): id is string => typeof id === "string" && state.comments.some(comment => comment.id === id && !comment.generated) && !state.comments.some(comment => comment.responseToId === id)))];
  return state;
}
