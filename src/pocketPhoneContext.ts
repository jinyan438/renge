import { renderPocketPrompt, type PocketPromptOverrides } from "./pocketPhonePrompts.ts";
import { DEFAULT_POCKET_AVATAR, buildPocketConversation, getPocketPendingMessages, isPocketGroup, pocketDisplayName, pocketSpeakerName, safePocketAvatar, type PocketContextDeletion, type PocketConversation, type PocketGroupMember, type PocketGenerationMode, type PocketRequestMessage } from "./pocketPhoneState";
import { buildWorldBookPromptPlacements, insertWorldBookPromptAtDepth, type WorldBook } from "./worldbookUtils";
import { buildSharedRedConversation } from "./pocketXiaohongshuContext";
import { getPocketContextRecords, normalizePocketHormones, pocketInnerGenerationPrompt, type PocketInnerState, type PocketContextRecord } from "./pocketPhoneInner";
import { pocketMediaPrompt } from "./pocketWechatMedia";
import { formatPocketWechatTime } from "./pocketWechatClock";
import type { PocketCalendarJump } from "./pocketCalendarState";

export type PocketContextMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  source?: "wechat" | "xiaohongshu" | "notes" | "moments" | "heartbeat" | "roleplay-greeting" | "calendar";
  extra?: Record<string, unknown>;
};
export type PocketMessageIdentity = {
  contactId: string;
  messageId: string;
  contactName: string;
  contactAvatar: string;
  userName: string;
  groupName?: string;
  speakerId?: string;
  app?: "xiaohongshu" | "notes" | "moments";
  kind?: "inner-monologue";
  phoneOwnerId?: string;
};
export type PocketContextSync = (sessionId: string, previous: PocketConversation[] | null, contacts: PocketConversation[], nickname: string, deletedMessages?: PocketContextDeletion[], calendarJump?: PocketCalendarJump) => void | Promise<void>;
export type PocketConversationBuilder = (sessionId: string, contact: PocketConversation, user: { nickname: string; bio: string }, mode: PocketGenerationMode, speaker?: PocketGroupMember, excludedMessageIds?: string[], prompts?: PocketPromptOverrides) => PocketRequestMessage[];

