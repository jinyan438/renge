import { normalizePocketPromptOverrides, renderPocketPrompt, type PocketPromptOverrides } from "./pocketPhonePrompts.ts";
import { normalizePocketInnerHistory, normalizePocketInnerState, type PocketInnerEntry, type PocketInnerState } from "./pocketPhoneInner.ts";
import { normalizePocketAttachment, normalizePocketWallet, type PocketAttachment, type PocketWallet } from "./pocketWechatMedia.ts";
import { normalizePocketWechatClock, type PocketWechatClock } from "./pocketWechatClock.ts";
import { normalizePocketNotes, pocketNotesConversation, type PocketNote } from "./pocketNotesState.ts";
import { normalizePocketMoments, pocketMomentsConversation, type PocketMoment, type PocketMomentContext } from "./pocketMomentsState.ts";

export type PocketMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  wechatTime?: string;
  replyContextMessageId?: string;
  generated?: true;
  speaker?: Pick<PocketContact, "id" | "name" | "avatar">;
  attachment?: PocketAttachment;
  moment?: PocketMomentContext;
};

export type PocketContact = {
  id: string;
  name: string;
  nickname?: string;
  avatar: string;
  personality: string;
  greeting: string;
  sourceLabel: string;
  sourceCharacterCardId?: string;
  sourceXiaohongshuActorId?: string;
  messages: PocketMessage[];
  createdAt: string;
  app?: "xiaohongshu" | "notes" | "moments";
  momentViewerIds?: string[];
  contextCharacterCardIds?: string[];
  innerState?: PocketInnerState;
  innerHistory?: PocketInnerEntry[];
  phoneOwner?: PocketPhoneOwner;
  syncedOwnerId?: string;
};

export type PocketPhoneOwner = Pick<PocketContact, "id" | "name" | "nickname" | "avatar" | "personality" | "sourceCharacterCardId"> & { userName?: string };
export type PocketCharacterPhone = { contacts: PocketContact[]; groups: PocketGroup[]; wallet: PocketWallet; notes?: PocketNote[]; userInnerState?: PocketInnerState; userInnerHistory?: PocketInnerEntry[] };

export type PocketGroupMember = Pick<PocketContact, "id" | "name" | "nickname" | "avatar" | "personality" | "sourceCharacterCardId" | "innerState">;
export function pocketDisplayName(person: { name: string; nickname?: string }) { return person.nickname?.trim() || person.name; }
export type PocketGroup = {
  id: string;
  name: string;
  members: PocketGroupMember[];
  messages: PocketMessage[];
  createdAt: string;
  replyContextMessageId?: string;
  innerHistory?: PocketInnerEntry[];
  phoneOwner?: PocketPhoneOwner;
};
export type PocketConversation = PocketContact | PocketGroup;
export function isPocketGroup(conversation: PocketConversation): conversation is PocketGroup { return "members" in conversation; }
export function pocketSpeakerName(conversation: PocketConversation, message: Pick<PocketMessage, "speaker">) {
  const member = isPocketGroup(conversation) ? conversation.members.find(member => member.id === message.speaker?.id) : undefined;
  return member?.nickname?.trim() || message.speaker?.name || pocketDisplayName(conversation);
}
export function getPocketConversations(state: PocketState): PocketConversation[] {
  return [...state.contacts, ...state.groups, ...(state.moments ? [pocketMomentsConversation(state.moments)] : []), ...Object.entries(state.characterPhones || {}).flatMap(([id, phone]) => {
    const owner = state.contacts.find(contact => contact.id === id);
    return owner ? [...[...phone.contacts, ...phone.groups].map(contact => ({ ...contact, phoneOwner: owner })), pocketNotesConversation(owner, phone.notes || [])] : [];
  })];
}

export type PocketTheme = "rose" | "mint" | "lavender";
export type PocketSettings = {
  theme: PocketTheme;
  nickname: string;
  providerId: string;
  modelId: string;
  largeText: boolean;
  /** Legacy session value, retained only for migration to global prompt settings. */
  promptOverrides?: PocketPromptOverrides;
};
export type PocketContextDeletion = { contactId: string; messageId: string };
export type PocketState = { version: 1; contacts: PocketContact[]; groups: PocketGroup[]; settings: PocketSettings; wallet: PocketWallet; notes?: PocketNote[]; moments?: PocketMoment[]; momentCovers?: Record<string, string>; deletedContextMessages: PocketContextDeletion[]; characterPhones?: Record<string, PocketCharacterPhone>; wechatClock?: PocketWechatClock };
export type PocketGenerationMode = "reply" | "proactive";
export type PocketRequestMessage = Pick<PocketMessage, "role" | "content"> | { role: "system"; content: string };

