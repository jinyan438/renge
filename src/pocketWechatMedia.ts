import type { PocketConversation, PocketGroupMember, PocketMessage, PocketState } from "./pocketPhoneState";

export type PocketAttachment =
  | { kind: "transfer"; amount: number; note: string; status: "pending" | "received" | "returned"; recipientId?: string; recipientName?: string }
  | { kind: "image"; description: string; url?: string }
  | { kind: "location"; name: string; address: string }
  | { kind: "voice"; text: string; seconds: number; shown?: boolean };
export type PocketWalletEntry = { id: string; kind: "edit" | "send" | "receive" | "refund"; amount: number; balance: number; title: string; createdAt: string };
export type PocketWallet = { balance: number; bills: PocketWalletEntry[] };
const MAX_MONEY = 999999999.99;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const money = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_MONEY;
export const roundPocketMoney = (value: number) => Math.round(value * 100) / 100;
export const formatPocketMoney = (value: number) => value.toFixed(2);

export function parsePocketMoney(value: string, allowZero = false) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("请输入有效金额，最多两位小数。");
  const amount = Number(value.trim());
  if (!money(amount) || (!allowZero && amount === 0)) throw new Error(allowZero ? "金额需在 0 至 999999999.99 元之间。" : "转账金额必须大于 0，且不超过 999999999.99 元。");
  return roundPocketMoney(amount);
}

export function normalizePocketWallet(value: unknown): PocketWallet {
  if (!object(value)) return { balance: 0, bills: [] };
  const ids = new Set<string>();
  const bills: PocketWalletEntry[] = (Array.isArray(value.bills) ? value.bills : []).flatMap(entry => {
    if (!object(entry) || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) || !["edit", "send", "receive", "refund"].includes(String(entry.kind)) || typeof entry.amount !== "number" || !money(Math.abs(entry.amount)) || !money(entry.balance) || typeof entry.title !== "string" || typeof entry.createdAt !== "string") return [];
    ids.add(entry.id);
    return [{ id: entry.id, kind: entry.kind as PocketWalletEntry["kind"], amount: roundPocketMoney(entry.amount), balance: roundPocketMoney(entry.balance), title: entry.title.slice(0, 100), createdAt: entry.createdAt }];
  });
  return { balance: money(value.balance) ? roundPocketMoney(value.balance) : 0, bills };
}

export function safePocketImageUrl(value: unknown) {
  return typeof value === "string" && /^(?:data:image\/(?:png|jpeg|webp|gif);base64,|\/api\/app-data\/assets\/|https?:\/\/)/i.test(value) ? value : undefined;
}
export function normalizePocketAttachment(value: unknown): PocketAttachment | undefined {
  if (!object(value)) return;
  if (value.kind === "transfer" && money(value.amount) && roundPocketMoney(value.amount) > 0 && ["pending", "received", "returned"].includes(String(value.status))) return {
    kind: "transfer", amount: roundPocketMoney(value.amount), note: typeof value.note === "string" ? value.note.slice(0, 100) : "", status: value.status as "pending" | "received" | "returned",
    ...(typeof value.recipientId === "string" ? { recipientId: value.recipientId } : {}), ...(typeof value.recipientName === "string" ? { recipientName: value.recipientName.slice(0, 30) } : {}),
  };
  if (value.kind === "image" && typeof value.description === "string" && value.description.trim()) return { kind: "image", description: value.description.trim().slice(0, 2000), ...(safePocketImageUrl(value.url) ? { url: safePocketImageUrl(value.url) } : {}) };
  if (value.kind === "location" && typeof value.name === "string" && value.name.trim()) return { kind: "location", name: value.name.trim().slice(0, 80), address: typeof value.address === "string" ? value.address.trim().slice(0, 200) : "" };
  if (value.kind === "voice" && typeof value.text === "string" && value.text.trim() && typeof value.seconds === "number" && Number.isInteger(value.seconds) && value.seconds >= 1 && value.seconds <= 60) return { kind: "voice", text: value.text.trim().slice(0, 2000), seconds: value.seconds, ...(value.shown === true ? { shown: true } : {}) };
}

