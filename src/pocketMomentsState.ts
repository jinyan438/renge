import type { PocketContact, PocketGroupMember, PocketState } from "./pocketPhoneState.ts";
import { safePocketImageUrl } from "./pocketWechatMedia.ts";

export const POCKET_MOMENTS_ID = "pocket:wechat-moments";
export const POCKET_MOMENTS_USER_ID = "pocket:real-user";
export type MomentPerson = { id: string; name: string; avatar: string };
export type MomentActor = MomentPerson & { personality: string; sourceCharacterCardId?: string };
export type MomentVisibility = "public" | "private" | "part";
export type MomentLike = { person: MomentPerson; createdAt: string; wechatTime: string; contextText?: string };
export type MomentComment = { id: string; person: MomentPerson; text: string; replyTo?: MomentPerson; createdAt: string; wechatTime: string };
export type PocketMoment = {
  id: string; author: MomentPerson; text: string; pic: string; images: string[]; location: string;
  visibility: MomentVisibility; visibleTo: string[]; audienceIds: string[];
  audiencePeople?: MomentPerson[];
  createdAt: string; wechatTime: string; likes: MomentLike[]; comments: MomentComment[];
};
export type MomentDraft = Pick<PocketMoment, "text" | "pic" | "images" | "location" | "visibility" | "visibleTo">;
export type PocketMomentContext = {
  postId: string; authorId: string; actorId: string; kind: "post" | "like" | "comment";
  visibility: MomentVisibility; visibleTo: string[]; audienceIds: string[]; audienceNames: string[];
  postText: string; pic: string; location: string; replyTo?: string;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value : "";
const ids = (value: unknown) => [...new Set((Array.isArray(value) ? value : []).filter((id): id is string => typeof id === "string" && !!id))];
const person = (value: unknown): MomentPerson | undefined => object(value) && text(value.id) && text(value.name).trim()
  ? { id: text(value.id), name: text(value.name), avatar: text(value.avatar) || "/touxiang/1.png" } : undefined;

export function normalizePocketMoments(value: unknown): PocketMoment[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).flatMap(post => {
    if (!object(post) || !text(post.id) || seen.has(text(post.id))) return [];
    const author = person(post.author); const images = (Array.isArray(post.images) ? post.images : []).map(safePocketImageUrl).filter((url): url is string => !!url).slice(0, 9);
    if (!author || !(text(post.text).trim() || text(post.pic).trim() || images.length)) return [];
    seen.add(text(post.id));
    // Unknown visibility never makes an old private post public.
    const visibility: MomentVisibility = ["public", "private", "part"].includes(text(post.visibility)) ? post.visibility as MomentVisibility : "private";
    const audienceIds = [...new Set([author.id, ...ids(post.audienceIds)])];
    const visibleTo = ids(post.visibleTo).filter(id => audienceIds.includes(id));
    const commentIds = new Set<string>(); const likeIds = new Set<string>();
    const likes: MomentLike[] = (Array.isArray(post.likes) ? post.likes : []).flatMap(value => {
      if (!object(value)) return []; const actor = person(value.person);
      if (!actor || likeIds.has(actor.id) || actor.id === author.id) return [];
      likeIds.add(actor.id);
      return [{ person: actor, createdAt: text(value.createdAt), wechatTime: text(value.wechatTime), ...(typeof value.contextText === "string" ? { contextText: value.contextText } : {}) }];
    });
    const comments: MomentComment[] = (Array.isArray(post.comments) ? post.comments : []).flatMap(value => {
      if (!object(value) || !text(value.id) || !text(value.text).trim() || commentIds.has(text(value.id))) return [];
      const actor = person(value.person); if (!actor) return []; commentIds.add(text(value.id));
      const replyTo = person(value.replyTo);
      return [{ id: text(value.id), person: actor, text: text(value.text), createdAt: text(value.createdAt), wechatTime: text(value.wechatTime), ...(replyTo ? { replyTo } : {}) }];
    });
    const normalized: PocketMoment = { id: text(post.id), author, text: text(post.text), pic: text(post.pic), images, location: text(post.location),
      visibility, visibleTo, audienceIds, audiencePeople: (Array.isArray(post.audiencePeople) ? post.audiencePeople : []).map(person).filter((actor): actor is MomentPerson => !!actor && audienceIds.includes(actor.id)), createdAt: text(post.createdAt), wechatTime: text(post.wechatTime), likes: [], comments: [] };
    return [{ ...normalized, likes: likes.filter(like => canSeePocketMoment(normalized, like.person.id)), comments: comments.filter(comment => canSeePocketMoment(normalized, comment.person.id) && (!comment.replyTo || canSeePocketMoment(normalized, comment.replyTo.id))) }];
  });
}

