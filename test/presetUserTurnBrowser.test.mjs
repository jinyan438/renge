import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. A local fixture stands in for the model provider,
// so the real renderer, server and Pi host are exercised end to end.
const root = await mkdtemp(join(tmpdir(), "renge-preset-user-turn-"));
let server, upstream, browser, page;
let modelRequests = [], chatRequests = [], sessionResets = 0;
const errors = [];
const count = (text, needle) => text.split(needle).length - 1;
function assertOrdered(text, needles) {
  const positions = needles.map((needle) => text.indexOf(needle));
  assert.ok(positions.every((position) => position >= 0), `missing one of: ${needles.join(", ")}`);
  assert.deepEqual([...positions].sort((left, right) => left - right), positions, needles.join(" < "));
}
try {
  upstream = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const isStory = JSON.stringify(body.messages ?? []).includes("PRESET_MAIN");
    if (isStory) modelRequests.push(body);
    const content = isStory ? `STORY-REPLY-${modelRequests.length}` : "{}";
    if (!body.stream) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta, finishReason = null) => response.write(`data: ${JSON.stringify({
      id: "fixture", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "fixture-model",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`);
    chunk({ role: "assistant", content });
    chunk({}, "stop");
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  browser = await chromium.launch({ headless: true });

  const now = new Date().toISOString();
  const provider = {
    id: "fixture", name: "Fixture", apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
    apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now,
  };
  const card = { id: "card", name: "Su Nian", firstMessage: "GREETING_TEXT", createdAt: now, updatedAt: now };
  const prompt = (identifier, role, content, marker = false) => ({
    identifier, name: identifier, role, content, enabled: true, marker,
    systemPrompt: false, injectionPosition: 0, injectionDepth: 0, injectionOrder: 100,
  });
  // The shape that lost user turns: user/assistant modules after the chat
  // history, plus a prompt-only regex that rewrites every user message.
  const preset = {
    id: "preset", name: "Modules after history", sourceFormat: "renge",
    prompts: [
      prompt("main", "system", "PRESET_MAIN"),
      prompt("story-open", "user", "STORY_OPEN_MODULE"),
      prompt("chatHistory", "system", "", true),
      prompt("format", "user", "FORMAT_MODULE"),
      prompt("acknowledge", "assistant", "ACK_MODULE"),
      prompt("style", "user", "STYLE_MODULE"),
      prompt("prefill", "assistant", "PREFILL_MODULE"),
    ],
    regexScripts: [{
      id: "wrap", scriptName: "Wrap user input", findRegex: "/^([\\s\\S]+)$/", replaceString: "<ReaderInput>$1</ReaderInput>",
      placement: [1], promptOnly: true, disabled: false,
    }],
    createdAt: now, updatedAt: now,
  };
  const turns = ["pat her head", "open the window", "close the door"];

  // AI chats resume the stored Pi session on every turn, which is where a
  // turn went missing. Roleplay chats rebuild the session before each send.
  for (const mode of ["ai", "roleplay"]) {
    modelRequests = []; chatRequests = []; sessionResets = 0;
    const session = {
      id: `preset-turns-${mode}`, title: "preset-turns", mode, workspaceKey: "default", workspaceName: "默认工作区",
      ...(mode === "roleplay" ? { roleplayCharacterCardId: card.id } : {}),
      messages: mode === "roleplay"
        ? [{ id: "greeting", role: "assistant", content: "GREETING_TEXT", source: "roleplay-greeting", createdAt: now }]
        : [{ id: "earlier", role: "user", content: "EARLIER_TURN", createdAt: now },
          { id: "greeting", role: "assistant", content: "GREETING_TEXT", createdAt: now }],
      createdAt: now, updatedAt: now,
    };
    const seeded = await fetch(`${server.url}/api/app-data`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: {
        version: 1, chatMode: mode, activeProviderId: provider.id, providers: [provider], chatSessions: [session],
        characterCards: [card], activeCharacterCardId: card.id,
        chatPresets: [preset], activeChatPresetId: preset.id, chatPresetEnabled: true,
      } }),
    });
    assert.equal(seeded.status, 200);

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" && path === "/api/pi/chat") chatRequests.push(request.postDataJSON());
      if (request.method() === "DELETE" && path === "/api/pi/session") sessionResets += 1;
    });
    await page.goto(server.url);
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.locator(".chat-session-item").first().locator("button").first().click();
    await page.getByText("GREETING_TEXT").first().waitFor();

    const input = page.getByPlaceholder("输入消息，可粘贴图片");
    for (const [index, text] of turns.entries()) {
      await input.fill(text);
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await page.getByText(`STORY-REPLY-${index + 1}`).first().waitFor();
      await page.getByRole("button", { name: "发送", exact: true }).waitFor();
    }
    assert.equal(chatRequests.length, turns.length, mode);
    assert.equal(modelRequests.length, turns.length, mode);
    if (mode === "ai") assert.equal(sessionResets, 0, "AI chats must exercise the resumed Pi session");

    // What the model actually receives on each turn.
    const received = modelRequests.map((body) => JSON.stringify(body.messages));
    assertOrdered(received[0], ["PRESET_MAIN", "STORY_OPEN_MODULE", "GREETING_TEXT", "pat her head", "FORMAT_MODULE", "ACK_MODULE", "STYLE_MODULE"]);
    assertOrdered(received[1], ["STORY_OPEN_MODULE", "GREETING_TEXT", "pat her head", "STORY-REPLY-1", "open the window", "FORMAT_MODULE", "ACK_MODULE", "STYLE_MODULE"]);
    assertOrdered(received[2], ["pat her head", "STORY-REPLY-1", "open the window", "STORY-REPLY-2", "close the door", "FORMAT_MODULE", "ACK_MODULE", "STYLE_MODULE"]);
    for (const [index, messages] of received.entries()) {
      for (const text of turns.slice(0, index + 1)) assert.equal(count(messages, text), 1, `${mode} turn ${index + 1} carries "${text}" once`);
      for (const module of ["STORY_OPEN_MODULE", "FORMAT_MODULE", "ACK_MODULE", "STYLE_MODULE"]) {
        assert.equal(count(messages, module), 1, `${mode} turn ${index + 1} carries ${module} once`);
      }
      assert.equal(count(messages, "PREFILL_MODULE"), 0, "an assistant prefill would make the model continue the old scene");
    }

    // The renderer names the real turn, although preset modules follow it and
    // the regex has replaced the message object along the way.
    for (const [index, text] of turns.entries()) {
      const { piPromptMessageIndex, piHistoryMode, request } = chatRequests[index];
      assert.equal(piHistoryMode, undefined, "the chat uses the stored Pi session");
      assert.ok(Number.isInteger(piPromptMessageIndex), "the user's turn is named explicitly");
      assert.deepEqual(request.messages[piPromptMessageIndex], { role: "user", content: `<ReaderInput>${text}</ReaderInput>` });
      assert.deepEqual(
        request.messages.slice(piPromptMessageIndex + 1).filter((message) => message.role !== "system")
          .slice(0, 3).map((message) => message.content),
        ["<ReaderInput>FORMAT_MODULE</ReaderInput>", "ACK_MODULE", "<ReaderInput>STYLE_MODULE</ReaderInput>"],
      );
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("Preset user turn browser regression passed: in AI and roleplay chats every user turn reaches the model, followed once by the preset's post-history modules.");
} catch (error) {
  if (page && !page.isClosed()) {
    console.error("Visible statuses:", await page.locator(".chat-status").allTextContents());
    await mkdir(".runtime", { recursive: true });
    await page.screenshot({ path: ".runtime/preset-user-turn-failure.png" });
  }
  throw error;
} finally {
  await browser?.close();
  if (server) { server.server.closeAllConnections(); await new Promise((resolve) => server.server.close(resolve)); }
  if (upstream) { upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve)); }
  await rm(root, { recursive: true, force: true });
}
