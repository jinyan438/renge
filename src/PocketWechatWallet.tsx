import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Banknote, ChevronRight, CircleDollarSign, CreditCard, Gift, Heart, MoreHorizontal, QrCode, Settings, ShieldCheck, Smile, Star, Ticket, UserRound, Wallet, X } from "lucide-react";
import { DEFAULT_POCKET_USER_AVATAR, safePocketAvatar } from "./pocketPhoneState";
import { formatPocketMoney, parsePocketMoney, type PocketWallet } from "./pocketWechatMedia";

export type PocketWalletPage = "me" | "service" | "wallet" | "balance" | "bills";
export function PocketWechatWallet({ wallet, nickname, avatar, page, onPage, onBalance, onSettings }: {
  wallet: PocketWallet; nickname: string; avatar: string; page: PocketWalletPage;
  onPage: (page: PocketWalletPage) => void; onBalance: (amount: number) => void; onSettings: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing && !detail) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]') || []);
    (editing ? inputRef.current : focusable()[0])?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setEditing(false); setDetail(""); }
      const elements = focusable();
      if (event.key === "Tab" && (event.shiftKey ? document.activeElement === elements[0] : document.activeElement === elements.at(-1))) { event.preventDefault(); (event.shiftKey ? elements.at(-1) : elements[0])?.focus(); }
    };
    dialog?.addEventListener("keydown", trap);
    return () => { dialog?.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, [editing, detail]);
  const edit = () => { setAmount(formatPocketMoney(wallet.balance)); setError(""); setEditing(true); };
  const back = () => onPage(page === "service" ? "me" : page === "wallet" ? "service" : "wallet");
  const rows = [
    { icon: Star, name: "收藏", color: "#f3ad38", note: "暂无收藏" },
    { icon: CircleDollarSign, name: "朋友圈", color: "#10aeff", note: "暂无朋友圈动态" },
    { icon: CreditCard, name: "卡包", color: "#2782d7", note: "暂无卡券" },
    { icon: Smile, name: "表情", color: "#f7b437", note: "暂无收藏的表情" },
  ];
  return <div className={`pocket-wx-account wx-page-${page}`}>
    <div className="pocket-wx-account-content pocket-scroll" inert={editing || detail ? true : undefined}>
      {page === "me" ? <>
        <div className="pocket-wx-profile"><img src={safePocketAvatar(avatar || DEFAULT_POCKET_USER_AVATAR)} alt={nickname} /><span><strong>{nickname}</strong><small>微信号：{nickname}</small><span className="pocket-wx-status"><Smile size={11} /> 状态</span></span><QrCode size={18} /><ChevronRight size={16} /></div>
        <button className="pocket-wx-row pocket-wx-service-entry" type="button" onClick={() => onPage("service")}><Wallet size={22} color="#07c160" /><span>服务</span><ChevronRight size={17} /></button>
        <div className="pocket-wx-row-group">{rows.map(row => <button className="pocket-wx-row" type="button" key={row.name} onClick={() => setDetail(row.note)}><row.icon size={22} color={row.color} /><span>{row.name}</span><ChevronRight size={17} /></button>)}</div>
        <button className="pocket-wx-row" type="button" onClick={onSettings}><Settings size={22} /><span>设置</span><ChevronRight size={17} /></button>
      </> : <>
        <header className="pocket-wx-page-header"><button type="button" onClick={back} aria-label={page === "service" ? "返回我" : "返回钱包上一级"}><ArrowLeft size={20} /></button><strong>{page === "service" ? "服务" : page === "wallet" ? "钱包" : page === "balance" ? "零钱" : "账单"}</strong><button type="button" aria-label={page === "balance" ? "修改零钱余额" : "查看账单"} onClick={page === "balance" ? edit : () => onPage("bills")}><MoreHorizontal size={22} /></button></header>
        {page === "service" ? <>
          <div className="pocket-wx-pay-card"><button type="button" onClick={() => onPage("balance")}><QrCode size={29} /><strong>收付款</strong></button><button type="button" aria-label="钱包" onClick={() => onPage("wallet")}><Wallet size={29} /><strong>钱包</strong><small>¥{formatPocketMoney(wallet.balance)}</small></button></div>
          <div className="pocket-wx-services"><h4>金融理财</h4><div>{[{ icon: CreditCard, label: "信用卡还款" }, { icon: CircleDollarSign, label: "理财通" }, { icon: ShieldCheck, label: "保险服务" }].map(item => <button type="button" key={item.label} onClick={() => setDetail(`${item.label}暂无记录`)}><item.icon size={24} /><span>{item.label}</span></button>)}</div></div>
          <div className="pocket-wx-services"><h4>生活服务</h4><div>{[{ icon: Banknote, label: "手机充值" }, { icon: Heart, label: "生活缴费" }, { icon: Ticket, label: "城市服务" }, { icon: Gift, label: "公益" }, { icon: ShieldCheck, label: "医疗健康" }, { icon: UserRound, label: "出行服务" }].map(item => <button type="button" key={item.label} onClick={() => setDetail(`${item.label}暂无记录`)}><item.icon size={24} /><span>{item.label}</span></button>)}</div></div>
        </> : page === "wallet" ? <>
          <div className="pocket-wx-wallet-list">
            <button className="pocket-wx-row" type="button" onClick={() => onPage("balance")}><CircleDollarSign size={23} color="#eba234" /><span>零钱</span><small>¥{formatPocketMoney(wallet.balance)}</small><ChevronRight size={16} /></button>
            <button className="pocket-wx-row" type="button" onClick={() => setDetail("零钱通余额 ¥0.00")}><CircleDollarSign size={23} color="#e29a34" /><span>零钱通</span><small>¥0.00</small><ChevronRight size={16} /></button>
            <button className="pocket-wx-row" type="button" onClick={() => setDetail("暂无银行卡")}><CreditCard size={23} color="#e3933c" /><span>银行卡</span><ChevronRight size={16} /></button>
          </div>
          <div className="pocket-wx-row-group"><button className="pocket-wx-row" type="button" onClick={() => setDetail("支付分 0")}><ShieldCheck size={23} color="#e5a440" /><span>支付分</span><small>0</small><ChevronRight size={16} /></button><button className="pocket-wx-row" type="button" onClick={() => setDetail("暂无亲属卡")}><Heart size={23} color="#e5a440" /><span>亲属卡</span><ChevronRight size={16} /></button></div>
          <button className="pocket-wx-row" type="button" onClick={() => onPage("bills")}><Banknote size={23} color="#e5a440" /><span>账单</span><ChevronRight size={16} /></button>
          <footer className="pocket-wx-wallet-footer"><ShieldCheck size={13} /> 微信支付</footer>
        </> : page === "balance" ? <div className="pocket-wx-balance"><span className="pocket-wx-coin">¥</span><h3>我的零钱</h3><strong aria-label="零钱余额">¥{formatPocketMoney(wallet.balance)}</strong><button className="pocket-wx-edit-balance" type="button" onClick={edit}>修改余额</button><button className="pocket-wx-bills-link" type="button" onClick={() => onPage("bills")}>查看零钱明细</button><p><ShieldCheck size={13} /> 账户安全保障中</p></div> : <div className="pocket-wx-bills">
          {wallet.bills.length ? [...wallet.bills].reverse().map(bill => <div className="pocket-wx-bill" key={bill.id}><span className={`pocket-wx-bill-icon kind-${bill.kind}`}><Wallet size={19} /></span><span><strong>{bill.title}</strong><small>{new Date(bill.wechatTime || bill.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></span><span><strong>{bill.amount >= 0 ? "+" : "−"}{formatPocketMoney(Math.abs(bill.amount))}</strong><small>余额 {formatPocketMoney(bill.balance)}</small></span></div>) : <div className="pocket-wx-no-bills"><Banknote size={42} /><p>暂无账单</p></div>}
        </div>}
      </>}
    </div>
    {(editing || detail) && <div className="pocket-wx-modal-backdrop"><div className="pocket-wx-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={editing ? "修改零钱余额" : "详情"}><header><strong>{editing ? "修改零钱余额" : "详情"}</strong><button type="button" aria-label="关闭钱包弹窗" onClick={() => { setEditing(false); setDetail(""); }}><X size={18} /></button></header>{editing ? <form onSubmit={event => { event.preventDefault(); try { onBalance(parsePocketMoney(amount, true)); setEditing(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "余额保存失败。"); } }}><label>零钱金额（元）<input ref={inputRef} inputMode="decimal" aria-label="零钱金额" value={amount} onChange={event => setAmount(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<button className="pocket-wx-green-button" type="submit">保存余额</button></form> : <><p>{detail}</p><button className="pocket-wx-green-button" type="button" onClick={() => setDetail("")}>知道了</button></>}</div></div>}
  </div>;
}
