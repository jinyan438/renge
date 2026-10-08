import assert from "node:assert/strict";
import test from "node:test";
import { emptyPocketState, makePocketContact, normalizePocketState, getPocketConversations, getPocketGenerationMode, getPocketConversationBubbles } from "../src/pocketPhoneState.ts";
import { characterPhoneView, commitCharacterPhoneView, applyCharacterPhoneGeneration, characterPhoneGenerationPrompt, syncCharacterPhoneWallets } from "../src/pocketCharacterPhone.ts";
import { buildPocketHistoryMessage, buildSharedPocketConversation, formatPocketContextMessage, syncPocketContext } from "../src/pocketPhoneContext.ts";
import { applyPocketContextChanges, recordPocketContextDeletions } from "../src/pocketPhoneSync.ts";
import { appendPocketAttachment, settlePocketTransfer } from "../src/pocketWechatMedia.ts";

const user = { nickname: "小月", bio: "喜欢画画", avatarImage: "/touxiang/20.png" };
const actor = name => makePocketContact({ name, personality: "{{char}}是{{user}}的朋友", avatar: "/touxiang/9.png", greeting: "", sourceLabel: "角色卡", sourceCharacterCardId: `card-${name}` });
const message = (id, role, extra = {}) => ({ id, role, content: id, createdAt: "2026-10-08T10:00:00Z", ...extra });
const seed = () => ({ ...emptyPocketState(), contacts: [{ ...actor("奶糖"), messages: [message("用户消息", "user"), message("角色消息", "assistant")] }, actor("薄荷")] });
const generated = (name = "同事") => JSON.stringify({ contacts: [{ name, personality: "喜欢烘焙的同事", avatarIndex: 2, messages: [{ from: "ta", text: "明天一起值班" }, { from: "them", text: "好呀" }] }] });

test("synchronized views retain original reply segmentation, manual line breaks and single attachment/code bubbles after reload", () => {
  const root = seed(); const owner = root.contacts[0];
  owner.messages = [message("manual", "user", { content: "学校门口\n我在这边" }),
    message("reply", "assistant", { content: "你发校门口做什么？\n这个点你怎么跑出去的，下午还有课。\n上课前回来。\n别当没听见。" }),
    message("code", "assistant", { content: "代码：\n```js\nconsole.log(1)\n```" }),
    message("location", "assistant", { content: "[位置：学校门口]", attachment: { kind: "location", name: "学校门口", address: "南门" } })];
  const restored = normalizePocketState(JSON.parse(JSON.stringify(root)));
  const original = restored.contacts[0]; const mirror = characterPhoneView(restored, owner.id, user).contacts[0];
  original.messages.forEach((item, index) => assert.deepEqual(getPocketConversationBubbles(mirror, mirror.messages[index]), getPocketConversationBubbles(original, item)));
  assert.equal(getPocketConversationBubbles(mirror, mirror.messages[0]).length, 1);
  assert.equal(getPocketConversationBubbles(mirror, mirror.messages[1]).length, 4);
  assert.equal(getPocketConversationBubbles(mirror, mirror.messages[2]).length, 1);
  assert.equal(getPocketConversationBubbles(mirror, mirror.messages[3]).length, 1);
  const npc = actor("同事"); npc.messages = [message("npc-reply", "assistant", { content: "好呀\n明天见" })];
  assert.equal(getPocketConversationBubbles(npc, npc.messages[0]).length, 2);
});

test("owner phone projects a single canonical user chat and writes both directions without duplicate records", () => {
  const root = seed(); const owner = root.contacts[0];
  const view = characterPhoneView(root, owner.id, user);
  assert.deepEqual(view.contacts[0].messages.map(item => item.role), ["assistant", "user"]);
  view.contacts[0].messages.push(message("角色手动发送", "user"), message("用户模拟回复", "assistant", { replyContextMessageId: "角色手动发送" }));
  const next = commitCharacterPhoneView(root, owner.id, view);
  assert.deepEqual(next.contacts[0].messages.map(item => item.role), ["user", "assistant", "assistant", "user"]);
  assert.equal(next.characterPhones[owner.id].contacts.length, 0);
  assert.equal(next.contacts[1], root.contacts[1]);
  const reloaded = normalizePocketState(JSON.parse(JSON.stringify(next)));
  assert.equal(reloaded.contacts[0].messages.at(-1).replyContextMessageId, "角色手动发送");
  assert.equal(getPocketGenerationMode(characterPhoneView(reloaded, owner.id, user).contacts[0]), "proactive");
  const records = syncPocketContext([], null, getPocketConversations(next), user.nickname);
  assert.equal(records.length, 4);
  assert.match(formatPocketContextMessage(records[2]), /奶糖 → 小月/);
  assert.match(formatPocketContextMessage(records[3]), /小月 → 奶糖/);
  assert.deepEqual(buildPocketHistoryMessage(records[2], owner.id, "", undefined, true), { role: "user", content: "角色手动发送" });
});

