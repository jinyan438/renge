import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Flag, Heart, History, ImagePlus, ListFilter, MessageCircle, MoreHorizontal, Music2, PencilLine, Plus, Search, Smile, Sparkles, Square, Star, Users, VolumeX, X } from "lucide-react";
import { DEFAULT_POCKET_AVATAR, DEFAULT_POCKET_USER_AVATAR } from "./pocketPhoneState";
import { emptyRedState, normalizeRedState, redActorNickname, redStorageKey, safeRedImage, toggleRedItem, type RedActor, type RedComment, type RedNote, type RedState } from "./pocketXiaohongshuState";
import { PocketXiaohongshuPerson } from "./PocketXiaohongshuPerson";
import { appendGeneratedRedFeed, appendGeneratedRedReplies, buildRedTaskContact, getRedRoleChoices, selectedRedRoles, syncRedRoleAvatars, type RedRole, type RedTask } from "./pocketXiaohongshuGeneration";
import { applyRedContextChanges, clearRedContent, redContextConversation } from "./pocketXiaohongshuContext";
import { subscribePocketContextChanges } from "./pocketPhoneSync";
import { requestPocketReply, type PocketProvider } from "./pocketPhoneChat";
import type { PocketContextSync, PocketConversationBuilder } from "./pocketPhoneContext";
import "./pocket-xiaohongshu.css";

type View = "feed" | "search" | "profile" | "messages" | "history" | "market";
type Sheet = "menu" | "share" | "publish" | "comment" | "person" | null;
type Props = {
  sessionId: string; nickname: string; bio: string; avatar: string; roles: RedRole[];
  provider: PocketProvider | undefined; modelId: string;
  onBuildConversation: PocketConversationBuilder; onSyncContext: PocketContextSync;
  onSettings: () => void; onExit: () => void;
  onMessage: (actor: RedActor) => void;
};
const channels = ["推荐", "RED", "热点", "直播", "短剧", "穿搭"];
const categories = ["推荐", "游戏", "生活", "职场", "情感", "穿搭"];

function RedAvatar({ src, name }: { src: string; name: string }) {
  return <img className="xhs-avatar" src={src} alt={`${name}的头像`} decoding="async" onError={event => { if (event.currentTarget.getAttribute("src") !== DEFAULT_POCKET_USER_AVATAR) event.currentTarget.src = DEFAULT_POCKET_USER_AVATAR; }} />;
}

function RedShareIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 3.5v4C7 8 4 12 3 19c3-4 6-6 11.5-6v4l7-7-7-6.5Z" /></svg>;
}

