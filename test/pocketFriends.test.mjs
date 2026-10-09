import assert from "node:assert/strict";
import test from "node:test";
import { availablePocketFriends, mergePocketFriends, parsePocketFriends, pocketCardSources, pocketFriendBatches, pocketFriendGenerationMessages } from "../src/pocketFriendGeneration.ts";
import { changedPocketLibraryContacts, mergePocketLibraryContacts, POCKET_FRIEND_LIBRARY_KEY, readPocketFriendLibrary, writePocketFriendLibrary } from "../src/pocketFriendLibrary.ts";
import { emptyPocketState, makePocketContact, resetPocketContactChat } from "../src/pocketPhoneState.ts";

const profile = (name, extra = {}) => ({ name, personality: `${name}是花店同事，耐心，会记得朋友的喜好。`, greeting: "{{user}}，来看看新花吧。", avatar: "/touxiang/2.png", sourceLabel: "上下文识别", ...extra });
const storageFixture = (entries = {}) => {
  const values = new Map(Object.entries(entries));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
};

test("card recognition reads basic information, every greeting and enabled book entries without treating a title as a person", () => {
  const card = { name: "北街群像", nickname: "", description: "阿禾是店员", personality: "", scenario: "", systemPrompt: "", messageExample: "", creatorNotes: "", postHistoryInstructions: "", firstMessage: "林霖推门进来", alternateGreetings: ["季北坐在窗前"], groupOnlyGreetings: ["白露正在插花"] };
  const sources = pocketCardSources(card, { name: "花园", entries: [{ comment: "同事", content: "白露开了花店", enabled: true }, { content: "DISABLED", enabled: false }] }).join("\n");
  for (const name of ["阿禾", "林霖", "季北", "白露"]) assert.match(sources, new RegExp(name));
  assert.doesNotMatch(sources, /DISABLED/);
  assert.match(sources, /卡名可能是剧情标题/);
});

test("long context is batched completely including late source entries", () => {
  const sources = ["a".repeat(36000), "最后出现的林霖", "末尾问候语"];
  const chunks = pocketFriendBatches(sources);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every(chunk => chunk.length <= 16000));
  assert.equal(chunks.join("").replaceAll("\n\n", ""), sources.join(""));
});

test("recognition request excludes existing names and the player, and parser handles wrapped multi-character JSON", () => {
  const existing = [profile("奶糖")];
  const messages = pocketFriendGenerationMessages("角色资料", existing, ["小月"]);
  assert.match(messages[0].content, /奶糖/); assert.match(messages[0].content, /小月/);
  const raw = `<think>{"characters":[{"name":"伪人物"}]}</think>\n说明\n\`\`\`json\n${JSON.stringify({ characters: [profile("阿禾"), profile("林霖")] })}\n\`\`\``;
  const roles = parsePocketFriends(raw, { sources: [], sourceCharacterCardId: "card" });
  assert.deepEqual(roles.map(role => role.name), ["阿禾", "林霖"]);
  assert.ok(roles.every(role => role.sourceCharacterCardId === "card"));
  assert.deepEqual(parsePocketFriends('{"characters":[]}', { sources: [] }), []);
  for (const invalid of ["无法识别", '{"notes":[]}', '{"characters":[{"name":"阿禾"}]}']) assert.throws(() => parsePocketFriends(invalid, { sources: [] }));
});

test("duplicate names, aliases, full-width names and player identities are filtered before adding", () => {
  const results = availablePocketFriends([profile(" 奶糖 "), profile("ＡＬＩＣＥ"), profile("小禾"), profile("小月"), profile("{{user}}"), profile("林霖"), profile(" 林霖 ")], [profile("奶糖"), profile("Alice"), profile("阿禾", { nickname: "小禾" })], ["小月"]);
  assert.deepEqual(results.map(role => role.name), ["林霖"]);
});

