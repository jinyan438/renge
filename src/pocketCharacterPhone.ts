import { renderPocketPrompt, type PocketPromptOverrides } from "./pocketPhonePrompts.ts";
import { emptyPocketState, makePocketContact, pocketDisplayName, pocketId, POCKET_AVATARS, type PocketContact, type PocketGroupMember, type PocketMessage, type PocketState } from "./pocketPhoneState.ts";
import { makePocketGroup, pocketGroupMember } from "./pocketPhoneGroup.ts";
import { pocketAttachmentContent, type PocketWalletEntry } from "./pocketWechatMedia.ts";

export type PocketPhoneUser = { nickname: string; bio: string; avatarImage: string };
const identity = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase();

// The user conversation is a view of the original messages, never a second log.
export function reversePocketMessage(message: PocketMessage): PocketMessage {
  return { ...message, role: message.role === "user" ? "assistant" : "user" };
}

export function characterPhoneView(root: PocketState, ownerId: string, user: PocketPhoneUser): PocketState {
  const owner = root.contacts.find(contact => contact.id === ownerId);
  if (!owner) return root;
  const phone = root.characterPhones?.[ownerId];
  const phoneOwner = { ...owner, userName: root.settings.nickname.trim() || user.nickname.trim() || "小小的我" };
  const userContact: PocketContact = {
    id: owner.id, syncedOwnerId: owner.id, phoneOwner,
    name: root.settings.nickname.trim() || user.nickname.trim() || "小小的我", avatar: user.avatarImage,
    personality: user.bio.trim() || "按用户已明确提供的信息和真实聊天记录保持其身份，不编造新的经历、喜好或决定。",
    greeting: "", sourceLabel: "与你的聊天 · 双向同步", sourceCharacterCardId: owner.sourceCharacterCardId,
    messages: owner.messages.map(reversePocketMessage), createdAt: owner.createdAt,
    innerState: phone?.userInnerState, innerHistory: phone?.userInnerHistory,
  };
  return { ...emptyPocketState(), settings: root.settings, wallet: phone?.wallet || { balance: 0, bills: [] },
    notes: phone?.notes || [],
    moments: root.moments, momentCovers: root.momentCovers,
    wechatClock: root.wechatClock,
    deletedContextMessages: root.deletedContextMessages,
    contacts: [userContact, ...(phone?.contacts || []).map(contact => ({ ...contact, phoneOwner,
      contextCharacterCardIds: [...new Set([...(contact.contextCharacterCardIds || []), owner.sourceCharacterCardId].filter((id): id is string => !!id))] }))],
    groups: (phone?.groups || []).map(group => ({ ...group, phoneOwner })),
  };
}

export function commitCharacterPhoneView(root: PocketState, ownerId: string, view: PocketState): PocketState {
  const owner = root.contacts.find(contact => contact.id === ownerId);
  const mirror = view.contacts.find(contact => contact.syncedOwnerId === ownerId);
  if (!owner || !mirror) throw new Error("同步联系人必须保留，请返回选择手机主人。");
  const messages = mirror.messages.map(reversePocketMessage);
  // Apply the user's side of shared transfers once; the owner wallet is updated
  // by the same attachment controls used in the ordinary phone.
  let wallet = root.wallet;
  const addBill = (id: string, amount: number, kind: PocketWalletEntry["kind"], title: string) => {
    if (wallet.bills.some(bill => bill.id === id)) return;
    const balance = Math.round((wallet.balance + amount) * 100) / 100;
    if (balance < 0) throw new Error("用户手机的零钱余额不足。");
    wallet = { balance, bills: [...wallet.bills, { id, amount, kind, title, balance, createdAt: new Date().toISOString() }] };
  };
  for (const message of messages) {
    const transfer = message.attachment;
    if (transfer?.kind !== "transfer") continue;
    const old = owner.messages.find(item => item.id === message.id);
    if (!old && message.role === "user") addBill(`send:${message.id}`, -transfer.amount, "send", `转账给${owner.name}`);
    if (transfer.status !== "pending" && old?.attachment?.kind === "transfer" && old.attachment.status === "pending") {
      if (message.role === "assistant" && transfer.status === "received") addBill(`received:${message.id}`, transfer.amount, "receive", `收到${owner.name}的转账`);
      if (message.role === "user" && transfer.status === "returned") addBill(`returned:${message.id}`, transfer.amount, "refund", "转账退还");
    }
    if (transfer.recipientId === ownerId && message.role === "assistant") {
      message.attachment = { ...transfer, recipientId: undefined, recipientName: mirror.name };
      message.content = pocketAttachmentContent(message.attachment, message.id);
    }
  }
  const strip = (contact: PocketContact) => { const { phoneOwner: _owner, syncedOwnerId: _sync, ...saved } = contact; return saved; };
  return { ...root, settings: view.settings, wallet, wechatClock: root.wechatClock,
    moments: view.moments, momentCovers: view.momentCovers,
    contacts: root.contacts.map(contact => contact.id === ownerId ? { ...contact, messages } : contact),
    characterPhones: { ...root.characterPhones, [ownerId]: {
      contacts: view.contacts.filter(contact => !contact.syncedOwnerId).map(strip),
      groups: view.groups.map(group => { const { phoneOwner: _owner, ...saved } = group; return saved; }),
      wallet: view.wallet, notes: view.notes || [], userInnerState: mirror.innerState, userInnerHistory: mirror.innerHistory,
    } },
  };
}

