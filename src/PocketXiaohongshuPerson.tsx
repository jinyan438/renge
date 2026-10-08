import { useState, type ReactNode } from "react";
import { ChevronLeft, Copy, MoreHorizontal, Search, UserRoundPlus } from "lucide-react";
import { DEFAULT_POCKET_USER_AVATAR } from "./pocketPhoneState";
import { redActorNickname, redActorProfile, type RedActor, type RedNote } from "./pocketXiaohongshuState";

type Props = { actor: RedActor; notes: RedNote[]; followed: boolean; onBack: () => void; onFollow: () => void; onMessage: () => void; onPersonality: () => void; renderNotes: (notes: RedNote[]) => ReactNode };

export function PocketXiaohongshuPerson({ actor, notes, followed, onBack, onFollow, onMessage, onPersonality, renderNotes }: Props) {
  const [tab, setTab] = useState("笔记");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const nickname = redActorNickname(actor);
  const profile = actor.profile || redActorProfile({}, actor.id);
  const likes = Math.max(profile.receivedLikes, notes.reduce((sum, note) => sum + note.likes + note.saves, 0));
  const visible = tab === "笔记" ? notes.filter(note => `${note.title} ${note.content} ${note.tags.join(" ")}`.includes(query.trim())) : [];
  return <div className={`xhs-person-page background-${profile.background}`} aria-label={`${nickname}的主页`}>
    <div className="xhs-person-hero">
      <header><button type="button" aria-label="返回人物主页上一页" onClick={onBack}><ChevronLeft /></button><button type="button" aria-label="查看人物资料" onClick={onPersonality}><MoreHorizontal /></button></header>
      <div className="xhs-person-identity"><img className="xhs-avatar" src={actor.avatar} alt={`${nickname}的头像`} onError={event => { if (event.currentTarget.getAttribute("src") !== DEFAULT_POCKET_USER_AVATAR) event.currentTarget.src = DEFAULT_POCKET_USER_AVATAR; }} /><div><h2>{nickname}</h2><span>小红书号：{profile.handle}<button type="button" aria-label="复制小红书号" onClick={() => { void navigator.clipboard?.writeText(profile.handle).catch(() => {}); }}><Copy /></button></span></div></div>
      <div className="xhs-person-stats"><span><b>{profile.following}</b>关注</span><span><b>{profile.followers + Number(followed)}</b>粉丝</span><span><b>{likes}</b>获赞与收藏</span></div>
      <p className="xhs-person-bio">{profile.bio || actor.personality.split("\n")[0].slice(0, 120)}</p>
      <div className="xhs-person-chips">{(profile.gender || profile.age > 0) && <span>{profile.gender === "女" ? "♀" : profile.gender === "男" ? "♂" : profile.gender} {profile.age > 0 ? `${profile.age}岁` : ""}</span>}{profile.location && <span>{profile.location}</span>}</div>
      <div className="xhs-person-actions"><button type="button" className="xhs-person-follow" aria-pressed={followed} onClick={onFollow}>{followed ? "已关注" : "关注"}</button><button type="button" onClick={onMessage}>发私信</button><button type="button" aria-label="人物资料" onClick={onPersonality}><UserRoundPlus /></button></div>
    </div>
    <section className="xhs-person-notes"><nav aria-label="人物笔记"><div>{["笔记", "收藏"].map(label => <button key={label} type="button" className={tab === label ? "is-active" : ""} aria-pressed={tab === label} onClick={() => setTab(label)}>{label}</button>)}</div><button type="button" aria-label="搜索人物笔记" aria-expanded={searching} onClick={() => { setSearching(previous => !previous); setQuery(""); }}><Search /></button></nav>{searching && <label className="xhs-person-search"><Search /><input autoFocus aria-label="搜索此人的笔记" value={query} onChange={event => setQuery(event.target.value)} /></label>}{visible.length > 0 && renderNotes(visible)}</section>
  </div>;
}
