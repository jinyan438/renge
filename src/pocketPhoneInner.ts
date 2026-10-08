import type { PocketConversation, PocketGroupMember, PocketMessage, PocketState } from "./pocketPhoneState";

export const POCKET_HORMONES = [
  { key: "dopamine", name: "多巴胺", color: "#e2a15c", effect: "对奖励的期待、渴望、追求与行动动力；不是已经得到后的快乐", update: "新的目标、期待或接近想要的奖励时可上升；期待落空、失去兴趣或追求结束后可回落。已经满足或听到重复的甜言蜜语不等于持续增加，区分‘想要’与‘已经拥有’。" },
  { key: "serotonin", name: "血清素", color: "#82ae98", effect: "满足、安全感、情绪平稳；低时更容易不安", update: "感到满足、安稳、被接纳时可上升；不安、失落或情绪失衡时可下降。短暂兴奋不等于平静满足，已经安稳时可以维持。" },
  { key: "endorphins", name: "内啡肽", color: "#c08fb8", effect: "承受不适、运动或大笑后的舒缓与轻松", update: "有运动、大笑、承受痛苦后舒缓等明确情境时可上升；舒缓效果消退时可回落。普通愉快聊天、被表白或亲密感本身不要求增加。" },
  { key: "oxytocin", name: "催产素", color: "#db8e9c", effect: "信任、依恋、同理心与亲密归属", update: "真诚关怀、相互信任、拥抱或深入交流带来新的亲近感时可上升；疏离、背叛或信任受损时可下降。已有亲密关系可以维持较高水平，不因每句示爱反复叠加。" },
  { key: "cortisol", name: "皮质醇", color: "#c4896f", effect: "压力、挫折与紧绷；持续偏高时疲惫、焦虑或易怒", update: "威胁、不确定、挫折或持续压力加重时可上升；压力解除、得到安慰或恢复安全感时可下降。开心的心动与焦虑的紧绷要区分，积极情绪不要求它上升。" },
  { key: "norepinephrine", name: "去甲肾上腺素", color: "#a693cc", effect: "警觉、注意与应战；偏高时紧张或愤怒，偏低时迟钝", update: "需要集中注意、应对危险、紧张或愤怒时可上升；放松、警戒解除或进入休息时可下降。心动可能伴随短暂警觉，也可能转为安心，依据实际感受决定，不能跟随多巴胺机械同涨。" },
  { key: "gaba", name: "GABA", color: "#83aeb7", effect: "放松、镇静与休息，缓和过度紧绷", update: "紧张被缓解、感到平静或准备休息时可上升；过度激动、焦虑或难以放松时可下降。它体现镇静倾向，不能仅因为情绪积极就增加。" },
  { key: "sexHormones", name: "性激素", color: "#cb9eaf", effect: "结合角色性别、年龄和设定，综合体现性激素对情绪、自信、果断与亲密欲望的影响", update: "结合角色背景，亲密欲望、自信或果断增强时可上升，减弱时可下降。按本轮具体情境决定方向和幅度，可大可小；不把爱情或信任机械等同于性激素增加。" },
  { key: "thyroid", name: "甲状腺素", color: "#acb381", effect: "活力与反应节奏；偏高时亢奋烦躁，偏低时倦怠迟缓", update: "结合角色的活力、亢奋或倦怠以及反应节奏判断；活力和反应增强时可上升，倦怠、迟缓时可下降。变化幅度由本轮情境和角色状态决定，可大可小。" },
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

export function pocketHormoneUpdatePrompt(state?: PocketInnerState) {
  return [
    "【本轮激素变量更新依据】",
    "9 项都是角色扮演的 0~100 相对状态，不是好感度或奖励分数；数值越高仅表示对应倾向越强，不代表越好。先结合角色人设、本轮新事件和真实感受，逐项判断维持、上升或下降，再输出更新后的绝对值，不要把增量当作新值。",
    "更新只以本人最新已保存的激素状态为基线。没有新的触发依据就保持不变；同一情绪、重复话题和已经建立的关系不能每次都继续累加，也不要为了展示变化随机升降或让全部指标同涨同跌。9 项的变化幅度均可大可小，由具体事件、感受强度、人设和当前状态共同决定，允许小幅或大幅上升、下降。情境缓和时可回落或恢复符合人设的稳定水平，不机械向 0 或 100 推进。",
    ...POCKET_HORMONES.map(item => `${item.key}（${item.name}）\n作用：${item.effect}。\n升降依据：${item.update}`),
    "9 项共同影响动力、满足、亲密、压力、警觉与放松，允许不同方向和不同变化幅度。数值、内心独白与实际消息应符合本轮同一情境，不把单项指标当作某种情绪或行为的唯一原因，不在聊天消息中报告数值或更新分析。",
    state ? `本人的最新激素状态（本轮唯一更新基线，不使用更早值）：${JSON.stringify(state.hormones)}` : "本人尚无激素状态：依据人设、当前背景和本次交流生成 9 项初始绝对值，不预设所有角色相同，不将格式示例当作初始值。",
  ].join("\n");
}

export function pocketInnerGenerationPrompt(state?: PocketInnerState, group = false) {
  return [
    "每次生成同时给出角色的内心独白和完整的 9 项激素状态。innerMonologue 是虚构角色的第一人称私密心理活动，不是模型的推理过程；体现本次交流后的真实感受、隐瞒的想法和动机，不能机械复述聊天消息，不替其他人编造心理活动。",
    "历史内心独白是私密状态参考，不是用户消息或公开发言。未说出口的想法不能当作别人已经知道的事实；只控制自己的状态与决定。",
    pocketHormoneUpdatePrompt(state),
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
