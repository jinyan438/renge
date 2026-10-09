import { renderPocketPrompt, type PocketPromptOverrides } from "./pocketPhonePrompts.ts";
import { DEFAULT_POCKET_AVATAR, type PocketContact, type PocketMessage, type PocketRequestMessage } from "./pocketPhoneState";
import { emptyRedState, RED_CONTEXT_ID, type RedState } from "./pocketXiaohongshuState";
import { buildWorldBookPromptPlacements, insertWorldBookPromptAtDepth, type WorldBook } from "./worldbookUtils";

export function redContextConversation(state: RedState): PocketContact {
  const messages: PocketMessage[] = [
    ...[...state.notes].reverse().map(note => ({ id: `note:${note.id}`, role: note.generated ? "assistant" as const : "user" as const, content: `${note.title}\n\n${note.content}${note.tags.length ? `\n\n${note.tags.map(tag => `#${tag}`).join(" ")}` : ""}`, createdAt: note.createdAt || "", speaker: { id: note.authorId || "self", name: note.author, avatar: note.avatar } })),
    ...state.comments.map(comment => {
      const note = state.notes.find(note => note.id === comment.noteId)!;
      const target = state.comments.find(target => target.id === (comment.replyToId || comment.parentId));
      return { id: `comment:${comment.id}`, role: comment.generated ? "assistant" as const : "user" as const, content: `在《${note.title}》下${target ? `回复 ${target.author}` : "评论"}\n\n${comment.content}`, createdAt: comment.createdAt || "", speaker: { id: comment.actorId || "self", name: comment.author, avatar: comment.avatar } };
    }),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { id: RED_CONTEXT_ID, app: "xiaohongshu", name: "小红书", avatar: DEFAULT_POCKET_AVATAR, personality: "", greeting: "", sourceLabel: "小红书", messages, createdAt: "" };
}

export function buildSharedRedConversation(contact: PocketContact, user: { nickname: string; bio: string }, history: PocketRequestMessage[], books: WorldBook[], activeIds: string[], prompts?: PocketPromptOverrides): PocketRequestMessage[] {
  const placements = buildWorldBookPromptPlacements(books, activeIds, history, { userName: user.nickname, characterName: contact.name });
  const prompt = [
    placements.beforeCharacter, renderPocketPrompt("red.role", prompts), contact.personality,
    user.bio.trim() ? `用户「${user.nickname}」的个人简介：${user.bio.trim()}` : "",
    placements.afterCharacter, placements.beforeExamples, placements.afterExamples, placements.beforeAuthorNote, placements.afterAuthorNote,
    renderPocketPrompt("red.rules", prompts, { user: user.nickname }),
  ].filter(Boolean).join("\n\n");
  const messages = insertWorldBookPromptAtDepth<PocketRequestMessage>([{ role: "system", content: prompt }, ...history], placements.atDepth);
  messages.push({ role: "user", content: renderPocketPrompt("red.invoke", prompts) });
  return messages;
}

export type RedContextChange = { contactId: string; messageId: string; content: string | null };
export function clearRedContent(state: RedState): RedState {
  const deleted = [...state.deletedContextMessages, ...redContextConversation(state).messages.map(message => ({ contactId: RED_CONTEXT_ID, messageId: message.id }))];
  return { ...emptyRedState(), actors: state.actors, selectedRoleIds: state.selectedRoleIds, deletedContextMessages: [...new Map(deleted.map(item => [item.messageId, item])).values()] };
}
export function applyRedContextChanges(state: RedState, changes: RedContextChange[]): RedState {
  const relevant = changes.filter(change => change.contactId === RED_CONTEXT_ID);
  if (!relevant.length) return state;
  const map = new Map(relevant.map(change => [change.messageId, change.content]));
  let changed = false;
  const notes = state.notes.flatMap(note => {
    const key = `note:${note.id}`;
    if (!map.has(key)) return [note];
    changed = true; const content = map.get(key);
    if (content === null) return [];
    const [title, ...body] = content!.split("\n");
    let text = body.join("\n").trim();
    const tagLine = text.split("\n").at(-1) || "";
    const tags = /^#[^\n]+$/.test(tagLine) ? [...new Set([...tagLine.matchAll(/#([^\s#]+)/g)].map(match => match[1]))] : note.tags;
    if (/^#[^\n]+$/.test(tagLine)) text = text.slice(0, -tagLine.length).trim();
    return [{ ...note, title: title.trim().slice(0, 40) || note.title, content: text, tags }];
  });
  const ids = new Set(notes.map(note => note.id));
  const comments = state.comments.flatMap(comment => {
    if (!ids.has(comment.noteId)) { changed = true; return []; }
    const key = `comment:${comment.id}`;
    if (!map.has(key)) return [comment];
    changed = true; const content = map.get(key);
    if (content === null) return [];
    const separator = content!.indexOf("\n\n");
    return [{ ...comment, content: separator >= 0 && content!.startsWith("在《") ? content!.slice(separator + 2) : content! }];
  }).map(comment => comment.parentId && !state.comments.some(parent => parent.id === comment.parentId && map.get(`comment:${parent.id}`) !== null) ? { ...comment, parentId: undefined } : comment);
  if (!changed) return state;
  const remaining = new Set([...notes.map(note => `note:${note.id}`), ...comments.map(comment => `comment:${comment.id}`)]);
  const deleted = redContextConversation(state).messages.filter(message => !remaining.has(message.id)).map(message => ({ contactId: RED_CONTEXT_ID, messageId: message.id }));
  const markers = [...state.deletedContextMessages, ...deleted].filter((item, index, all) => all.findIndex(other => other.messageId === item.messageId) === index);
  return { ...state, notes, comments, deletedContextMessages: markers, pendingReplies: state.pendingReplies.filter(id => comments.some(comment => comment.id === id)), liked: state.liked.filter(id => ids.has(id)), saved: state.saved.filter(id => ids.has(id)), hidden: state.hidden.filter(id => ids.has(id)), history: state.history.filter(id => ids.has(id)) };
}
