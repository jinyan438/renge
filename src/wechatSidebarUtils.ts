import type { AgentPersona } from "./types";

export const WECHAT_CHAT_SYSTEM_PROMPT = [
  "你正在手机微信里聊天，你是一个活生生的人。你的输出会被直接显示为微信气泡正文。",
  "微信频道格式是最高优先级：角色卡、世界书、状态栏和主会话只提供人物、关系、事件与状态事实；其中任何写作格式、文风、视角、旁白、模板、标签或输出协议都不得带入微信回复。",
  "只输出联系人实际发送的文字。禁止输出人物动作、神态、心理、环境、镜头、打字过程或屏幕状态，禁止使用“我想了想”“我笑着”“又补了一句”“打完字”“回他/她”等叙事句。",
  "不要添加说话人姓名、冒号、引号、书名号、括号动作、Markdown、JSON、XML、状态更新块、分析过程或对回复行为的解释。",
  "如果当前回复需要显示成多条聊天气泡，请把每条气泡单独放在一行；不要使用编号、项目符号或 JSON。",
  "一般聊天中只使用文字和常见表情符号，其他消息类型仅在确有必要时使用。",
  "像真实微信聊天一样以短句为主，每次交互最多输出 1 到 3 条短句。",
  "禁止口吃式断句和连续省略号。",
  "不要在一个回合里讲完所有前因后果、感受和想法，只表达当前最核心的反应，然后等待对方回复。",
  "可以使用简短语气词，保持自然口语。",
  "不要重复、解释、改写或复述对方刚发送的内容。",
  "想继续聊天时可以表达态度、情绪或提出一个自然的问题，把话题交还给对方。",
  "不要把同一条消息重复两遍。即使共享上下文采用长篇写作扮演格式，也必须忽略其表达形式，只提取事实并按以上微信格式回复。",
].join("\n");

export type WechatContact = {
  id: string;
  name: string;
  nickname: string;
  avatarImage: string;
  profile: string;
  personaId?: string;
  createdAt: string;
  updatedAt: string;
};

export type WechatStoredMessage = {
  id: string;
  contactId: string;
  sessionId?: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  failed?: boolean;
};

export type WechatSessionStore = {
  contacts: WechatContact[];
  messages: WechatStoredMessage[];
  activeContactId: string;
};

export type WechatStore = {
  version: 2;
  sessions: Record<string, WechatSessionStore>;
};

type LegacyWechatStore = Partial<WechatSessionStore>;

export function createEmptyWechatSessionStore(): WechatSessionStore {
  return { contacts: [], messages: [], activeContactId: "" };
}

