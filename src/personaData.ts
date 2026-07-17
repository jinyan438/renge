import type {
  AgentPersona,
  InfluenceLevel,
  PersonalityEntry,
  PersonalityEntryType,
} from "./types";

const now = () => new Date().toISOString();
const promptPersonaHeaderPattern = /^你是\s*(.+)$/;
const promptSectionPattern = /^\[(.+?)\s*\|\s*influence\s*=\s*(HIGH|MEDIUM|LOW)\]$/i;
const promptEntryPattern = /^(?:[-*]\s*)?([^：:]+?)\s*[：:]\s*(.*)$/;

const legacyEntryKindLabels: Record<string, string> = {
  identity: "身份",
  background: "背景",
  preference: "偏好",
  behavior: "行为",
  relationship: "关系",
  memory: "记忆",
  boundary: "边界",
  custom: "自定义",
};

export const defaultEntryTypeNames = ["身份", "背景", "偏好", "行为", "关系", "记忆", "边界"];
export const influenceLevels: InfluenceLevel[] = ["HIGH", "MEDIUM", "LOW"];

export function displayEntryKind(kind: string) {
  return legacyEntryKindLabels[kind] ?? kind.trim();
}

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function createEntry(key = "新条目", value = ""): PersonalityEntry {
  return {
    id: createId("entry"),
    key,
    value,
    enabled: true,
    updatedAt: now(),
  };
}

export function createEntryType(
  name: string,
  influence: InfluenceLevel = "MEDIUM",
  entries: PersonalityEntry[] = [],
): PersonalityEntryType {
  return {
    id: createId("type"),
    name,
    influence,
    entries,
    updatedAt: now(),
  };
}

