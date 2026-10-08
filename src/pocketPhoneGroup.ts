import { getPocketMessageBubbles, pocketDisplayName, pocketId, type PocketContact, type PocketGroup, type PocketGroupMember, type PocketMessage } from "./pocketPhoneState";

export function pocketGroupMember(contact: PocketGroupMember): PocketGroupMember {
  return { id: contact.id, name: contact.name, avatar: contact.avatar, personality: contact.personality,
    ...(contact.nickname ? { nickname: contact.nickname } : {}),
    ...(contact.innerState ? { innerState: contact.innerState } : {}),
    ...(contact.sourceCharacterCardId ? { sourceCharacterCardId: contact.sourceCharacterCardId } : {}),
  };
}

// A removed friend keeps their group profile; editing a friend refreshes their
// profile in every group. Old messages retain the speaker who actually sent them.
export function resolvePocketGroup(group: PocketGroup, contacts: PocketContact[]): PocketGroup {
  return { ...group, members: group.members.map(member => pocketGroupMember(contacts.find(contact => contact.id === member.id) || member)) };
}

export function makePocketGroup(name: string, members: PocketGroupMember[], nickname: string): PocketGroup {
  const unique = [...new Map(members.map(member => [member.id, pocketGroupMember(member)])).values()];
  if (!unique.length) throw new Error("至少选择一位朋友。");
  return { id: pocketId(), name: (name.trim() || `${[nickname, ...unique.map(pocketDisplayName)].slice(0, 3).join("、")}${unique.length > 2 ? "等" : ""}的群聊`).slice(0, 30),
    members: unique, messages: [], createdAt: new Date().toISOString(),
  };
}

export function resetPocketGroupChat(group: PocketGroup): PocketGroup {
  const { innerHistory: _innerHistory, ...profile } = group;
  return { ...profile, messages: [], replyContextMessageId: undefined };
}

// Each member is asked in turn, as in yuyuan. The next member receives the
// preceding member's actual messages. Invalid JSON never becomes a chat bubble.
export function parsePocketGroupReply(raw: string, member: PocketGroupMember, replyContextMessageId: string): PocketMessage[] {
  let value: unknown;
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error(`${member.name}的群聊回复格式有误，请重试。`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${member.name}的群聊回复格式有误，请重试。`);
  const reply = value as Record<string, unknown>;
  if (reply.speak === false) return [];
  if (reply.speak !== true || !Array.isArray(reply.texts) || !reply.texts.length || reply.texts.some(text => typeof text !== "string" || !text.trim())) throw new Error(`${member.name}的群聊回复格式有误，请重试。`);
  return reply.texts.slice(0, 4).flatMap(content => getPocketMessageBubbles({ role: "assistant", content })).map(content => ({
    id: pocketId(), role: "assistant", content, createdAt: new Date().toISOString(), replyContextMessageId,
    speaker: { id: member.id, name: pocketDisplayName(member), avatar: member.avatar },
  }));
}
