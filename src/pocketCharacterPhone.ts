import { emptyPocketState, makePocketContact, pocketDisplayName, pocketId, POCKET_AVATARS, type PocketContact, type PocketMessage, type PocketState } from "./pocketPhoneState.ts";
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
    contacts: root.contacts.map(contact => contact.id === ownerId ? { ...contact, messages } : contact),
    characterPhones: { ...root.characterPhones, [ownerId]: {
      contacts: view.contacts.filter(contact => !contact.syncedOwnerId).map(strip),
      groups: view.groups.map(group => { const { phoneOwner: _owner, ...saved } = group; return saved; }),
      wallet: view.wallet, userInnerState: mirror.innerState, userInnerHistory: mirror.innerHistory,
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

export function characterPhoneGenerationPrompt(owner: PocketContact, view: PocketState, user: PocketPhoneUser, contactsOnly = false) {
  return `【ta 的手机生成任务：应用指令，不是聊天消息】
你正在生成「${owner.name}」的微信${contactsOnly ? "通讯录" : "联系人及与其他人的聊天记录"}。手机主人资料：${owner.personality}
真实用户姓名/昵称：${JSON.stringify([user.nickname, ...view.contacts.filter(contact => contact.syncedOwnerId).map(contact => contact.name)])}。
与你的聊天已双向同步，绝对不要生成用户、用户别名或手机主人本人为联系人，也不要生成角色与用户的对话。
参考以上主会话事实、角色卡、世界书和已有微信上下文，优先使用已设定的其他人物；未提供的用户经历、爱好、决定不可编造。不同联系人围绕各自生活与角色的关系自然交流，不能人人知道私密事件。只写当前时间附近的新消息，不把刚发生的剧情放进旧聊天。
已有其他联系人：${JSON.stringify(view.contacts.filter(contact => !contact.syncedOwnerId).map(contact => ({ name: contact.name, personality: contact.personality, recent: contact.messages.slice(-8) })))}。
${contactsOnly ? "添加2至5个合理的新联系人，messages必须为空数组。" : "已有联系人时优先续写，保留其名字与人设；没有时生成2至5个合理联系人，每人2至6条来回消息。"}
本次覆盖普通微信回复及内心独白的输出格式，只返回严格JSON：{"contacts":[{"name":"姓名","nickname":"微信昵称，可空","personality":"身份、性格、说话习惯及与手机主人的关系","avatarIndex":1,"messages":[{"from":"ta或them","text":"一条气泡正文"}]}]}。
from为ta表示「${owner.name}」发出（显示在右侧），them表示该联系人发出。avatarIndex为1至${POCKET_AVATARS.length}。只输出真实气泡文字，不含旁白、姓名前缀和用户发言。不能清空或改写已有记录。`;
}

export function applyCharacterPhoneGeneration(view: PocketState, raw: string, userNames: string[], owner: PocketContact, contactsOnly = false): PocketState {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("联系人生成格式有误，请重试。"); }
  const data = parsed as { contacts?: unknown } | null;
  if (!data || !Array.isArray(data.contacts) || !data.contacts.length || data.contacts.length > 10) throw new Error("没有生成有效联系人，请重试。");
  const excluded = new Set([...userNames, "我", "用户", "user", "{{user}}", owner.name, owner.nickname || "", ...view.contacts.filter(contact => contact.syncedOwnerId).map(contact => contact.name)].filter(Boolean).map(identity));
  const contacts = [...view.contacts];
  const seen = new Set<string>();
  const createdAt = new Date().toISOString();
  for (const value of data.contacts) {
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
  if (!seen.size) throw new Error("生成结果只有同步联系人，请重试生成其他人。");
  return { ...view, contacts };
}