export const POCKET_EXTRACTED_AVATARS = ["game", "work", "mall", "gemini", "momo", "wind", "watermelon", "ssr", "croissant", "wxfeng", "fish"].map(name => `/xiaohongshu/avatar-${name}.jpg`);
export const POCKET_AVATARS = [...Array.from({ length: 20 }, (_, index) => `/touxiang/${index + 1}.png`), ...POCKET_EXTRACTED_AVATARS];
export const DEFAULT_POCKET_AVATAR = POCKET_AVATARS[0];
export const DEFAULT_POCKET_USER_AVATAR = POCKET_AVATARS[19];
const LEGACY_POCKET_AVATARS = ["🐰", "🐱", "🐻", "🦊", "🐼", "🐶", "🌷", "🍓", "🌙", "🧸", "🦋", "🍑"];
export const POCKET_THEMES: { id: PocketTheme; name: string; color: string; note: string }[] = [
  { id: "rose", name: "草莓奶霜", color: "#efb4c6", note: "一点点甜，刚刚好" },
  { id: "mint", name: "薄荷布丁", color: "#a9cfc1", note: "把清新的风装进口袋" },
  { id: "lavender", name: "芋泥云朵", color: "#c3b4e2", note: "做一个软绵绵的梦" },
];

export function pocketId() {
  return crypto.randomUUID();
}

export function emptyPocketState(): PocketState {
  return { version: 1, contacts: [], groups: [], settings: { theme: "rose", nickname: "", providerId: "", modelId: "", largeText: false }, wallet: { balance: 0, bills: [] }, deletedContextMessages: [] };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown) { return typeof value === "string" ? value : ""; }

function normalizeMessages(value: unknown, group = false): PocketMessage[] {
  const ids = new Set<string>();
  return (Array.isArray(value) ? value : []).flatMap(message => {
    if (!record(message) || !text(message.id) || ids.has(text(message.id)) || !text(message.content).trim() || (message.role !== "user" && message.role !== "assistant")) return [];
    const speaker = group && message.role === "assistant" && record(message.speaker) && text(message.speaker.id) && text(message.speaker.name).trim()
      ? { id: text(message.speaker.id), name: text(message.speaker.name).trim().slice(0, 30), avatar: safePocketAvatar(message.speaker.avatar) } : undefined;
    if (group && message.role === "assistant" && !speaker) return [];
    ids.add(text(message.id));
    const attachment = normalizePocketAttachment(message.attachment);
    return [{ id: text(message.id), role: message.role, content: text(message.content), createdAt: text(message.createdAt),
      ...(text(message.wechatTime) && Number.isFinite(Date.parse(text(message.wechatTime))) ? { wechatTime: text(message.wechatTime) } : {}),
      ...(typeof message.replyContextMessageId === "string" ? { replyContextMessageId: message.replyContextMessageId } : {}),
      // Older simulated user replies kept their generation marker when mirrored.
      ...(message.generated === true || message.role === "user" && typeof message.replyContextMessageId === "string" ? { generated: true as const } : {}),
      ...(speaker ? { speaker } : {}),
      ...(attachment ? { attachment } : {}),
    }];
  });
}

export function safePocketAvatar(value: unknown) {
  const avatar = text(value);
  if (POCKET_AVATARS.includes(avatar) || /^(data:image\/(?:png|jpeg|webp|gif);base64,|\/api\/app-data\/assets\/)/i.test(avatar)) return avatar;
  // Restore old contacts and group speakers with image avatars, preserving
  // distinct choices without displaying the retired emoji options.
  const legacyIndex = LEGACY_POCKET_AVATARS.indexOf(avatar);
  return legacyIndex >= 0 ? POCKET_AVATARS[legacyIndex] : DEFAULT_POCKET_AVATAR;
}