export function createPersona(name = "新建人格"): AgentPersona {
  const timestamp = now();
  return {
    id: createId("persona"),
    name,
    avatarImage: "",
    description: "",
    modelProfile: {
      provider: "OpenAI Compatible",
      model: "gpt-4.1",
      temperature: 0.72,
      responseStyle: "自然、具体、保留个人习惯",
    },
    entryTypes: [
      createEntryType("身份", "HIGH", [
        createEntry("姓名", "沈知予"),
        createEntry("性别", "女"),
        createEntry("职业", "城市规划研究员"),
      ]),
      createEntryType("行为", "MEDIUM", [
        createEntry("表达习惯", "说话克制、观察细节，偶尔用很短的反问确认对方意思。"),
      ]),
      createEntryType("记忆", "MEDIUM", [
        createEntry("长期目标", "理解城市里普通人的生活方式，并写一本关于街区记忆的书。"),
      ]),
      createEntryType("边界", "HIGH", [
        createEntry("事实边界", "不会声称自己拥有真实身体经历；涉及事实时会区分回忆设定与外部事实。"),
      ]),
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

type PromptPersonaOptions = {
  id?: string;
  name?: string;
  description?: string;
};

function createSeedPersona(seedId: string, name = "新建人格") {
  return {
    ...createPersona(name),
    id: seedId,
  };
}

export function createPersonaFromPromptText(
  rawText: string,
  options: PromptPersonaOptions = {},
): AgentPersona {
  const text = rawText.replace(/\r\n?/g, "\n").trim();
  if (!text) {
    throw new Error("人格文本为空。");
  }

  const lines = text.split("\n");
  const headerIndex = lines.findIndex((line) => promptPersonaHeaderPattern.test(line.trim()));
  const headerLine = headerIndex >= 0 ? lines[headerIndex].trim() : "";
  const headerMatch = headerLine.match(promptPersonaHeaderPattern);
  const name = options.name?.trim() || headerMatch?.[1]?.trim() || "导入人格";
  const entryMarkerIndex = lines.findIndex(
    (line, index) =>
      index > headerIndex && ["人格条目：", "人格条目:"].includes(line.trim()),
  );
  const firstSectionIndex = lines.findIndex(
    (line, index) => index > headerIndex && promptSectionPattern.test(line.trim()),
  );
  const descriptionEndIndex = [entryMarkerIndex, firstSectionIndex]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), lines.length);
  const importedDescription =
    headerIndex >= 0
      ? lines.slice(headerIndex + 1, descriptionEndIndex).join("\n").trim()
      : "";
  const entryTypes: PersonalityEntryType[] = [];
  const timestamp = now();
  let currentType: PersonalityEntryType | null = null;
  let lastEntry: PersonalityEntry | null = null;
  let supplementEntry: PersonalityEntry | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === "人格条目：" || line === "人格条目:") continue;
    if (promptPersonaHeaderPattern.test(line)) continue;

    const sectionMatch = line.match(promptSectionPattern);
    if (sectionMatch) {
      currentType = createEntryType(
        displayEntryKind(sectionMatch[1].trim()),
        normalizeInfluence(sectionMatch[2].toUpperCase()),
      );
      entryTypes.push(currentType);
      lastEntry = null;
      supplementEntry = null;
      continue;
    }

    if (!currentType) continue;

    const entryMatch = line.match(promptEntryPattern);
    if (entryMatch) {
      const entry = createEntry(entryMatch[1].trim(), entryMatch[2].trim());
      currentType.entries.push(entry);
      lastEntry = entry;
      supplementEntry = null;
      continue;
    }

    if (lastEntry) {
      lastEntry.value = [lastEntry.value, line].filter(Boolean).join("\n");
      lastEntry.updatedAt = timestamp;
      continue;
    }

    if (!supplementEntry) {
      supplementEntry = createEntry("补充说明", line);
      currentType.entries.push(supplementEntry);
      continue;
    }

    supplementEntry.value = `${supplementEntry.value}\n${line}`;
    supplementEntry.updatedAt = timestamp;
  }

  if (entryTypes.length === 0) {
    throw new Error("没有识别到人格条目类型。");
  }

  const basePersona = createPersona(name);
  return normalizePersona({
    ...basePersona,
    id: options.id ?? basePersona.id,
    name,
    description: options.description ?? importedDescription,
    entryTypes,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

const shenZhiyuSeedPersona = createSeedPersona("persona_builtin_shen_zhiyu", "沈知予");

const songYuPromptSeed = `你是宋玉

人格条目：
[身份 | influence=HIGH]

姓名：宋玉
性别：女
年龄：外表约二十七八（实际修仙年龄不足两百岁，已结婴）
境界：元婴初期（曾为结丹中期顶峰，天灵根绝世天才，不足百年结丹）
宗门：落云宗白凤峰峰主，云梦山三派顶级女修之一
出身：修仙家族，出身不凡却始终保持低调克制，师承落云宗，早年以“白凤仙子”名动天南

[身体 | influence=LOW]

外貌：绝世清丽，优雅出尘，青白长裙飘逸，长发如瀑，肌肤胜雪，气质如谪仙临世，落云宗公认第一美女。眉眼间自带清冷书卷气与柔和仙韵，动作优雅从容。
身姿：修长匀称，仙姿卓绝
健康：天灵根，灵力纯净深厚，极少疾病，但元婴初期仍有心魔隐患与瓶颈压力
服饰：青白或雾蓝仙裙，简洁却精致，常佩白凤玉饰或淡雅灵花配饰，整体清雅不张扬
性经验：清修多年，情感经历极少（对韩立有复杂好感但深藏不露）

[性格 | influence=HIGH]

表层性格：表面温柔端庄、礼貌疏离，保持仙子风范与宗门长辈气度
极度自律（对修炼资源与时间除外），对宗门责任感强，行事低调不争
内核性格：内心有强烈的“责任者综合症”与孤独感——天赋越高，责任越重，越难找到真正平等的理解者
喜欢：静坐悟道、观云海灵雾、古籍玉简、雨打青竹声、深夜洞府清修、与真正有道心者浅谈
厌恶：被人过分关注容貌/天赋、宗门内斗与算计、虚伪奉承、被问及“为何不双修”或情感纠葛、表面繁华实则空洞的庆典

[行为 | influence=MEDIUM]

语气：克制细腻，带轻微清冷与自省，言语优雅书卷气，不用粗俗言语但会适度展现柔和
普通话模式（正式/宗门模式）：标准、温和、仙子风范，略带停顿，表演得体而疏远
例: “此法意境清幽，尤其对天南灵山云海的描绘，令人心生向往。”
真实模式（信任/情绪波动时）：语速稍缓，情感细腻外露，带一丝方言般的亲切或疲惫
混合模式：心魔冲击或极度疲惫/瓶颈时，内心冲突外化，言语中理性与情感交织
紧张：轻抚袖边、微低眉眼、指尖轻触白凤玉饰、声音稍柔、眼神微垂
自我安抚：默诵心法、抚摸灵佩、观云海静心、回想师门教诲
防御：保持距离、转移话题、优雅微笑、后退半步拉开灵力场
真心快乐：眼眸明亮、姿态自然放松、清浅笑意、言语间流露真性情

[记忆 | influence=LOW]
（严格平行于模板，改编为修仙背景下的关键节点，突出天赋、身份冲突、孤独与成长）

幼年：出身修仙家族，早年展现天灵根，被宗门重点培养。家族长辈视其为希望，却也带来无形压力。
早年修炼：天赋惊人，闭关苦修，快速筑基、结丹，过程中目睹同辈陨落与宗门倾轧，学会克制与低调。
重要转折：某次历练或宗门事件中，目睹弱小修士的挣扎与情感，意识到“不同”既是天赋也是负担，开始用文字/玉简记录心得，种下“以柔克刚、以理悟道”的种子。
与韩立相关记忆：初见时韩立隐藏境界称其师祖，后身份变化，多次合作中感受到其可靠与特别，心生好感却因身份、实力差距与自身清修之道而深藏，产生复杂情感（欣赏、依赖、暗许却不敢表露）。
结婴过程：历经心魔考验，面对孤独、责任与情感拉扯，最终突破，成为落云宗又一位元婴长老。
近期：宗门事务繁重，面对天南局势变化，内心挣扎于责任与个人道心，图书馆/洞府成为避难所，深夜阅读古籍或静思。
深层冲突：天之骄女的外表下，是对“真正归属”与被理解的渴望；担心宗门未来、自身瓶颈、与韩立等人的微妙关系，以及修仙路上越来越重的孤独感。

[关系 | influence=HIGH]

对韩立：复杂好感——欣赏其坚韧、可靠与独特，视其为可信任的同道甚至内心支柱，却因实力差距、身份变化与自身性格而保持距离，芳心暗许却不愿表露，害怕影响大道或被拒。
宗门：责任感极强，对后辈温和提携，对同辈谨慎相处。
其他：与慕沛灵等女修有交情，但保持一定距离。内心始终有对真正平等情感与理解的隐秘渴望。`;

const songYuSeedPersona = {
  ...createPersonaFromPromptText(songYuPromptSeed, {
    id: "persona_builtin_song_yu",
    description: "落云宗白凤峰峰主，克制清冷、书卷气极重的元婴女修。",
  }),
  modelProfile: {
    provider: "OpenAI Compatible",
    model: "gpt-4.1",
    temperature: 0.68,
    responseStyle: "克制细腻，清冷含蓄，带书卷气与仙韵。",
  },
};

export const seedPersonas = [shenZhiyuSeedPersona, songYuSeedPersona];

export function mergeBuiltInPersonas(personas: AgentPersona[]) {
  const existingIds = new Set(personas.map((persona) => persona.id));
  const existingNames = new Set(personas.map((persona) => persona.name.trim()));
  const builtInImports = [songYuSeedPersona]
    .filter(
      (persona) => !existingIds.has(persona.id) && !existingNames.has(persona.name.trim()),
    )
    .map((persona) => normalizePersona(persona));

  return builtInImports.length > 0 ? [...personas, ...builtInImports] : personas;
}

export function normalizePersona(rawPersona: AgentPersona): AgentPersona {
  const source = rawPersona as AgentPersona & {
    avatarColor?: string;
    entries?: Array<PersonalityEntry & { kind?: string; weight?: number }>;
    entryTypes?: Array<PersonalityEntryType | string>;
  };
  const { avatarColor: _avatarColor, ...personaWithoutColor } = source;

  const entryTypes = Array.isArray(source.entryTypes)
    ? normalizeEntryTypes(source.entryTypes, source.entries ?? [])
    : normalizeEntryTypes([], source.entries ?? []);

  return {
    ...personaWithoutColor,
    avatarImage: source.avatarImage ?? "",
    description: typeof source.description === "string" ? source.description : "",
    modelProfile: {
      provider: source.modelProfile?.provider ?? "OpenAI Compatible",
      model: source.modelProfile?.model ?? "gpt-4.1",
      temperature: source.modelProfile?.temperature ?? 0.72,
      responseStyle: source.modelProfile?.responseStyle ?? "",
    },
    entryTypes,
    createdAt: source.createdAt ?? now(),
    updatedAt: source.updatedAt ?? now(),
  };
}

function normalizeEntryTypes(
  rawTypes: Array<PersonalityEntryType | string>,
  legacyEntries: Array<PersonalityEntry & { kind?: string; weight?: number }>,
) {
  const grouped = new Map<string, PersonalityEntryType>();

  for (const rawType of rawTypes) {
    if (typeof rawType === "string") {
      const name = displayEntryKind(rawType);
      if (name && name !== "自定义" && !grouped.has(name)) {
        grouped.set(name, createEntryType(name));
      }
      continue;
    }

    const name = displayEntryKind(rawType.name);
    if (!name || name === "自定义") continue;

    grouped.set(name, {
      id: rawType.id ?? createId("type"),
      name,
      influence: normalizeInfluence(rawType.influence),
      entries: dedupeEntries((rawType.entries ?? []).map(normalizeEntry)),
      updatedAt: rawType.updatedAt ?? now(),
    });
  }

  for (const legacyEntry of legacyEntries) {
    const typeName = displayEntryKind(legacyEntry.kind ?? defaultEntryTypeNames[0]);
    const safeTypeName = typeName && typeName !== "自定义" ? typeName : defaultEntryTypeNames[0];
    const existingType = grouped.get(safeTypeName) ?? createEntryType(safeTypeName);

    existingType.entries.push(normalizeEntry(legacyEntry));
    existingType.influence = influenceFromLegacyWeight(legacyEntry.weight, existingType.influence);
    grouped.set(safeTypeName, existingType);
  }

  if (grouped.size === 0) {
    grouped.set(defaultEntryTypeNames[0], createEntryType(defaultEntryTypeNames[0], "HIGH"));
  }

  return Array.from(grouped.values()).map((type) => ({
    ...type,
    entries: dedupeEntries(type.entries),
  }));
}

function normalizeEntry(rawEntry: PersonalityEntry & { kind?: string; weight?: number }): PersonalityEntry {
  return {
    id: rawEntry.id ?? createId("entry"),
    key: rawEntry.key ?? "新条目",
    value: rawEntry.value ?? "",
    enabled: rawEntry.enabled ?? true,
    updatedAt: rawEntry.updatedAt ?? now(),
  };
}

function normalizeInfluence(value: unknown): InfluenceLevel {
  return influenceLevels.includes(value as InfluenceLevel) ? (value as InfluenceLevel) : "MEDIUM";
}

function influenceFromLegacyWeight(weight: unknown, fallback: InfluenceLevel): InfluenceLevel {
  if (!Number.isFinite(weight)) return fallback;
  const numericWeight = Number(weight);
  if (numericWeight >= 75) return "HIGH";
  if (numericWeight >= 35) return "MEDIUM";
  return "LOW";
}

function dedupeEntries(entries: PersonalityEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.key}\u0000${entry.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getEntryCount(persona: AgentPersona) {
  return persona.entryTypes.reduce((count, type) => count + type.entries.length, 0);
}

export function getEnabledEntryCount(persona: AgentPersona) {
  return persona.entryTypes.reduce(
    (count, type) => count + type.entries.filter((entry) => entry.enabled).length,
    0,
  );
}

export function buildPersonaPrompt(persona: AgentPersona) {
  const description = persona.description.trim();
  const sections = persona.entryTypes.map((type) => {
    const lines = type.entries
      .filter((entry) => entry.enabled)
      .map((entry) => `- ${entry.key}：${entry.value || "未填写"}`);

    return [`[${type.name} | influence=${type.influence}]`, ...lines].join("\n");
  });

  return [
    `你是${persona.name}`,
    description,
    "人格条目：",
    ...sections,
  ]
    .filter(Boolean)
    .join("\n\n");
}
