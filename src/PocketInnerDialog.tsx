import type { CSSProperties, RefObject } from "react";
import { Heart, X } from "lucide-react";
import { POCKET_HORMONES } from "./pocketPhoneInner";
import { pocketDisplayName, safePocketAvatar, type PocketGroupMember } from "./pocketPhoneState";

export function PocketPhoneInner({ person, dialogRef, onClose }: { person: PocketGroupMember; dialogRef: RefObject<HTMLDivElement | null>; onClose: () => void }) {
  const state = person.innerState;
  return <div className="pocket-inner-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="pocket-inner-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="pocket-inner-title">
      <header><img src={safePocketAvatar(person.avatar)} alt="" /><div><h3 id="pocket-inner-title">{pocketDisplayName(person)}</h3><span>此刻的心事</span></div><button type="button" aria-label="关闭内心独白" onClick={onClose}><X size={17} /></button></header>
      <div className="pocket-inner-scroll">
        <section className="pocket-inner-monologue"><h4><Heart size={13} />内心独白</h4><p>{state?.monologue || "…"}</p></section>
        <section className="pocket-inner-hormones"><h4>激素状态</h4>{POCKET_HORMONES.map(item => {
          const value = state?.hormones[item.key];
          const before = state?.previousHormones?.[item.key];
          const delta = value !== undefined && before !== undefined ? Math.round((value - before) * 10) / 10 : 0;
          return <div className="pocket-hormone" key={item.key} style={{ "--hormone-color": item.color } as CSSProperties}>
            <div><span>{item.name}</span><span>{delta !== 0 && <small className={delta > 0 ? "is-up" : "is-down"}>{delta > 0 ? "+" : ""}{delta}</small>}<b>{value ?? "—"}</b></span></div>
            <div className="pocket-hormone-track" role="progressbar" aria-label={item.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={value === undefined ? "尚未生成" : `${value} / 100`}><i style={{ width: `${value ?? 0}%` }} /></div>
          </div>;
        })}</section>
      </div>
    </div>
  </div>;
}