export function normalizePocketState(value: unknown): PocketState {
  const state = emptyPocketState();
  if (!record(value) || value.version !== 1) return state;
  if (Array.isArray(value.moments)) state.moments = normalizePocketMoments(value.moments);
  if (record(value.momentCovers)) state.momentCovers = Object.fromEntries(Object.entries(value.momentCovers).filter(([, url]) => typeof url === "string" && /^(data:image\/(?:png|jpeg|webp|gif);base64,|\/api\/app-data\/assets\/|https?:\/\/)/i.test(url))) as Record<string, string>;
  state.wallet = normalizePocketWallet(value.wallet);
  const wechatClock = normalizePocketWechatClock(value.wechatClock);
  if (wechatClock) state.wechatClock = wechatClock;
  const deletedKeys = new Set<string>();
  state.deletedContextMessages = (Array.isArray(value.deletedContextMessages) ? value.deletedContextMessages : []).flatMap(item => {
    if (!record(item) || !text(item.contactId) || !text(item.messageId)) return [];
    const key = JSON.stringify([item.contactId, item.messageId]);
    if (deletedKeys.has(key)) return [];
    deletedKeys.add(key);
    return [{ contactId: text(item.contactId), messageId: text(item.messageId) }];
  });
  if (record(value.settings)) {
    const settings = value.settings;
    const promptOverrides = normalizePocketPromptOverrides(settings.promptOverrides);
    state.settings = {
      theme: POCKET_THEMES.some(theme => theme.id === settings.theme) ? settings.theme as PocketTheme : "rose",
      nickname: text(settings.nickname).slice(0, 24),
      providerId: text(settings.providerId), modelId: text(settings.modelId), largeText: settings.largeText === true,
      ...(Object.keys(promptOverrides).length ? { promptOverrides } : {}),
    };
  }
  const contactIds = new Set<string>();
  for (const contact of Array.isArray(value.contacts) ? value.contacts : []) {
    if (!record(contact) || !text(contact.id) || !text(contact.name).trim() || contactIds.has(text(contact.id))) continue;
    contactIds.add(text(contact.id));
    const messages = normalizeMessages(contact.messages);
    const innerState = normalizePocketInnerState(contact.innerState);
    const innerHistory = normalizePocketInnerHistory(contact.innerHistory, safePocketAvatar);
    state.contacts.push({
      id: text(contact.id), name: text(contact.name).trim().slice(0, 30), avatar: safePocketAvatar(contact.avatar),
      personality: text(contact.personality), greeting: text(contact.greeting), sourceLabel: text(contact.sourceLabel),
      ...(text(contact.nickname).trim() ? { nickname: text(contact.nickname).trim().slice(0, 30) } : {}),
      ...(text(contact.sourceCharacterCardId) ? { sourceCharacterCardId: text(contact.sourceCharacterCardId) } : {}),
      ...(text(contact.sourceXiaohongshuActorId) ? { sourceXiaohongshuActorId: text(contact.sourceXiaohongshuActorId) } : {}),
      ...(Array.isArray(contact.contextCharacterCardIds) ? { contextCharacterCardIds: contact.contextCharacterCardIds.filter((id): id is string => typeof id === "string" && !!id) } : {}),
      messages, createdAt: text(contact.createdAt),
      ...(innerState ? { innerState } : {}), ...(innerHistory.length ? { innerHistory } : {}),
    });
  }
  for (const group of Array.isArray(value.groups) ? value.groups : []) {
    if (!record(group) || !text(group.id) || !text(group.name).trim() || contactIds.has(text(group.id))) continue;
    const memberIds = new Set<string>();
    const members: PocketGroupMember[] = (Array.isArray(group.members) ? group.members : []).flatMap(member => {
      if (!record(member) || !text(member.id) || !text(member.name).trim() || memberIds.has(text(member.id))) return [];
      memberIds.add(text(member.id));
      const innerState = normalizePocketInnerState(member.innerState);
      return [{ id: text(member.id), name: text(member.name).trim().slice(0, 30), avatar: safePocketAvatar(member.avatar), personality: text(member.personality),
        ...(text(member.nickname).trim() ? { nickname: text(member.nickname).trim().slice(0, 30) } : {}),
        ...(innerState ? { innerState } : {}),
        ...(text(member.sourceCharacterCardId) ? { sourceCharacterCardId: text(member.sourceCharacterCardId) } : {}),
      }];
    });
    if (!members.length) continue;
    contactIds.add(text(group.id));
    const innerHistory = normalizePocketInnerHistory(group.innerHistory, safePocketAvatar);
    state.groups.push({ id: text(group.id), name: text(group.name).trim().slice(0, 30), members, messages: normalizeMessages(group.messages, true), createdAt: text(group.createdAt),
      ...(typeof group.replyContextMessageId === "string" ? { replyContextMessageId: group.replyContextMessageId } : {}),
      ...(innerHistory.length ? { innerHistory } : {}),
    });
  }
  if (record(value.characterPhones)) {
    state.characterPhones = {};
    const usedIds = new Set([...state.contacts, ...state.groups].map(contact => contact.id));
    for (const [ownerId, phone] of Object.entries(value.characterPhones)) {
      if (!record(phone) || !state.contacts.some(contact => contact.id === ownerId)) continue;
      const normalized = normalizePocketState({ version: 1, contacts: phone.contacts, groups: phone.groups, wallet: phone.wallet });
      const unique = <T extends PocketConversation>(items: T[]) => items.filter(item => { if (usedIds.has(item.id)) return false; usedIds.add(item.id); return true; });
      state.characterPhones[ownerId] = { contacts: unique(normalized.contacts), groups: unique(normalized.groups), wallet: normalized.wallet, notes: normalizePocketNotes(phone.notes),
        userInnerState: normalizePocketInnerState(phone.userInnerState), userInnerHistory: normalizePocketInnerHistory(phone.userInnerHistory, safePocketAvatar) };
    }
  }
  return state;
}