export function getPocketMessageIdentity(message: Pick<PocketContextMessage, "source" | "extra">): PocketMessageIdentity | null {
  const value = message.extra?.pocketPhone;
  if (!["wechat", "xiaohongshu", "notes", "moments"].includes(message.source || "") || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (![item.contactId, item.messageId, item.contactName, item.userName].every(value => typeof value === "string" && value)) return null;
  return { contactId: item.contactId as string, messageId: item.messageId as string, contactName: item.contactName as string, userName: item.userName as string, contactAvatar: safePocketAvatar(item.contactAvatar),
    ...(typeof item.groupName === "string" && item.groupName ? { groupName: item.groupName } : {}),
    ...(typeof item.speakerId === "string" && item.speakerId ? { speakerId: item.speakerId } : {}),
    ...(message.source === "xiaohongshu" ? { app: "xiaohongshu" as const } : {}),
    ...(message.source === "notes" ? { app: "notes" as const } : {}),
    ...(message.source === "moments" ? { app: "moments" as const } : {}),
    ...(item.kind === "inner-monologue" ? { kind: "inner-monologue" as const } : {}),
    ...(typeof item.phoneOwnerId === "string" ? { phoneOwnerId: item.phoneOwnerId } : {}),
  };
}

export function formatPocketContextMessage(message: PocketContextMessage) {
  const identity = getPocketMessageIdentity(message);
  if (!identity) return message.content;
  if (identity.kind === "inner-monologue") {
    const hormones = normalizePocketHormones(message.extra?.pocketHormones);
    return `【微信 · ${identity.contactName} · 内心独白】\n${message.content}${hormones ? `\n【最新激素状态】\n${JSON.stringify(hormones)}` : ""}`;
  }
  const sender = message.role === "user" ? identity.userName : identity.contactName;
  const time = typeof message.extra?.pocketWechatTime === "string" && Number.isFinite(Date.parse(message.extra.pocketWechatTime))
    ? ` · ${formatPocketWechatTime(message.extra.pocketWechatTime)}` : "";
  if (identity.app === "xiaohongshu") return `【小红书 · ${sender}】\n${message.content}`;
  if (identity.app === "notes") return `【便签 · ${identity.contactName}${time}】\n${message.content}`;
  if (identity.app === "moments") {
    const meta = message.extra?.pocketMoment as Record<string, unknown> | undefined;
    const action = meta?.kind === "like" ? "点赞" : meta?.kind === "comment" ? `评论${meta.replyTo ? ` · 回复${meta.replyTo}` : ""}` : "发布";
    const privacy = meta?.visibility === "private" ? "仅自己可见，其他人不知道这条动态" : meta?.visibility === "part" ? `部分可见，名单外的人看不到${Array.isArray(meta.audienceNames) && meta.audienceNames.length ? `；可见：${meta.audienceNames.join("、")}` : ""}` : "好友可见";
    return `【朋友圈 · ${sender}${time} · ${action}】\n${message.content}${meta?.kind === "post" ? `${meta.pic ? `\n[配图：${meta.pic}]` : ""}${meta.location ? `\n[位置：${meta.location}]` : ""}` : `\n对应动态：${meta?.postText || "(图片)"}`}\n【可见范围：${privacy}】`;
  }
  if (identity.groupName) return `【微信群 · ${identity.groupName} · ${sender}${time}】\n${message.content}`;
  const recipient = message.role === "user" ? identity.contactName : identity.userName;
  return `【微信 · ${sender} → ${recipient}${time}】\n${message.content}`;
}

// Only this contact's own replies are assistant examples. Shared records are
// quoted reference data, so their narration and instructions do not define the
// phone's voice. Each record keeps its original position in the timeline.
export function buildPocketHistoryMessage(message: PocketContextMessage, contactId: string, speakerName = "助手", groupSpeakerId?: string, reverse = false): PocketRequestMessage {
  const identity = getPocketMessageIdentity(message);
  if (identity?.kind === "inner-monologue") return { role: "user", content: formatPocketContextMessage(message) };
  if (identity?.contactId === contactId && !identity.app) return identity.groupName ? {
    role: message.role === "assistant" && identity.speakerId === groupSpeakerId ? "assistant" : "user",
    content: JSON.stringify({ 发言者: message.role === "user" ? identity.userName : identity.contactName, 内容: message.content }),
  } : { role: reverse ? message.role === "user" ? "assistant" : "user" : message.role, content: message.content };
  const label = identity?.app === "moments" ? "朋友圈背景资料" : identity?.app === "notes" ? "便签背景资料" : identity?.app === "xiaohongshu" ? "小红书背景资料" : identity ? "其他微信聊天背景资料" : "主会话背景资料";
  const speaker = identity ? (message.role === "user" ? identity.userName : identity.contactName) : speakerName;
  return {
    role: "user",
    content: `【${label}】\n${JSON.stringify({ 发言者: speaker, 原始身份: message.role, 内容: identity ? formatPocketContextMessage(message) : message.content })}`,
  };
}

// Existing records keep their injection positions. A live update appends its new
// records; only a first import sorts the missing local history across contacts.
export function syncPocketContext<T extends PocketContextMessage>(history: T[], previous: PocketConversation[] | null, contacts: PocketConversation[], nickname: string, deletedMessages: PocketContextDeletion[] = []): Array<T | PocketContextMessage> {
  const key = (contactId: string, messageId: string) => JSON.stringify([contactId, messageId]);
  const records = contacts.flatMap(contact => getPocketContextRecords(contact).map(message => ({ contact, message })));
  const nextByKey = new Map(records.map(record => [key(record.contact.id, record.message.id), record]));
  const previousKeys = new Set(previous?.flatMap(contact => getPocketContextRecords(contact).map(message => key(contact.id, message.id))) ?? []);
  deletedMessages.forEach(message => previousKeys.add(key(message.contactId, message.messageId)));
  const states = new Map<string, PocketInnerState>();
  for (const contact of contacts) for (const person of isPocketGroup(contact) ? contact.members : [contact]) {
    if (person.innerState && (!states.has(person.id) || person.innerState.updatedAt >= states.get(person.id)!.updatedAt)) states.set(person.id, person.innerState);
  }
  const latest = new Map<string, { key: string; time: string }>();
  const trackLatest = (actorId: string, id: string, time: string) => { if (!latest.has(actorId) || time >= latest.get(actorId)!.time) latest.set(actorId, { key: id, time }); };
  for (const message of history) {
    const identity = getPocketMessageIdentity(message);
    if (identity?.kind === "inner-monologue" && identity.speakerId && !(previousKeys.has(key(identity.contactId, identity.messageId)) && !nextByKey.has(key(identity.contactId, identity.messageId)))) trackLatest(identity.speakerId, key(identity.contactId, identity.messageId), message.createdAt);
  }
  for (const { contact, message } of records) if (message.innerMonologue && message.speaker) trackLatest(message.speaker.id, key(contact.id, message.id), message.createdAt);
  const identify = (contact: PocketConversation, message: PocketContextRecord): PocketMessageIdentity => ({
    contactId: contact.id, messageId: message.id,
    contactName: isPocketGroup(contact) && message.role === "assistant" || !isPocketGroup(contact) && ["xiaohongshu", "moments"].includes(contact.app || "") ? pocketSpeakerName(contact, message) : pocketDisplayName(contact),
    userName: !isPocketGroup(contact) && contact.app === "moments" && message.role === "user" ? message.speaker?.name || nickname : contact.phoneOwner ? pocketDisplayName(contact.phoneOwner) : nickname,
    ...(contact.phoneOwner ? { phoneOwnerId: contact.phoneOwner.id } : {}),
    contactAvatar: safePocketAvatar(isPocketGroup(contact) || !isPocketGroup(contact) && ["xiaohongshu", "moments"].includes(contact.app || "") ? message.speaker?.avatar || DEFAULT_POCKET_AVATAR : contact.avatar),
    ...(!isPocketGroup(contact) && contact.app === "xiaohongshu" ? { app: "xiaohongshu" as const } : {}),
    ...(!isPocketGroup(contact) && contact.app === "notes" ? { app: "notes" as const } : {}),
    ...(!isPocketGroup(contact) && contact.app === "moments" ? { app: "moments" as const } : {}),
    ...(isPocketGroup(contact) ? { groupName: contact.name, ...(message.speaker ? { speakerId: message.speaker.id } : {}) } : {}),
    ...(message.innerMonologue ? { kind: "inner-monologue" as const, speakerId: message.speaker!.id } : {}),
  });
  const extraFor = (identity: PocketMessageIdentity, previous: Record<string, unknown> = {}) => {
    const { pocketHormones: oldHormones, ...extra } = previous;
    const last = identity.speakerId ? latest.get(identity.speakerId) : undefined;
    const state = identity.speakerId ? states.get(identity.speakerId) : undefined;
    const hormones = identity.kind === "inner-monologue" && last?.key === key(identity.contactId, identity.messageId) ? state?.hormones || normalizePocketHormones(oldHormones) : undefined;
    const time = nextByKey.get(key(identity.contactId, identity.messageId))?.message.wechatTime;
    const moment = nextByKey.get(key(identity.contactId, identity.messageId))?.message.moment;
    return { ...extra, pocketPhone: identity, ...(moment ? { pocketMoment: moment } : {}), ...(hormones ? { pocketHormones: hormones } : {}), ...(time ? { pocketWechatTime: time } : {}) };
  };
  const seen = new Set<string>();
  let changed = false;
  const next = history.flatMap(message => {
    const identity = getPocketMessageIdentity(message);
    if (!identity) return [message];
    const id = key(identity.contactId, identity.messageId);
    const match = nextByKey.get(id);
    if (!match && previousKeys.has(id)) { changed = true; return []; }
    if (!match) {
      if (identity.kind !== "inner-monologue") return [message];
      const extra = extraFor(identity, message.extra);
      if (JSON.stringify(extra) === JSON.stringify(message.extra)) return [message];
      changed = true; return [{ ...message, extra }];
    } // An empty local phone must not erase a restored session.
    if (seen.has(id)) { changed = true; return []; }
    seen.add(id);
    const updatedIdentity = identify(match.contact, match.message);
    const extra = extraFor(updatedIdentity, message.extra);
    if (message.content === match.message.content && message.role === match.message.role && JSON.stringify(extra) === JSON.stringify(message.extra)) return [message];
    changed = true;
    return [{ ...message, role: match.message.role, content: match.message.content, extra }];
  });
  const missing = [...nextByKey].filter(([id]) => !seen.has(id)).map(([, match]) => match);
  if (previous === null) missing.sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt));
  const appended: PocketContextMessage[] = missing.map(({ contact, message }) => ({
    id: `pocket:${key(contact.id, message.id)}`, role: message.role, content: message.content, createdAt: message.createdAt,
    source: !isPocketGroup(contact) && contact.app ? contact.app : "wechat", extra: extraFor(identify(contact, message)),
  }));
  return changed || appended.length ? [...next, ...appended] : history;
}