export function pocketAttachmentContent(attachment: PocketAttachment, id: string) {
  if (attachment.kind === "image") return `[图片：${attachment.description}]`;
  if (attachment.kind === "voice") return `[语音 ${attachment.seconds}秒：${attachment.text}]`;
  if (attachment.kind === "location") return `[位置：${attachment.name}${attachment.address ? ` · ${attachment.address}` : ""}]`;
  return `[微信转账 ¥${formatPocketMoney(attachment.amount)}${attachment.note ? ` · ${attachment.note}` : ""}${attachment.recipientName ? ` · 收款人：${attachment.recipientName}` : ""} · ${attachment.status === "received" ? "已收款" : attachment.status === "returned" ? "已退还" : "待收款"} · 编号：${id}]`;
}
export function pocketMessagePreview(message: PocketMessage) {
  if (!message.attachment) return message.content;
  if (message.attachment.kind === "location") return `[位置] ${message.attachment.name}`;
  return message.attachment.kind === "transfer" ? `[转账] ¥${formatPocketMoney(message.attachment.amount)}` : message.attachment.kind === "image" ? "[图片]" : `[语音] ${message.attachment.seconds}秒`;
}

function walletChange(wallet: PocketWallet, id: string, amount: number, kind: PocketWalletEntry["kind"], title: string): PocketWallet {
  if (wallet.bills.some(bill => bill.id === id)) return wallet;
  const balance = roundPocketMoney(wallet.balance + amount);
  if (!money(balance)) throw new Error(balance < 0 ? "零钱余额不足，请先在「我 → 服务 → 钱包 → 零钱」修改余额。" : "零钱余额已超过可保存的最大金额。");
  return { balance, bills: [...wallet.bills, { id, amount, balance, kind, title, createdAt: new Date().toISOString() }] };
}
export function editPocketBalance(state: PocketState, amount: number): PocketState {
  if (!money(amount)) throw new Error("零钱金额无效。");
  return { ...state, wallet: walletChange(state.wallet, crypto.randomUUID(), roundPocketMoney(amount - state.wallet.balance), "edit", "修改零钱余额") };
}
export function appendPocketAttachment(state: PocketState, conversationId: string, attachment: PocketAttachment): PocketState {
  const conversation = [...state.contacts, ...state.groups].find(item => item.id === conversationId);
  if (!conversation) return state;
  const valid = normalizePocketAttachment(attachment);
  if (!valid) throw new Error("请检查消息内容。");
  const id = crypto.randomUUID();
  const message: PocketMessage = { id, role: "user", content: pocketAttachmentContent(valid, id), attachment: valid, createdAt: new Date().toISOString() };
  const wallet = valid.kind === "transfer" ? walletChange(state.wallet, `send:${id}`, -valid.amount, "send", `转账给${valid.recipientName || conversation.name}`) : state.wallet;
  return { ...state, wallet, contacts: state.contacts.map(item => item.id === conversationId ? { ...item, messages: [...item.messages, message] } : item), groups: state.groups.map(item => item.id === conversationId ? { ...item, messages: [...item.messages, message] } : item) };
}

// Settle only an existing pending card. Receipt IDs make repeated actions harmless.
export function settlePocketTransfer(state: PocketState, conversationId: string, messageId: string, action: "received" | "returned", actor: "user" | "assistant", speakerId?: string): PocketState {
  const conversation = [...state.contacts, ...state.groups].find(item => item.id === conversationId);
  const message = conversation?.messages.find(item => item.id === messageId);
  const attachment = message?.attachment;
  if (!message || attachment?.kind !== "transfer" || attachment.status !== "pending" || message.role === actor || actor === "assistant" && attachment.recipientId && attachment.recipientId !== (speakerId || conversationId)) return state;
  const updated: PocketAttachment = { ...attachment, status: action };
  const amount = actor === "user" && action === "received" || actor === "assistant" && action === "returned" ? attachment.amount : 0;
  const wallet = amount ? walletChange(state.wallet, `${action}:${messageId}`, amount, action === "returned" ? "refund" : "receive", action === "returned" ? "转账退还" : `收到${message.speaker?.name || conversation!.name}的转账`) : state.wallet;
  const receipt: PocketMessage[] = actor === "user" ? [{ id: crypto.randomUUID(), role: "user", content: `[${action === "received" ? "已收款" : "已退还转账"} ¥${formatPocketMoney(attachment.amount)} · 编号：${messageId}]`, createdAt: new Date().toISOString() }] : [];
  const update = <T extends PocketConversation>(item: T): T => item.id === conversationId ? { ...item, messages: [...item.messages.map(entry => entry.id === messageId ? { ...entry, attachment: updated, content: pocketAttachmentContent(updated, messageId) } : entry), ...receipt] } : item;
  return { ...state, wallet, contacts: state.contacts.map(update), groups: state.groups.map(update) };
}