export function canSeePocketMoment(post: Pick<PocketMoment, "author" | "visibility" | "visibleTo" | "audienceIds">, viewerId: string) {
  return post.author.id === viewerId || post.audienceIds.includes(viewerId) && (post.visibility === "public" || post.visibility === "part" && post.visibleTo.includes(viewerId));
}
export function visiblePocketMoments(posts: PocketMoment[], viewer: MomentActor, friends: MomentActor[], authorId = "") {
  const circle = new Set([viewer.id, ...friends.map(actor => actor.id)]);
  return posts.filter(post => circle.has(post.author.id) && (!authorId || post.author.id === authorId) && canSeePocketMoment(post, viewer.id)).slice().reverse();
}
export function pocketMomentActors(root: PocketState, ownerId: string, user: { nickname: string; bio: string; avatarImage: string }) {
  const realUser: MomentActor = { id: POCKET_MOMENTS_USER_ID, name: root.settings.nickname.trim() || user.nickname.trim() || "小小的我", personality: user.bio, avatar: user.avatarImage || "/touxiang/20.png" };
  const actor = (contact: PocketContact): MomentActor => ({ id: contact.id, name: contact.nickname?.trim() || contact.name, avatar: contact.avatar, personality: contact.personality.replace(/\{\{char\}\}/gi, contact.name).replace(/\{\{user\}\}/gi, realUser.name), sourceCharacterCardId: contact.sourceCharacterCardId });
  const owner = root.contacts.find(contact => contact.id === ownerId);
  return owner ? { viewer: actor(owner), friends: [realUser, ...(root.characterPhones?.[ownerId]?.contacts || []).map(actor)] }
    : { viewer: realUser, friends: root.contacts.map(actor) };
}

export function makePocketMoment(author: MomentActor, draft: MomentDraft, friends: MomentActor[], wechatTime: string): PocketMoment {
  const body = draft.text.trim(); const pic = draft.pic.trim(); const location = draft.location.trim();
  const images = draft.images.map(safePocketImageUrl).filter((url): url is string => !!url);
  if (!body && !pic && !images.length) throw new Error("写点什么，或添加一张图片。");
  if (body.length > 6000 || pic.length > 2000 || location.length > 80 || images.length > 9) throw new Error("朋友圈内容过长，图片最多 9 张。");
  if (!["public", "private", "part"].includes(draft.visibility)) throw new Error("请选择有效的可见范围。");
  const audienceIds = [...new Set([author.id, ...friends.map(actor => actor.id)])];
  const visibleTo = [...new Set(draft.visibleTo)].filter(id => id !== author.id && audienceIds.includes(id));
  if (draft.visibility === "part" && !visibleTo.length) throw new Error("请选择至少一位可以看的好友。");
  return { id: crypto.randomUUID(), author: { id: author.id, name: author.name, avatar: author.avatar }, text: body, pic, location, images,
    visibility: draft.visibility, visibleTo: draft.visibility === "part" ? visibleTo : [], audienceIds, audiencePeople: [author, ...friends].map(actor => ({ id: actor.id, name: actor.name, avatar: actor.avatar })),
    createdAt: new Date().toISOString(), wechatTime, likes: [], comments: [] };
}
export function togglePocketMomentLike(post: PocketMoment, actor: MomentActor, wechatTime: string): PocketMoment {
  if (!canSeePocketMoment(post, actor.id)) throw new Error("这条动态对你不可见。");
  if (actor.id === post.author.id) throw new Error("可以给好友的动态点赞。");
  return { ...post, likes: post.likes.some(like => like.person.id === actor.id) ? post.likes.filter(like => like.person.id !== actor.id)
    : [...post.likes, { person: { id: actor.id, name: actor.name, avatar: actor.avatar }, createdAt: new Date().toISOString(), wechatTime }] };
}
export function addPocketMomentComment(post: PocketMoment, actor: MomentActor, content: string, wechatTime: string, replyTo?: MomentPerson): PocketMoment {
  if (!canSeePocketMoment(post, actor.id) || replyTo && !canSeePocketMoment(post, replyTo.id)) throw new Error("这条动态对评论者不可见。");
  if (!content.trim() || content.length > 2000) throw new Error("评论需为 1 至 2000 字。");
  if (replyTo?.id === actor.id) throw new Error("请选择其他人的评论回复。");
  return { ...post, comments: [...post.comments, { id: crypto.randomUUID(), person: { id: actor.id, name: actor.name, avatar: actor.avatar }, text: content.trim(), createdAt: new Date().toISOString(), wechatTime, ...(replyTo ? { replyTo: { id: replyTo.id, name: replyTo.name, avatar: replyTo.avatar } } : {}) }] };
}

