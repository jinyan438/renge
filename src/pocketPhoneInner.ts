import type { PocketConversation, PocketGroupMember, PocketMessage, PocketState } from "./pocketPhoneState";

export const POCKET_HORMONES = [
  { key: "dopamine", name: "多巴胺", color: "#e2a15c", effect: "对奖励的期待、渴望、追求与行动动力；不是已经得到后的快乐" },
  { key: "serotonin", name: "血清素", color: "#82ae98", effect: "满足、安全感、情绪平稳；低时更容易不安" },
  { key: "endorphins", name: "内啡肽", color: "#c08fb8", effect: "承受不适、运动或大笑后的舒缓与轻松" },
  { key: "oxytocin", name: "催产素", color: "#db8e9c", effect: "信任、依恋、同理心与亲密归属" },
  { key: "cortisol", name: "皮质醇", color: "#c4896f", effect: "压力、挫折与紧绷；持续偏高时疲惫、焦虑或易怒" },
  { key: "norepinephrine", name: "去甲肾上腺素", color: "#a693cc", effect: "警觉、注意与应战；偏高时紧张或愤怒，偏低时迟钝" },
  { key: "gaba", name: "GABA", color: "#83aeb7", effect: "放松、镇静与休息，缓和过度紧绷" },
  { key: "sexHormones", name: "性激素", color: "#cb9eaf", effect: "结合角色性别、年龄和设定，综合体现性激素对情绪、自信、果断与亲密欲望的影响" },
  { key: "thyroid", name: "甲状腺素", color: "#acb381", effect: "活力与反应节奏；偏高时亢奋烦躁，偏低时倦怠迟缓" },
] as const;
export type PocketHormones = Record<typeof POCKET_HORMONES[number]["key"], number>;
export type PocketInnerState = { monologue: string; hormones: PocketHormones; previousHormones?: PocketHormones; updatedAt: string };
export type PocketInnerEntry = { id: string; content: string; createdAt: string; speaker: Pick<PocketGroupMember, "id" | "name" | "avatar"> };
export type PocketInnerTurn = { texts: string[]; speak: boolean; innerState: PocketInnerState };
export type PocketContextRecord = PocketMessage & { innerMonologue?: true };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function normalizePocketHormones(value: unknown): PocketHormones | undefined {
  if (!object(value) || POCKET_HORMONES.some(({ key }) => typeof value[key] !== "number" || !Number.isFinite(value[key]) || (value[key] as number) < 0 || (value[key] as number) > 100)) return;
  return Object.fromEntries(POCKET_HORMONES.map(({ key }) => [key, Math.round((value[key] as number) * 10) / 10])) as PocketHormones;
}
export function normalizePocketInnerState(value: unknown): PocketInnerState | undefined {
  if (!object(value) || typeof value.monologue !== "string" || !value.monologue.trim()) return;
  const hormones = normalizePocketHormones(value.hormones);
  if (!hormones) return;
  const previousHormones = normalizePocketHormones(value.previousHormones);
  return { monologue: value.monologue.trim().slice(0, 1600), hormones, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "", ...(previousHormones ? { previousHormones } : {}) };
}
export function normalizePocketInnerHistory(value: unknown, avatar: (value: unknown) => string): PocketInnerEntry[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).flatMap(entry => {
    if (!object(entry) || typeof entry.id !== "string" || !entry.id || seen.has(entry.id) || typeof entry.content !== "string" || !entry.content.trim() || !object(entry.speaker) || typeof entry.speaker.id !== "string" || !entry.speaker.id || typeof entry.speaker.name !== "string" || !entry.speaker.name.trim()) return [];
    seen.add(entry.id);
    return [{ id: entry.id, content: entry.content.trim().slice(0, 1600), createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "", speaker: { id: entry.speaker.id, name: entry.speaker.name.trim().slice(0, 30), avatar: avatar(entry.speaker.avatar) } }];
  });
}

export class PocketWechatFormatError extends Error {}

