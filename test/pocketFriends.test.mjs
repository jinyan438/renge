import assert from "node:assert/strict";
import test from "node:test";
import { availablePocketFriends, mergePocketFriends, parsePocketFriends, pocketCardSources, pocketFriendBatches, pocketFriendGenerationMessages } from "../src/pocketFriendGeneration.ts";
import { changedPocketLibraryContacts, mergePocketLibraryContacts, POCKET_FRIEND_LIBRARY_KEY, readPocketFriendLibrary, writePocketFriendLibrary } from "../src/pocketFriendLibrary.ts";
import { emptyPocketState, makePocketContact, resetPocketContactChat } from "../src/pocketPhoneState.ts";
import { requestPocketFriends } from "../src/pocketFriendRequest.ts";

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

test("recognition accepts prose-wrapped arrays, aliases, nested results and structured human profiles", () => {
  const chinese = [{ 姓名: "阿禾", 人设: { 身份: "店员", 性格: ["开朗", "耐心"], 关系: "林霖的朋友" }, 问候语: "来看花吧" }];
  const inputs = [
    `人物如下：\n\`\`\`json\n${JSON.stringify(chinese)}\n\`\`\`\n完成。`,
    JSON.stringify({ data: { 角色列表: chinese } }),
    JSON.stringify({ result: { roles: [{ Character_Name: "阿禾", Description: "店员", speaking_style: "温和", first_mes: "来看花吧" }] } }),
    JSON.stringify(JSON.stringify({ characters: [profile("阿禾")] })),
    `格式示例：{"notes":[]}\n实际结果：${JSON.stringify({ cast: [{ name: "阿禾", persona: "店员" }] })}`,
  ];
  for (const input of inputs) assert.equal(parsePocketFriends(input, { sources: [] })[0].name, "阿禾");
  const person = parsePocketFriends(inputs[0], { sources: [] })[0];
  assert.match(person.personality, /身份：店员/); assert.match(person.personality, /开朗\n耐心/); assert.match(person.personality, /林霖的朋友/);
  assert.equal(person.greeting, "来看花吧");
});

test("conservative JSON cleanup handles trailing commas and literal newlines without changing quoted punctuation or inventing truncated people", () => {
  const raw = '\uFEFF```jsonc\n{ // 角色清单\n"characters": [{"name":"阿禾","personality":"第一行\n第二行，有 ,} 和 ,] 以及 https://example.test/path",},],}\n```';
  const person = parsePocketFriends(raw, { sources: [] })[0];
  assert.equal(person.personality, "第一行\n第二行，有 ,} 和 ,] 以及 https://example.test/path");
  const withMarkup = profile("阿禾", { personality: '原文保留 <think>这段描述</think> 和 "引号" 及 {括号}' });
  assert.equal(parsePocketFriends(JSON.stringify({ characters: [withMarkup] }), { sources: [] })[0].personality, withMarkup.personality);
  assert.throws(() => parsePocketFriends('{"characters":[{"name":"阿禾","personality":"店员"},{"name":"林霖"', { sources: [] }));
});

const provider = { id: "test", name: "Test", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture", apiType: "chat-completions", modelId: "fixture", models: ["fixture"] };
const reply = content => Response.json({ choices: [{ message: { content } }] });

test("both recognition sources automatically repair malformed, incomplete and plain-text results with unchanged evidence and exclusions", async t => {
  const requests = []; let broken;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    requests.push(JSON.parse(options.body).request);
    return reply(requests.length % 2 ? broken : JSON.stringify({ characters: [profile("阿禾"), profile("林霖")] }));
  });
  for (const cardId of [undefined, "card"]) for (const invalid of ["阿禾是花店店员，林霖是画家。", "{'characters': []}", '{"characters":[{"name":"阿禾"}]', '{"characters":[{"name":"阿禾"}]}']) {
    broken = invalid; let repairs = 0;
    const context = { sources: ["同一份资料"], sourceCharacterCardId: cardId };
    const result = await requestPocketFriends(provider, "fixture", context.sources[0], context, [profile("奶糖")], ["小月"], new AbortController().signal, () => repairs++);
    assert.equal(repairs, 1); assert.deepEqual(result.map(person => person.name), ["阿禾", "林霖"]);
    assert.ok(result.every(person => person.sourceCharacterCardId === cardId));
    const [original, repaired] = requests.slice(-2);
    assert.deepEqual(repaired.messages.slice(0, -1), original.messages);
    assert.match(repaired.messages.at(-1).content, /角色识别格式补全任务/);
    assert.ok(repaired.messages.at(-1).content.includes(JSON.stringify(invalid)));
    assert.match(repaired.messages[0].content, /奶糖/); assert.match(repaired.messages[0].content, /小月/);
  }
});

test("empty or reasoning-only replies get one retry, while an explicit empty list needs no repair", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    calls++;
    if (calls % 2) return Response.json({ choices: [{ message: { content: "", reasoning_content: "思考中，即使这里写有阿禾也不能成为人设" }, finish_reason: "length" }] });
    assert.match(JSON.parse(options.body).request.messages.at(-1).content, /没有返回正文/);
    return reply(JSON.stringify({ characters: [profile("阿禾")] }));
  });
  assert.equal((await requestPocketFriends(provider, "fixture", "资料", { sources: [] }, [], [], new AbortController().signal))[0].name, "阿禾");
  assert.equal(calls, 2);
  calls = 0; globalThis.fetch.mock.mockImplementation(async () => { calls++; return reply('{"characters":[]}'); });
  assert.deepEqual(await requestPocketFriends(provider, "fixture", "资料", { sources: [] }, [], [], new AbortController().signal), []); assert.equal(calls, 1);
});

test("repair is bounded, canceled work stays canceled, and provider/network failures are not retried as formatting errors", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return reply("依然缺少JSON"); });
  await assert.rejects(requestPocketFriends(provider, "fixture", "资料", { sources: [] }, [], [], new AbortController().signal), /已自动补全一次/); assert.equal(calls, 2);
  calls = 0; globalThis.fetch.mock.mockImplementation(async () => { calls++; return reply(""); });
  await assert.rejects(requestPocketFriends(provider, "fixture", "资料", { sources: [] }, [], [], new AbortController().signal), /自动重试后仍为空/); assert.equal(calls, 2);
  calls = 0; globalThis.fetch.mock.mockImplementation(async () => { calls++; return Response.json({ error: { message: "bad credentials" } }, { status: 401 }); });
  await assert.rejects(requestPocketFriends(provider, "fixture", "资料", { sources: [] }, [], [], new AbortController().signal), /bad credentials/); assert.equal(calls, 1);
  const controller = new AbortController(); calls = 0;
  globalThis.fetch.mock.mockImplementation(async () => { calls++; if (calls === 2) controller.abort(); return reply(calls === 1 ? "plain text" : JSON.stringify({ characters: [profile("阿禾")] })); });
  await assert.rejects(requestPocketFriends(provider, "fixture", "资料", { sources: [] }, [], [], controller.signal), { name: "AbortError" }); assert.equal(calls, 2);
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
