import { renderPocketPrompt, type PocketPromptOverrides } from "./pocketPhonePrompts.ts";
import type { AgentPersona } from "./types";
import { type PocketContact } from "./pocketPhoneState";
import { redContextConversation } from "./pocketXiaohongshuContext";
import { isRedCommunityActor, randomRedAvatar, redActorNickname, redActorProfile, RED_COVER_TONES, redCount, redText, safeRedImage, type RedActor, type RedComment, type RedCoverTone, type RedNote, type RedState } from "./pocketXiaohongshuState";

export type RedRole = Omit<RedActor, "avatar"> & { avatar?: string };
export type RedTask = { kind: "feed"; category?: string; topic?: string } | { kind: "reply"; noteId: string; commentId: string };
export function getRedRoles(contacts: PocketContact[], personas: AgentPersona[]): RedRole[] {
  const roles: RedRole[] = [
    ...contacts.map(contact => ({ id: contact.sourceXiaohongshuActorId || `contact:${contact.id}`, name: contact.name, ...(contact.nickname ? { nickname: contact.nickname } : {}), avatar: safeRedImage(contact.avatar) ? contact.avatar : undefined, personality: contact.personality, ...(contact.sourceCharacterCardId ? { sourceCharacterCardId: contact.sourceCharacterCardId } : {}) })),
    ...personas.map(persona => ({ id: `persona:${persona.id}`, name: persona.name, avatar: safeRedImage(persona.avatarImage) ? persona.avatarImage : undefined, personality: [persona.description, ...persona.entryTypes.flatMap(type => type.entries.filter(entry => entry.enabled).map(entry => `${type.name} · ${entry.key}：${entry.value}`))].filter(Boolean).join("\n") })),
  ];
  return roles.filter((role, index) => role.name.trim() && roles.findIndex(other => other.name === role.name) === index).map(role => ({ ...role, avatar: role.avatar || roles.find(other => other.name === role.name && other.avatar)?.avatar }));
}

export function getRedRoleChoices(roles: RedRole[], actors: RedActor[]): RedRole[] {
  return [...roles.map(role => { const actor = actors.find(actor => actor.id === role.id || actor.name === role.name); return actor?.nickname && !role.nickname ? { ...role, nickname: actor.nickname } : role; }), ...actors.filter(actor => !roles.some(role => role.name === actor.name || role.id === actor.id))].filter(role => !role.id.startsWith("card:") && !isRedCommunityActor(role));
}
export function selectedRedRoles(state: RedState, roles: RedRole[]): RedRole[] {
  return getRedRoleChoices(roles, state.actors).filter(role => state.selectedRoleIds.includes(role.id));
}
export function syncRedRoleAvatars(state: RedState, roles: RedRole[]): RedState {
  const actors = state.actors.map(actor => {
    const role = roles.find(role => role.id === actor.id || role.name === actor.name);
    const nickname = redActorNickname({ ...actor, nickname: role?.nickname || actor.nickname });
    const avatar = role?.avatar && safeRedImage(role.avatar) ? role.avatar : actor.avatar;
    return nickname !== actor.nickname || avatar !== actor.avatar ? { ...actor, nickname, avatar } : actor;
  });
  const actorFor = (id: string | undefined, name: string) => actors.find(actor => actor.id === id || actor.name === name || actor.nickname === name);
  const notes = state.notes.map(note => { const actor = note.generated ? actorFor(note.authorId, note.author) : undefined; return !actor || actor.avatar === note.avatar && actor.nickname === note.author ? note : { ...note, avatar: actor.avatar, author: redActorNickname(actor) }; });
  const comments = state.comments.map(comment => { const actor = comment.generated ? actorFor(comment.actorId, comment.author) : undefined; return !actor || actor.avatar === comment.avatar && actor.nickname === comment.author ? comment : { ...comment, avatar: actor.avatar, author: redActorNickname(actor) }; });
  const followed = state.followed.map(name => { const actor = state.actors.find(actor => actor.id === name || actor.name === name || actor.nickname === name); return actor ? redActorNickname(actors.find(item => item.id === actor.id)!) : name; });
  return actors.every((actor, index) => actor === state.actors[index]) && notes.every((note, index) => note === state.notes[index]) && comments.every((comment, index) => comment === state.comments[index]) && followed.every((name, index) => name === state.followed[index]) ? state : { ...state, actors, notes, comments, followed };
}