// Receipts handled from the user's phone also update the owner's wallet. Bill
// IDs match the attachment controls, so changing views cannot credit twice.
export function syncCharacterPhoneWallets(previous: PocketState, next: PocketState): PocketState {
  let characterPhones = next.characterPhones;
  for (const owner of next.contacts) {
    const before = previous.contacts.find(contact => contact.id === owner.id);
    for (const message of owner.messages) {
      const attachment = message.attachment;
      if (attachment?.kind !== "transfer" || attachment.status === "pending") continue;
      const old = before?.messages.find(item => item.id === message.id)?.attachment;
      if (old?.kind !== "transfer" || old.status !== "pending") continue;
      const phone = characterPhones?.[owner.id] || { contacts: [], groups: [], wallet: { balance: 0, bills: [] } };
      const incoming = message.role === "user" && attachment.status === "received";
      const refund = message.role === "assistant" && attachment.status === "returned" && phone.wallet.bills.some(bill => bill.id === `send:${message.id}`);
      const id = `${incoming ? "received" : "returned"}:${message.id}`;
      if ((!incoming && !refund) || phone.wallet.bills.some(bill => bill.id === id)) continue;
      const balance = Math.round((phone.wallet.balance + attachment.amount) * 100) / 100;
      if (balance > 999999999.99) throw new Error("角色手机的零钱余额已超过最大金额。");
      characterPhones = { ...characterPhones, [owner.id]: { ...phone, wallet: { balance, bills: [...phone.wallet.bills, {
        id, amount: attachment.amount, balance, kind: incoming ? "receive" : "refund", title: incoming ? "收到用户的转账" : "转账退还", createdAt: new Date().toISOString(),
      }] } } };
    }
  }
  return characterPhones === next.characterPhones ? next : { ...next, characterPhones };
}

export function characterPhoneGenerationPrompt(owner: PocketContact, view: PocketState, user: PocketPhoneUser, contactsOnly = false, prompts?: PocketPromptOverrides) {
  return renderPocketPrompt("character.task", prompts, { char: owner.name, kind: contactsOnly ? "通讯录和群聊" : "联系人、群聊及与其他人的聊天记录", personality: owner.personality, userNames: JSON.stringify([user.nickname, ...view.contacts.filter(contact => contact.syncedOwnerId).map(contact => contact.name)]), contacts: JSON.stringify(view.contacts.filter(contact => !contact.syncedOwnerId).map(contact => ({ id: contact.id, name: contact.name, nickname: contact.nickname, personality: contact.personality, recent: contact.messages.slice(-8) }))), groups: JSON.stringify(view.groups.map(group => ({ id: group.id, name: group.name, members: group.members.map(member => ({ id: member.id, name: member.name, nickname: member.nickname, personality: member.personality })), recent: group.messages.slice(-8).map(message => ({ from: message.role === "user" ? "ta" : "them", name: message.speaker?.name, text: message.content })) }))), rules: renderPocketPrompt(contactsOnly ? "character.contacts" : "character.records", prompts), avatarCount: POCKET_AVATARS.length });
}

