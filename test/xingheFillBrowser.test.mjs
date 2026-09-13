import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Opt-in integration test: production build plus the user's unmodified script.
assert.ok(process.env.TAVERN_SCRIPT_FILE, "Set TAVERN_SCRIPT_FILE to the Xinghe script JSON");
const script = JSON.parse(await readFile(process.env.TAVERN_SCRIPT_FILE, "utf8"));
const launchOptions = { headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined };

for (const apiType of ["chat-completions", "responses"]) {
  const root = await mkdtemp(join(tmpdir(), "renge-xinghe-fill-"));
  const dataDir = join(root, "data");
  const profile = join(root, "browser");
  const requests = [];
  let marker = "manual-fill-marker";
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ path: request.url, body });
    const content = body.stream
      ? "The hero arrives at the town and visits the market. ".repeat(20)
      : `<thought>${"Fixture output padding. ".repeat(30)}</thought><tableEdit>\ninsertRow(0,{"0":"${marker}","1":"restored","2":"test"})\n</tableEdit>`;
    if (body.stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const message = { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: content, annotations: [] }] };
      const events = apiType === "responses"
        ? [
            { type: "response.created", response: { id: "resp_fixture", object: "response", status: "in_progress", output: [] } },
            { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
            { type: "response.output_text.delta", output_index: 0, item_id: message.id, content_index: 0, delta: content },
            { type: "response.output_item.done", output_index: 0, item: message },
            { type: "response.completed", response: { id: "resp_fixture", object: "response", status: "completed", output: [message], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } },
          ]
        : [{ choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }];
      response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n");
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(apiType === "responses"
        ? { object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: content }] }] }
        : { choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] }));
    }
  });
  let server;
  let context;
  const closeServer = () => new Promise(resolve => server.server.close(resolve));
  try {
    await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
    server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
    const now = new Date().toISOString();
    const seed = {
      version: 1, tavernScripts: [script], chatMode: "roleplay", activeCharacterCardId: "fixture-card", activeProviderId: "fixture-provider",
      providers: [{ id: "fixture-provider", name: "Fixture API", apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture-key", modelId: "fixture-model", models: ["fixture-model"], apiType, updatedAt: now }],
      llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
      chatSessions: [{ id: "fixture-chat", title: "Fixture", mode: "roleplay", roleplayCharacterCardId: "fixture-card", messages: [
        { id: "greeting", role: "assistant", content: "The hero arrives.", createdAt: now },
        { id: "user", role: "user", content: "Enter town.", createdAt: now },
        { id: "reply", role: "assistant", content: "The hero enters the town.", createdAt: now },
      ], createdAt: now, updatedAt: now }],
      characterCards: [{ id: "fixture-card", name: "Fixture", firstMessage: "The hero arrives.", characterBook: { id: "fixture-book", name: "Fixture World", entries: [] }, createdAt: now, updatedAt: now }],
    };
    assert.equal((await fetch(`${server.url}/api/app-data`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }),
    })).ok, true);
    context = await chromium.launchPersistentContext(profile, launchOptions);
    let page = await context.newPage();
    page.on("pageerror", error => console.error("Browser error:", error.message));
    const openRuntime = async () => {
      await page.goto(server.url);
      await page.waitForFunction(() => window.__ACU_STAR_DB_III_LOADED__, null, { timeout: 90000 });
      await page.waitForFunction(() => Object.keys(window.AutoCardUpdaterAPI?.exportTableAsJson() ?? {}).some(key => key.startsWith("sheet_")), null, { timeout: 60000 });
      await page.getByText("SP·数据库 IX", { exact: true }).click();
    };
    await openRuntime();
    await page.getByRole("button", { name: "切换到高手模式" }).click();
    await page.getByText("填表工作台", { exact: true }).first().click();
    await page.getByText("全局数据表", { exact: true }).first().waitFor({ state: "visible", timeout: 60000 });
    if (await page.getByRole("switch").first().getAttribute("aria-checked") === "true") {
      await page.getByRole("switch").first().click();
    }
    await page.getByRole("button", { name: "执行手动填表", exact: true }).click();
    await page.getByRole("button", { name: "确认并继续", exact: true }).click();
    const waitForTable = async value => page.waitForFunction(expected => {
      const chat = window.SillyTavern.getContext().chat;
      return JSON.stringify(chat.at(-1)?.TavernDB_ACU_IsolatedData ?? {}).includes(expected);
    }, value, { timeout: 60000 });
    await waitForTable(marker);
    await page.getByText("手动填表完成。", { exact: true }).waitFor();
    marker = "automatic-fill-marker";
    await page.evaluate(async () => {
      window.__fixtureEvents = [];
      const ctx = window.SillyTavern.getContext();
      ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, id => window.__fixtureEvents.push(id));
      await window.TavernHelper.sendMessage("Continue to the town.");
    });
    await waitForTable(marker);
    assert.deepEqual(await page.evaluate(() => window.__fixtureEvents), [4]);
    assert.ok(requests.some(({ body }) => body.stream));
    assert.ok(requests.filter(({ body }) => !body.stream).length >= 2);
    assert.ok(requests.every(({ path }) => path === (apiType === "responses" ? "/v1/responses" : "/v1/chat/completions")));
    // Wait for the actual disk commit, not just the mutable in-memory chat.
    await page.waitForFunction(async expected => {
      const payload = await (await fetch("/api/app-data")).json();
      return JSON.stringify(payload.data.chatSessions[0].messages.at(-1).extra?.TavernDB_ACU_IsolatedData ?? {}).includes(expected);
    }, marker);
    await context.close();
    context = null;
    const port = server.port;
    await closeServer();
    server = await startRengeServer({ host: "127.0.0.1", port, dataDir });
    context = await chromium.launchPersistentContext(profile, launchOptions);
    page = await context.newPage();
    await openRuntime();
    await waitForTable(marker);
    await page.waitForFunction(expected => JSON.stringify(window.AutoCardUpdaterAPI.exportTableAsJson()).includes(expected), marker);
    assert.match(await page.evaluate(() => JSON.stringify(window.SillyTavern.getContext().chat[2].TavernDB_ACU_IsolatedData)), /manual-fill-marker/);
    console.log(`PASS ${apiType}: real Xinghe manual fill, automatic fill, disk commit and process restart`);
  } catch (error) {
    console.error(apiType, "requests:", requests.map(({ path, body }) => ({ path, stream: body.stream })));
    const page = context?.pages().at(-1);
    if (page) console.error(await page.evaluate(() => ({
      messages: window.SillyTavern?.getContext().chat.map(message => ({ role: message.role, length: message.mes?.length })),
      status: document.body.innerText.slice(-1200),
    })));
    throw error;
  } finally {
    await context?.close();
    if (server) await closeServer();
    await new Promise(resolve => upstream.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}
