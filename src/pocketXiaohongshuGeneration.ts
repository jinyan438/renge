import type { AgentPersona } from "./types";
import { type PocketContact } from "./pocketPhoneState";
import { redContextConversation } from "./pocketXiaohongshuContext";
import { randomRedAvatar, RED_COVER_TONES, redCount, redText, safeRedImage, type RedActor, type RedComment, type RedCoverTone, type RedNote, type RedState } from "./pocketXiaohongshuState";

export type RedRole = Omit<RedActor, "avatar"> & { avatar?: string };
export type RedTask = { kind: "feed" } | { kind: "reply"; noteId: string; commentId: string };
export function getRedRoles(contacts: PocketContact[], personas: AgentPersona[]): RedRole[] {
  const roles: RedRole[] = [
    ...contacts.map(contact => ({ id: `contact:${contact.id}`, name: contact.name, avatar: safeRedImage(contact.avatar) ? contact.avatar : undefined, personality: contact.personality, ...(contact.sourceCharacterCardId ? { sourceCharacterCardId: contact.sourceCharacterCardId } : {}) })),
    ...personas.map(persona => ({ id: `persona:${persona.id}`, name: persona.name, avatar: safeRedImage(persona.avatarImage) ? persona.avatarImage : undefined, personality: [persona.description, ...persona.entryTypes.flatMap(type => type.entries.filter(entry => entry.enabled).map(entry => `${type.name} · ${entry.key}：${entry.value}`))].filter(Boolean).join("\n") })),
  ];
  return roles.filter((role, index) => role.name.trim() && roles.findIndex(other => other.name === role.name) === index).map(role => ({ ...role, avatar: role.avatar || roles.find(other => other.name === role.name && other.avatar)?.avatar }));
}

export function getRedRoleChoices(roles: RedRole[], actors: RedActor[]): RedRole[] {
  // Saved community actors are opt-in too; historical posts never enable them.
  return [...roles, ...actors.filter(actor => !actor.id.startsWith("card:") && !roles.some(role => role.name === actor.name || role.id === actor.id))];
}
export function selectedRedRoles(state: RedState, roles: RedRole[]): RedRole[] {
  return getRedRoleChoices(roles, state.actors).filter(role => state.selectedRoleIds.includes(role.id));
}
export function syncRedRoleAvatars(state: RedState, roles: RedRole[]): RedState {
  const actors = state.actors.map(actor => {
    const role = roles.find(role => role.id === actor.id || role.name === actor.name);
    return role?.avatar && safeRedImage(role.avatar) && role.avatar !== actor.avatar ? { ...actor, avatar: role.avatar } : actor;
  });
  const avatarFor = (id: string | undefined, name: string, previous: string) => actors.find(actor => actor.id === id || actor.name === name)?.avatar || previous;
  const notes = state.notes.map(note => { const avatar = note.generated ? avatarFor(note.authorId, note.author, note.avatar) : note.avatar; return avatar === note.avatar ? note : { ...note, avatar }; });
  const comments = state.comments.map(comment => { const avatar = comment.generated ? avatarFor(comment.actorId, comment.author, comment.avatar) : comment.avatar; return avatar === comment.avatar ? comment : { ...comment, avatar }; });
  return actors.every((actor, index) => actor === state.actors[index]) && notes.every((note, index) => note === state.notes[index]) && comments.every((comment, index) => comment === state.comments[index]) ? state : { ...state, actors, notes, comments };
}