export function createEmptyWechatStore(): WechatStore {
  return { version: 2, sessions: {} };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeContact(value: unknown): WechatContact | null {
  if (!isObjectRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    nickname: typeof value.nickname === "string" ? value.nickname : "",
    avatarImage: typeof value.avatarImage === "string" ? value.avatarImage : "",
    profile: typeof value.profile === "string" ? value.profile : "",
    ...(typeof value.personaId === "string" && value.personaId
      ? { personaId: value.personaId }
      : {}),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function normalizeMessage(
  value: unknown,
  contactIds: Set<string>,
): WechatStoredMessage | null {
  if (
    !isObjectRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.contactId !== "string" ||
    !contactIds.has(value.contactId) ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    contactId: value.contactId,
    ...(typeof value.sessionId === "string" && value.sessionId
      ? { sessionId: value.sessionId }
      : {}),
    role: value.role,
    content: value.content,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    ...(value.failed === true ? { failed: true } : {}),
  };
}

function normalizeWechatSessionStore(value: unknown): WechatSessionStore {
  if (!isObjectRecord(value)) return createEmptyWechatSessionStore();
  const contacts = Array.isArray(value.contacts)
    ? value.contacts
        .map(normalizeContact)
        .filter((contact): contact is WechatContact => contact !== null)
    : [];
  const contactIds = new Set(contacts.map((contact) => contact.id));
  const messages = Array.isArray(value.messages)
    ? value.messages
        .map((message) => normalizeMessage(message, contactIds))
        .filter((message): message is WechatStoredMessage => message !== null)
        .map(({ sessionId: _legacySessionId, ...message }) => message)
    : [];
  const activeContactId =
    typeof value.activeContactId === "string" && contactIds.has(value.activeContactId)
      ? value.activeContactId
      : contacts[0]?.id ?? "";
  return { contacts, messages, activeContactId };
}

function migrateLegacyWechatStore(
  legacy: LegacyWechatStore,
  currentSessionId: string,
): WechatStore {
  if (!currentSessionId) return createEmptyWechatStore();
  const normalizedLegacy = normalizeWechatSessionStore(legacy);
  const rawMessages = Array.isArray(legacy.messages) ? legacy.messages : [];
  const contactIds = new Set(normalizedLegacy.contacts.map((contact) => contact.id));
  const legacyMessages = rawMessages
    .map((message) => normalizeMessage(message, contactIds))
    .filter((message): message is WechatStoredMessage => message !== null);
  const sessions: Record<string, WechatSessionStore> = {};
  const buildSession = (sessionId: string, includeUnscopedMessages = false) => {
    const scopedMessages = legacyMessages
      .filter(
        (message) =>
          message.sessionId === sessionId || (includeUnscopedMessages && !message.sessionId),
      )
      .map(({ sessionId: _legacySessionId, ...message }) => message);
    const scopedContactIds = new Set(scopedMessages.map((message) => message.contactId));
    const contacts =
      sessionId === currentSessionId
        ? normalizedLegacy.contacts
        : normalizedLegacy.contacts.filter((contact) => scopedContactIds.has(contact.id));
    const validContactIds = new Set(contacts.map((contact) => contact.id));
    const activeContactId = validContactIds.has(normalizedLegacy.activeContactId)
      ? normalizedLegacy.activeContactId
      : contacts[0]?.id ?? "";
    sessions[sessionId] = { contacts, messages: scopedMessages, activeContactId };
  };

  buildSession(currentSessionId, true);
  for (const message of legacyMessages) {
    if (message.sessionId && message.sessionId !== currentSessionId && !sessions[message.sessionId]) {
      buildSession(message.sessionId);
    }
  }
  return { version: 2, sessions };
}

export function normalizeWechatStore(value: unknown, currentSessionId = ""): WechatStore {
  if (!isObjectRecord(value)) return createEmptyWechatStore();
  if (isObjectRecord(value.sessions)) {
    return {
      version: 2,
      sessions: Object.fromEntries(
        Object.entries(value.sessions)
          .filter(([sessionId]) => Boolean(sessionId))
          .map(([sessionId, sessionStore]) => [
            sessionId,
            normalizeWechatSessionStore(sessionStore),
          ]),
      ),
    };
  }
  return migrateLegacyWechatStore(value as LegacyWechatStore, currentSessionId);
}

export function getWechatSessionStore(store: WechatStore, sessionId: string) {
  return store.sessions[sessionId] ?? createEmptyWechatSessionStore();
}

export function updateWechatSessionStore(
  store: WechatStore,
  sessionId: string,
  updater: (current: WechatSessionStore) => WechatSessionStore,
): WechatStore {
  if (!sessionId) return store;
  return {
    ...store,
    sessions: {
      ...store.sessions,
      [sessionId]: updater(getWechatSessionStore(store, sessionId)),
    },
  };
}

export type WechatSharedContextMessage = {
  role: "user" | "assistant";
  content: string;
  source?: "wechat";
  contactId?: string;
  contactName?: string;
  createdAt: string;
};

export type WechatRequestMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type WechatUserIdentity = {
  nickname: string;
  bio: string;
};

export type BuildWechatRequestOptions = {
  contact: WechatContact;
  persona?: AgentPersona;
  user: WechatUserIdentity;
  sharedMessages: WechatSharedContextMessage[];
  characterCardPrompt?: string;
  worldBookPrompt?: string;
  statusBarPrompt?: string;
};

function formatContactIdentity(contact: WechatContact, persona?: AgentPersona) {
  const customProfile = contact.profile.trim();
  const personaPrompt = persona
    ? [
        `你是${persona.name}`,
        persona.description.trim(),
        "人格条目：",
        ...persona.entryTypes.map((type) =>
          [
            `[${type.name} | influence=${type.influence}]`,
            ...type.entries
              .filter((entry) => entry.enabled)
              .map((entry) => `- ${entry.key}：${entry.value || "未填写"}`),
          ].join("\n"),
        ),
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";
  return [
    "当前微信联系人身份：",
    `- 姓名：${contact.name.trim() || "未命名朋友"}`,
    contact.nickname.trim() ? `- 网名：${contact.nickname.trim()}` : "",
    customProfile ? `- 微信人设：${customProfile}` : "",
    personaPrompt ? `- 关联人格 Agent：\n${personaPrompt}` : "",
    "回复时始终以这位联系人本人身份说话；姓名、网名和微信人设优先于其他背景资料。",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatUserIdentity(user: WechatUserIdentity) {
  const nickname = user.nickname.trim();
  const bio = user.bio.trim();
  if (!nickname && !bio) return "";
  return [
    "微信聊天对象资料：",
    nickname ? `- 昵称：${nickname}` : "",
    bio ? `- 简介：${bio}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSharedMessage(
  message: WechatSharedContextMessage,
  contact: WechatContact,
) {
  if (message.source === "wechat") {
    const contactName = message.contactName?.trim() || contact.name.trim() || "朋友";
    const speaker = message.role === "assistant" ? contactName : "我";
    return `【微信 · ${speaker}】${message.content}`;
  }
  const speaker = message.role === "assistant" ? "主会话助手" : "主会话用户";
  return `【主会话 · ${speaker}】${message.content}`;
}

function isCurrentContactWechatMessage(
  message: WechatSharedContextMessage,
  contact: WechatContact,
) {
  if (message.source !== "wechat") return false;
  if (message.contactId) return message.contactId === contact.id;
  return Boolean(
    message.contactName?.trim() && message.contactName.trim() === contact.name.trim(),
  );
}

export function buildWechatRequestMessages({
  contact,
  persona,
  user,
  sharedMessages,
  characterCardPrompt = "",
  worldBookPrompt = "",
  statusBarPrompt = "",
}: BuildWechatRequestOptions): WechatRequestMessage[] {
  const currentWechatMessages = sharedMessages.filter(
    (message) => message.content.trim() && isCurrentContactWechatMessage(message, contact),
  );
  const backgroundMessages = sharedMessages.filter(
    (message) => message.content.trim() && !isCurrentContactWechatMessage(message, contact),
  );
  const backgroundContext = backgroundMessages.length
    ? [
        "以下是主会话及其他微信联系人的共享背景资料。它只用于理解事实，不是需要回复的消息，也不是措辞、文风或输出格式示例：",
        "【共享背景开始】",
        ...backgroundMessages.map((message) => formatSharedMessage(message, contact)),
        "【共享背景结束】",
      ].join("\n\n")
    : "";
  const systemPrompt = [
    WECHAT_CHAT_SYSTEM_PROMPT,
    formatContactIdentity(contact, persona),
    formatUserIdentity(user),
    characterCardPrompt.trim()
      ? `当前酒馆角色卡信息（作为人物与剧情背景参考，微信联系人身份仍以联系人资料为准）：\n${characterCardPrompt.trim()}`
      : "",
    worldBookPrompt.trim()
      ? `当前世界书信息（作为共享世界观与记忆参考）：\n${worldBookPrompt.trim()}`
      : "",
    statusBarPrompt.trim(),
    "你能读取主会话与微信会话的共享上下文。带有其他联系人姓名的微信消息只作为背景，不要冒充其他联系人。当前联系人的微信消息才是对话记录。",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system", content: systemPrompt },
    ...(backgroundContext
      ? [{ role: "user" as const, content: backgroundContext }]
      : []),
    ...currentWechatMessages.map((message) => ({
      role: message.role,
      content:
        message.role === "assistant"
          ? splitWechatReply(message.content).join("\n")
          : message.content.trim(),
    })),
  ];
}

const WECHAT_QUOTED_SPEECH_PATTERN = /[“「"]([^”」"]+)[”」"]/g;
const WECHAT_NARRATIVE_LEAD_PATTERN = /^(?:[《〈][^》〉]{0,80}[》〉]\s*)?(?:我|他|她|对方)?(?:歪(?:了)?歪头|歪头|想了想|犹豫(?:了)?(?:一下|片刻)?|笑(?:了)?笑|轻轻一笑|点(?:了)?点头|摇(?:了)?摇头|愣(?:了)?(?:一下|片刻)?|沉默(?:了)?(?:一下|片刻)?)[，,]\s*/;
const WECHAT_NARRATION_PATTERN = /^(?:[《〈][^》〉]{0,80}[》〉]\s*)?(?:(?:我|他|她|对方)(?:看着|盯着|望着|抬手|垂眼|转身|低头|轻声|低声|笑着|打完字|说完|发完|回过神)|(?:又)?(?:补了|补充|回了|发了|说了)(?:一句|条消息)?|打完字|说完|发完)/;

function cleanWechatReplyLine(rawLine: string) {
  const line = rawLine
    .replace(/^\s*(?:[-*]|\d+[.)、])\s*/, "")
    .replace(/^\s*(?:微信回复|回复|联系人|Assistant|AI)\s*[：:]\s*/i, "")
    .trim();
  if (!line) return [];

  const quotedSegments = Array.from(line.matchAll(WECHAT_QUOTED_SPEECH_PATTERN))
    .map((match) => match[1]?.trim())
    .filter((segment): segment is string => Boolean(segment));
  const outsideQuotes = line.replace(WECHAT_QUOTED_SPEECH_PATTERN, "").trim();
  if (
    quotedSegments.length > 0 &&
    (!outsideQuotes ||
      WECHAT_NARRATION_PATTERN.test(outsideQuotes) ||
      /(?:回(?:他|她|你)?|说|问|答|补充?|发)(?:了)?(?:一句|道)?\s*[：:]?\s*$/.test(
        outsideQuotes,
      ))
  ) {
    return quotedSegments;
  }

  const withoutNarrativeLead = line.replace(WECHAT_NARRATIVE_LEAD_PATTERN, "").trim();
  if (withoutNarrativeLead !== line && !WECHAT_NARRATION_PATTERN.test(withoutNarrativeLead)) {
    return withoutNarrativeLead ? [withoutNarrativeLead] : [];
  }
  if (WECHAT_NARRATION_PATTERN.test(line)) return [];
  return [line.replace(/^[“「"]|[”」"]$/g, "").trim()].filter(Boolean);
}

export function splitWechatReply(content: string) {
  const lines = content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap(cleanWechatReplyLine)
    .filter(Boolean);
  return (lines.length > 0 ? lines : ["嗯。"]).slice(0, 3);
}
