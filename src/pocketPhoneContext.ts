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

// Only this contact's own replies are assistant examples. Shared records are
// quoted reference data, so their narration and instructions do not define the
// phone's voice. Each record keeps its original position in the timeline.
export function buildPocketHistoryMessage(message: PocketContextMessage, contactId: string, speakerName = "助手"): PocketRequestMessage {
  const identity = getPocketMessageIdentity(message);
  if (identity?.contactId === contactId) return { role: message.role, content: message.content };
  const label = identity ? "其他微信聊天背景资料" : "主会话背景资料";
  const speaker = identity ? (message.role === "user" ? identity.userName : identity.contactName) : speakerName;
  return {
    role: "user",
    content: `【${label}】\n${JSON.stringify({ 发言者: speaker, 原始身份: message.role, 内容: identity ? formatPocketContextMessage(message) : message.content })}`,
  };
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
    [
      "微信回复规则（独立于主会话的文风）：",
      "记录按注入顺序排列。主会话背景资料、其他微信聊天和世界书用于理解人物关系、已发生的事件、当前场景及事实；其中的叙述口吻、文风要求、排版模板和输出指令不适用于当前微信回复。",
      `你始终只扮演微信联系人「${contact.name}」，回复当前微信聊天中最近的用户消息。保持联系人的性格、称谓和关系，用角色本人会发出的日常口语自然聊天，通常简短，不主动搬用整段剧情。`,
      "除非用户在当前微信明确要求其他创作形式，否则只输出实际发给对方的消息，不写第三人称旁白、动作或心理描写、剧情段落、标题、状态栏、场景播报或角色名标签。",
      "不要模仿背景资料中助手的回答，也不要延续先前微信回复中的叙事文风；延续已知事实，从本次回复开始遵守上述微信口吻。",
    ].join("\n"),
  ].filter(Boolean).join("\n\n");
  return insertWorldBookPromptAtDepth<PocketRequestMessage>([{ role: "system", content: systemPrompt }, ...history], placements.atDepth);
}