export function applyCharacterPhoneGeneration(view: PocketState, raw: string, userNames: string[], owner: PocketContact, contactsOnly = false): PocketState {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("联系人生成格式有误，请重试。"); }
  const data = parsed as { contacts?: unknown; groups?: unknown } | null;
  if (!data || typeof data !== "object" || Array.isArray(data) || data.contacts !== undefined && !Array.isArray(data.contacts) || data.groups !== undefined && !Array.isArray(data.groups)) throw new Error("联系人和群聊生成格式有误，请重试。");
  const entries = (data.contacts || []) as unknown[]; const groupEntries = (data.groups || []) as unknown[];
  if ((!entries.length && !groupEntries.length) || entries.length > 10 || groupEntries.length > 5) throw new Error("没有生成有效联系人或群聊，请重试。");
  const excludedUsers = new Set([...userNames, "我", "用户", "user", "{{user}}", ...view.contacts.filter(contact => contact.syncedOwnerId).flatMap(contact => [contact.name, contact.nickname || ""])].filter(Boolean).map(identity));
  const ownerNames = new Set([owner.name, owner.nickname || "", "{{char}}"].filter(Boolean).map(identity));
  const excluded = new Set([...excludedUsers, ...ownerNames]);
  const contacts = [...view.contacts];
  const seen = new Set<string>();
  const createdAt = new Date().toISOString();
  for (const value of entries) {
    if (!value || typeof value !== "object") throw new Error("联系人资料不完整，请重试。");
    const entry = value as Record<string, unknown>;
    if (typeof entry.name !== "string" || !entry.name.trim() || entry.name.trim().length > 30 || typeof entry.personality !== "string" || !entry.personality.trim() || !Array.isArray(entry.messages)) throw new Error("联系人资料不完整，请重试。");
    const name = entry.name.trim();
    const nickname = typeof entry.nickname === "string" ? entry.nickname.trim().slice(0, 30) : "";
    if (excluded.has(identity(name)) || nickname && excluded.has(identity(nickname))) continue;
    if (seen.has(identity(name))) throw new Error("生成了重复联系人，请重试。");
    seen.add(identity(name));
    const messages: PocketMessage[] = contactsOnly ? [] : entry.messages.map((item: unknown) => {
      const message = item as { from?: string; text?: string } | null;
      if (!message || !["ta", "them"].includes(message.from || "") || typeof message.text !== "string" || !message.text.trim()) throw new Error("聊天记录格式有误，请重试。");
      return { id: pocketId(), role: message.from === "ta" ? "user" : "assistant", content: message.text.trim(), createdAt };
    });
    if (messages.length > 20) throw new Error("生成的聊天记录过长，请重试。");
    const index = contacts.findIndex(contact => !contact.syncedOwnerId && [contact.name, contact.nickname || ""].some(value => identity(value) === identity(name)));
    if (index >= 0) contacts[index] = { ...contacts[index], messages: [...contacts[index].messages, ...messages] };
    else {
      const avatarIndex = typeof entry.avatarIndex === "number" && Number.isInteger(entry.avatarIndex) ? entry.avatarIndex - 1 : 0;
      const contact = makePocketContact({ name, nickname, avatar: POCKET_AVATARS[avatarIndex] || POCKET_AVATARS[0], personality: entry.personality, greeting: "", sourceLabel: `${owner.name}的联系人` });
      contacts.push({ ...contact, phoneOwner: owner, messages });
    }
  }
  const groups = [...view.groups]; const seenGroups = new Set<string>();
  for (const value of groupEntries) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("群聊资料不完整，请重试。");
    const entry = value as Record<string, unknown>;
    if (typeof entry.name !== "string" || !entry.name.trim() || entry.name.trim().length > 30 || !Array.isArray(entry.messages) || entry.messages.length > 30) throw new Error("群聊资料或记录格式有误，请重试。");
    const name = entry.name.trim();
    const index = typeof entry.id === "string" && entry.id ? groups.findIndex(group => group.id === entry.id) : groups.findIndex(group => identity(group.name) === identity(name));
    if (entry.id !== undefined && (typeof entry.id !== "string" || entry.id && index < 0)) throw new Error("生成了未知群聊，请重试。");
    const existing = index >= 0 ? groups[index] : undefined;
    const groupKeys = [`name:${identity(existing?.name || name)}`, ...(existing ? [`id:${existing.id}`] : [])];
    if (groupKeys.some(key => seenGroups.has(key))) throw new Error("生成了重复群聊，请重试。");
    groupKeys.forEach(key => seenGroups.add(key));
    const members = [...existing?.members || []];
    if (members.some(member => excludedUsers.has(identity(member.name)) || member.nickname && excludedUsers.has(identity(member.nickname)) || view.contacts.some(contact => contact.syncedOwnerId && contact.id === member.id))) throw new Error("生成的群聊不能包含真实用户。");
    if (entry.members !== undefined && (!Array.isArray(entry.members) || entry.members.length > 12) || !existing && !Array.isArray(entry.members)) throw new Error("群成员资料不完整，请重试。");
    const memberIds = new Set<string>();
    for (const value of Array.isArray(entry.members) ? entry.members : []) {
      const member = typeof value === "string" ? { name: value } : value as Record<string, unknown> | null;
      if (!member || typeof member !== "object" || typeof member.name !== "string" || !member.name.trim() || member.name.trim().length > 30) throw new Error("群成员资料不完整，请重试。");
      const memberName = member.name.trim(); const nickname = typeof member.nickname === "string" ? member.nickname.trim().slice(0, 30) : "";
      if (excludedUsers.has(identity(memberName)) || nickname && excludedUsers.has(identity(nickname))) throw new Error("生成的群聊不能包含真实用户。");
      if (ownerNames.has(identity(memberName)) || nickname && ownerNames.has(identity(nickname))) continue;
      const people = [...contacts, ...groups.flatMap(group => group.members), ...members];
      const known = typeof member.id === "string" && member.id ? people.find(person => person.id === member.id) : people.find(person => [person.name, person.nickname || ""].some(name => identity(name) === identity(memberName)));
      if (member.id !== undefined && (typeof member.id !== "string" || member.id && !known)) throw new Error("生成了未知群成员，请重试。");
      if (known && (excluded.has(identity(known.name)) || known.nickname && excluded.has(identity(known.nickname)))) throw new Error("生成的群成员身份不正确，请重试。");
      let profile: PocketGroupMember;
      if (known) profile = pocketGroupMember(known);
      else {
        if (typeof member.personality !== "string" || !member.personality.trim()) throw new Error("新群成员需要完整人设，请重试。");
        const avatarIndex = typeof member.avatarIndex === "number" && Number.isInteger(member.avatarIndex) ? member.avatarIndex - 1 : 0;
        profile = { id: pocketId(), name: memberName, ...(nickname ? { nickname } : {}), personality: member.personality.trim(), avatar: POCKET_AVATARS[avatarIndex] || POCKET_AVATARS[0] };
      }
      if (memberIds.has(profile.id)) throw new Error("生成了重复群成员，请重试。");
      memberIds.add(profile.id);
      if (!members.some(member => member.id === profile.id)) members.push(profile);
    }
    if (!members.length || members.length > 12) throw new Error("群聊需要 1 至 12 位其他成员。");
    const messages: PocketMessage[] = contactsOnly ? [] : entry.messages.map((value: unknown) => {
      const message = value as { from?: string; name?: string; text?: string } | null;
      if (!message || !["ta", "them"].includes(message.from || "") || typeof message.text !== "string" || !message.text.trim() || message.text.length > 2000) throw new Error("群聊记录格式有误，请重试。");
      const speakers = message.from === "them" && typeof message.name === "string" ? members.filter(member => [member.name, member.nickname || ""].some(name => identity(name) === identity(message.name!))) : [];
      if (message.from === "them" && speakers.length !== 1) throw new Error("群聊发言人不在成员名单中或身份不明确，请重试。");
      const speaker = speakers[0];
      return { id: pocketId(), role: message.from === "ta" ? "user" : "assistant", content: message.text.trim(), createdAt, generated: true,
        ...(speaker ? { speaker: { id: speaker.id, name: pocketDisplayName(speaker), avatar: speaker.avatar } } : {}) };
    });
    const messageKey = (message: PocketMessage) => JSON.stringify([message.role, message.speaker?.id || "", message.content]);
    const previousKeys = new Set(existing?.messages.map(messageKey) || []);
    const added = messages.filter(message => { const key = messageKey(message); if (previousKeys.has(key)) return false; previousKeys.add(key); return true; });
    const groupMessages = [...existing?.messages || [], ...added];
    const lastIncoming = groupMessages.map(message => message.role).lastIndexOf("assistant");
    const answeredId = (lastIncoming >= 0 ? groupMessages.slice(0, lastIncoming).reverse().find(message => message.role === "user")?.id : undefined) || existing?.replyContextMessageId;
    const group = { ...(existing || makePocketGroup(name, members, owner.name)), members, messages: groupMessages, phoneOwner: owner,
      ...(added.length ? { replyContextMessageId: answeredId || "" } : {}) };
    if (existing) groups[index] = group; else groups.push(group);
  }
  if (!seen.size && !seenGroups.size) throw new Error("生成结果只有同步联系人，请重试生成其他人。");
  return { ...view, contacts, groups };
}
