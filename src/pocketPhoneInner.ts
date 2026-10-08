import type { PocketConversation, PocketGroupMember, PocketMessage, PocketState } from "./pocketPhoneState";

export const POCKET_HORMONES = [
  { key: "dopamine", name: "多巴胺", color: "#e2a15c", effect: "对奖励的期待、渴望、追求与行动动力；不是已经得到后的快乐", update: "新的期待、强烈想靠近对方、目标变得可实现或追求动力增强时上升；期待破灭、失去兴趣、放弃追求或渴望被满足后减弱时下降。得到奖励后若又期待下一步，也可以继续升高。先看‘想要’如何变化，不把开心或已经拥有直接当成持续增加。" },
  { key: "serotonin", name: "血清素", color: "#82ae98", effect: "满足、安全感、情绪平稳；低时更容易不安", update: "感到被接纳、被确认、满足或内心安稳时上升；被否定、患得患失、失落或安全感动摇时下降。表白让人安心才上升；若反而担心关系、害怕失去，也可能下降。兴奋和满足分别判断，不能仅凭‘开心’上涨。" },
  { key: "endorphins", name: "内啡肽", color: "#c08fb8", effect: "承受不适、运动或大笑后的舒缓与轻松", update: "运动、大笑、承受不适后明确感到舒缓或释然时上升；这种舒缓消退、痛苦重新占据感受时可下降。没有相关经历时保持原值，不因普通聊天、表白或压力本身就增加。" },
  { key: "oxytocin", name: "催产素", color: "#db8e9c", effect: "信任、依恋、同理心与亲密归属", update: "真诚回应、信任被确认、愿意接受的亲密接触或关系推进让依恋增强时上升；被背叛、被疏远、被拒绝或信任破裂时下降。按新的亲近或疏离程度判断；被迫接触不等于信任，已有关系不因重复示爱自动叠加。" },
  { key: "cortisol", name: "皮质醇", color: "#c4896f", effect: "压力、挫折与紧绷；持续偏高时疲惫、焦虑或易怒", update: "威胁、失控、冲突、害怕被拒绝或不确定带来的压力增强时上升；担忧被解除、危险退去或安慰确实减轻紧绷时下降。表白既可能消除不安，也可能带来新的焦虑，按角色实际感受决定。脸红、心跳快或情绪积极本身不能确定它的方向。" },
  { key: "norepinephrine", name: "去甲肾上腺素", color: "#a693cc", effect: "警觉、注意与应战；偏高时紧张或愤怒，偏低时迟钝", update: "明显心动、心跳加速、注意力被抓住、需要应战、紧张或愤怒时上升；兴奋消退、警戒解除、注意松开或进入安静休息时下降。积极兴奋也可以上升，不把它只当负面压力；依据唤醒程度，不机械跟随其他指标。" },
  { key: "gaba", name: "GABA", color: "#83aeb7", effect: "放松、镇静与休息，缓和过度紧绷", update: "确实平静下来、紧绷缓解、安心休息或能够放松时上升；坐立不安、焦虑、过度激动或无法平静时下降。想靠近、被爱或害羞不自动代表已放松，没有放松变化依据可以不变。既心动又安心时可与警觉指标同时上升，但双方各自都要有依据。" },
  { key: "sexHormones", name: "性激素", color: "#cb9eaf", effect: "结合角色性别、年龄和设定，综合体现性激素对情绪、自信、果断与亲密欲望的影响", update: "结合角色背景，明确的身体吸引、欲望、自信或果断增强时上升，欲望消退、自信受挫或退缩时下降。区分依恋与身体欲望，想陪伴、靠近或拥抱不自动等于欲望增强。依据本轮实际变化决定方向和幅度，可大可小。" },
  { key: "thyroid", name: "甲状腺素", color: "#acb381", effect: "活力与反应节奏；偏高时亢奋烦躁，偏低时倦怠迟缓", update: "角色整体活力、精神亢奋或反应节奏明显增强时上升；明显疲惫、倦怠、迟钝或活力减弱时下降。看整体状态的变化，单独脸红或一次心跳快不自动触发；方向和幅度由本轮情境决定，可大可小。" },
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
    "先区分本轮的期待与渴望、满足与安全、信任与依恋、压力与不确定、兴奋与警觉、放松与镇静、身体欲望以及整体活力。逐项比较这些感受相对最新状态的实际变化，每项都需要自己的升降依据；一种情绪不能替代全部判断。新事件使已有感受明显增强或减弱也算变化，不能因为历史里曾有相同情绪就一律不变。",
    "更新只以本人最新已保存的激素状态为基线。没有新的触发依据就保持不变；同一情绪、重复话题和已经建立的关系不能每次都继续累加，也不要为了展示变化随机升降或让全部指标同涨同跌。9 项的变化幅度均可大可小，由具体事件、感受强度、人设和当前状态共同决定，允许小幅或大幅上升、下降。情境缓和时可回落或恢复符合人设的稳定水平，不机械向 0 或 100 推进。",
    "幅度参考（角色模拟刻度）：无实际变化为 0；轻微波动的变化绝对值可为 1~4；明确变化可为 5~12；强烈变化可为 13~25；重大冲击或状态反转可为 26~40，特别强烈时可以更大。升降都适用，区间是强弱参考，不是固定配方或硬限制。首次认真表白、明显心动、信任突破、激烈冲突、严重拒绝或危机解除时，直接受影响的核心变量应考虑明确或强烈幅度，不要习惯性全部写成 ±1~3；关联弱的项目仍可小幅变化或不变。",
    "结合当前数值选择本轮合理的新水平，再比较与最新基线的差值。接近 0 或 100 时以剩余空间为准，幅度自然可以缩小；不为达到参考幅度越界，不把既有高值重置后重加，也不为展示大变化强行跳到极值。所有 9 项使用同一幅度原则。",
    ...POCKET_HORMONES.map(item => `${item.key}（${item.name}）\n作用：${item.effect}。\n升降依据：${item.update}`),
    "混合情境参考：认真表白后心跳加快、期待靠近，优先考虑多巴胺与去甲肾上腺素上升，信任推进时催产素上升；血清素与皮质醇由‘安心还是担忧’决定，GABA 由是否真的放松决定，不能因为想黏着对方就增加性激素。被拒绝或背叛时，压力与警觉可上升、信任与满足可下降，多巴胺取决于仍想争取还是失去动力。得到安慰并平静下来时，压力与警觉可下降、放松与满足可上升。以上均结合本轮人设和感受，不照搬固定组合。",
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
