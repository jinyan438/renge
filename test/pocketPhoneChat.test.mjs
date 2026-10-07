import assert from "node:assert/strict";
import test from "node:test";
import { requestPocketReply, resolvePocketModel } from "../src/pocketPhoneChat.ts";

const provider = { id: "test", name: "Test", apiBaseUrl: "http://127.0.0.1:1/v1/", apiKey: "fixture-key", apiType: "chat-completions", modelId: "default", models: ["default", "other"] };
const messages = [{ role: "system", content: "扮演奶糖" }, { role: "user", content: "你好" }];

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