export function pocketStorageKey(sessionId: string) { return `renge_pocket_phone_v1:${sessionId || "default"}`; }

export function getPocketPendingMessages(contact: { messages: PocketMessage[]; replyContextMessageId?: string }): PocketMessage[] {
  let latestAssistant = -1;
  contact.messages.forEach((message, index) => { if (message.role === "assistant") latestAssistant = index; });
  const assistant = contact.messages[latestAssistant];
  // A message sent while generation is running was not in that reply's context.
  // Older replies without this marker covered all messages preceding them.
  const marker = "members" in contact ? contact.replyContextMessageId ?? "" : assistant?.replyContextMessageId;
  const covered = typeof marker === "string"
    ? contact.messages.findIndex(message => message.id === marker)
    : latestAssistant;
  return contact.messages.filter((message, index) => message.role === "user" && index > covered);
}

export function getPocketGenerationMode(contact: Pick<PocketContact, "messages">): PocketGenerationMode {
  return getPocketPendingMessages(contact).length ? "reply" : "proactive";
}

export function getPocketMessageBubbles(message: Pick<PocketMessage, "role" | "content" | "attachment" | "generated">): string[] {
  if (message.attachment) return [message.content];
  if (message.role === "user" && !message.generated || /```|~~~/.test(message.content)) return [message.content];
  const lines = message.content.replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).filter(Boolean);
  // Keep lists, tables and other structured replies together.
  if (lines.some(line => /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/.test(line))) return [message.content];
  return lines;
}

export function getPocketConversationBubbles(conversation: PocketConversation, message: PocketMessage): string[] {
  // Mirroring changes which side sends a message, but its original formatting
  // still applies: generated replies split, while manual line breaks stay.
  const role = !isPocketGroup(conversation) && conversation.syncedOwnerId
    ? message.role === "user" ? "assistant" : "user"
    : message.role;
  return getPocketMessageBubbles({ ...message, role });
}

export function makePocketContact(input: Pick<PocketContact, "name" | "nickname" | "avatar" | "personality" | "greeting" | "sourceLabel" | "sourceCharacterCardId">): PocketContact {
  if (!input.name.trim()) throw new Error("给这位朋友起个名字吧。");
  if (!input.personality.trim()) throw new Error("写一点角色设定，让 TA 更了解自己吧。");
  const createdAt = new Date().toISOString();
  const { nickname, ...details } = input;
  return {
    ...details, id: pocketId(), name: input.name.trim().slice(0, 30), avatar: safePocketAvatar(input.avatar),
    ...(nickname?.trim() ? { nickname: nickname.trim().slice(0, 30) } : {}),
    personality: input.personality.trim(), greeting: input.greeting.trim(), createdAt,
    messages: input.greeting.trim() ? [{ id: pocketId(), role: "assistant", content: input.greeting.trim(), createdAt }] : [],
  };
}

export function resetPocketContactChat(contact: PocketContact, nickname: string): PocketContact {
  const greeting = contact.greeting.trim().replace(/\{\{char\}\}/gi, contact.name).replace(/\{\{user\}\}/gi, nickname);
  const { innerHistory: _innerHistory, innerState: _innerState, ...profile } = contact;
  return { ...profile, messages: greeting ? [{ id: pocketId(), role: "assistant", content: greeting, createdAt: new Date().toISOString() }] : [] };
}

export function buildPocketConversation(contact: PocketContact, user: { nickname: string; bio: string }, prompts?: PocketPromptOverrides): PocketRequestMessage[] {
  const nickname = user.nickname.trim() || "我";
  const expand = (value: string) => value.replace(/\{\{char\}\}/gi, contact.name).replace(/\{\{user\}\}/gi, nickname);
  return [
    { role: "system", content: renderPocketPrompt("wechat.role", prompts, { char: contact.name, user: nickname,
      nicknameInfo: contact.nickname ? `你的微信昵称是「${pocketDisplayName(contact)}」，角色名称是「${contact.name}」。两个名字指向同一人物，保持原有身份、人设与关系。` : "",
      personality: expand(contact.personality), userBio: user.bio.trim() ? `对方的个人简介：\n${user.bio.trim()}` : "" }) },
    ...contact.messages.slice(-60).map(message => ({ role: message.role, content: expand(message.content) })),
  ];
}