export function buildRedTaskContact(state: RedState, nickname: string, roles: RedRole[], task: RedTask): PocketContact {
  if (!roles.length) throw new Error("请先到「我」勾选参与生成的角色。");
  const contact = redContextConversation(state);
  const note = task.kind === "reply" ? state.notes.find(note => note.id === task.noteId) : undefined;
  const comment = task.kind === "reply" ? state.comments.find(comment => comment.id === task.commentId) : undefined;
  if (task.kind === "reply" && (!note || !comment || comment.noteId !== note.id)) throw new Error("这篇笔记或评论已不存在。");
  const target = state.comments.find(item => item.id === comment?.replyToId);
  const actor = state.actors.find(actor => actor.id === (target?.actorId === "self" ? note?.authorId : target?.actorId || note?.authorId));
  const role = roles.find(role => role.id === actor?.id || role.name === actor?.name || role.name === note?.author) || roles[0];
  const expand = (value: string, name: string) => value.replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, nickname);
  const index = roles.map(item => ({ id: item.id, name: item.name, personality: expand(item.personality, item.name) }));
  const feedSchema = '{"notes":[{"authorId":"可选，已有角色的id","author":"角色昵称","title":"标题","content":"正文","tags":["话题"],"category":"生活/游戏/职场/情感/穿搭","location":"角色所在地","coverText":"适合封面的短文字","coverTone":"mint/cream/rose/blue/lavender/white","likes":0,"saves":0,"comments":[{"authorId":"可选","author":"评论者昵称","content":"评论内容","likes":0}]}]}';
  contact.name = role?.name || "小红书社区";
  contact.sourceCharacterCardId = role?.sourceCharacterCardId;
  contact.contextCharacterCardIds = [...new Set(roles.flatMap(role => role.sourceCharacterCardId || []))];
  contact.personality = [
    `当前用户：${nickname}。已勾选的生成角色及最新设定：${JSON.stringify(index)}`,
    "作者、评论者和回复者只能使用以上已勾选角色的 id 与昵称。未勾选角色即使出现在历史记录中也不能发言，不能新增社区路人或替用户发言。头像由应用使用角色已有头像或随机头像池分配，不输出头像字段。",
    task.kind === "feed" ? [
      "本次任务：增量生成 3 篇全新的小红书笔记，以及每篇 1~3 条自然评论。已有内容全部保留，不重复标题或改写同一篇旧帖子。",
      "优先由与当前场景相关的已勾选角色发帖。作者、评论者保持各自口吻；只有一个角色时，可由该角色发帖并自评。禁止让当前用户发帖或评论。",
      "每篇正文约 100~250 个汉字，标题不超过 40 字。coverText 是简短的文字封面，coverTone 从限定值中选择，不生成图片或网址。内容、标签和所在地符合上下文；不要强行使用现实世界的地点或热点。",
      `只输出此格式的 JSON：${feedSchema}`,
    ].join("\n") : [
      `本次任务：立即回复用户刚刚在笔记「${note!.title}」发送的这条评论。帖子作者：${note!.author}。`,
      `待回复评论索引（仅引用已存在记录）：${JSON.stringify({ id: comment!.id, author: comment!.author, content: comment!.content, replyTo: target?.author || note!.author })}`,
      `本次优先发言角色：${role?.name || target?.author || note!.author}。${role ? `最新角色设定：${expand(role.personality, role.name)}` : "根据帖子和评论线程的已知关系自然回应。"}`,
      "生成 1~3 条自然的角色回复，针对这条评论及所属线程，不抢答其他尚未回复的新评论。保持角色的性格和称呼，评论通常简短，不写旁白。不能替用户发言。",
      '只输出此格式的 JSON：{"replies":[{"authorId":"可选，已有角色id","author":"回复者昵称","content":"实际回复内容","likes":0}]}。',
    ].join("\n"),
  ].join("\n\n");
  return contact;
}

