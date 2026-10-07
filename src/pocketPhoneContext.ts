import { buildPocketConversation, safePocketAvatar, type PocketContact, type PocketRequestMessage } from "./pocketPhoneState";
import { buildWorldBookPromptPlacements, insertWorldBookPromptAtDepth, type WorldBook } from "./worldbookUtils";

export type PocketContextMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  source?: "wechat" | "heartbeat" | "roleplay-greeting";
  extra?: Record<string, unknown>;
};
export type PocketMessageIdentity = {
  contactId: string;
  messageId: string;
  contactName: string;
  contactAvatar: string;
  userName: string;
};
export type PocketContextSync = (sessionId: string, previous: PocketContact[] | null, contacts: PocketContact[], nickname: string) => void;
export type PocketConversationBuilder = (sessionId: string, contact: PocketContact, user: { nickname: string; bio: string }) => PocketRequestMessage[];

export function getPocketMessageIdentity(message: Pick<PocketContextMessage, "source" | "extra">): PocketMessageIdentity | null {
  const value = message.extra?.pocketPhone;
  if (message.source !== "wechat" || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (![item.contactId, item.messageId, item.contactName, item.userName].every(value => typeof value === "string" && value)) return null;
  return { contactId: item.contactId as string, messageId: item.messageId as string, contactName: item.contactName as string, userName: item.userName as string, contactAvatar: safePocketAvatar(item.contactAvatar) };
}

export function formatPocketContextMessage(message: PocketContextMessage) {
  const identity = getPocketMessageIdentity(message);
  if (!identity) return message.content;
  const sender = message.role === "user" ? identity.userName : identity.contactName;
  const recipient = message.role === "user" ? identity.contactName : identity.userName;
  return `【微信 · ${sender} → ${recipient}】\n${message.content}`;
}

// Existing records keep their injection positions. A live update appends its new
// records; only a first import sorts the missing local history across contacts.
export function syncPocketContext<T extends PocketContextMessage>(history: T[], previous: PocketContact[] | null, contacts: PocketContact[], nickname: string): Array<T | PocketContextMessage> {
  const key = (contactId: string, messageId: string) => JSON.stringify([contactId, messageId]);
  const nextByKey = new Map(contacts.flatMap(contact => contact.messages.map(message => [key(contact.id, message.id), { contact, message }] as const)));
  const previousKeys = new Set(previous?.flatMap(contact => contact.messages.map(message => key(contact.id, message.id))) ?? []);
  const seen = new Set<string>();
  let changed = false;
  const next = history.flatMap(message => {
    const identity = getPocketMessageIdentity(message);
    if (!identity) return [message];
    const id = key(identity.contactId, identity.messageId);
    const match = nextByKey.get(id);
    if (!match && previousKeys.has(id)) { changed = true; return []; }
    if (!match) return [message]; // An empty local phone must not erase a restored session.
    if (seen.has(id)) { changed = true; return []; }
    seen.add(id);
    const updatedIdentity = { ...identity, contactName: match.contact.name, contactAvatar: match.contact.avatar, userName: nickname };
    if (message.content === match.message.content && message.role === match.message.role && JSON.stringify(identity) === JSON.stringify(updatedIdentity)) return [message];
    changed = true;
    return [{ ...message, role: match.message.role, content: match.message.content, extra: { ...message.extra, pocketPhone: updatedIdentity } }];
  });
  const missing = [...nextByKey].filter(([id]) => !seen.has(id)).map(([, match]) => match);
  if (previous === null) missing.sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt));
  const appended: PocketContextMessage[] = missing.map(({ contact, message }) => ({
    id: `pocket:${key(contact.id, message.id)}`, role: message.role, content: message.content, createdAt: message.createdAt,
    source: "wechat", extra: { pocketPhone: { contactId: contact.id, messageId: message.id, contactName: contact.name, contactAvatar: contact.avatar, userName: nickname } satisfies PocketMessageIdentity },
  }));
  return changed || appended.length ? [...next, ...appended] : history;
}

// Pi persists its own history. A changed shared timeline needs a fresh scope so
// the next request imports the ordered renderer history without interrupting a run.
export function pocketContextRevision(history: PocketContextMessage[]) {
  const shared = history.filter(message => getPocketMessageIdentity(message));
  if (!shared.length) return "";
  const value = JSON.stringify(shared.map(message => [message.id, message.role, message.content, message.extra?.pocketPhone]));
  let first = 2166136261; let second = 5381;
  for (let index = 0; index < value.length; index++) {
    first = Math.imul(first ^ value.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ value.charCodeAt(index);
  }
  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

export function buildSharedPocketConversation(contact: PocketContact, user: { nickname: string; bio: string }, history: PocketRequestMessage[], books: WorldBook[], activeBookIds: string[]): PocketRequestMessage[] {
  const placements = buildWorldBookPromptPlacements(books, activeBookIds, history, { userName: user.nickname, characterName: contact.name });
  const rolePrompt = buildPocketConversation(contact, user)[0].content;
  const systemPrompt = [
    placements.beforeCharacter, rolePrompt, placements.afterCharacter,
    placements.beforeExamples, placements.afterExamples, placements.beforeAuthorNote, placements.afterAuthorNote,
    "以下记录按注入顺序包含主会话和微信聊天。带【主会话】或其他微信联系人的记录是共享背景；你始终只扮演当前微信联系人，回复当前微信聊天中最近的用户消息。",
  ].filter(Boolean).join("\n\n");
  return insertWorldBookPromptAtDepth<PocketRequestMessage>([{ role: "system", content: systemPrompt }, ...history], placements.atDepth);
}