test("generated contacts remain owner-specific, survive reload and inject the owner as sender", () => {
  const root = seed(); const owner = root.contacts[0];
  const view = applyCharacterPhoneGeneration(characterPhoneView(root, owner.id, user), generated(), [user.nickname], owner);
  const next = commitCharacterPhoneView(root, owner.id, view);
  assert.equal(next.contacts.length, 2);
  assert.equal(characterPhoneView(next, root.contacts[1].id, user).contacts.length, 1);
  const restored = normalizePocketState(next);
  const npc = characterPhoneView(restored, owner.id, user).contacts[1];
  assert.equal(npc.messages.length, 2);
  assert.ok(npc.contextCharacterCardIds.includes(owner.sourceCharacterCardId));
  const records = syncPocketContext([], null, getPocketConversations(restored), user.nickname);
  const npcRecords = records.filter(item => item.extra.pocketPhone.contactId === npc.id);
  assert.match(formatPocketContextMessage(npcRecords[0]), /奶糖 → 同事/);
  assert.match(formatPocketContextMessage(npcRecords[1]), /同事 → 奶糖/);
  const prompt = buildSharedPocketConversation(npc, { nickname: owner.name, bio: owner.personality }, [], [], [])[0].content;
  assert.match(prompt, /奶糖是小月的朋友/);
  assert.match(prompt, /只以当前联系人或群成员身份回复手机主人/);
});

test("generation excludes the real user and owner, appends existing histories and rejects partial invalid responses atomically", () => {
  const root = seed(); const owner = root.contacts[0]; const base = characterPhoneView(root, owner.id, user);
  assert.throws(() => applyCharacterPhoneGeneration(base, generated("小月"), [user.nickname], owner), /同步联系人/);
  assert.throws(() => applyCharacterPhoneGeneration(base, generated("奶糖"), [user.nickname], owner), /同步联系人/);
  const once = applyCharacterPhoneGeneration(base, generated(), [user.nickname], owner);
  const twice = applyCharacterPhoneGeneration(once, generated(), [user.nickname], owner);
  assert.equal(twice.contacts.length, 2); assert.equal(twice.contacts[1].id, once.contacts[1].id); assert.equal(twice.contacts[1].messages.length, 4);
  const invalid = JSON.parse(generated()); invalid.contacts.push({ name: "坏格式", personality: "同学", messages: [{ from: "user", text: "错误" }] });
  assert.throws(() => applyCharacterPhoneGeneration(once, JSON.stringify(invalid), [user.nickname], owner), /聊天记录格式/);
  assert.equal(once.contacts[1].messages.length, 2);
  const only = applyCharacterPhoneGeneration(base, generated(), [user.nickname], owner, true);
  assert.equal(only.contacts[1].messages.length, 0);
  assert.match(characterPhoneGenerationPrompt(owner, base, user), /绝对不要生成用户/);
});

test("main edits and deletions reach nested chats and both synchronized perspectives without resurrection", () => {
  const root = seed(); const owner = root.contacts[0];
  const generatedView = applyCharacterPhoneGeneration(characterPhoneView(root, owner.id, user), generated(), [user.nickname], owner);
  const saved = commitCharacterPhoneView(root, owner.id, generatedView); const npc = saved.characterPhones[owner.id].contacts[0];
  const edited = applyPocketContextChanges(saved, [{ contactId: npc.id, messageId: npc.messages[0].id, content: "改过的消息" }, { contactId: owner.id, messageId: "用户消息", content: null }]);
  assert.equal(edited.characterPhones[owner.id].contacts[0].messages[0].content, "改过的消息");
  assert.equal(characterPhoneView(edited, owner.id, user).contacts[0].messages.length, 1);
  const cleared = recordPocketContextDeletions(edited, { ...edited, characterPhones: { ...edited.characterPhones, [owner.id]: { ...edited.characterPhones[owner.id], contacts: [] } } });
  const stale = syncPocketContext([], null, getPocketConversations(edited), user.nickname);
  const fresh = syncPocketContext(stale, getPocketConversations(edited), getPocketConversations(cleared), user.nickname, cleared.deletedContextMessages);
  assert.equal(fresh.length, 1);
});

test("shared attachments reverse sides and transfer settlement credits the correct wallet once", () => {
  const root = seed(); const owner = root.contacts[0]; root.wallet.balance = 100;
  let view = characterPhoneView(root, owner.id, user); view.wallet.balance = 50;
  view = appendPocketAttachment(view, owner.id, { kind: "transfer", amount: 10, note: "请吃甜点", status: "pending" });
  let saved = commitCharacterPhoneView(root, owner.id, view);
  const transfer = saved.contacts[0].messages.at(-1);
  assert.equal(transfer.role, "assistant"); assert.equal(saved.wallet.balance, 100); assert.equal(saved.characterPhones[owner.id].wallet.balance, 40);
  view = characterPhoneView(saved, owner.id, user);
  view = settlePocketTransfer(view, owner.id, transfer.id, "received", "assistant");
  saved = commitCharacterPhoneView(saved, owner.id, view);
  assert.equal(saved.wallet.balance, 110);
  assert.equal(commitCharacterPhoneView(saved, owner.id, characterPhoneView(saved, owner.id, user)).wallet.balance, 110);
});

test("accepting a user's transfer from either phone credits the owner once", () => {
  let root = seed(); root.wallet.balance = 100; const owner = root.contacts[0];
  root = appendPocketAttachment(root, owner.id, { kind: "transfer", amount: 20, note: "请吃饭", status: "pending" });
  const id = root.contacts[0].messages.at(-1).id;
  const accepted = settlePocketTransfer(root, owner.id, id, "received", "assistant");
  const synced = syncCharacterPhoneWallets(root, accepted);
  assert.equal(synced.wallet.balance, 80); assert.equal(synced.characterPhones[owner.id].wallet.balance, 20);
  assert.equal(syncCharacterPhoneWallets(root, synced).characterPhones[owner.id].wallet.balance, 20);
  const view = characterPhoneView(root, owner.id, user);
  const settledView = settlePocketTransfer(view, owner.id, id, "received", "user");
  const committed = syncCharacterPhoneWallets(root, commitCharacterPhoneView(root, owner.id, settledView));
  assert.equal(committed.characterPhones[owner.id].wallet.balance, 20);
});
