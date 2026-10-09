import assert from "node:assert/strict";
import test from "node:test";
import { requestPocketReply, requestPocketWechatTurn, resolvePocketModel } from "../src/pocketPhoneChat.ts";
import { POCKET_HORMONES, PocketWechatFormatError } from "../src/pocketPhoneInner.ts";

const provider = { id: "test", name: "Test", apiBaseUrl: "http://127.0.0.1:1/v1/", apiKey: "fixture-key", apiType: "chat-completions", modelId: "default", models: ["default", "other"] };
const messages = [{ role: "system", content: "扮演奶糖" }, { role: "user", content: "你好" }];
const hormones = Object.fromEntries(POCKET_HORMONES.map(item => [item.key, 50]));
const turnOutput = JSON.stringify({ texts: ["一起去画画吧"], innerMonologue: "其实很期待和他一起走", hormones });
const replyResponse = content => Response.json({ choices: [{ message: { content } }] });

test("model selection follows the app or a specific phone channel without substituting a deleted channel", () => {
  const second = { ...provider, id: "second", modelId: "second-model" };
  assert.equal(resolvePocketModel([provider, second], "second", "", "obsolete").modelId, "second-model");
  assert.equal(resolvePocketModel([provider, second], "second", "test", "other").modelId, "other");
  assert.equal(resolvePocketModel([provider], "test", "deleted", "other").provider, undefined);
});

test("phone messages use the app proxy and only the requested conversation", async t => {
  let body;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/chat/completions");
    body = JSON.parse(options.body);
    assert.equal(options.signal.aborted, false);
    return Response.json({ choices: [{ message: { content: "  你好呀  " } }] });
  });
  assert.equal(await requestPocketReply(provider, "other", messages, new AbortController().signal), "你好呀");
  assert.equal(body.apiBaseUrl, "http://127.0.0.1:1/v1");
  assert.equal(body.request.model, "other");
  assert.deepEqual(body.request.messages, messages);
  assert.equal(body.request.stream, false);
  assert.equal(body.request.tools, undefined);
});

test("Responses API output and text content parts both become character replies", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "想你啦" }] }] }));
  assert.equal(await requestPocketReply({ ...provider, apiType: "responses" }, "default", messages, new AbortController().signal), "想你啦");
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ choices: [{ message: { content: [{ type: "text", text: "今天" }, { type: "text", text: "很好" }] } }] }));
  assert.equal(await requestPocketReply(provider, "default", messages, new AbortController().signal), "今天很好");
});

test("empty gateway content does not mask final output in alternate response fields", async t => {
  const payloads = [
    { choices: [{ message: { content: "" } }], output_text: "最终正文" },
    { choices: [{ message: { content: null }, text: "旧版正文" }] },
    { choices: [{ message: { content: [{ type: "text", text: { value: "分段正文" } }] } }] },
    { choices: [{ message: { content: [{ type: "text", text: '{"personality":"保留 ' }, { type: "text", text: ' 空格"}' }] } }] },
    { choices: [{ message: { content: "", parsed: { characters: [] } } }] },
    { choices: [{ message: { content: "", reasoning_content: "不能作为正文" } }], output: [{ type: "message", content: [{ type: "output_text", text: "Responses 正文" }] }] },
  ];
  t.mock.method(globalThis, "fetch", async () => Response.json(payloads.shift()));
  for (const expected of ["最终正文", "旧版正文", "分段正文", '{"personality":"保留  空格"}', '{"characters":[]}', "Responses 正文"]) assert.equal(await requestPocketReply(provider, "default", messages, new AbortController().signal), expected);
});

test("configuration errors, upstream failures and empty replies are actionable errors", async t => {
  await assert.rejects(requestPocketReply(undefined, "", messages, new AbortController().signal), /手机设置/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "channel unavailable" } }, { status: 503 }));
  await assert.rejects(requestPocketReply(provider, "default", messages, new AbortController().signal), /channel unavailable/);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ choices: [{ message: { content: " " } }] }));
  await assert.rejects(requestPocketReply(provider, "default", messages, new AbortController().signal), /重试/);
  globalThis.fetch.mock.mockImplementation(async () => Response.json(null));
  await assert.rejects(requestPocketReply(provider, "default", messages, new AbortController().signal), /无效消息/);
});