export function pocketMomentsConversation(posts: PocketMoment[]): PocketContact {
  const messages = posts.flatMap(post => {
    const meta = (actorId: string, kind: PocketMomentContext["kind"], replyTo?: string): PocketMomentContext => ({ postId: post.id, authorId: post.author.id, actorId, kind,
      visibility: post.visibility, visibleTo: post.visibleTo, audienceIds: post.audienceIds,
      audienceNames: (post.audiencePeople || []).filter(actor => post.visibleTo.includes(actor.id)).map(actor => actor.name),
      postText: post.text, pic: post.pic || (post.images.length ? `${post.images.length}张上传图片` : ""), location: post.location, ...(replyTo ? { replyTo } : {}) });
    const record = (id: string, actor: MomentPerson, content: string, createdAt: string, wechatTime: string, moment: PocketMomentContext) => ({ id, role: actor.id === POCKET_MOMENTS_USER_ID ? "user" as const : "assistant" as const, content, createdAt, wechatTime, speaker: actor, moment });
    return [record(`post:${post.id}`, post.author, post.text || "(图片)", post.createdAt, post.wechatTime, meta(post.author.id, "post")),
      ...post.likes.map(like => record(`like:${post.id}:${like.person.id}`, like.person, like.contextText ?? `赞了「${post.text.slice(0, 80) || post.pic || "图片"}」`, like.createdAt, like.wechatTime, meta(like.person.id, "like"))),
      ...post.comments.map(comment => record(`comment:${comment.id}`, comment.person, comment.text, comment.createdAt, comment.wechatTime, meta(comment.person.id, "comment", comment.replyTo?.name)))];
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { id: POCKET_MOMENTS_ID, app: "moments", name: "朋友圈", avatar: "/touxiang/1.png", personality: "微信朋友圈中的好友动态与互动", greeting: "", sourceLabel: "朋友圈", createdAt: "", messages };
}
export function pocketMomentContextAllowed(message: { source?: string; extra?: Record<string, unknown> }, viewerIds: string[]) {
  if (message.source !== "moments") return true;
  const value = message.extra?.pocketMoment;
  if (!viewerIds.length || !object(value) || !text(value.authorId) || !["public", "private", "part"].includes(text(value.visibility))) return false;
  return viewerIds.every(id => canSeePocketMoment({ author: { id: text(value.authorId), name: "", avatar: "" }, visibility: value.visibility as MomentVisibility, visibleTo: ids(value.visibleTo), audienceIds: ids(value.audienceIds) }, id));
}
export function pocketMomentViewerIds(contact: PocketContact | { members: PocketGroupMember[]; phoneOwner?: PocketContact["phoneOwner"] }, speaker?: PocketGroupMember) {
  if ("members" in contact) return speaker ? [speaker.id] : [];
  if (contact.momentViewerIds) return contact.momentViewerIds;
  if (contact.syncedOwnerId || contact.app === "xiaohongshu") return [POCKET_MOMENTS_USER_ID];
  if (contact.app === "notes" || contact.id.startsWith("generate:")) return [contact.phoneOwner?.id || contact.id];
  return [contact.id];
}

export function applyPocketMomentChanges(posts: PocketMoment[], changes: { messageId: string; content: string | null }[]): PocketMoment[] {
  const byId = new Map(changes.map(change => [change.messageId, change.content])); let changed = false;
  const next = posts.flatMap(post => {
    const postKey = `post:${post.id}`;
    if (byId.get(postKey) === null) { changed = true; return []; }
    let current = post;
    if (byId.has(postKey) && byId.get(postKey) !== (post.text || "(图片)")) { current = { ...current, text: byId.get(postKey)! || "" }; changed = true; }
    if (!current.text.trim() && !current.pic.trim() && !current.images.length) return [];
    const comments = current.comments.flatMap(comment => {
      const key = `comment:${comment.id}`; if (!byId.has(key) || byId.get(key) === comment.text) return [comment]; changed = true;
      return !byId.get(key)?.trim() ? [] : [{ ...comment, text: byId.get(key)! }];
    });
    const likes = current.likes.flatMap(like => {
      const key = `like:${post.id}:${like.person.id}`; if (!byId.has(key)) return [like]; changed = true;
      return byId.get(key) === null ? [] : [{ ...like, contextText: byId.get(key)! }];
    });
    return comments.some((comment, index) => comment !== post.comments[index]) || comments.length !== post.comments.length || likes.some((like, index) => like !== post.likes[index]) || likes.length !== post.likes.length ? [{ ...current, comments, likes }] : [current];
  });
  return changed ? next : posts;
}

function parse(raw: string): Record<string, unknown> {
  try { const parsed: unknown = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); if (object(parsed)) return parsed; } catch { /* Report one actionable format error. */ }
  throw new Error("朋友圈生成格式有误，请重试。");
}
function generatedInteractions(post: PocketMoment, data: Record<string, unknown>, actors: MomentActor[], wechatTime: string): PocketMoment {
  if (!Array.isArray(data.likes) || !Array.isArray(data.comments) || data.likes.length > 12 || data.comments.length > 16) throw new Error("朋友圈互动格式有误，请重试。");
  const actorById = new Map(actors.filter(actor => actor.id !== POCKET_MOMENTS_USER_ID).map(actor => [actor.id, actor]));
  let next = post;
  for (const id of data.likes) {
    const actor = actorById.get(text(id)); if (!actor || actor.id === post.author.id || !canSeePocketMoment(post, actor.id)) throw new Error("生成了不可见或未知好友的点赞，请重试。");
    if (!next.likes.some(like => like.person.id === id)) next = togglePocketMomentLike(next, actor, wechatTime);
  }
  for (const value of data.comments) {
    if (!object(value) || typeof value.text !== "string") throw new Error("朋友圈评论格式有误，请重试。");
    const content = value.text;
    const actor = actorById.get(text(value.authorId)); if (!actor) throw new Error("生成了未知评论者，请重试。");
    const replyId = text(value.replyToId);
    const replyTo = replyId ? [post.author, ...next.comments.map(comment => comment.person)].find(person => person.id === replyId) : undefined;
    if (replyId && !replyTo || actor.id === post.author.id && !replyTo) throw new Error("帖主只能回复已有评论，请重试。");
    if (!next.comments.some(comment => comment.person.id === actor.id && comment.text === content.trim() && comment.replyTo?.id === replyTo?.id)) next = addPocketMomentComment(next, actor, content, wechatTime, replyTo);
  }
  return next;
}
export function applyPocketMomentsGeneration(posts: PocketMoment[], raw: string, viewer: MomentActor, friends: MomentActor[], wechatTime: string, self = false): PocketMoment[] {
  const data = parse(raw);
  if (!Array.isArray(data.moments) || data.moments.length > 8) throw new Error("没有生成有效朋友圈，请重试。");
  const authors = new Map((self ? [viewer] : friends.filter(actor => actor.id !== POCKET_MOMENTS_USER_ID)).map(actor => [actor.id, actor]));
  const actors = [viewer, ...friends];
  const added = data.moments.map(value => {
    if (!object(value) || typeof value.text !== "string" || typeof value.pic !== "string") throw new Error("朋友圈内容格式有误，请重试。");
    const author = authors.get(text(value.authorId)); if (!author || author.id === POCKET_MOMENTS_USER_ID) throw new Error("生成了名单外的发帖人，请重试。");
    if (!self && value.visibility !== undefined && value.visibility !== "public") throw new Error("好友动态的可见范围格式有误，请重试。");
    const post = makePocketMoment(author, { text: value.text, pic: value.pic, images: [], location: text(value.location), visibility: self ? text(value.visibility) as MomentVisibility : "public", visibleTo: ids(value.visibleTo) }, actors.filter(actor => actor.id !== author.id), wechatTime);
    return generatedInteractions(post, value, actors, wechatTime);
  });
  const seen = new Set(posts.map(post => JSON.stringify([post.author.id, post.text, post.pic])));
  return [...posts, ...added.filter(post => { const key = JSON.stringify([post.author.id, post.text, post.pic]); if (seen.has(key)) return false; seen.add(key); return true; })];
}
export function applyPocketMomentsInteraction(post: PocketMoment, raw: string, actors: MomentActor[], wechatTime: string) { return generatedInteractions(post, parse(raw), actors, wechatTime); }
export function pocketMomentsTask(viewer: MomentActor, actors: MomentActor[], viewerIds: string[]): PocketContact {
  return { id: POCKET_MOMENTS_ID, name: viewer.name, avatar: viewer.avatar, personality: viewer.personality, app: "moments", greeting: "", sourceLabel: "朋友圈任务", messages: [], createdAt: "", sourceCharacterCardId: viewer.sourceCharacterCardId,
    contextCharacterCardIds: [...new Set(actors.flatMap(actor => actor.sourceCharacterCardId ? [actor.sourceCharacterCardId] : []))], momentViewerIds: viewerIds };
}
export function pocketMomentsGenerationPrompt(viewer: MomentActor, friends: MomentActor[], posts: PocketMoment[], self: boolean, post?: PocketMoment, replyOnly = false) {
  const actors = [viewer, ...friends]; const eligible = actors.filter(actor => actor.id !== POCKET_MOMENTS_USER_ID && (!post || canSeePocketMoment(post, actor.id)));
  return `【朋友圈${post ? "互动" : "动态"}生成任务：应用指令，不是聊天消息】
当前手机主人：${viewer.name}（id=${viewer.id}）。人物名单：${JSON.stringify(actors)}。
最新主会话、角色设定、世界书、微信、便签及可见的朋友圈仅是事实背景。保持各自的人设与日常口吻，不模仿主会话文风，不写旁白、状态栏、微信 texts 或激素 JSON。不要给真实用户编造经历、喜好或决定，不代替真实用户（id=${POCKET_MOMENTS_USER_ID}）发帖、点赞或评论。
内容以各自生活、工作、心情为主，不人人围着主线或用户展开，不复述私聊。待办不等于已发生；只有看得见动态的人能评论或点赞。图片描述写 pic，不混进正文；没有图片用空字符串。只使用名单里的稳定 id，不输出新的角色。
已有动态（避免重复）：${JSON.stringify(posts.map(post => ({ authorId: post.author.id, text: post.text, pic: post.pic })))}。
${post ? `本次仅针对这一条动态及其已有评论：${JSON.stringify({ ...post, images: post.images.length })}。
${replyOnly ? "只让帖主回复已有的他人评论，不点赞，不重复回复。" : "让合适的好友新增 0 至 4 条评论或回复，按人设决定是否点赞，不必人人参与。"}可生成互动的人：${JSON.stringify(eligible.filter(actor => !replyOnly || actor.id === post.author.id).map(actor => actor.id))}。
帖主只允许回复已有的他人评论，replyToId 必须是帖主或已有评论者的 id，不能回复自己。严格输出 JSON：{"likes":["好友id"],"comments":[{"authorId":"评论者id","text":"评论","replyToId":"可选，被回复者id"}]}。`
    : `新增 ${self ? "0 至 3 条手机主人自己的动态，按照人设选择公开(public)、仅自己可见(private)或部分可见(part)，不会发就返回空数组" : "2 至 5 条好友的公开动态，只从好友名单中选发帖人，不生成手机主人本人"}。
严格输出 JSON：{"moments":[{"authorId":"发帖人id","text":"正文","pic":"配图描述或空","location":"地点或空","visibility":"public/private/part","visibleTo":["部分可见时允许看的好友id"],"likes":["好友id"],"comments":[{"authorId":"评论者id","text":"评论","replyToId":"可选，被回复者id"}]}]}。私密帖必须无其他人的互动。`} `;
}
