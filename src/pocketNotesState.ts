import { renderPocketPrompt, type PocketPromptOverrides } from "./pocketPhonePrompts.ts";
import type { PocketContact, PocketPhoneOwner } from "./pocketPhoneState.ts";

export type PocketNote = { id: string; title: string; body: string; createdAt: string; wechatTime?: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function normalizePocketNotes(value: unknown): PocketNote[] {
  const ids = new Set<string>();
  return (Array.isArray(value) ? value : []).flatMap(note => {
    if (!object(note) || typeof note.id !== "string" || !note.id || ids.has(note.id) || typeof note.title !== "string" || typeof note.body !== "string" || !(note.title.trim() || note.body.trim())) return [];
    ids.add(note.id);
    return [{ id: note.id, title: note.title, body: note.body, createdAt: typeof note.createdAt === "string" ? note.createdAt : "",
      ...(typeof note.wechatTime === "string" && Number.isFinite(Date.parse(note.wechatTime)) ? { wechatTime: note.wechatTime } : {}) }];
  });
}

export function makePocketNote(title: string, body: string, wechatTime?: string): PocketNote {
  title = title.replace(/\r?\n/g, " ").trim(); body = body.trim();
  if (!title && !body) throw new Error("写一点内容再保存吧。");
  if (title.length > 80 || body.length > 6000) throw new Error("便签过长，标题最多 80 字，正文最多 6000 字。");
  return { id: crypto.randomUUID(), title: title || "新建便签", body, createdAt: new Date().toISOString(), ...(wechatTime ? { wechatTime } : {}) };
}

export const pocketNotesContextId = (ownerId: string) => `notes:${ownerId}`;
export const pocketNoteContent = (note: Pick<PocketNote, "title" | "body">) => `${note.title}\n${note.body}`;

// A virtual conversation lets notes use WeChat's ordered injection, revisions,
// tombstones and reverse synchronization without appearing in its contact list.
export function pocketNotesConversation(owner: PocketPhoneOwner, notes: PocketNote[]): PocketContact {
  return { id: pocketNotesContextId(owner.id), name: owner.name, nickname: owner.nickname, avatar: owner.avatar, personality: owner.personality,
    sourceCharacterCardId: owner.sourceCharacterCardId, phoneOwner: owner, app: "notes", greeting: "", sourceLabel: "便签", createdAt: notes[0]?.createdAt || "",
    contextCharacterCardIds: owner.sourceCharacterCardId ? [owner.sourceCharacterCardId] : [],
    messages: notes.map(note => ({ id: note.id, role: "assistant", content: pocketNoteContent(note), createdAt: note.createdAt, ...(note.wechatTime ? { wechatTime: note.wechatTime } : {}) })) };
}

export function pocketNotesGenerationPrompt(owner: PocketPhoneOwner, notes: PocketNote[], user: { nickname: string; bio: string }, prompts?: PocketPromptOverrides) {
  return renderPocketPrompt("notes.task", prompts, { char: owner.name, userProfile: JSON.stringify(user), notes: JSON.stringify(notes.map(note => ({ title: note.title, body: note.body }))) });
}

export function applyPocketNotesGeneration(notes: PocketNote[], raw: string, wechatTime: string): PocketNote[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("便签生成格式有误，请重试。"); }
  if (!object(parsed) || !Array.isArray(parsed.notes) || !parsed.notes.length || parsed.notes.length > 10) throw new Error("没有生成有效便签，请重试。");
  // Validate the entire response before changing storage or shared history.
  const added = parsed.notes.map(value => {
    if (!object(value) || typeof value.title !== "string" || typeof value.body !== "string") throw new Error("便签内容格式有误，请重试。");
    return makePocketNote(value.title, value.body, wechatTime);
  });
  const seen = new Set(notes.map(pocketNoteContent));
  const unique = added.filter(note => { const key = pocketNoteContent(note); if (seen.has(key)) return false; seen.add(key); return true; });
  if (!unique.length) throw new Error("生成的便签与已有内容重复，请重试。");
  return [...notes, ...unique];
}

export function applyPocketNoteChanges(notes: PocketNote[], changes: { messageId: string; content: string | null }[]): PocketNote[] {
  const byId = new Map(changes.map(change => [change.messageId, change.content]));
  let changed = false;
  const next = notes.flatMap(note => {
    if (!byId.has(note.id) || byId.get(note.id) === pocketNoteContent(note)) return [note];
    changed = true;
    const content = byId.get(note.id);
    if (content == null || !content.trim()) return [];
    const [title, ...body] = content.replace(/\r\n?/g, "\n").split("\n");
    return [{ ...note, title, body: body.join("\n") }];
  });
  return changed ? next : notes;
}