test("a canceled reply is never returned after the network completes", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => { controller.abort(); return Response.json({ choices: [{ message: { content: "late reply" } }] }); });
  await assert.rejects(requestPocketReply(provider, "default", messages, controller.signal), { name: "AbortError" });
});

test("WeChat repeats its required output format after plain chat history and accepts wrapped complete output without an extra call", async t => {
  const requests = [];
  const history = [...messages, { role: "assistant", content: "之前的普通文字回复" }, { role: "user", content: "我们去画画吧" }];
  t.mock.method(globalThis, "fetch", async (_, options) => { requests.push(JSON.parse(options.body).request); return replyResponse(`以下是回复：\n\`\`\`json\n${turnOutput}\n\`\`\``); });
  const turn = await requestPocketWechatTurn(provider, "default", history, new AbortController().signal);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].messages.slice(0, -1), history);
  assert.match(requests[0].messages.at(-1).content, /应用指令，不是用户聊天消息/);
  assert.match(requests[0].messages.at(-1).content, /innerMonologue.*hormones/);
  for (const item of POCKET_HORMONES) {
    assert.ok(requests[0].messages.at(-1).content.includes(`${item.key}（${item.name}）`));
    assert.ok(requests[0].messages.at(-1).content.includes(item.effect));
    assert.ok(requests[0].messages.at(-1).content.includes(item.update));
  }
  assert.match(requests[0].messages.at(-1).content, /本人尚无激素状态/);
  assert.equal(requests[0].max_tokens, 4096);
  assert.equal(history.length, 4);
  assert.deepEqual(turn.texts, ["一起去画画吧"]);
});

test("plain dialogue, incomplete JSON and missing state get one automatic completion using the frozen context and latest baseline", async t => {
  const previous = { monologue: "之前的心事", hormones: { ...hormones, dopamine: 63 }, updatedAt: "" };
  const history = [{ role: "system", content: `人设：喜欢画画。最新激素状态：${JSON.stringify(previous.hormones)}` }, ...messages.slice(1)];
  const requests = [];
  let malformed;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    requests.push(JSON.parse(options.body).request);
    return replyResponse(requests.length % 2 ? malformed : turnOutput);
  });
  for (const raw of ["一起去画画吧", turnOutput.slice(0, -2), JSON.stringify({ texts: ["一起去画画吧"], innerMonologue: "其实很期待和他一起走", hormones: { dopamine: 50 } })]) {
    malformed = raw;
    const before = requests.length;
    const turn = await requestPocketWechatTurn(provider, "default", history, new AbortController().signal, previous);
    assert.equal(requests.length, before + 2);
    assert.deepEqual(requests.at(-1).messages.slice(0, -1), requests.at(-2).messages);
    assert.match(requests.at(-1).messages.at(-1).content, /格式补全任务/);
    assert.ok(requests.at(-1).messages.at(-1).content.includes(JSON.stringify(raw)));
    assert.match(requests.at(-1).messages[0].content, /"dopamine":63/);
    assert.equal(requests.at(-1).max_tokens, 6144);
    assert.deepEqual(turn.innerState.previousHormones, previous.hormones);
    assert.deepEqual(turn.innerState.hormones, hormones);
    assert.equal(turn.innerState.monologue, "其实很期待和他一起走");
  }
});

test("format repair is bounded and never substitutes defaults or hides configuration/network errors", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return replyResponse("仍旧缺少状态"); });
  await assert.rejects(requestPocketWechatTurn(provider, "default", messages, new AbortController().signal), PocketWechatFormatError);
  assert.equal(calls, 2);
  calls = 0;
  globalThis.fetch.mock.mockImplementation(async () => { calls++; return Response.json({ error: { message: "bad credentials" } }, { status: 401 }); });
  await assert.rejects(requestPocketWechatTurn(provider, "default", messages, new AbortController().signal), /bad credentials/);
  assert.equal(calls, 1);
});