function wechatPayloads(raw: string): unknown[] {
  // A complete JSON response takes precedence over any markup inside its strings.
  try { return [JSON.parse(raw.trim())]; } catch { /* Read JSON embedded in model output below. */ }
  const text = raw.replace(/<(think|thinking|analysis)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<(?:think|thinking|analysis)\b[^>]*>[\s\S]*$/gi, "");
  const candidates: string[] = [];
  let start = -1; let depth = 0; let quoted = false; let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (start < 0) { if (char === "{") { start = index; depth = 1; } continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) { candidates.push(text.slice(start, index + 1)); start = -1; }
  }
  return candidates.reverse().flatMap(candidate => { try { return [JSON.parse(candidate)]; } catch { return []; } });
}

function modelHormones(value: unknown): PocketHormones | undefined {
  if (!object(value)) return;
  const keyOf = (key: string) => key.replace(/[\s_-]/g, "").toLowerCase();
  const fields = new Map(Object.entries(value).map(([key, item]) => [keyOf(key), item]));
  const aliases: Partial<Record<typeof POCKET_HORMONES[number]["key"], string>> = { norepinephrine: "noradrenaline", thyroid: "thyroidHormones" };
  const values = Object.fromEntries(POCKET_HORMONES.map(({ key, name }) => {
    const item = fields.get(keyOf(key)) ?? fields.get(keyOf(name)) ?? fields.get(keyOf(aliases[key] || key));
    const level = object(item) ? item.value : item;
    // Numeric strings/percentages are still model values. Never fill or clamp missing values.
    return [key, typeof level === "string" && /^\s*\d+(?:\.\d+)?\s*%?\s*$/.test(level) ? Number(level.replace("%", "").trim()) : level];
  }));
  return normalizePocketHormones(values);
}

function parseWechatPayload(value: unknown, previous: PocketInnerState | undefined, group: boolean): PocketInnerTurn {
  if (object(value)) {
    const inner = object(value.innerState) ? value.innerState : {};
    const texts = value.texts ?? value.messages ?? value.reply;
    value = { ...value, texts: typeof texts === "string" && texts.trim() ? texts.trim().split(/\n+/) : texts,
      innerMonologue: value.innerMonologue ?? value.inner_monologue ?? value.monologue ?? value["内心独白"] ?? inner.monologue,
      hormones: value.hormones ?? value.hormoneLevels ?? value.hormone_levels ?? value.hormoneState ?? value.hormone_state ?? value["激素状态"] ?? inner.hormones };
  }
  if (!object(value) || group && typeof value.speak !== "boolean" || !Array.isArray(value.texts) || value.texts.length > 4 || value.texts.some(text => typeof text !== "string" || !text.trim()) || (!group || value.speak) && !value.texts.length || group && value.speak === false && value.texts.length) throw new PocketWechatFormatError("微信消息格式有误，请重试。");
  const hormones = modelHormones(value.hormones);
  if (!hormones || typeof value.innerMonologue !== "string" || !value.innerMonologue.trim()) throw new PocketWechatFormatError("这次缺少内心独白或完整的 9 项激素状态，请重试。");
  return { texts: value.texts.map(text => (text as string).trim()), speak: !group || value.speak === true, innerState: { monologue: value.innerMonologue.trim().slice(0, 1600), hormones, updatedAt: new Date().toISOString(), ...(previous ? { previousHormones: previous.hormones } : {}) } };
}

export function parsePocketWechatTurn(raw: string, previous?: PocketInnerState, group = false): PocketInnerTurn {
  const candidates = wechatPayloads(raw);
  let error = new PocketWechatFormatError("微信回复、内心独白和激素状态格式有误，请重试。");
  for (const value of candidates) {
    try { return parseWechatPayload(value, previous, group); }
    catch (cause) { if (cause instanceof PocketWechatFormatError) error = cause; else throw cause; }
  }
  throw error;
}