test("multiple batches merge a person's settings without mixing other characters", () => {
  const roles = mergePocketFriends([profile("阿禾", { nickname: "小禾", personality: "花店同事" }), profile("林霖", { personality: "画家" }), profile("小禾", { personality: "喜欢向日葵", greeting: "" })]);
  assert.equal(roles.length, 2); assert.match(roles[0].personality, /花店同事[\s\S]*喜欢向日葵/); assert.equal(roles[1].personality, "画家");
});

test("global library migrates all old sessions and character phones once without carrying chat or simulated user contacts", () => {
  const one = makePocketContact(profile("阿禾"));
  const other = makePocketContact(profile("林霖"));
  const nested = makePocketContact(profile("季北"));
  const user = { ...makePocketContact(profile("玩家联系人")), id: one.id, syncedOwnerId: one.id };
  const storage = storageFixture({ "renge_pocket_phone_v1:one": JSON.stringify({ ...emptyPocketState(), contacts: [one], characterPhones: { [one.id]: { contacts: [nested, user], groups: [], wallet: { balance: 0, bills: [] } } } }), "renge_pocket_phone_v1:two": JSON.stringify({ ...emptyPocketState(), contacts: [other] }), "renge_pocket_phone_v1:broken": "bad json" });
  const migrated = readPocketFriendLibrary(storage, "renge_pocket_phone_v1:one");
  assert.deepEqual(new Set(migrated.characters.map(role => role.name)), new Set(["阿禾", "林霖", "季北"]));
  assert.ok(migrated.characters.every(role => !Object.hasOwn(role, "messages") && !Object.hasOwn(role, "innerState")));
  const storedPhones = storage.values.get("renge_pocket_phone_v1:one");
  writePocketFriendLibrary(storage, []);
  assert.deepEqual(readPocketFriendLibrary(storage, "renge_pocket_phone_v1:two").characters, []);
  assert.equal(storage.values.get("renge_pocket_phone_v1:one"), storedPhones);
});

test("chat updates do not resurrect deleted library entries while new or edited roles are saved", () => {
  const contact = makePocketContact(profile("阿禾"));
  const previous = { ...emptyPocketState(), contacts: [contact] };
  const next = { ...previous, contacts: [{ ...contact, messages: [...contact.messages, { id: "chat", role: "user", content: "你好", createdAt: contact.createdAt }] }] };
  assert.deepEqual(changedPocketLibraryContacts(previous, next), []);
  next.contacts[0].personality = "新的角色设定";
  assert.equal(changedPocketLibraryContacts(previous, next).length, 1);
  const saved = mergePocketLibraryContacts([], [contact]);
  const renamed = mergePocketLibraryContacts(saved, [{ ...contact, name: "阿禾同学" }]);
  assert.equal(renamed.length, 1); assert.equal(renamed[0].name, "阿禾同学");
});

test("importing a library profile creates independent identities and a fresh greeting for each session", () => {
  const original = makePocketContact(profile("阿禾", { sourceCharacterCardId: "card" }));
  const saved = mergePocketLibraryContacts([], [original])[0];
  const imported = resetPocketContactChat(makePocketContact(saved), "另一位玩家");
  assert.notEqual(imported.id, original.id); assert.notEqual(imported.messages[0].id, original.messages[0].id);
  assert.equal(imported.messages[0].content, "另一位玩家，来看看新花吧。");
  assert.equal(imported.sourceCharacterCardId, "card");
});

test("malformed global library data is preserved and storage failures are visible", () => {
  const storage = storageFixture({ [POCKET_FRIEND_LIBRARY_KEY]: "broken" });
  assert.match(readPocketFriendLibrary(storage, "unused").storageWarning, /读取失败/);
  assert.equal(storage.values.get(POCKET_FRIEND_LIBRARY_KEY), "broken");
  const failing = { ...storageFixture(), setItem: () => { throw new Error("full"); } };
  const result = writePocketFriendLibrary(failing, mergePocketLibraryContacts([], [makePocketContact(profile("阿禾"))]));
  assert.match(result.storageWarning, /暂未保存/); assert.equal(result.characters.length, 1);
});
