import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Image as ImageIcon, Mic, Wallet, X } from "lucide-react";
import { formatPocketMoney, normalizePocketAttachment, parsePocketMoney, type PocketAttachment } from "./pocketWechatMedia";
import { isPocketGroup, pocketDisplayName, type PocketConversation, type PocketMessage } from "./pocketPhoneState";
import { PocketWechatVoiceGlyph } from "./PocketWechatVoiceGlyph";

export function PocketWechatMessage({ message, onVoice, onTransfer }: { message: PocketMessage; onVoice: () => void; onTransfer: (action: "received" | "returned") => void }) {
  const attachment = message.attachment;
  const [zoomed, setZoomed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!zoomed) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [zoomed]);
  if (!attachment) return <div className="pocket-message-bubble">{message.content}</div>;
  if (attachment.kind === "voice") {
    const width = Math.min(165, 76 + attachment.seconds * 2);
    return <div className="pocket-wx-voice"><button type="button" onClick={onVoice} aria-label={`${attachment.shown ? "收起" : "展开"}语音文字`} aria-expanded={!!attachment.shown} style={{ width }} title={`${attachment.seconds}秒语音`}><PocketWechatVoiceGlyph seconds={attachment.seconds} outgoing={message.role === "user"} /></button>{attachment.shown && <p>{attachment.text}</p>}</div>;
  }
  if (attachment.kind === "image") return <><button type="button" className={`pocket-wx-image${attachment.url ? " has-photo" : ""}`} aria-label="查看聊天图片" onClick={() => setZoomed(true)}>{attachment.url ? <img src={attachment.url} alt={attachment.description} /> : <><ImageIcon size={28} /><small>图片</small><span>{attachment.description}</span></>}</button>{zoomed && <div className="pocket-wx-image-viewer" role="dialog" aria-modal="true" aria-label="聊天图片" onKeyDown={event => { if (event.key === "Escape") setZoomed(false); if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); } }}><button ref={closeRef} type="button" aria-label="关闭图片预览" onClick={() => setZoomed(false)}><X size={23} /></button>{attachment.url ? <img src={attachment.url} alt={attachment.description} /> : <ImageIcon size={64} />}<p>{attachment.description}</p></div>}</>;
  const pendingIncoming = message.role === "assistant" && attachment.status === "pending";
  return <div className={`pocket-wx-transfer status-${attachment.status}`}><div><span className="pocket-wx-transfer-icon">{attachment.status === "received" ? <Check size={23} /> : <Wallet size={23} />}</span><span><strong>¥{formatPocketMoney(attachment.amount)}</strong><small>{attachment.note || "微信转账"}</small>{attachment.recipientName && <small>给{attachment.recipientName}</small>}</span></div><footer>{attachment.status === "received" ? message.role === "user" ? "对方已收款" : "已收款" : attachment.status === "returned" ? "已退还" : message.role === "user" ? "待对方收款" : "待收款"}</footer>{pendingIncoming && <div className="pocket-wx-transfer-actions"><button type="button" onClick={() => onTransfer("received")}>确认收款 <ChevronRight size={12} /></button><button type="button" onClick={() => onTransfer("returned")}>退还</button></div>}</div>;
}

async function readPocketPhoto(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("请选择 PNG、JPEG、WebP 或 GIF 图片。");
  if (file.size > 8 * 1024 * 1024) throw new Error("请选择小于 8 MB 的图片。");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d"); if (!context) throw new Error("图片读取失败，请重试。");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", .75);
    if (url.length > 500000) throw new Error("图片内容过大，请选择更小的图片。");
    return url;
  } finally { bitmap.close(); }
}