export function pocketWechatOutputInstruction(group = false) {
  const example = { ...(group ? { speak: true } : {}), texts: ["实际发送的短消息"], innerMonologue: "角色内心独白", hormones: Object.fromEntries(POCKET_HORMONES.map((item, index) => [item.key, 40 + index * 3])) };
  return `输出规则：只输出合法 JSON，不附解释或 Markdown。格式示例：${JSON.stringify(example)}。示例数值只用于说明格式，不得照抄，实际 9 项都必须是 0~100 的数字。texts 只包含实际微信消息，1~4 条，不含独白、激素、标签或旁白；${group ? "沉默时 speak 为 false、texts 为 []，但仍必须生成独白和完整激素状态。" : "不要省略任何字段。"}`;
}

export function pocketInnerGenerationPrompt(state?: PocketInnerState, group = false) {
  return [
    "每次生成同时给出角色的内心独白和完整的 9 项激素状态。innerMonologue 是虚构角色的第一人称私密心理活动，不是模型的推理过程；体现本次交流后的真实感受、隐瞒的想法和动机，不能机械复述聊天消息，不替其他人编造心理活动。",
    "激素数值是角色扮演的 0~100 相对状态。依据最新人设、事件、关系与自身感受初始化或更新，允许不变，不要全部同涨同跌。普通交流通常小幅变化，强烈事件可以明显变化；性激素和甲状腺素通常比即时情绪指标变化缓慢，没有依据不强行波动。",
    "9 项共同影响角色此刻的动力、满足、亲密、警觉与放松，在原有人设内影响语气和选择；数值变化、内心独白和实际消息必须符合本次同一情境。不要在聊天中报激素数值，不把单项指标当作某种情绪或行为的唯一原因。",
    "历史内心独白是私密状态参考，不是用户消息或公开发言。未说出口的想法不能当作别人已经知道的事实；只控制自己的状态与决定。",
    ...POCKET_HORMONES.map(item => `${item.key}（${item.name}）：${item.effect}。`),
    state ? `本人的最新激素状态（更新时以此为基线，不沿用更早的值）：${JSON.stringify(state.hormones)}` : "本人尚无激素状态：根据人设、当前背景和本次交流首次生成 9 项初始值，不能预设所有人都相同。",
    pocketWechatOutputInstruction(group),
  ].join("\n");
}

// Inner records join the shared timeline without becoming visible WeChat bubbles.
export function getPocketContextRecords(conversation: PocketConversation): PocketContextRecord[] {
  return [...conversation.messages, ...(conversation.innerHistory || []).map(entry => ({ id: `inner:${entry.id}`, role: "assistant" as const, content: entry.content, createdAt: entry.createdAt, speaker: entry.speaker, innerMonologue: true as const }))];
}

export function applyPocketInnerTurns(state: PocketState, conversationId: string, turns: { speaker: PocketGroupMember; innerState: PocketInnerState }[], messages: PocketMessage[], replyContextMessageId: string): PocketState {
  const states = new Map(turns.map(turn => [turn.speaker.id, turn.innerState]));
  const entries = turns.map(turn => ({ id: crypto.randomUUID(), content: turn.innerState.monologue, createdAt: turn.innerState.updatedAt, speaker: { id: turn.speaker.id, name: turn.speaker.nickname || turn.speaker.name, avatar: turn.speaker.avatar } }));
  return { ...state,
    contacts: state.contacts.map(contact => ({ ...contact, ...(states.has(contact.id) ? { innerState: states.get(contact.id)! } : {}), ...(contact.id === conversationId ? { messages: [...contact.messages, ...messages], innerHistory: [...(contact.innerHistory || []), ...entries] } : {}) })),
    groups: state.groups.map(group => ({ ...group, members: group.members.map(member => states.has(member.id) ? { ...member, innerState: states.get(member.id)! } : member), ...(group.id === conversationId ? { messages: [...group.messages, ...messages], innerHistory: [...(group.innerHistory || []), ...entries], replyContextMessageId } : {}) })),
  };
}