test("single and quiet group updates resend all hormone effects/directions with only the latest saved baseline, including format completion", async t => {
  const previous = { monologue: "已经很安心", hormones: { ...hormones, dopamine: 61 }, previousHormones: { ...hormones, dopamine: 12 }, updatedAt: "" };
  const requests = [];
  const modelLevels = { ...hormones, dopamine: 83, oxytocin: 79, cortisol: 19 };
  let group = false;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    requests.push(JSON.parse(options.body).request);
    return replyResponse(requests.length % 2 ? "抱抱就好" : JSON.stringify({ ...(group ? { speak: false } : {}), texts: group ? [] : ["抱抱就好"], innerMonologue: "有他陪着很安心，却又期待下一次见面", hormones: modelLevels }));
  });
  for (const quiet of [false, true]) {
    group = quiet;
    const history = [...messages, { role: "assistant", content: "刚才已收到过表白" }];
    const turn = await requestPocketWechatTurn(provider, "default", history, new AbortController().signal, previous, group);
    for (const request of requests.slice(-2)) {
      const task = request.messages.at(-1).content;
      for (const item of POCKET_HORMONES) {
        assert.ok(task.includes(`${item.key}（${item.name}）`), `${item.key} must have its own description in the update task`);
        assert.ok(task.includes(item.effect));
        assert.ok(task.includes(item.update));
      }
      assert.match(task, /没有新的触发依据就保持不变/);
      assert.match(task, /同一情绪、重复话题.*不能每次都继续累加/);
      assert.match(task, /不要把增量当作新值/);
      assert.match(task, /9 项的变化幅度均可大可小/);
      assert.match(task, /明确变化可为 5~12.*强烈变化可为 13~25.*状态反转可为 26~40/);
      assert.match(task, /区间是强弱参考，不是固定配方或硬限制/);
      assert.match(task, /接近 0 或 100 时以剩余空间为准/);
      assert.match(task, /每项都需要自己的升降依据/);
      assert.match(task, /GABA 由是否真的放松决定/);
      assert.match(task, /不能因为想黏着对方就增加性激素/);
      assert.doesNotMatch(task, /较慢变化|缓慢变化|普通交流优先维持|通常不变/);
      assert.match(task, /"dopamine":61/);
      assert.doesNotMatch(task, /"dopamine":12|previousHormones/);
      assert.deepEqual(request.messages.slice(0, history.length), history);
    }
    assert.match(requests.at(-1).messages.at(-1).content, /同一轮格式补全.*只从最新已保存基线更新一次/);
    assert.deepEqual(turn.innerState.hormones, modelLevels);
    assert.deepEqual(turn.innerState.previousHormones, previous.hormones);
    assert.equal(turn.innerState.hormones.dopamine - turn.innerState.previousHormones.dopamine, 22);
    assert.equal(turn.innerState.hormones.cortisol - turn.innerState.previousHormones.cortisol, -31);
    assert.equal(turn.innerState.hormones.gaba, previous.hormones.gaba);
    assert.equal(turn.speak, !group);
  }
  assert.equal(requests.length, 4);
});

test("format completion retains a silent group decision and cancellation discards a late completion", async t => {
  const controller = new AbortController();
  const requests = [];
  const quiet = JSON.stringify({ speak: false, texts: [], innerMonologue: "想先听他们说", hormones });
  t.mock.method(globalThis, "fetch", async (_, options) => {
    requests.push(JSON.parse(options.body).request);
    return replyResponse(requests.length % 2 ? JSON.stringify({ speak: false, texts: [] }) : quiet);
  });
  const turn = await requestPocketWechatTurn(provider, "default", messages, controller.signal, undefined, true);
  assert.equal(turn.speak, false); assert.deepEqual(turn.texts, []);
  assert.equal(Object.keys(turn.innerState.hormones).length, 9);
  assert.match(requests.at(-1).messages.at(-1).content, /保留.*群聊发言决定/);
  requests.length = 0;
  globalThis.fetch.mock.mockImplementation(async () => {
    requests.push({});
    if (requests.length === 2) controller.abort();
    return replyResponse(requests.length === 1 ? "普通消息" : turnOutput);
  });
  await assert.rejects(requestPocketWechatTurn(provider, "default", messages, controller.signal), { name: "AbortError" });
  assert.equal(requests.length, 2);
});