function parseObject(output: string): Record<string, unknown> {
  const cleaned = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); } catch { throw new Error("模型没有返回有效 JSON，请重试生成。"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("模型返回的内容格式无效，请重试。");
  return parsed as Record<string, unknown>;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("生成内容不完整，请重试。");
  return value as Record<string, unknown>;
}
function actorWriter(state: RedState, roles: RedRole[], nickname: string, random: () => number) {
  const actors = [...state.actors];
  return { actors, resolve(input: Record<string, unknown>): RedActor {
    const requestedId = redText(input.authorId, 100);
    const requestedName = redText(input.author, 30);
    if (requestedName === nickname || requestedId === "self") throw new Error("模型生成了无效角色或替用户发言，请重试。");
    const existing = actors.find(actor => actor.id === requestedId);
    const known = requestedId ? roles.find(role => role.id === requestedId || role.name === existing?.name) : roles.find(role => role.name === requestedName);
    if (!known) throw new Error("模型使用了未勾选的角色，请重试生成。");
    const name = known.name;
    const index = actors.findIndex(actor => actor.id === known?.id || actor.name === name);
    if (index >= 0) { const actor = { ...actors[index], name, personality: known.personality, sourceCharacterCardId: known.sourceCharacterCardId, avatar: safeRedImage(known.avatar) ? known.avatar : actors[index].avatar }; actors[index] = actor; return actor; }
    const actor: RedActor = { id: known.id, name, avatar: safeRedImage(known.avatar) ? known.avatar : randomRedAvatar(random), personality: known.personality, ...(known.sourceCharacterCardId ? { sourceCharacterCardId: known.sourceCharacterCardId } : {}) };
    actors.push(actor); return actor;
  } };
}
export function appendGeneratedRedFeed(state: RedState, output: string, roles: RedRole[], nickname: string, random: () => number = Math.random): RedState {
  const value = parseObject(output);
  if (!Array.isArray(value.notes) || !value.notes.length || value.notes.length > 4) throw new Error("模型需要返回 1~4 篇完整笔记，请重试。");
  const writer = actorWriter(state, roles, nickname, random); const notes: RedNote[] = []; const comments: RedComment[] = [];
  const keys = new Set(state.notes.map(note => `${note.title}\n${note.content}`));
  const timestamp = Date.now();
  for (const item of value.notes) {
    const raw = object(item); const title = redText(raw.title, 40); const content = redText(raw.content);
    if (!title || !content) throw new Error("生成的笔记缺少标题或正文，请重试。");
    const key = `${title}\n${content}`; if (keys.has(key)) continue; keys.add(key);
    const actor = writer.resolve(raw); const id = crypto.randomUUID();
    const createdAt = new Date(timestamp + notes.length * 10).toISOString();
    notes.push({ id, title, content, tags: [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map(tag => redText(tag, 30)).filter(Boolean))].slice(0, 10), images: [], author: actor.name, authorId: actor.id, avatar: actor.avatar, generated: true, createdAt, coverText: redText(raw.coverText, 120) || title, coverTone: RED_COVER_TONES.includes(raw.coverTone as RedCoverTone) ? raw.coverTone as RedCoverTone : RED_COVER_TONES[notes.length % RED_COVER_TONES.length], category: redText(raw.category, 20) || "生活", location: redText(raw.location, 30), time: "刚刚", likes: redCount(raw.likes), saves: redCount(raw.saves), comments: 0 });
    const initial = raw.comments === undefined ? [] : raw.comments;
    if (!Array.isArray(initial) || initial.length > 3) throw new Error("生成的评论格式无效，请重试。");
    for (const value of initial) {
      const comment = object(value); const text = redText(comment.content, 1000); if (!text) throw new Error("生成的评论为空，请重试。");
      const commenter = writer.resolve(comment);
      comments.push({ id: crypto.randomUUID(), noteId: id, actorId: commenter.id, author: commenter.name, avatar: commenter.avatar, generated: true, content: text, createdAt: new Date(timestamp + notes.length * 10 - 9 + comments.length).toISOString(), time: "刚刚", location: "", likes: redCount(comment.likes), ...(commenter.id === actor.id ? { isAuthor: true } : {}) });
    }
  }
  if (!notes.length) throw new Error("这次没有生成新内容，请重试。");
  return syncRedRoleAvatars({ ...state, actors: writer.actors, notes: [...notes.reverse(), ...state.notes], comments: [...state.comments, ...comments] }, roles);
}
export function appendGeneratedRedReplies(state: RedState, output: string, roles: RedRole[], nickname: string, task: Extract<RedTask, { kind: "reply" }>, random: () => number = Math.random): RedState {
  const note = state.notes.find(note => note.id === task.noteId); const target = state.comments.find(comment => comment.id === task.commentId && comment.noteId === task.noteId);
  if (!note || !target) throw new Error("这篇笔记或评论已不存在。");
  if (state.comments.some(comment => comment.responseToId === target.id)) return state;
  const value = parseObject(output);
  if (!Array.isArray(value.replies) || !value.replies.length || value.replies.length > 3) throw new Error("模型需要返回 1~3 条角色回复，请重试。");
  const writer = actorWriter(state, roles, nickname, random);
  const replies: RedComment[] = value.replies.map((item, index) => {
    const raw = object(item); const content = redText(raw.content, 1000); if (!content) throw new Error("生成的回复为空，请重试。");
    const actor = writer.resolve(raw);
    return { id: crypto.randomUUID(), noteId: note.id, actorId: actor.id, author: actor.name, avatar: actor.avatar, generated: true, content, createdAt: new Date(Date.now() + index).toISOString(), time: "刚刚", location: "", likes: redCount(raw.likes), parentId: target.parentId || target.id, replyToId: target.id, responseToId: target.id, ...(actor.id === note.authorId ? { isAuthor: true } : {}) };
  });
  return syncRedRoleAvatars({ ...state, actors: writer.actors, comments: [...state.comments, ...replies], pendingReplies: state.pendingReplies.filter(id => id !== task.commentId) }, roles);
}
