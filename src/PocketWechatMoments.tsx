import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Camera, Flame, Heart, ImagePlus, LockKeyhole, MapPin, MessageCircle, MoreHorizontal, RefreshCw, Square, Trash2, Users, X } from "lucide-react";
import { safePocketAvatar } from "./pocketPhoneState";
import { readPocketPhoto } from "./PocketWechatAttachments";
import { visiblePocketMoments, POCKET_MOMENTS_USER_ID, type MomentActor, type MomentDraft, type MomentPerson, type PocketMoment } from "./pocketMomentsState";
import "./pocket-moments.css";

type Props = {
  viewer: MomentActor; friends: MomentActor[]; posts: PocketMoment[]; cover: string;
  busy: boolean; pending: boolean; error: string; feedback: string;
  onPublish: (draft: MomentDraft, id?: string) => void; onLike: (id: string) => void;
  onComment: (id: string, text: string, replyTo?: MomentPerson) => void;
  onDelete: (id: string) => void; onDeleteComment: (postId: string, commentId: string) => void;
  onGenerate: (kind: "feed" | "self" | "interact" | "reply", id?: string) => void;
  onClear: (ids: string[]) => void; onCover: (url: string) => void; onCancel: () => void; onExit: () => void;
};
const emptyDraft = (): MomentDraft => ({ text: "", pic: "", images: [], location: "", visibility: "public", visibleTo: [] });
function momentTime(post: PocketMoment) {
  const date = new Date(post.wechatTime || post.createdAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
export function PocketWechatMoments(props: Props) {
  const [publishing, setPublishing] = useState(false); const [editId, setEditId] = useState("");
  const [draft, setDraft] = useState<MomentDraft>(emptyDraft); const [localError, setLocalError] = useState(""); const [reading, setReading] = useState(false);
  const [menuId, setMenuId] = useState(""); const [authorId, setAuthorId] = useState(""); const [photo, setPhoto] = useState("");
  const [comment, setComment] = useState<{ postId: string; text: string; replyTo?: MomentPerson } | null>(null);
  const mounted = useRef(true); const lightbox = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!photo) return; const button = lightbox.current?.querySelector<HTMLButtonElement>("button"); button?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPhoto(""); if (event.key === "Tab") { event.preventDefault(); button?.focus(); } };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [photo]);
  const people = new Map([props.viewer, ...props.friends].map(person => [person.id, person]));
  const name = (person: MomentPerson) => people.get(person.id)?.name || person.name;
  const visible = visiblePocketMoments(props.posts, props.viewer, props.friends, authorId);
  const start = (post?: PocketMoment) => { setDraft(post ? { text: post.text, pic: post.pic, images: post.images, location: post.location, visibility: post.visibility, visibleTo: post.visibleTo } : emptyDraft()); setEditId(post?.id || ""); setLocalError(""); setPublishing(true); setMenuId(""); };
  function publish(event: FormEvent) { event.preventDefault(); if (reading) return; try { props.onPublish(draft, editId || undefined); setPublishing(false); setLocalError(""); } catch (error) { setLocalError(error instanceof Error ? error.message : "发布失败。"); } }
  async function readImages(files: File[]) {
    setLocalError(""); setReading(true);
    try { if (draft.images.length + files.length > 9) throw new Error("最多添加 9 张图片。"); const urls = await Promise.all(files.map(readPocketPhoto)); if (mounted.current) setDraft(previous => ({ ...previous, images: [...previous.images, ...urls] })); }
    catch (error) { if (mounted.current) setLocalError(error instanceof Error ? error.message : "图片读取失败。"); }
    finally { if (mounted.current) setReading(false); }
  }
  return <div className="pocket-moments">
    {publishing ? <>
      <header className="pocket-moment-publish-header"><button type="button" disabled={reading} onClick={() => setPublishing(false)}>取消</button><strong>{editId ? "编辑朋友圈" : "发表朋友圈"}</strong><button type="submit" form="pocket-moment-publish" disabled={reading || !(draft.text.trim() || draft.pic.trim() || draft.images.length)}>发表</button></header>
      <form id="pocket-moment-publish" className="pocket-moment-publish pocket-scroll" onSubmit={publish}>
        <textarea aria-label="朋友圈正文" maxLength={6000} placeholder="这一刻的想法…" value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} autoFocus />
        <label className="pocket-moment-field"><ImagePlus size={17} />配图描述<textarea aria-label="朋友圈配图描述" rows={2} maxLength={2000} placeholder="也可以用文字描述一张图" value={draft.pic} onChange={event => setDraft({ ...draft, pic: event.target.value })} /></label>
        <div className="pocket-moment-upload-grid">{draft.images.map((url, index) => <span key={index}><img src={url} alt={`待发布图片${index + 1}`} /><button type="button" aria-label={`移除图片${index + 1}`} onClick={() => setDraft({ ...draft, images: draft.images.filter((_, item) => item !== index) })}><X size={13} /></button></span>)}{draft.images.length < 9 && <label className="pocket-moment-photo-add"><ImagePlus size={24} /><span>选择图片</span><input aria-label="选择朋友圈图片" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" disabled={reading} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void readImages(files); }} /></label>}</div>
        <label className="pocket-moment-field"><MapPin size={17} />所在位置<input aria-label="朋友圈位置" maxLength={80} placeholder="不显示位置" value={draft.location} onChange={event => setDraft({ ...draft, location: event.target.value })} /></label>
        <label className="pocket-moment-field"><Users size={17} />谁可以看<select aria-label="朋友圈可见范围" value={draft.visibility} onChange={event => setDraft({ ...draft, visibility: event.target.value as MomentDraft["visibility"] })}><option value="public">公开 · 好友可见</option><option value="private">私密 · 仅自己可见</option><option value="part">部分可见</option></select></label>
        {draft.visibility === "part" && <fieldset className="pocket-moment-audience"><legend>选择可以看的好友</legend>{props.friends.map(person => <label key={person.id}><img src={safePocketAvatar(person.avatar)} alt="" /><span>{person.name}</span><input type="checkbox" checked={draft.visibleTo.includes(person.id)} onChange={event => setDraft({ ...draft, visibleTo: event.target.checked ? [...draft.visibleTo, person.id] : draft.visibleTo.filter(id => id !== person.id) })} /></label>)}{!props.friends.length && <p>先添加一位微信好友。</p>}</fieldset>}
        {reading && <p role="status">正在读取图片…</p>}{localError && <p className="pocket-moment-error" role="alert">{localError}</p>}
      </form>
    </> : <>
      <header className="pocket-moments-header"><button type="button" aria-label={authorId ? "查看全部朋友圈" : "返回微信"} onClick={() => authorId ? setAuthorId("") : props.onExit()}><ArrowLeft size={20} /></button><strong>朋友圈</strong><button type="button" aria-label="生成好友朋友圈" title="生成好友动态" disabled={props.busy} onClick={() => props.onGenerate("feed")}><RefreshCw size={18} /></button><button type="button" aria-label="发表朋友圈" onClick={() => start()}><Camera size={21} /></button></header>
      {props.pending && <div className="pocket-moment-progress" role="status"><span>正在生成朋友圈…</span><button type="button" aria-label="停止朋友圈生成" onClick={props.onCancel}><Square size={12} />停止</button></div>}
      {(props.error || localError) && <p className="pocket-moment-error" role="alert">{props.error || localError}</p>}{props.feedback && !props.pending && <p className="pocket-moment-feedback" role="status">{props.feedback}</p>}
      <div className="pocket-moments-scroll pocket-scroll">
        <div className="pocket-moments-cover" style={props.cover ? { backgroundImage: `url(${JSON.stringify(props.cover)})` } : undefined}>
          <label className="pocket-moment-cover-picker" title="更换朋友圈封面"><Camera size={16} /><input type="file" aria-label="选择朋友圈封面" accept="image/png,image/jpeg,image/webp,image/gif" disabled={reading} onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setReading(true); setLocalError(""); try { const url = await readPocketPhoto(file); if (mounted.current) props.onCover(url); } catch (error) { if (mounted.current) setLocalError(error instanceof Error ? error.message : "封面读取失败。"); } finally { if (mounted.current) setReading(false); } }} /></label>
          <div className="pocket-moments-profile"><strong>{props.viewer.name}</strong><img src={safePocketAvatar(props.viewer.avatar)} alt={props.viewer.name} /></div>
        </div>
        <div className="pocket-moment-filters"><button type="button" aria-pressed={!authorId} onClick={() => setAuthorId("")}>全部</button><button type="button" aria-pressed={authorId === props.viewer.id} onClick={() => setAuthorId(props.viewer.id)}>我的动态</button>{props.viewer.id !== POCKET_MOMENTS_USER_ID && <button type="button" disabled={props.busy} onClick={() => props.onGenerate("self")}><RefreshCw size={12} />生成 ta 的动态</button>}<button type="button" aria-label="清空当前朋友圈" disabled={!visible.length} onClick={() => props.onClear(visible.map(post => post.id))}><Trash2 size={14} /></button></div>
        {authorId && authorId !== props.viewer.id && <p className="pocket-moment-author-filter">{people.get(authorId)?.name || visible[0]?.author.name}的动态</p>}
        {!visible.length && <div className="pocket-moments-empty"><MessageCircle size={30} /><p>还没有朋友圈动态</p><small>发一条这一刻的想法，或生成好友的近况。</small></div>}
        {visible.map(post => <article className="pocket-moment-post" key={post.id} data-moment-id={post.id}>
          <button className="pocket-moment-avatar" type="button" aria-label={`查看${name(post.author)}的朋友圈`} onClick={() => setAuthorId(post.author.id)}><img src={safePocketAvatar(people.get(post.author.id)?.avatar || post.author.avatar)} alt="" /></button>
          <div className="pocket-moment-body"><button className="pocket-moment-name" type="button" onClick={() => setAuthorId(post.author.id)}>{name(post.author)}</button>{post.text && <p className="pocket-moment-text">{post.text}</p>}
            {post.pic && <div className="pocket-moment-description"><ImagePlus size={18} /><p>{post.pic}</p></div>}
            {!!post.images.length && <div className={`pocket-moment-images${post.images.length === 1 ? " is-single" : ""}`}>{post.images.map((url, index) => <button type="button" key={index} aria-label={`查看朋友圈图片${index + 1}`} onClick={() => setPhoto(url)}><img src={url} alt={post.pic || `朋友圈图片${index + 1}`} /></button>)}</div>}
            {post.location && <span className="pocket-moment-location"><MapPin size={11} />{post.location}</span>}
            <div className="pocket-moment-foot"><time>{momentTime(post)}{post.visibility !== "public" && <span title={post.visibility === "private" ? "仅自己可见" : "部分可见"}>{post.visibility === "private" ? <LockKeyhole size={10} /> : <Users size={10} />}{post.visibility === "private" ? "私密" : "部分可见"}</span>}</time><button type="button" aria-label="朋友圈操作" aria-expanded={menuId === post.id} onClick={() => setMenuId(menuId === post.id ? "" : post.id)}><MoreHorizontal size={18} /></button></div>
            {menuId === post.id && <div className="pocket-moment-menu"><button type="button" disabled={post.author.id === props.viewer.id} onClick={() => { try { props.onLike(post.id); setLocalError(""); } catch (error) { setLocalError(error instanceof Error ? error.message : "点赞失败。"); } }}><Heart size={13} />{post.likes.some(like => like.person.id === props.viewer.id) ? "取消赞" : "赞"}</button><button type="button" onClick={() => { setComment({ postId: post.id, text: "" }); setMenuId(""); }}><MessageCircle size={13} />评论</button><button type="button" disabled={props.busy} onClick={() => props.onGenerate("interact", post.id)}><Flame size={13} />好友互动</button>{post.author.id !== POCKET_MOMENTS_USER_ID && post.comments.some(comment => comment.person.id !== post.author.id) && <button type="button" disabled={props.busy} onClick={() => props.onGenerate("reply", post.id)}>让帖主回复</button>}{post.author.id === props.viewer.id && <button type="button" onClick={() => start(post)}>编辑</button>}<button type="button" onClick={() => props.onDelete(post.id)}>删除</button></div>}
            {(post.likes.length > 0 || post.comments.length > 0) && <div className="pocket-moment-interactions">{!!post.likes.length && <div className="pocket-moment-likes"><Heart size={12} />{post.likes.map(like => name(like.person)).join("、")}</div>}{post.comments.map(item => <div className="pocket-moment-comment" key={item.id}><button type="button" aria-label={`回复${name(item.person)}的评论`} disabled={item.person.id === props.viewer.id} onClick={() => setComment({ postId: post.id, text: "", replyTo: item.person })}><b>{name(item.person)}</b>{item.replyTo && <> 回复 <b>{name(item.replyTo)}</b></>}：{item.text}</button>{(item.person.id === props.viewer.id || post.author.id === props.viewer.id) && <button className="pocket-moment-comment-delete" type="button" aria-label="删除这条评论" onClick={() => props.onDeleteComment(post.id, item.id)}><X size={11} /></button>}</div>)}</div>}
            {comment?.postId === post.id && <form className="pocket-moment-comment-form" onSubmit={event => { event.preventDefault(); try { props.onComment(post.id, comment.text, comment.replyTo); setComment(null); setLocalError(""); } catch (error) { setLocalError(error instanceof Error ? error.message : "评论失败。"); } }}>{comment.replyTo && <span>回复 {name(comment.replyTo)}</span>}<input aria-label="朋友圈评论" autoFocus maxLength={2000} placeholder={comment.replyTo ? `回复${name(comment.replyTo)}` : "评论…"} value={comment.text} onChange={event => setComment({ ...comment, text: event.target.value })} /><button type="submit" disabled={!comment.text.trim()}>发送评论</button><button type="button" aria-label="取消朋友圈评论" onClick={() => setComment(null)}><X size={13} /></button></form>}
          </div>
        </article>)}
      </div>
    </>}
    {photo && <div className="pocket-moment-lightbox" ref={lightbox} role="dialog" aria-modal="true" aria-label="朋友圈图片"><button type="button" aria-label="关闭朋友圈图片" onClick={() => setPhoto("")}><X size={22} /></button><img src={photo} alt="朋友圈图片预览" /></div>}
  </div>;
}