async function readPhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("请选择 JPG、PNG、WebP 或 GIF 图片");
  if (file.size > 15 * 1024 * 1024) throw new Error("单张图片不能超过 15 MB");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file);
  });
  const picture = await new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("图片无法打开")); image.src = data; });
  const scale = Math.min(1, 800 / Math.max(picture.width, picture.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(picture.width * scale)); canvas.height = Math.max(1, Math.round(picture.height * scale));
  const context = canvas.getContext("2d"); if (!context) throw new Error("图片处理失败");
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(picture, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", .78);
}

export function PocketXiaohongshu({ sessionId, nickname, bio, avatar, roles, provider, modelId, onBuildConversation, onSyncContext, onSettings, onExit, onMessage }: Props) {
  const storageKey = redStorageKey(sessionId);
  const [state, setState] = useState<RedState>(() => {
    try { return normalizeRedState(JSON.parse(localStorage.getItem(storageKey) || "null")); } catch { return emptyRedState(); }
  });
  const stateRef = useRef(state);
  const roleChoices = getRedRoleChoices(roles, state.actors).filter(role => role.name !== nickname);
  const generationRoles = selectedRedRoles(state, roles).filter(role => role.name !== nickname);
  const controllerRef = useRef<AbortController | null>(null);
  const contentRevisionRef = useRef(0);
  const mountedRef = useRef(true);
  const [generation, setGeneration] = useState<RedTask | null>(null);
  const [failure, setFailure] = useState<{ task: RedTask; message: string } | null>(null);
  const [failedReplyIds, setFailedReplyIds] = useState<string[]>([]);
  const [view, setView] = useState<View>("feed");
  const [topTab, setTopTab] = useState("发现");
  const [category, setCategory] = useState("推荐");
  const [categoryPicker, setCategoryPicker] = useState(false);
  const [noteId, setNoteId] = useState("");
  const [personId, setPersonId] = useState("");
  const personOriginsRef = useRef<{ noteId: string; scroll: number; returnPerson: string }[]>([]);
  const noteReturnPersonRef = useRef("");
  const [slide, setSlide] = useState(0);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [profileTab, setProfileTab] = useState("笔记");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [commentText, setCommentText] = useState("");
  const [replyTarget, setReplyTarget] = useState<RedComment | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [commentSort, setCommentSort] = useState<"default" | "latest">("default");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftImages, setDraftImages] = useState<string[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const feedScroll = useRef(0);
  const detailRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  const selfAvatar = safeRedImage(avatar) ? avatar : DEFAULT_POCKET_USER_AVATAR;
  const notes = state.notes;
  const note = notes.find(item => item.id === noteId);
  const person = state.actors.find(actor => actor.id === personId);
  const allComments = state.comments;
  const noteComments = allComments.filter(comment => comment.noteId === noteId);
  const countComments = (item: RedNote) => state.comments.filter(comment => comment.noteId === item.id).length;

  function update(change: (previous: RedState) => RedState) {
    const previous = stateRef.current;
    const next = change(previous); stateRef.current = next; setState(next);
    onSyncContext(sessionId, [redContextConversation(previous)], [redContextConversation(next)], nickname, next.deletedContextMessages);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageWarning(""); }
    catch { setStorageWarning("手机存储空间不足，这次改动暂未保存，请保留当前页面。"); }
  }
  function notify(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message); toastTimer.current = setTimeout(() => setToast(""), 2400);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    mountedRef.current = true;
    onSyncContext(sessionId, null, [redContextConversation(stateRef.current)], nickname, stateRef.current.deletedContextMessages);
    return () => { mountedRef.current = false; controllerRef.current?.abort(); };
  }, [sessionId]);
  useEffect(() => subscribePocketContextChanges(sessionId, (changes, warning) => {
    const next = applyRedContextChanges(stateRef.current, changes);
    if (next === stateRef.current) return;
    controllerRef.current?.abort(new Error("相关笔记或评论已修改，请重试生成。"));
    stateRef.current = next; setState(next); setStorageWarning(warning);
    if (!next.notes.some(note => note.id === noteId)) setNoteId("");
  }), [sessionId, noteId]);
  const roleSettingsKey = JSON.stringify(roles);
  useEffect(() => {
    const next = syncRedRoleAvatars(stateRef.current, roles);
    if (next !== stateRef.current) update(() => next);
  }, [roleSettingsKey]);
  const generationContextKey = JSON.stringify([provider?.id, modelId, generationRoles]);
  useEffect(() => { controllerRef.current?.abort(new Error("模型或角色设定已变化，请重试生成。")); }, [generationContextKey]);
  useEffect(() => {
    if (controllerRef.current) return;
    const id = state.pendingReplies.find(id => !failedReplyIds.includes(id));
    const comment = state.comments.find(comment => comment.id === id);
    if (comment) void generate({ kind: "reply", noteId: comment.noteId, commentId: comment.id });
  }, [state.pendingReplies, generation, failedReplyIds, generationContextKey]);
  useEffect(() => { if (!noteId && feedRef.current) feedRef.current.scrollTop = feedScroll.current; }, [noteId, personId]);
  useEffect(() => {
    if (!sheet) return;
    const element = sheetRef.current; if (!element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type="file"]), textarea, [tabindex="0"]'));
    const firstInput = element.querySelector<HTMLElement>("textarea, input:not([type=file])");
    (firstInput || focusables()[0])?.focus();
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); setSheet(null); }
      if (event.key !== "Tab") return;
      const items = focusables(); const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !element?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !element?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
    element.addEventListener("keydown", handleKey);
    return () => { element.removeEventListener("keydown", handleKey); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [sheet]);

  async function generate(task: RedTask) {
    if (controllerRef.current) return;
    const revision = contentRevisionRef.current;
    const controller = new AbortController(); controllerRef.current = controller;
    setGeneration(task); setFailure(null);
    if (task.kind === "reply") setFailedReplyIds(previous => previous.filter(id => id !== task.commentId));
    const timeout = setTimeout(() => controller.abort(new Error("等待有点久，请重试生成。")), 120000);
    try {
      const snapshot = stateRef.current;
      const contact = buildRedTaskContact(snapshot, nickname, generationRoles, task, roles);
      const request = onBuildConversation(sessionId, contact, { nickname, bio }, "proactive");
      const reply = await requestPocketReply(provider, modelId, request, controller.signal, task.kind === "feed" ? 6144 : 2048);
      controller.signal.throwIfAborted();
      if (!mountedRef.current || revision !== contentRevisionRef.current) return;
      update(previous => task.kind === "feed" ? appendGeneratedRedFeed(previous, reply, generationRoles, nickname, Math.random, roles) : appendGeneratedRedReplies(previous, reply, generationRoles, nickname, task, Math.random, roles));
      if (task.kind === "feed") { setTopTab("发现"); setCategory("推荐"); navigate("feed"); feedRef.current?.scrollTo(0, 0); notify("新笔记已生成"); }
      else {
        const target = stateRef.current.comments.find(comment => comment.id === task.commentId);
        if (target) setExpanded(previous => [...new Set([...previous, target.parentId || target.id])]);
      }
    } catch (error) {
      if (mountedRef.current && revision === contentRevisionRef.current && (task.kind === "feed" || stateRef.current.comments.some(comment => comment.id === task.commentId))) {
        setFailure({ task, message: error instanceof Error ? error.message : "生成失败，请重试。" });
        if (task.kind === "reply") setFailedReplyIds(previous => [...new Set([...previous, task.commentId])]);
      }
    } finally {
      clearTimeout(timeout);
      if (controllerRef.current === controller) { controllerRef.current = null; if (mountedRef.current) setGeneration(null); }
    }
  }

  function navigate(next: View) { setPersonId(""); personOriginsRef.current = []; noteReturnPersonRef.current = ""; setNoteId(""); setView(next); setCategoryPicker(false); feedScroll.current = 0; }
  function openPerson(id: string | undefined, name: string) {
    if (id === "self" || name === nickname) { navigate("profile"); return; }
    const actor = state.actors.find(actor => actor.id === id || actor.name === name || actor.nickname === name);
    if (!actor || actor.id === personId) return;
    personOriginsRef.current.push({ noteId, scroll: detailRef.current?.scrollTop || 0, returnPerson: noteReturnPersonRef.current });
    if (feedRef.current) feedScroll.current = feedRef.current.scrollTop;
    setPersonId(actor.id);
  }
  function backFromPerson() {
    const origin = personOriginsRef.current.pop();
    setPersonId(""); setNoteId(origin?.noteId || ""); noteReturnPersonRef.current = origin?.returnPerson || "";
    requestAnimationFrame(() => { if (detailRef.current) detailRef.current.scrollTop = origin?.scroll || 0; });
  }
  function backFromNote() {
    if (noteReturnPersonRef.current) { setPersonId(noteReturnPersonRef.current); setNoteId(personOriginsRef.current.at(-1)?.noteId || ""); noteReturnPersonRef.current = ""; }
    else setNoteId("");
  }
  function clearAll() {
    contentRevisionRef.current++;
    controllerRef.current?.abort(); controllerRef.current = null;
    setGeneration(null); setFailure(null); setFailedReplyIds([]);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(""); setNoteId(""); setSheet(null); setReplyTarget(null); setCommentText(""); setExpanded([]);
    setPersonId(""); personOriginsRef.current = []; noteReturnPersonRef.current = "";
    setQuery(""); setSearchTerm(""); setDraftTitle(""); setDraftContent(""); setDraftImages([]); setPublishError("");
    setProfileTab("笔记"); setTopTab("发现"); setCategory("推荐"); setCategoryPicker(false); feedScroll.current = 0;
    update(clearRedContent);
  }
  function selectRole(id: string) {
    controllerRef.current?.abort(new Error("生成角色已变化，请重试生成。"));
    setFailure(null); setFailedReplyIds([]);
    update(previous => ({ ...previous, selectedRoleIds: toggleRedItem(previous.selectedRoleIds, id) }));
  }
  function openNote(item: RedNote) {
    noteReturnPersonRef.current = personId; setPersonId("");
    feedScroll.current = feedRef.current?.scrollTop || 0;
    setNoteId(item.id); setSlide(0); setExpanded([]); setCommentSort("default"); setReplyTarget(null); setCommentText("");
    update(previous => ({ ...previous, history: [...previous.history.filter(id => id !== item.id), item.id].slice(-100) }));
  }
  function like(item: RedNote) { update(previous => ({ ...previous, liked: toggleRedItem(previous.liked, item.id) })); }
  function follow(author: string) { update(previous => ({ ...previous, followed: toggleRedItem(previous.followed, author) })); }
  function openComment(target: RedComment | null = null) { setReplyTarget(target); setSheet("comment"); }
  function jumpToComments() {
    const container = detailRef.current; const section = commentsRef.current;
    if (container && section) container.scrollTo({ top: section.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  function submitComment(event: FormEvent) {
    event.preventDefault(); if (!note || !commentText.trim()) return;
    const comment: RedComment = { id: crypto.randomUUID(), noteId: note.id, actorId: "self", author: nickname, avatar: selfAvatar, content: `${replyTarget && replyTarget.parentId ? `回复 ${replyTarget.author}：` : ""}${commentText.trim()}`, time: "刚刚", createdAt: new Date().toISOString(), location: "", likes: 0, ...(replyTarget ? { parentId: replyTarget.parentId || replyTarget.id, replyToId: replyTarget.id } : {}) };
    update(previous => ({ ...previous, comments: [...previous.comments, comment], pendingReplies: [...previous.pendingReplies, comment.id] }));
    if (comment.parentId) setExpanded(previous => [...new Set([...previous, comment.parentId!])]);
    else setCommentSort("latest");
    setSheet(null); setCommentText(""); setReplyTarget(null); notify("评论成功");
    requestAnimationFrame(jumpToComments);
    void generate({ kind: "reply", noteId: note.id, commentId: comment.id });
  }
  function submitSearch(event?: FormEvent, term = query) { event?.preventDefault(); setQuery(term); setSearchTerm(term.trim()); navigate("search"); }
  async function copyNote() {
    if (!note) return;
    try { await navigator.clipboard.writeText(`${note.title}\n${note.content}\n${note.tags.map(tag => `#${tag}`).join(" ")}\n—— ${note.author}`); setSheet(null); notify("笔记内容已复制"); }
    catch { notify("无法访问剪贴板，请选中笔记文字复制"); }
  }
  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return;
    setLoadingPhotos(true); setPublishError("");
    try {
      const remaining = 9 - draftImages.length;
      if (files.length > remaining) throw new Error("一篇笔记最多添加 9 张图片");
      const photos = await Promise.all(Array.from(files).map(readPhoto));
      setDraftImages(previous => [...previous, ...photos].slice(0, 9));
    } catch (error) { setPublishError(error instanceof Error ? error.message : "图片读取失败"); }
    finally { setLoadingPhotos(false); }
  }
  function publish(event: FormEvent) {
    event.preventDefault(); if (!draftTitle.trim() || loadingPhotos) return;
    const tags = [...new Set([...draftContent.matchAll(/#([^\s#]+)/g)].map(match => match[1]))].slice(0, 10);
    const published: RedNote = { id: crypto.randomUUID(), title: draftTitle.trim(), content: draftContent.trim(), tags, images: draftImages, author: nickname, authorId: "self", avatar: selfAvatar, generated: false, createdAt: new Date().toISOString(), likes: 0, saves: 0, comments: 0, category: "生活", location: "", time: "刚刚" };
    update(previous => ({ ...previous, notes: [published, ...previous.notes] }));
    setSheet(null); setDraftTitle(""); setDraftContent(""); setDraftImages([]); setPublishError("");
    navigate("profile"); setProfileTab("笔记"); openNote(published); notify("笔记已发布到手机");
  }
  function carouselKey(event: KeyboardEvent) {
    if (!note || note.images.length < 2) return;
    if (event.key === "ArrowRight") { event.preventDefault(); setSlide(previous => Math.min(note.images.length - 1, previous + 1)); }
    if (event.key === "ArrowLeft") { event.preventDefault(); setSlide(previous => Math.max(0, previous - 1)); }
  }

  function renderCards(items: RedNote[]) {
    const columns = [items.filter((_, index) => index % 2 === 0), items.filter((_, index) => index % 2 === 1)];
    return items.length ? <div className="xhs-waterfall">{columns.map((column, index) => <div className="xhs-column" key={index}>{column.map(item => <article className="xhs-card" key={item.id}>
      <button type="button" className="xhs-card-open" aria-label={`打开笔记：${item.title}`} onClick={() => openNote(item)}>
        {item.images.length ? <img className="xhs-card-cover" src={item.images[0]} alt={item.title} loading="lazy" decoding="async" /> : <div className={`xhs-text-cover tone-${item.coverTone || "cream"}`}><span>“</span><strong>{item.coverText || item.title}</strong><i /></div>}
        <h3>{item.title}</h3>
      </button>
      <div className="xhs-card-meta"><button type="button" className="xhs-card-author" aria-label={`查看${item.author}的主页`} onClick={() => openPerson(item.authorId, item.author)}><RedAvatar src={item.avatar} name={item.author} /><span>{item.author}</span></button><button className={`xhs-card-like${state.liked.includes(item.id) ? " is-liked" : ""}`} type="button" aria-label={`${state.liked.includes(item.id) ? "取消点赞" : "点赞"}：${item.title}`} aria-pressed={state.liked.includes(item.id)} onClick={() => like(item)}><Heart /><span>{item.likes + Number(state.liked.includes(item.id))}</span></button></div>
    </article>)}</div>)}</div> : <div className="xhs-empty"><Search size={34} /><p>暂无笔记</p><button type="button" onClick={() => { setTopTab("发现"); setCategory("推荐"); setSearchTerm(""); setQuery(""); navigate("feed"); }}>看看推荐</button></div>;
  }
  function renderComment(comment: RedComment, nested = false) {
    const liked = state.likedComments.includes(comment.id);
    return <div className={`xhs-comment${nested ? " is-reply" : ""}`} key={comment.id}>
      <button type="button" className="xhs-avatar-link" aria-label={`查看${comment.author}的主页`} onClick={() => openPerson(comment.actorId, comment.author)}><RedAvatar src={comment.avatar} name={comment.author} /></button>
      <div className="xhs-comment-body"><div className="xhs-comment-name"><span>{comment.author}</span>{comment.isAuthor && <b>作者</b>}</div><p>{comment.content}</p>
        <div className="xhs-comment-meta"><span>{comment.time} {comment.location}</span><button type="button" onClick={() => openComment(comment)}>回复</button><button type="button" className={`xhs-comment-like${liked ? " is-liked" : ""}`} aria-label={`${liked ? "取消点赞" : "点赞"}${comment.author}的评论`} aria-pressed={liked} onClick={() => update(previous => ({ ...previous, likedComments: toggleRedItem(previous.likedComments, comment.id) }))}><Heart /><span>{comment.likes + Number(liked) || ""}</span></button><button type="button" aria-label={`用表情回复${comment.author}`} onClick={() => { setCommentText(previous => previous + "😄"); openComment(comment); }}><Smile /></button></div>
        {comment.authorLiked && <small className="xhs-author-liked">作者赞过</small>}
      </div>
    </div>;
  }

  const visible = notes.filter(item => !state.hidden.includes(item.id));
  let feedNotes = visible;
  if (view === "search") feedNotes = visible.filter(item => `${item.title} ${item.content} ${item.tags.join(" ")} ${item.author}`.toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase()));
  else if (view === "profile") feedNotes = profileTab === "笔记" ? state.notes.filter(item => !item.generated) : visible.filter(item => (profileTab === "收藏" ? state.saved : state.liked).includes(item.id));
  else if (view === "history") feedNotes = [...state.history].reverse().flatMap(id => visible.find(item => item.id === id) || []);
  else {
    if (topTab === "关注" && view === "feed") feedNotes = feedNotes.filter(item => state.followed.includes(item.author));
    if (topTab === "合肥" && view === "feed") feedNotes = feedNotes.filter(item => item.location === "安徽");
    if (!["推荐", "RED", "热点"].includes(category) && view === "feed") feedNotes = feedNotes.filter(item => item.category === category);
    if (category === "热点") feedNotes = [...feedNotes].sort((a, b) => b.likes - a.likes);
    if (view === "market") feedNotes = visible.filter(item => item.category === "生活");
  }
  const rootComments = noteComments.filter(comment => !comment.parentId);
  if (commentSort === "latest") rootComments.reverse();

  return <div className="xhs-app" aria-label="小红书">
    <div className="xhs-main" inert={sheet ? true : undefined}>
      {storageWarning && <p className="xhs-storage-warning" role="alert">{storageWarning}</p>}
      {generation && <div className="xhs-generation-status" role="status"><Sparkles /><span>{generation.kind === "feed" ? "正在生成新笔记…" : "正在生成评论回复…"}</span><button type="button" aria-label="停止小红书生成" onClick={() => controllerRef.current?.abort(new Error("已停止生成，点击重试继续。"))}><Square /></button></div>}
      {failure && <div className="xhs-generation-error" role="alert"><p>{failure.message}</p><button type="button" disabled={!!generation} onClick={() => void generate(failure.task)}>重试生成</button><button type="button" onClick={onSettings}>手机设置</button></div>}
      {!failure && failedReplyIds.some(id => state.pendingReplies.includes(id)) && <div className="xhs-generation-error"><p>有评论暂未收到回复</p><button type="button" disabled={!!generation} onClick={() => { const pending = state.comments.find(comment => failedReplyIds.includes(comment.id) && state.pendingReplies.includes(comment.id)); if (pending) void generate({ kind: "reply", noteId: pending.noteId, commentId: pending.id }); }}>重试回复</button></div>}
      {person ? <PocketXiaohongshuPerson key={person.id} actor={person} notes={visible.filter(item => item.authorId === person.id)} followed={state.followed.includes(redActorNickname(person))} onBack={backFromPerson} onFollow={() => follow(redActorNickname(person))} onMessage={() => onMessage(person)} onPersonality={() => setSheet("person")} renderNotes={renderCards} /> : note ? <>
        <header className="xhs-note-header"><button type="button" aria-label="返回小红书列表" onClick={backFromNote}><ChevronLeft /></button><button type="button" className="xhs-avatar-link" aria-label={`查看${note.author}的主页`} onClick={() => openPerson(note.authorId, note.author)}><RedAvatar src={note.avatar} name={note.author} /></button><span className="xhs-note-author"><span>{note.author}</span>{note.music && <small><Music2 />{note.music}</small>}</span><button type="button" className={`xhs-follow${state.followed.includes(note.author) ? " is-followed" : ""}`} aria-pressed={state.followed.includes(note.author)} onClick={() => follow(note.author)}>{state.followed.includes(note.author) ? "已关注" : "关注"}</button><button type="button" aria-label="分享笔记" onClick={() => setSheet("share")}><RedShareIcon /></button></header>
        <div className="xhs-note-scroll" ref={detailRef}>
          {!note.images.length && <div className={`xhs-text-cover xhs-note-cover tone-${note.coverTone || "cream"}`}><span>“</span><strong>{note.coverText || note.title}</strong><i /></div>}
          {note.images.length > 0 && <div className="xhs-carousel" tabIndex={note.images.length > 1 ? 0 : undefined} aria-label={`笔记图片 ${slide + 1}/${note.images.length}`} onKeyDown={carouselKey} onTouchStart={event => { touchX.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={event => { const end = event.changedTouches[0]?.clientX; if (touchX.current !== null && end !== undefined && Math.abs(end - touchX.current) > 35) setSlide(previous => Math.max(0, Math.min(note.images.length - 1, previous + (end < touchX.current! ? 1 : -1)))); touchX.current = null; }}>
            <img src={note.images[slide]} alt={`${note.title}，第${slide + 1}张图片`} decoding="async" />
            {note.images.length > 1 && <><span className="xhs-image-count">{slide + 1}/{note.images.length}</span><button className="xhs-slide-prev" type="button" disabled={!slide} aria-label="上一张图片" onClick={() => setSlide(previous => previous - 1)}><ChevronLeft /></button><button className="xhs-slide-next" type="button" disabled={slide === note.images.length - 1} aria-label="下一张图片" onClick={() => setSlide(previous => previous + 1)}><ChevronRight /></button></>}
            {note.music && <span className="xhs-mute" aria-label="静态图文笔记"><VolumeX /></span>}
          </div>}
          {note.images.length > 1 && <div className="xhs-image-dots" aria-label="选择图片">{note.images.map((_, index) => <button type="button" key={index} aria-label={`第${index + 1}张图片`} aria-pressed={slide === index} className={slide === index ? "is-active" : ""} onClick={() => setSlide(index)} />)}</div>}
          <article className="xhs-note-copy"><h2>{note.title}</h2>{note.content !== note.title && <p>{note.content}</p>}<div className="xhs-tags">{note.tags.map(tag => <button type="button" key={tag} onClick={() => { setNoteId(""); submitSearch(undefined, tag); }}>#{tag}</button>)}</div>
            {note.activity && <button type="button" className="xhs-activity" onClick={() => { setNoteId(""); submitSearch(undefined, note.activity); }}><Flag />活动 <i />{note.activity}</button>}
            <div className="xhs-note-info"><span>编辑于 {note.time} {note.location}</span><button type="button" onClick={() => { update(previous => ({ ...previous, hidden: [...previous.hidden, note.id] })); setNoteId(""); notify("将减少这篇笔记的推荐"); }}><Smile />不喜欢</button></div>
          </article>
          <section className="xhs-comments" ref={commentsRef} aria-label="笔记评论"><header><span>共 {countComments(note)} 条评论</span><button type="button" aria-label={commentSort === "default" ? "按最新排序评论" : "按默认排序评论"} onClick={() => setCommentSort(previous => previous === "default" ? "latest" : "default")}><ListFilter />{commentSort === "latest" && <small>最新</small>}</button></header><div className="xhs-comment-prompt"><RedAvatar src={selfAvatar} name={nickname} /><button type="button" onClick={() => openComment()}><span>留下你的想法吧</span><Smile /><ImagePlus /></button></div>
            {rootComments.map(comment => { const replies = noteComments.filter(reply => reply.parentId === comment.id); const isExpanded = expanded.includes(comment.id); return <div className="xhs-thread" key={comment.id}>{renderComment(comment)}{(isExpanded ? replies : replies.slice(0, 1)).map(reply => renderComment(reply, true))}{replies.length > 1 && <button type="button" className="xhs-expand-replies" aria-expanded={isExpanded} onClick={() => setExpanded(previous => toggleRedItem(previous, comment.id))}><i />{isExpanded ? "收起回复" : `展开 ${replies.length} 条回复`}</button>}</div>; })}
            {!rootComments.length && <p className="xhs-no-comments">还没有评论，快来留下你的想法吧</p>}
          </section>
        </div>
        <footer className="xhs-interactions"><button className="xhs-say-something" type="button" onClick={() => openComment()}><PencilLine /><span>说点什么...</span></button><button type="button" className={state.liked.includes(note.id) ? "is-liked" : ""} aria-label={state.liked.includes(note.id) ? "取消点赞笔记" : "点赞笔记"} aria-pressed={state.liked.includes(note.id)} onClick={() => like(note)}><Heart /><span>{note.likes + Number(state.liked.includes(note.id))}</span></button><button type="button" className={state.saved.includes(note.id) ? "is-saved" : ""} aria-label={state.saved.includes(note.id) ? "取消收藏笔记" : "收藏笔记"} aria-pressed={state.saved.includes(note.id)} onClick={() => update(previous => ({ ...previous, saved: toggleRedItem(previous.saved, note.id) }))}><Star /><span>{note.saves + Number(state.saved.includes(note.id))}</span></button><button type="button" aria-label="查看评论" onClick={jumpToComments}><MessageCircle /><span>{countComments(note)}</span></button></footer>
      </> : <>
        {view === "feed" ? <><header className="xhs-feed-header"><button type="button" aria-label="小红书菜单" onClick={() => setSheet("menu")}><MessageCircle /></button><nav aria-label="首页频道">{["关注", "发现", "合肥"].map(label => <button type="button" key={label} className={topTab === label ? "is-active" : ""} aria-current={topTab === label ? "page" : undefined} onClick={() => { setTopTab(label); feedRef.current?.scrollTo(0, 0); }}>{label}</button>)}</nav><button type="button" aria-label="搜索小红书" onClick={() => navigate("search")}><Search /></button></header><div className="xhs-channels"><nav aria-label="发现分类">{[...new Set([...channels, ...(!channels.includes(category) ? [category] : [])])].map(label => <button type="button" key={label} className={category === label ? "is-active" : ""} aria-pressed={category === label} onClick={() => { setCategory(label); feedRef.current?.scrollTo(0, 0); }}>{label}</button>)}</nav><button type="button" aria-label="展开频道分类" aria-expanded={categoryPicker} onClick={() => setCategoryPicker(previous => !previous)}><ChevronDown /></button></div>{categoryPicker && <div className="xhs-category-picker">{categories.map(label => <button key={label} type="button" className={category === label ? "is-active" : ""} onClick={() => { setCategory(label); setCategoryPicker(false); }}>{label}</button>)}</div>}</> : view === "search" ? <form className="xhs-search-header" onSubmit={event => submitSearch(event)}><button type="button" aria-label="返回小红书首页" onClick={() => navigate("feed")}><ChevronLeft /></button><label><Search /><input autoFocus aria-label="搜索笔记" placeholder="搜索感兴趣的内容" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="清空搜索" onClick={() => { setQuery(""); setSearchTerm(""); }}><X /></button>}</label><button type="submit">搜索</button></form> : <header className="xhs-page-header"><button type="button" aria-label="返回小红书首页" onClick={() => navigate("feed")}><ChevronLeft /></button><h2>{view === "profile" ? "我" : view === "history" ? "浏览记录" : view === "market" ? "市集" : "消息"}</h2>{view === "profile" ? <button type="button" className="xhs-clear-button" onClick={clearAll}>清空</button> : <button type="button" aria-label="小红书菜单" onClick={() => setSheet("menu")}><MoreHorizontal /></button>}</header>}
        {view === "feed" && <div className="xhs-generation-toolbar"><button type="button" className="xhs-role-shortcut" aria-label="选择生成角色" onClick={() => navigate("profile")}><Users /></button><button type="button" className="xhs-red-button" disabled={!!generation} onClick={() => void generate({ kind: "feed" })} aria-label="生成小红书笔记"><Sparkles />{generation?.kind === "feed" ? "生成中…" : "生成"}</button></div>}
        <div className="xhs-feed-scroll" ref={feedRef}>
          {view === "profile" && <><div className="xhs-profile"><RedAvatar src={selfAvatar} name={nickname} /><div><h2>{nickname}</h2><span>小红书号：renge</span></div><p>记录生活里的点点滴滴 ✨</p><div className="xhs-profile-stats"><span><b>{state.followed.length}</b>关注</span><span><b>{state.notes.length}</b>笔记</span><span><b>{state.liked.length + state.saved.length}</b>赞过与收藏</span></div></div>
            <section className="xhs-role-picker" aria-label="生成角色"><header><h3>生成角色</h3><span>已选 {generationRoles.length} 位</span></header><div>{roleChoices.map(role => <label className="xhs-role-choice" key={role.id}><input type="checkbox" checked={state.selectedRoleIds.includes(role.id)} onChange={() => selectRole(role.id)} aria-label={`参与生成：${role.name}`} /><RedAvatar src={role.avatar || state.actors.find(actor => actor.name === role.name)?.avatar || DEFAULT_POCKET_AVATAR} name={role.name} /><span><strong>{role.name}</strong></span></label>)}</div></section>
            <nav className="xhs-profile-tabs" aria-label="我的笔记">{["笔记", "收藏", "赞过"].map(label => <button type="button" key={label} className={profileTab === label ? "is-active" : ""} aria-pressed={profileTab === label} onClick={() => setProfileTab(label)}>{label}</button>)}</nav></>}
          {view === "search" && !searchTerm && <div className="xhs-search-suggestions"><h3>猜你想搜</h3>{[...new Set(notes.flatMap(item => item.tags))].slice(0, 8).map(term => <button type="button" key={term} onClick={() => submitSearch(undefined, term)}><Search />{term}</button>)}</div>}
          {view === "search" && searchTerm && <p className="xhs-results-label">全部 · {feedNotes.length} 篇笔记</p>}
          {view === "market" && <div className="xhs-market-banner"><span>逛逛生活</span><strong>发现身边的好去处</strong><small>灵感与日常，都在这里</small></div>}
          {view === "messages" ? <div className="xhs-messages"><div className="xhs-message-shortcuts">{[{ icon: Heart, label: "赞和收藏", color: "red", count: state.liked.length + state.saved.length }, { icon: Users, label: "新增关注", color: "blue", count: state.followed.length }, { icon: MessageCircle, label: "评论和@", color: "green", count: state.comments.length }].map(item => <button type="button" key={item.label} onClick={() => { if (item.label === "赞和收藏") { setProfileTab("赞过"); navigate("profile"); } else if (item.label === "新增关注") { setTopTab("关注"); navigate("feed"); } else document.querySelector(".xhs-message-list")?.scrollIntoView({ block: "nearest" }); }}><span className={`xhs-shortcut-${item.color}`}><item.icon /></span><small>{item.label}</small><b>{item.count}</b></button>)}</div><div className="xhs-message-list"><h3>我的评论</h3>{state.comments.length ? [...state.comments].reverse().map(comment => { const target = notes.find(item => item.id === comment.noteId); return target && <button type="button" className="xhs-message-row" key={comment.id} onClick={() => openNote(target)}><RedAvatar src={comment.avatar} name={comment.author} /><span><strong>{comment.content}</strong><small>{target.title} · {comment.time}</small></span><ChevronRight /></button>; }) : <div className="xhs-empty"><MessageCircle size={34} /><p>评论笔记后，会在这里留下记录</p></div>}</div></div> : renderCards(feedNotes)}
        </div>
        <nav className="xhs-bottom-nav" aria-label="小红书导航"><button type="button" className={["feed", "search", "history"].includes(view) ? "is-active" : ""} aria-current={view === "feed" ? "page" : undefined} onClick={() => navigate("feed")}>首页</button><button type="button" className={view === "market" ? "is-active" : ""} aria-current={view === "market" ? "page" : undefined} onClick={() => navigate("market")}>市集</button><button className="xhs-publish-button" type="button" aria-label="发布笔记" onClick={() => { setPublishError(""); setSheet("publish"); }}><Plus /></button><button type="button" className={view === "messages" ? "is-active" : ""} aria-current={view === "messages" ? "page" : undefined} onClick={() => navigate("messages")}>消息{state.comments.length > 0 && <small>{state.comments.length}</small>}</button><button type="button" className={view === "profile" ? "is-active" : ""} aria-current={view === "profile" ? "page" : undefined} onClick={() => navigate("profile")}>我</button></nav>
      </>}
    </div>
    {sheet && <div className="xhs-backdrop" onClick={event => { if (event.target === event.currentTarget && !loadingPhotos) setSheet(null); }}><div className={`xhs-sheet xhs-sheet-${sheet}`} ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="xhs-sheet-title"><header><h3 id="xhs-sheet-title">{sheet === "person" ? (person ? redActorNickname(person) : "") : sheet === "menu" ? "小红书" : sheet === "share" ? "分享笔记" : sheet === "publish" ? "发布笔记" : replyTarget ? `回复 ${replyTarget.author}` : "留下你的想法"}</h3><button type="button" aria-label="关闭弹层" disabled={loadingPhotos} onClick={() => setSheet(null)}><X /></button></header>
      {sheet === "person" && <p className="xhs-person-personality"><strong>{person?.name}</strong><br />{person?.personality}</p>}
      {sheet === "menu" && <div className="xhs-menu"><button type="button" onClick={() => { setSheet(null); setTopTab("关注"); navigate("feed"); }}><Users />我的关注<ChevronRight /></button><button type="button" onClick={() => { setSheet(null); navigate("history"); }}><History />浏览记录<ChevronRight /></button><button type="button" onClick={() => { setSheet(null); setProfileTab("收藏"); navigate("profile"); }}><Star />我的收藏<ChevronRight /></button><button type="button" onClick={onExit}><ArrowLeft />返回手机桌面<ChevronRight /></button><small>笔记和互动保存在当前会话的手机中</small></div>}
      {sheet === "share" && <div className="xhs-share-options"><button type="button" onClick={() => void copyNote()}><span><Copy /></span>复制笔记内容</button><button type="button" onClick={() => { if (!note) return; update(previous => ({ ...previous, saved: toggleRedItem(previous.saved, note.id) })); setSheet(null); notify(state.saved.includes(note.id) ? "已取消收藏" : "已收藏"); }}><span><Star /></span>{note && state.saved.includes(note.id) ? "取消收藏" : "收藏笔记"}</button></div>}
      {sheet === "comment" && <form className="xhs-comment-form" onSubmit={submitComment}><textarea aria-label="评论内容" placeholder={replyTarget ? `回复 ${replyTarget.author}…` : "友善评论，分享你的想法…"} maxLength={1000} rows={4} value={commentText} onChange={event => setCommentText(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div><button type="button" aria-label="添加表情" onClick={() => setCommentText(previous => previous.slice(0, 998) + "😊")}><Smile /></button><span>{commentText.length}/1000</span><button className="xhs-red-button" type="submit" disabled={!commentText.trim()}>发送</button></div></form>}
      {sheet === "publish" && <form className="xhs-publish-form" onSubmit={publish}><div className="xhs-photo-picker">{draftImages.map((src, index) => <div key={src + index}><img src={src} alt={`待发布图片${index + 1}`} /><button type="button" aria-label={`移除图片${index + 1}`} onClick={() => setDraftImages(previous => previous.filter((_, imageIndex) => imageIndex !== index))}><X /></button></div>)}{draftImages.length < 9 && <label><ImagePlus /><span>{loadingPhotos ? "读取中…" : "添加图片"}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={loadingPhotos} aria-label="添加笔记图片" onChange={event => { void uploadPhotos(event.target.files); event.target.value = ""; }} /></label>}</div><input aria-label="笔记标题" placeholder="填写标题会有更多赞哦" maxLength={40} required value={draftTitle} onChange={event => setDraftTitle(event.target.value)} /><textarea aria-label="笔记正文" placeholder="分享你的生活，使用 # 添加话题" maxLength={3000} rows={5} value={draftContent} onChange={event => setDraftContent(event.target.value)} /><small>发布到当前会话的手机 · {draftImages.length}/9 张图片</small>{publishError && <p role="alert">{publishError}</p>}<button type="submit" className="xhs-red-button" disabled={!draftTitle.trim() || loadingPhotos}>{loadingPhotos ? "图片处理中…" : "发布笔记"}</button></form>}
    </div></div>}
    {toast && <div className="xhs-toast" role="status"><Check />{toast}</div>}
  </div>;
}