export function buildRedTaskContact(state: RedState, nickname: string, roles: RedRole[], task: RedTask, reservedRoles: RedRole[] = roles, prompts?: PocketPromptOverrides): PocketContact {
  const community = state.actors.filter(isRedCommunityActor);
  const speakers = [...roles, ...community.filter(actor => !roles.some(role => role.id === actor.id || role.name === actor.name))];
  const contact = redContextConversation(state);
  const note = task.kind === "reply" ? state.notes.find(note => note.id === task.noteId) : undefined;
  const comment = task.kind === "reply" ? state.comments.find(comment => comment.id === task.commentId) : undefined;
  if (task.kind === "reply" && (!note || !comment || comment.noteId !== note.id)) throw new Error("这篇笔记或评论已不存在。");
  const target = state.comments.find(item => item.id === comment?.replyToId);
  const actor = state.actors.find(actor => actor.id === (target?.actorId === "self" ? note?.authorId : target?.actorId || note?.authorId));
  const role = speakers.find(role => role.id === actor?.id || role.name === actor?.name || role.name === note?.author) || speakers[0];
  const expand = (value: string, name: string) => value.replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, nickname);
  const index = roles.map(item => ({ id: item.id, name: item.name, nickname: item.nickname, personality: expand(item.personality, item.name) }));
  const category = task.kind === "feed" ? redText(task.category, 20) || "推荐" : "推荐";
  const topic = task.kind === "feed" ? redText(task.topic, 500) : "";
  contact.name = role?.name || "小红书社区";
  contact.sourceCharacterCardId = role?.sourceCharacterCardId;
  contact.contextCharacterCardIds = [...new Set(roles.flatMap(role => role.sourceCharacterCardId || []))];
  contact.personality = [
    renderPocketPrompt("red.people", prompts, { user: nickname, roles: JSON.stringify(index),
      community: JSON.stringify(community.map(actor => ({ id: actor.id, name: actor.name, nickname: redActorNickname(actor), personality: expand(actor.personality, actor.name), profile: actor.profile }))),
      excludedNames: JSON.stringify([...new Set([...reservedRoles, ...state.actors].filter(item => !isRedCommunityActor(item) && !roles.some(role => role.id === item.id || role.name === item.name)).map(item => item.name))]),
    }),
    task.kind === "feed" ? renderPocketPrompt("red.feed", prompts, { target: JSON.stringify(topic ? { topic } : { category }),
      topicRules: topic ? "用户输入的想看内容是本次主题，优先于当前分类标签。所有新笔记的标题、正文、话题标签和评论都围绕该主题，category 按实际内容填写。" : category === "推荐" ? "用户选中推荐标签，结合会话上下文生成多样的推荐内容，category 按各篇实际内容填写。" : `用户选中 ${JSON.stringify(category)} 标签，所有新笔记及评论围绕该标签生成；每篇笔记的 category 必须填写 ${JSON.stringify(category)}，确保能在该标签下看到。`, mixRules: roles.length ? "本批笔记必须混合至少一位已勾选角色和至少一位本次新创建的社区人物发帖。" : "未勾选角色，本批笔记由社区人物发帖，至少一位作者必须是本次新创建的独立人物。",
    }) : renderPocketPrompt("red.reply", prompts, { title: note!.title, author: note!.author,
      comment: JSON.stringify({ id: comment!.id, author: comment!.author, content: comment!.content, replyTo: target?.author || note!.author }),
      char: role?.name || "新增社区人物", personality: role ? `最新角色设定：${expand(role.personality, role.name)}` : "创建有完整人设的独立社区人物，根据帖子和评论线程自然回应，不使用未勾选的旧作者。",
    }),
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
function actorWriter(state: RedState, roles: RedRole[], nickname: string, random: () => number, definitions: unknown, reservedRoles: RedRole[]) {
  const actors = [...state.actors];
  const aliases = new Map<string, RedActor>();
  const newActors: RedActor[] = [];
  const allowed = [...roles, ...state.actors.filter(isRedCommunityActor).filter(actor => !roles.some(role => role.id === actor.id || role.name === actor.name))].map(role => ({ ...role, nickname: role.nickname || state.actors.find(actor => actor.id === role.id || actor.name === role.name)?.nickname }));
  if (definitions !== undefined && (!Array.isArray(definitions) || definitions.length > 12)) throw new Error("新增人物资料格式无效，请重试。");
  for (const value of (definitions || []) as unknown[]) {
    const raw = object(value); const alias = redText(raw.id, 100); const name = redText(raw.name, 30); const personality = redText(raw.personality, 6000);
    const requestedNickname = redText(raw.nickname, 30);
    if (name === nickname || requestedNickname === nickname || alias === "self") throw new Error("模型生成了无效角色或替用户发言，请重试。");
    const known = allowed.find(role => role.id === alias);
    if (known) {
      if (name && name !== known.name) throw new Error("人物角色名称和 id 不一致，请重试。");
      if (!requestedNickname || requestedNickname === known.name) throw new Error("人物缺少独立昵称，请重试。");
      known.nickname ||= requestedNickname;
      continue;
    }
    if (!alias || !name || !personality || aliases.has(alias) || newActors.some(actor => actor.name === name) || [...state.actors, ...reservedRoles, ...roles].some(actor => actor.id === alias || actor.name === name)) throw new Error("新增人物缺少独立人设、昵称重复或使用了未勾选的角色，请重试。");
    const id = `community:${crypto.randomUUID()}`;
    const actor: RedActor = { id, name, nickname: redActorNickname({ id, name, nickname: requestedNickname }), personality, avatar: randomRedAvatar(random), origin: "community", profile: redActorProfile(raw.profile, id) };
    aliases.set(alias, actor); newActors.push(actor);
  }
  return { actors, newActors, resolve(input: Record<string, unknown>): RedActor {
    const requestedId = redText(input.authorId, 100);
    const requestedName = redText(input.author, 30);
    if (requestedName === nickname || requestedId === "self") throw new Error("模型生成了无效角色或替用户发言，请重试。");
    const fresh = requestedId ? aliases.get(requestedId) : newActors.find(actor => actor.name === requestedName || actor.nickname === requestedName);
    if (fresh) {
      if (requestedName && fresh.name !== requestedName && fresh.nickname !== requestedName) throw new Error("人物昵称和 id 不一致，请重试。");
      if (!actors.some(actor => actor.id === fresh.id)) actors.push(fresh);
      return fresh;
    }
    const existing = actors.find(actor => actor.id === requestedId);
    const known = requestedId ? allowed.find(role => role.id === requestedId || role.name === existing?.name) : allowed.find(role => role.name === requestedName || redActorNickname(role) === requestedName);
    if (!known) throw new Error("模型使用了未勾选的角色，请重试生成。");
    if (requestedName && requestedName !== known.name && requestedName !== redActorNickname(known)) throw new Error("人物昵称和 id 不一致，请重试。");
    const name = known.name;
    const index = actors.findIndex(actor => actor.id === known?.id || actor.name === name);
    if (index >= 0) {
      const actor = { ...actors[index], name, nickname: redActorNickname(known), personality: known.personality, ...(known.sourceCharacterCardId ? { sourceCharacterCardId: known.sourceCharacterCardId } : {}), avatar: safeRedImage(known.avatar) ? known.avatar : actors[index].avatar };
      actors[index] = actor; return actor;
    }
    const actor: RedActor = { id: known.id, name, nickname: redActorNickname(known), avatar: safeRedImage(known.avatar) ? known.avatar : randomRedAvatar(random), personality: known.personality, ...(known.sourceCharacterCardId ? { sourceCharacterCardId: known.sourceCharacterCardId } : {}) };
    actors.push(actor); return actor;
  } };
}
export function appendGeneratedRedFeed(state: RedState, output: string, roles: RedRole[], nickname: string, random: () => number = Math.random, reservedRoles: RedRole[] = roles): RedState {
  const value = parseObject(output);
  if (!Array.isArray(value.notes) || !value.notes.length || value.notes.length > 4) throw new Error("模型需要返回 1~4 篇完整笔记，请重试。");
  const writer = actorWriter(state, roles, nickname, random, value.actors, reservedRoles); const notes: RedNote[] = []; const comments: RedComment[] = [];
  const keys = new Set(state.notes.map(note => `${note.title}\n${note.content}`));
  const timestamp = Date.now();
  for (const item of value.notes) {
    const raw = object(item); const title = redText(raw.title, 40); const content = redText(raw.content);
    if (!title || !content) throw new Error("生成的笔记缺少标题或正文，请重试。");
    const key = `${title}\n${content}`; if (keys.has(key)) continue; keys.add(key);
    const actor = writer.resolve(raw); const id = crypto.randomUUID();
    const createdAt = new Date(timestamp + notes.length * 10).toISOString();
    notes.push({ id, title, content, tags: [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map(tag => redText(tag, 30)).filter(Boolean))].slice(0, 10), images: [], author: redActorNickname(actor), authorId: actor.id, avatar: actor.avatar, generated: true, createdAt, coverText: redText(raw.coverText, 120) || title, coverTone: RED_COVER_TONES.includes(raw.coverTone as RedCoverTone) ? raw.coverTone as RedCoverTone : RED_COVER_TONES[notes.length % RED_COVER_TONES.length], category: redText(raw.category, 20) || "生活", location: redText(raw.location, 30), time: "刚刚", likes: redCount(raw.likes), saves: redCount(raw.saves), comments: 0 });
    const initial = raw.comments === undefined ? [] : raw.comments;
    if (!Array.isArray(initial) || initial.length > 3) throw new Error("生成的评论格式无效，请重试。");
    for (const value of initial) {
      const comment = object(value); const text = redText(comment.content, 1000); if (!text) throw new Error("生成的评论为空，请重试。");
      const commenter = writer.resolve(comment);
      comments.push({ id: crypto.randomUUID(), noteId: id, actorId: commenter.id, author: redActorNickname(commenter), avatar: commenter.avatar, generated: true, content: text, createdAt: new Date(timestamp + notes.length * 10 - 9 + comments.length).toISOString(), time: "刚刚", location: "", likes: redCount(comment.likes), ...(commenter.id === actor.id ? { isAuthor: true } : {}) });
    }
  }
  if (!notes.length) throw new Error("这次没有生成新内容，请重试。");
  if (!notes.some(note => writer.newActors.some(actor => actor.id === note.authorId))) throw new Error("这次没有新社区人物发帖，请重试生成。");
  if (roles.length && !notes.some(note => roles.some(role => role.id === note.authorId || role.name === writer.actors.find(actor => actor.id === note.authorId)?.name))) throw new Error("这次没有已勾选角色发帖，请重试生成。");
  return syncRedRoleAvatars({ ...state, actors: writer.actors, notes: [...notes.reverse(), ...state.notes], comments: [...state.comments, ...comments] }, roles);
}
export function appendGeneratedRedReplies(state: RedState, output: string, roles: RedRole[], nickname: string, task: Extract<RedTask, { kind: "reply" }>, random: () => number = Math.random, reservedRoles: RedRole[] = roles): RedState {
  const note = state.notes.find(note => note.id === task.noteId); const target = state.comments.find(comment => comment.id === task.commentId && comment.noteId === task.noteId);
  if (!note || !target) throw new Error("这篇笔记或评论已不存在。");
  if (state.comments.some(comment => comment.responseToId === target.id)) return state;
  const value = parseObject(output);
  if (!Array.isArray(value.replies) || !value.replies.length || value.replies.length > 3) throw new Error("模型需要返回 1~3 条角色回复，请重试。");
  const writer = actorWriter(state, roles, nickname, random, value.actors, reservedRoles);
  const replies: RedComment[] = value.replies.map((item, index) => {
    const raw = object(item); const content = redText(raw.content, 1000); if (!content) throw new Error("生成的回复为空，请重试。");
    const actor = writer.resolve(raw);
    return { id: crypto.randomUUID(), noteId: note.id, actorId: actor.id, author: redActorNickname(actor), avatar: actor.avatar, generated: true, content, createdAt: new Date(Date.now() + index).toISOString(), time: "刚刚", location: "", likes: redCount(raw.likes), parentId: target.parentId || target.id, replyToId: target.id, responseToId: target.id, ...(actor.id === note.authorId ? { isAuthor: true } : {}) };
  });
  return syncRedRoleAvatars({ ...state, actors: writer.actors, comments: [...state.comments, ...replies], pendingReplies: state.pendingReplies.filter(id => id !== task.commentId) }, roles);
}
