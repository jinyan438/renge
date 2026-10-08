import { useEffect, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import type { PocketAttachment } from "./pocketWechatMedia";

type PocketLocation = Extract<PocketAttachment, { kind: "location" }>;

// A local map illustration keeps manually entered and fictional places usable
// without a map service or invented geographic coordinates.
function LocationMap() {
  return <svg className="pocket-wx-location-map" viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <path fill="#eef0e8" d="M0 0h240v110H0z" />
    <path fill="#dce8cf" d="M14 8h48v25H14zM170 8h54v29h-54zM13 76h42v28H13zM153 77h33v28h-33z" />
    <path fill="#e2e5db" d="M77 8h60v27H77zM74 77h58v29H74zM193 74h32v31h-32z" />
    <path fill="none" stroke="#d9dece" strokeWidth="13" d="M-10 58 250 48M67-10l-2 130M147-10l-4 130M-10 73 240 116" />
    <path fill="none" stroke="#fff" strokeWidth="9" d="M-10 58 250 48M67-10l-2 130M147-10l-4 130M-10 73 240 116" />
    <path fill="none" stroke="#f7df9a" strokeWidth="6" d="m211-10-13 63 19 67" />
    <path fill="none" stroke="#fff4cc" strokeWidth="3" d="m211-10-13 63 19 67" />
    <ellipse cx="120" cy="62" rx="10" ry="3" fill="#64785b" opacity=".15" />
    <path fill="#f05b50" stroke="#fff" strokeWidth="1.5" d="M120 61c-3-5-12-13-12-21a12 12 0 0 1 24 0c0 8-9 16-12 21Z" />
    <circle cx="120" cy="40" r="4" fill="#fff" />
  </svg>;
}

export function PocketWechatLocation({ location }: { location: PocketLocation }) {
  const [opened, setOpened] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!opened) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [opened]);
  return <>
    <button type="button" className="pocket-wx-location" aria-label={`查看位置：${location.name}`} onClick={() => setOpened(true)}>
      <span className="pocket-wx-location-copy"><strong>{location.name}</strong>{location.address && <small>{location.address}</small>}</span>
      <LocationMap />
      <span className="pocket-wx-location-footer"><MapPin size={10} />位置</span>
    </button>
    {opened && <section className="pocket-wx-location-viewer pocket-scroll" role="dialog" aria-modal="true" aria-label="位置信息" onKeyDown={event => {
      if (event.key === "Escape") setOpened(false);
      if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); }
    }}>
      <header><strong>位置信息</strong><button ref={closeRef} type="button" aria-label="关闭位置信息" onClick={() => setOpened(false)}><X size={20} /></button></header>
      <LocationMap />
      <div className="pocket-wx-location-details"><MapPin size={23} /><div><h3>{location.name}</h3>{location.address && <p>{location.address}</p>}<small>地图示意 · 以填写的位置信息为准</small></div></div>
    </section>}
  </>;
}
