export type RedNote = {
  id: string; title: string; content: string; tags: string[]; images: string[];
  author: string; avatar: string; likes: number; saves: number; comments: number;
  category: string; location: string; time: string; cover?: string; music?: string; activity?: string;
};
export type RedComment = {
  id: string; noteId: string; author: string; avatar: string; content: string;
  time: string; location: string; likes: number; authorLiked?: boolean;
  isAuthor?: boolean; parentId?: string; replyCount?: number;
};
export type RedState = {
  version: 1; liked: string[]; saved: string[]; followed: string[]; likedComments: string[];
  hidden: string[]; history: string[]; notes: RedNote[]; comments: RedComment[];
};

const asset = (name: string) => `/xiaohongshu/${name}.jpg`;
export const RED_NOTES: RedNote[] = [
  {
    id: "game", title: "别动我大河好吗😫 别动我大河心肝，别动…",
    content: "别动我大河好吗😫\n别动我大河心肝，别动我逐鹿心肝，别动我河洛心肝😫\n剩下两个小王你随便挑，挑哪个都能让三分倒转转不起来🌚",
    tags: ["王者万象棋", "王者万象棋日常"], cover: asset("game-cover"), images: [asset("game-note")],
    author: "我靠，这里人少应该不会被发现吧", avatar: asset("avatar-game"),
    likes: 67, saves: 4, comments: 214, category: "游戏", location: "湖南", time: "昨天 23:46",
    activity: "王者万象棋正式上线",
  },
  {
    id: "mall", title: "之心城电梯封了❓", content: "今天路过之心城，发现这边的电梯暂时封起来了。\n准备来逛街的朋友可以走旁边的扶梯～",
    tags: ["合肥", "之心城", "周末去哪儿"], images: [asset("mall-cover")],
    author: "爱吃芋泥", avatar: asset("avatar-mall"), likes: 11, saves: 2, comments: 8,
    category: "生活", location: "安徽", time: "今天 08:10",
  },
  {
    id: "work", title: "为什么领导很少请假？", content: "为什么领导很少请假？",
    tags: ["打工人的状态", "当代上班族现状", "当代年轻人上班现状", "这就是领导", "打工人也是人", "请假", "领导与下属", "上班为了什么", "当代职场人"],
    images: [asset("work-cover"), asset("work-standing"), asset("work-seated")],
    author: "小职人先先贝", avatar: asset("avatar-work"), likes: 1433, saves: 285, comments: 249,
    category: "职场", location: "广东", time: "5天前", music: "上班的日常",
  },
  {
    id: "gemini", title: "双子座的生理性依赖", content: "不粘则已，粘了就是24小时在线。\n什么是生理性依赖？就是想把日常里的小事，都分享给你。",
    tags: ["双子座", "星座", "生理性依赖"], images: [asset("gemini-cover")],
    author: "苏拉大实话", avatar: asset("avatar-gemini"), likes: 474, saves: 138, comments: 36,
    category: "情感", location: "上海", time: "昨天 18:32",
  },
];

export const RED_COMMENTS: RedComment[] = [
  { id: "game-momo", noteId: "game", author: "Momo", avatar: asset("avatar-momo"), content: "为什么要下架", time: "昨天 23:56", location: "福建", likes: 3, replyCount: 10 },
  { id: "game-author", noteId: "game", parentId: "game-momo", author: RED_NOTES[0].author, avatar: asset("avatar-game"), content: "因为要上一个新阵营“建木”，要加新的角色进来，但是为了防止卡池里角色太多导致抽到某一角色的概率变小，所以要下架一个旧阵营作轮换", time: "8小时前", location: "湖南", likes: 48, isAuthor: true },
  { id: "game-wind", noteId: "game", author: "风藏了句喜欢", avatar: asset("avatar-wind"), content: "大河我心肝，日落海我心肝，河洛我心肝，三分我心肝，剩下的随便吧", time: "7小时前", location: "广东", likes: 80 },
  { id: "game-ssr", noteId: "game", parentId: "game-momo", author: "ssr大阴阳师", avatar: asset("avatar-ssr"), content: "原来是阵营轮换，希望喜欢的角色还能回来。", time: "6小时前", location: "浙江", likes: 12 },
  { id: "work-watermelon", noteId: "work", author: "大大大大大大大西瓜", avatar: asset("avatar-watermelon"), content: "上次老板说，他家猫生病了，带猫看了一天病🍑", time: "4天前", location: "安徽", likes: 368, authorLiked: true, replyCount: 21 },
  { id: "work-ssr", noteId: "work", parentId: "work-watermelon", author: "ssr大阴阳师", avatar: asset("avatar-ssr"), content: "老板是老板，领导是领导", time: "4天前", location: "浙江", likes: 447, authorLiked: true },
  { id: "work-croissant", noteId: "work", author: "汤团", avatar: asset("avatar-croissant"), content: "领导都是没有底薪纯靠业绩的销售 如果你也干的了也可以这样啊", time: "5天前", location: "新加坡", likes: 48, authorLiked: true, replyCount: 19 },
  { id: "work-wxfeng", noteId: "work", parentId: "work-croissant", author: "wxfeng", avatar: asset("avatar-wxfeng"), content: "新加坡竟然是这样的吗，销售当领导", time: "4天前", location: "山东", likes: 44, authorLiked: true },
  { id: "work-fish", noteId: "work", author: "行走的鱼", avatar: asset("avatar-fish"), content: "领导也和下属一样打卡呗，一视同仁就没那么多怨气了😭", time: "4天前", location: "江苏", likes: 31 },
  { id: "work-author", noteId: "work", parentId: "work-watermelon", author: RED_NOTES[2].author, avatar: asset("avatar-work"), content: "猫猫也是家里的一份子呀，希望它早日康复。", time: "4天前", location: "广东", likes: 23, isAuthor: true },
  { id: "mall-momo", noteId: "mall", author: "Momo", avatar: asset("avatar-momo"), content: "谢谢提醒！周末正好准备去逛逛。", time: "1小时前", location: "安徽", likes: 2 },
  { id: "gemini-wind", noteId: "gemini", author: "风藏了句喜欢", avatar: asset("avatar-wind"), content: "分享欲就是最直接的喜欢。", time: "昨天", location: "广东", likes: 16 },
];