// Preserve yuyuan's standalone tokens inside the existing validated texts array.
export function pocketReplyMessages(texts: string[], createdAt: string, replyContextMessageId: string, speaker?: PocketGroupMember): PocketMessage[] {
  const entries = !speaker && texts.every(text => !/^[\[【](转账|图片|语音|位置|收款|退还)[:：]/.test(text)) ? [texts.join("\n")] : texts;
  return entries.map(content => {
    const id = crypto.randomUUID();
    let attachment: PocketAttachment | undefined;
    const transfer = content.match(/^[\[【]转账[:：](\d+(?:\.\d{1,2})?)(?:[:：]([^\]】]*))?[\]】]$/);
    const image = content.match(/^[\[【]图片[:：]([\s\S]+)[\]】]$/);
    const voice = content.match(/^[\[【]语音[:：](\d+)[:：]([\s\S]+)[\]】]$/);
    const location = content.match(/^[\[【]位置[:：]([^:：\]】\r\n]+)(?:[:：]([^\]】]*))?[\]】]$/);
    if (transfer) { try { attachment = { kind: "transfer", amount: parsePocketMoney(transfer[1]), note: (transfer[2] || "").slice(0, 100), status: "pending" }; } catch { /* Invalid tokens remain ordinary text. */ } }
    if (image) attachment = normalizePocketAttachment({ kind: "image", description: image[1] });
    if (voice) attachment = normalizePocketAttachment({ kind: "voice", seconds: Number(voice[1]), text: voice[2] });
    if (location) attachment = normalizePocketAttachment({ kind: "location", name: location[1], address: location[2] });
    return { id, role: "assistant", content: attachment ? pocketAttachmentContent(attachment, id) : content, createdAt, replyContextMessageId, ...(attachment ? { attachment } : {}), ...(speaker ? { speaker: { id: speaker.id, name: speaker.nickname || speaker.name, avatar: speaker.avatar } } : {}) };
  });
}
export function applyPocketTransferReplies(state: PocketState, conversationId: string, replies: PocketMessage[]): PocketState {
  let next = state;
  for (const reply of replies) {
    const action = reply.content.match(/^[\[【](收款|退还)[:：]([\w-]+)[\]】]$/);
    if (!action) continue;
    const settled = settlePocketTransfer(next, conversationId, action[2], action[1] === "收款" ? "received" : "returned", "assistant", reply.speaker?.id);
    if (settled === next) { reply.content = "这笔转账已处理或不属于我。"; continue; }
    next = settled;
    reply.content = action[1] === "收款" ? "[已收款]" : "[转账已退还]";
  }
  return next;
}

export function pocketMediaPrompt(conversation: PocketConversation, speakerId?: string) {
  const pending = conversation.messages.filter(message => message.role === "user" && message.attachment?.kind === "transfer" && message.attachment.status === "pending" && (!message.attachment.recipientId || message.attachment.recipientId === (speakerId || conversation.id)));
  return [
    "需要图片或语音时，可在 texts 中单独发送一条 [图片:具体画面描述] 或 [语音:1至60的整数秒数:语音文字内容]。图片是画面描述卡，语音是文字语音卡；不要声称已经拍摄、上传或录制了真实文件。普通聊天仍发送普通文字。",
    "需要分享地点、约见或指路时，可在 texts 中单独发送一条 [位置:地点名称:详细地址]，会显示为微信位置卡片。地点名称必填，地址可省略；根据聊天背景填写，不要声称获取了用户的实时定位。",
    "只有当前聊天明确涉及还钱、AA、请客或赠予等金钱往来时，才偶尔发送 [转账:金额:留言]，金额大于0且最多两位小数，一轮最多一笔。不要默认或频繁发钱。角色转账的收款人是用户。",
    pending.length ? `待你处理的用户转账编号：${JSON.stringify(pending.map(message => ({ id: message.id, content: message.content })))}。愿意收款则在 texts 单独发送 [收款:准确编号]，拒收则发送 [退还:准确编号]；仅实际输出此码才会改变收款状态。` : "没有需要你处理的用户转账，不要编造收款或退还编号。",
  ].join("\n");
}