export function PocketWechatAttachDialog({ kind, conversation, balance, onSend, onClose }: { kind: PocketAttachment["kind"]; conversation: PocketConversation; balance: number; onSend: (attachment: PocketAttachment) => void; onClose: () => void }) {
  const [amount, setAmount] = useState(""); const [text, setText] = useState(""); const [seconds, setSeconds] = useState("2");
  const [recipientId, setRecipientId] = useState(isPocketGroup(conversation) ? conversation.members[0]?.id || "" : conversation.id);
  const [url, setUrl] = useState(""); const [reading, setReading] = useState(false); const [error, setError] = useState("");
  const dialogRef = useRef<HTMLFormElement>(null); const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type="file"]), textarea, select') || []);
    focusable()[1]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      const elements = focusable();
      if (event.key === "Tab" && (event.shiftKey ? document.activeElement === elements[0] : document.activeElement === elements.at(-1))) { event.preventDefault(); (event.shiftKey ? elements.at(-1) : elements[0])?.focus(); }
    };
    dialog?.addEventListener("keydown", trap);
    return () => { mountedRef.current = false; dialog?.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);
  const title = kind === "transfer" ? "转账" : kind === "image" ? "发送图片" : "发送语音";
  return <div className="pocket-sheet-backdrop"><form ref={dialogRef} className="pocket-sheet pocket-wx-attach-sheet pocket-scroll" role="dialog" aria-modal="true" aria-label={title} onSubmit={event => {
    event.preventDefault(); if (reading) return;
    try {
      const recipient = isPocketGroup(conversation) ? conversation.members.find(member => member.id === recipientId) : conversation;
      if (kind === "transfer" && !recipient) throw new Error("请选择收款人。");
      const attachment = normalizePocketAttachment(kind === "transfer" ? { kind, amount: parsePocketMoney(amount), note: text, status: "pending", recipientId: recipient!.id, recipientName: pocketDisplayName(recipient!) } : kind === "image" ? { kind, description: text || (url ? "发送了一张图片" : ""), url } : { kind, text, seconds: Number(seconds) });
      if (!attachment) throw new Error(kind === "voice" ? "请填写语音内容，时长为 1 至 60 的整数秒数。" : "请填写图片描述或选择图片。");
      onSend(attachment); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "消息发送失败。"); }
  }}><header><h3>{title}</h3><button type="button" aria-label="关闭附件编辑" onClick={onClose}><X size={18} /></button></header>
    {kind === "transfer" ? <>{isPocketGroup(conversation) ? <label className="pocket-field">收款人<select aria-label="收款人" value={recipientId} onChange={event => setRecipientId(event.target.value)}>{conversation.members.map(member => <option key={member.id} value={member.id}>{pocketDisplayName(member)}</option>)}</select></label> : <div className="pocket-wx-recipient">转账给 {pocketDisplayName(conversation)}</div>}<label className="pocket-field">转账金额（元）<input aria-label="转账金额" inputMode="decimal" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} /></label><small>零钱余额 ¥{formatPocketMoney(balance)}</small><label className="pocket-field">转账说明<input maxLength={100} value={text} placeholder="添加转账说明" onChange={event => setText(event.target.value)} /></label></> : kind === "image" ? <><label className="pocket-field">图片描述<textarea aria-label="图片描述" rows={4} maxLength={2000} placeholder="描述这张图片里的画面…" value={text} onChange={event => setText(event.target.value)} /></label><label className="pocket-field">选择图片（可选）<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={reading} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; setReading(true); setError(""); setUrl(""); try { const photo = await readPocketPhoto(file); if (mountedRef.current) { setUrl(photo); if (!text.trim()) setText(file.name); } } catch (cause) { if (mountedRef.current) setError(cause instanceof Error ? cause.message : "图片读取失败。"); } finally { if (mountedRef.current) setReading(false); } }} /></label>{url && <img className="pocket-wx-photo-preview" src={url} alt="待发送图片" />}{reading && <p role="status">正在读取图片…</p>}</> : <><label className="pocket-field">语音时长（秒）<input aria-label="语音时长" type="number" min={1} max={60} step={1} value={seconds} onChange={event => setSeconds(event.target.value)} /></label><label className="pocket-field">语音内容<textarea aria-label="语音内容" rows={4} maxLength={2000} value={text} placeholder="输入这条语音的文字内容…" onChange={event => setText(event.target.value)} /></label><small>点击聊天中的语音气泡可以展开文字。</small></>}
    {error && <p className="pocket-editor-error" role="alert">{error}</p>}<button className="pocket-wx-green-button" type="submit" disabled={reading}>{kind === "transfer" ? <Wallet size={17} /> : kind === "image" ? <ImageIcon size={17} /> : <Mic size={17} />}{kind === "transfer" ? "确认转账" : "发送"}</button>
  </form></div>;
}
