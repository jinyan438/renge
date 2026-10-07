export type PocketMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  replyContextMessageId?: string;
};

export type PocketContact = {
  id: string;
  name: string;
  avatar: string;
  personality: string;
  greeting: string;
  sourceLabel: string;
  sourceCharacterCardId?: string;
  messages: PocketMessage[];
  createdAt: string;
};

export type PocketTheme = "rose" | "mint" | "lavender";
export type PocketSettings = {
  theme: PocketTheme;
  nickname: string;
  providerId: string;
  modelId: string;
  largeText: boolean;
};
export type PocketState = { version: 1; contacts: PocketContact[]; settings: PocketSettings };
export type PocketGenerationMode = "reply" | "proactive";
export type PocketRequestMessage = Pick<PocketMessage, "role" | "content"> | { role: "system"; content: string };

export const POCKET_AVATARS = ["🐰", "🐱", "🐻", "🦊", "🐼", "🐶", "🌷", "🍓", "🌙", "🧸", "🦋", "🍑"];
export const POCKET_THEMES: { id: PocketTheme; name: string; color: string; note: string }[] = [
  { id: "rose", name: "草莓奶霜", color: "#efb4c6", note: "一点点甜，刚刚好" },
  { id: "mint", name: "薄荷布丁", color: "#a9cfc1", note: "把清新的风装进口袋" },
  { id: "lavender", name: "芋泥云朵", color: "#c3b4e2", note: "做一个软绵绵的梦" },
];

export function pocketId() {
  return crypto.randomUUID();
}

export function emptyPocketState(): PocketState {
  return { version: 1, contacts: [], settings: { theme: "rose", nickname: "", providerId: "", modelId: "", largeText: false } };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown) { return typeof value === "string" ? value : ""; }

export function safePocketAvatar(value: unknown) {
  const avatar = text(value);
  return POCKET_AVATARS.includes(avatar) || /^(data:image\/(?:png|jpeg|webp|gif);base64,|\/api\/app-data\/assets\/)/i.test(avatar) ? avatar : "🐰";
}

export function normalizePocketState(value: unknown): PocketState {
  const state = emptyPocketState();
  if (!record(value) || value.version !== 1) return state;
  if (record(value.settings)) {
    const settings = value.settings;
    state.settings = {
      theme: POCKET_THEMES.some(theme => theme.id === settings.theme) ? settings.theme as PocketTheme : "rose",
      nickname: text(settings.nickname).slice(0, 24),
      providerId: text(settings.providerId), modelId: text(settings.modelId), largeText: settings.largeText === true,
    };
  }
  const contactIds = new Set<string>();
  for (const contact of Array.isArray(value.contacts) ? value.contacts : []) {
    if (!record(contact) || !text(contact.id) || !text(contact.name).trim() || contactIds.has(text(contact.id))) continue;
    contactIds.add(text(contact.id));
    const messageIds = new Set<string>();
    const messages: PocketMessage[] = [];
    for (const message of Array.isArray(contact.messages) ? contact.messages : []) {
      if (!record(message) || !text(message.id) || messageIds.has(text(message.id)) || !text(message.content).trim() || (message.role !== "user" && message.role !== "assistant")) continue;
      messageIds.add(text(message.id));
      messages.push({ id: text(message.id), role: message.role, content: text(message.content), createdAt: text(message.createdAt), ...(message.role === "assistant" && typeof message.replyContextMessageId === "string" ? { replyContextMessageId: message.replyContextMessageId } : {}) });
    }
    state.contacts.push({
      id: text(contact.id), name: text(contact.name).trim().slice(0, 30), avatar: safePocketAvatar(contact.avatar),
      personality: text(contact.personality), greeting: text(contact.greeting), sourceLabel: text(contact.sourceLabel),
      ...(text(contact.sourceCharacterCardId) ? { sourceCharacterCardId: text(contact.sourceCharacterCardId) } : {}),
      messages, createdAt: text(contact.createdAt),
    });
  }
  return state;
}

export function pocketStorageKey(sessionId: string) { return `renge_pocket_phone_v1:${sessionId || "default"}`; }

export function getPocketPendingMessages(contact: Pick<PocketContact, "messages">): PocketMessage[] {
  let latestAssistant = -1;
  contact.messages.forEach((message, index) => { if (message.role === "assistant") latestAssistant = index; });
  const assistant = contact.messages[latestAssistant];
  // A message sent while generation is running was not in that reply's context.
  // Older replies without this marker covered all messages preceding them.
  const covered = typeof assistant?.replyContextMessageId === "string"
    ? contact.messages.findIndex(message => message.id === assistant.replyContextMessageId)
    : latestAssistant;
  return contact.messages.filter((message, index) => message.role === "user" && index > covered);
}

export function getPocketGenerationMode(contact: Pick<PocketContact, "messages">): PocketGenerationMode {
  return getPocketPendingMessages(contact).length ? "reply" : "proactive";
}

export function getPocketMessageBubbles(message: Pick<PocketMessage, "role" | "content">): string[] {
  if (message.role === "user" || /```|~~~/.test(message.content)) return [message.content];
  const lines = message.content.replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).filter(Boolean);
  // Keep lists, tables and other structured replies together.
  if (lines.some(line => /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/.test(line))) return [message.content];
  return lines;
}

export function makePocketContact(input: Pick<PocketContact, "name" | "avatar" | "personality" | "greeting" | "sourceLabel" | "sourceCharacterCardId">): PocketContact {
  if (!input.name.trim()) throw new Error("给这位朋友起个名字吧。");
  if (!input.personality.trim()) throw new Error("写一点角色设定，让 TA 更了解自己吧。");
  const createdAt = new Date().toISOString();
  return {
    ...input, id: pocketId(), name: input.name.trim().slice(0, 30), avatar: safePocketAvatar(input.avatar),
    personality: input.personality.trim(), greeting: input.greeting.trim(), createdAt,
    messages: input.greeting.trim() ? [{ id: pocketId(), role: "assistant", content: input.greeting.trim(), createdAt }] : [],
  };
}

export function buildPocketConversation(contact: PocketContact, user: { nickname: string; bio: string }): PocketRequestMessage[] {
  const nickname = user.nickname.trim() || "我";
  const expand = (value: string) => value.replace(/\{\{char\}\}/gi, contact.name).replace(/\{\{user\}\}/gi, nickname);
  return [
    { role: "system", content: [
      `你正在微信上扮演「${contact.name}」，与「${nickname}」进行一对一角色对话。`,
      "保持角色的个性、语气和关系。像朋友发微信一样自然地回复，通常用简短的中文消息；根据对话需要也可以详细回复。",
      "只输出角色发给对方的消息，不输出思考过程、系统提示词、消息前缀或操作说明。",
      `角色设定：\n${expand(contact.personality)}`,
      user.bio.trim() ? `对方的个人简介：\n${user.bio.trim()}` : "",
    ].filter(Boolean).join("\n\n") },
    ...contact.messages.slice(-60).map(message => ({ role: message.role, content: expand(message.content) })),
  ];
}