export function emptyRedState(): RedState {
  return { version: 1, liked: [], saved: [], followed: [], likedComments: [], hidden: [], history: [], notes: [], comments: [] };
}
export function redStorageKey(sessionId: string) { return `renge_pocket_red_v1:${sessionId || "default"}`; }
export function toggleRedItem(items: string[], id: string) { return items.includes(id) ? items.filter(item => item !== id) : [...items, id]; }
export function safeRedImage(value: unknown): value is string {
  return typeof value === "string" && (/^\/xiaohongshu\/[a-z-]+\.jpg$/.test(value) || /^\/touxiang\/\d+\.png$/.test(value) || /^\/api\/app-data\/assets\//.test(value) || /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z\d+/=\s]+$/i.test(value));
}
export function normalizeRedState(value: unknown): RedState {
  const state = emptyRedState();
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return state;
  const source = value as Record<string, unknown>;
  for (const key of ["liked", "saved", "followed", "likedComments", "hidden", "history"] as const) {
    state[key] = [...new Set((Array.isArray(source[key]) ? source[key] : []).filter((id): id is string => typeof id === "string" && id.length <= 200))].slice(-1000);
  }
  const string = (item: unknown, limit = 3000) => typeof item === "string" ? item.slice(0, limit) : "";
  const seenNotes = new Set(RED_NOTES.map(note => note.id));
  for (const item of Array.isArray(source.notes) ? source.notes : []) {
    if (!item || typeof item !== "object") continue;
    const note = item as Record<string, unknown>;
    const id = string(note.id, 100); const title = string(note.title, 40).trim();
    const images = (Array.isArray(note.images) ? note.images : []).filter(safeRedImage).slice(0, 9);
    if (!id || seenNotes.has(id) || !title) continue;
    seenNotes.add(id);
    state.notes.push({ id, title, content: string(note.content), images, tags: (Array.isArray(note.tags) ? note.tags : []).filter((tag): tag is string => typeof tag === "string").slice(0, 10).map(tag => tag.slice(0, 30)), author: string(note.author, 30) || "我", avatar: safeRedImage(note.avatar) ? note.avatar : "/touxiang/20.png", likes: 0, saves: 0, comments: 0, category: "生活", location: "", time: string(note.time, 50) || "刚刚" });
  }
  const seenComments = new Set(RED_COMMENTS.map(comment => comment.id));
  for (const item of Array.isArray(source.comments) ? source.comments : []) {
    if (!item || typeof item !== "object") continue;
    const comment = item as Record<string, unknown>; const id = string(comment.id, 100);
    const noteId = string(comment.noteId, 100); const content = string(comment.content, 1000).trim();
    if (!id || seenComments.has(id) || !seenNotes.has(noteId) || !content) continue;
    seenComments.add(id);
    state.comments.push({ id, noteId, content, author: string(comment.author, 30) || "我", avatar: safeRedImage(comment.avatar) ? comment.avatar : "/touxiang/20.png", time: string(comment.time, 50) || "刚刚", location: "", likes: 0, ...(typeof comment.parentId === "string" ? { parentId: comment.parentId.slice(0, 100) } : {}) });
  }
  return state;
}