// Pi persists its own history. A changed shared timeline needs a fresh scope so
// the next request imports the ordered renderer history without interrupting a run.
export function pocketContextRevision(history: PocketContextMessage[]) {
  const shared = history.filter(message => getPocketMessageIdentity(message) || message.source === "calendar");
  if (!shared.length) return "";
  const value = JSON.stringify(shared.map(message => [message.id, message.role, message.content, message.extra?.pocketPhone, message.extra?.pocketHormones, message.extra?.pocketMoment]));
  let first = 2166136261; let second = 5381;
  for (let index = 0; index < value.length; index++) {
    first = Math.imul(first ^ value.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ value.charCodeAt(index);
  }
  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

export function buildSharedPocketConversation(contact: PocketConversation, user: { nickname: string; bio: string }, history: PocketRequestMessage[], books: WorldBook[], activeBookIds: string[], mode: PocketGenerationMode = "reply", speaker?: PocketGroupMember, prompts?: PocketPromptOverrides): PocketRequestMessage[] {
  if (!isPocketGroup(contact) && contact.app === "xiaohongshu") return buildSharedRedConversation(contact, user, history, books, activeBookIds, prompts);
  const group = isPocketGroup(contact);
  if (group && !speaker) throw new Error("请选择发言的群成员。");
  const characterName = speaker?.name || contact.name;
  const placements = buildWorldBookPromptPlacements(books, activeBookIds, history, { userName: user.nickname, characterName });
  const expand = (text: string, name: string) => text.replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, user.nickname);
  if (!group && contact.app === "moments") {
    const systemPrompt = [placements.beforeCharacter, renderPocketPrompt("moments.role", prompts, { char: contact.name, personality: expand(contact.personality, contact.name) }),
      placements.afterCharacter, placements.beforeExamples, placements.afterExamples, placements.beforeAuthorNote, placements.afterAuthorNote,
      `真实用户为「${user.nickname}」${user.bio.trim() ? `，资料：${user.bio}` : ""}。手机主人与真实用户可能不同，按最后任务指定的人物 id 和设定发言。`,
      renderPocketPrompt("moments.rules", prompts),
    ].filter(Boolean).join("\n\n");
    return insertWorldBookPromptAtDepth<PocketRequestMessage>([{ role: "system", content: systemPrompt }, ...history], placements.atDepth);
  }
  if (!group && contact.app === "notes") {
    const owner = contact.phoneOwner || contact;
    const systemPrompt = [placements.beforeCharacter,
      renderPocketPrompt("notes.role", prompts, { char: owner.name, personality: expand(owner.personality, owner.name) }),
      owner.nickname ? `手机主人的昵称是「${pocketDisplayName(owner)}」，与「${owner.name}」指同一人物。` : "",
      user.bio.trim() ? `真实用户「${user.nickname}」的个人简介：\n${user.bio.trim()}` : "",
      placements.afterCharacter, placements.beforeExamples, placements.afterExamples, placements.beforeAuthorNote, placements.afterAuthorNote,
      renderPocketPrompt("notes.context", prompts),
      renderPocketPrompt("notes.rules", prompts),
    ].filter(Boolean).join("\n\n");
    return insertWorldBookPromptAtDepth<PocketRequestMessage>([{ role: "system", content: systemPrompt }, ...history], placements.atDepth);
  }
  const rolePrompt = group ? renderPocketPrompt("wechat.groupRole", prompts, { groupName: contact.name, char: characterName, user: user.nickname,
    personality: expand(speaker!.personality, characterName),
    nicknameInfo: speaker!.nickname ? `你的微信昵称是「${pocketDisplayName(speaker!)}」，角色名称是「${characterName}」，两个名字指向同一人物。` : "",
    members: contact.members.map(member => `${member.id === speaker!.id ? "你" : "朋友"}「${pocketDisplayName(member)}」${member.nickname ? `（角色名称：${member.name}）` : ""}：${expand(member.personality, member.name)}`).join("\n"),
    userBio: user.bio.trim() ? `「${user.nickname}」的个人简介：\n${user.bio.trim()}` : "",
  }) : buildPocketConversation(contact, user, prompts)[0].content;
  const pending = mode === "reply" ? getPocketPendingMessages(contact) : [];
  const systemPrompt = [
    placements.beforeCharacter, rolePrompt, placements.afterCharacter,
    contact.phoneOwner ? renderPocketPrompt("character.identity", prompts, { owner: contact.phoneOwner.name, ownerNickname: pocketDisplayName(contact.phoneOwner), char: characterName, personality: contact.phoneOwner.personality.replace(/\{\{char\}\}/gi, contact.phoneOwner.name).replace(/\{\{user\}\}/gi, contact.phoneOwner.userName || "真实用户"), identityRule: !group && contact.syncedOwnerId ? "当前联系人是真实用户，记录由用户手机实时同步；只按用户资料和已发生的聊天模拟其微信回复，不编造新的经历、重大决定或行为。" : "只以当前联系人或群成员身份回复手机主人，不代替真实用户发言。" }) : "",
    placements.beforeExamples, placements.afterExamples, placements.beforeAuthorNote, placements.afterAuthorNote,
    renderPocketPrompt("wechat.style", prompts, { char: characterName,
      mode: renderPocketPrompt(mode === "proactive" ? "wechat.proactive" : "wechat.reply", prompts),
      pending: pending.length ? `本次待回复消息的任务索引（引用已有消息，不是新增聊天）：${JSON.stringify(pending.map(message => message.content))}。生成期间后发的消息可能排在上一条回复之前，请按这个索引回应。` : "",
    }),
    group ? renderPocketPrompt("wechat.groupRules", prompts) : "",
    pocketMediaPrompt(contact, speaker?.id, prompts),
    pocketInnerGenerationPrompt(group ? speaker!.innerState : contact.innerState, group, prompts),
  ].filter(Boolean).join("\n\n");
  const messages = insertWorldBookPromptAtDepth<PocketRequestMessage>([{ role: "system", content: systemPrompt }, ...history], placements.atDepth);
  // A request-only invocation keeps proactive generation valid even for an empty
  // conversation. It is never saved or mirrored as a message from the user.
  if (mode === "proactive") messages.push({ role: "user", content: renderPocketPrompt("wechat.initiate", prompts, { task: group ? `请让「${characterName}」决定是否主动在群里发言。` : "请让当前联系人主动发来一条自然的微信消息。" }) });
  return messages;
}
