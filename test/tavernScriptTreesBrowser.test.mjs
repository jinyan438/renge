import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Reproduce Eldran's opening script switch without distributing the card.
const root = await mkdtemp(join(tmpdir(), "renge-script-trees-"));
let server, browser;
try {
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const opening = `<!doctype html><html><body>
    <button id="toggle">Toggle external scripts</button><output id="scripts"></output><output id="error"></output>
    <script>
      const bundled = new Set(['bundled-source']);
      function refresh() {
        try { document.getElementById('scripts').textContent = JSON.stringify(getScriptTrees({type:'character'}).map(s=>({id:s.id,enabled:s.enabled}))); }
        catch (error) { document.getElementById('error').textContent = error.message; }
      }
      document.getElementById('toggle').onclick = () => {
        const scripts = getScriptTrees({type:'character'});
        const enabled = !scripts.some(s=>!bundled.has(s.id)&&s.enabled);
        updateScriptTreesWith(trees=>trees.map(s=>bundled.has(s.id)?s:{...s,enabled}),{type:'character'});
        refresh();
      };
      refresh();setInterval(refresh,100);
    </script></body></html>`;
  const makeScript = (id, sourceId, content = "", enabled = true) => ({
    id, sourceId, sourceFormat: "sillytavern", name: sourceId, enabled, autoRun: true, runOn: "startup", content,
    info: "Keep original notes", data: { nested: { value: 7 } }, exportWith: { data: false, button: true },
  });
  const characterScripts = [
    makeScript("bundled", "bundled-source", "parent.__scriptTreesReady=true;eventOn(tavern_events.GENERATION_ENDED,()=>parent.__fixtureEnded=(parent.__fixtureEnded||0)+1);"),
    makeScript("external", "external-source", "parent.__externalRuns=(parent.__externalRuns||0)+1;"),
  ];
  const card = { id: "card", name: "Script library fixture", firstMessage: `\`\`\`html\n${opening}\n\`\`\``, tavernScripts: characterScripts, createdAt: now, updatedAt: now };
  const data = {
    version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true, chatMultiBubbleEnabled: false,
    activeCharacterCardId: card.id, characterCards: [card, { ...card, id: "other", name: "Other card", tavernScripts: [] }],
    tavernScripts: [makeScript("global", "global-source")],
    chatPresetEnabled: true, activeChatPresetId: "preset",
    chatPresets: [{ id: "preset", name: "Fixture preset", tavernScripts: [makeScript("preset-script", "preset-source")], createdAt: now, updatedAt: now }],
    activeProviderId: "provider", providers: [{ id: "provider", name: "Fixture", apiType: "chat-completions", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture", modelId: "fixture", models: ["fixture"], updatedAt: now }],
    chatSessions: [{ id: "chat", title: "Script trees fixture", mode: "roleplay", roleplayCharacterCardId: card.id,
      messages: [{ id: "greeting", role: "assistant", source: "roleplay-greeting", content: card.firstMessage, createdAt: now }], createdAt: now, updatedAt: now }],
  };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30_000);
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/pi/chat", async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Fixture reply" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n` });
  });
  const open = async () => {
    await page.goto(server.url);
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.waitForFunction(() => window.__scriptTreesReady);
    await page.locator("iframe.chat-html-frame").first().waitFor();
  };
  const frame = async () => {
    const f = await (await page.locator("iframe.chat-html-frame").first().elementHandle()).contentFrame();
    await f.waitForFunction(() => document.querySelector("#scripts")?.textContent);
    assert.equal(await f.locator("#error").textContent(), "");
    return f;
  };
  await open();
  let frontend = await frame();
  const readScopes = () => page.evaluate(() => Object.fromEntries(["global", "preset", "character"].map(type => [type, getScriptTrees({ type }).map(s => s.id)])));
  assert.deepEqual(await readScopes(), { global: ["global-source"], preset: ["preset-source"], character: ["bundled-source", "external-source"] });
  assert.deepEqual(await frontend.evaluate(() => getScriptTrees({ type: "global" }).map(s => s.id)), ["global-source"]);
  assert.equal(await frontend.evaluate(() => getScriptTrees({ type: "character" })[0].data.nested.value), 7);
  const oldFrame = await page.locator("iframe.chat-html-frame").first().elementHandle();
  await frontend.locator("#toggle").click();
  await page.waitForFunction(() => typeof getScriptTrees === 'function' && getScriptTrees({ type: "character" })[1].enabled === false);
  await page.waitForFunction(old => !old.isConnected, oldFrame);
  frontend = await frame();
  assert.equal(await frontend.evaluate(() => getScriptTrees({ type: "character" })[0].enabled), true);
  assert.equal(await frontend.evaluate(() => getScriptTrees({ type: "character" })[1].enabled), false);
  const saved = () => readFile(join(root, "data", "app-data.json"), "utf8").then(JSON.parse);
  let persisted;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    persisted = await saved();
    if (persisted.characterCards[0].tavernScripts[1].enabled === false) break;
    await page.waitForTimeout(100);
  }
  assert.equal(persisted.characterCards[0].tavernScripts[1].enabled, false);
  assert.equal(persisted.characterCards[0].tavernScripts[1].id, "external");
  assert.equal(persisted.characterCards[0].tavernScripts[1].info, "Keep original notes");
  assert.equal(persisted.characterCards[0].tavernScripts[1].data.nested.value, 7);
  assert.equal(persisted.tavernScripts[0].enabled, true);
  assert.equal(persisted.chatPresets[0].tavernScripts[0].enabled, true);
  assert.deepEqual(persisted.characterCards[1].tavernScripts, []);
  await open();
  frontend = await frame();
  assert.equal(await frontend.evaluate(() => getScriptTrees({ type: "character" })[1].enabled), false);
  await frontend.locator("#toggle").click();
  await page.waitForFunction(() => typeof getScriptTrees === 'function' && getScriptTrees({ type: "character" })[1].enabled === true);
  frontend = await frame();

  // Separate mounted preview survives deleting a sibling message; reads receive
  // the updated context before a subsequent create/delete operation.
  await page.evaluate(async () => createChatMessages([{ role: "assistant", message: "old-map" }, { role: "assistant", message: "keep-entry" }]));
  await frontend.waitForFunction(() => getLastMessageId() === 2);
  await frontend.evaluate(async () => deleteChatMessages([1], { refresh: "all" }));
  await frontend.waitForFunction(() => getLastMessageId() === 1);
  assert.deepEqual(await page.evaluate(() => getChatMessages("0-1").map(m => m.message.includes("keep-entry"))), [false, true]);
  await frontend.evaluate(async () => deleteChatMessages([-1], { refresh: "all" }));
  await frontend.waitForFunction(() => getLastMessageId() === 0);
  await frontend.evaluate(() => {
    injectPrompts([{ id: "once", role: "system", position: "in_chat", depth: 0, content: "NEW_STOCK_ONCE" }], { once: true });
    injectPrompts([{ id: "persistent", role: "system", position: "in_chat", depth: 0, content: "PERSISTENT_NEWS" }]);
    const removed = injectPrompts([{ id: "removed", content: "REMOVED_PROMPT" }]);
    removed.uninject();
  });
  const send = async (text, count) => {
    const ended = await page.evaluate(() => window.__fixtureEnded || 0);
    await page.getByPlaceholder("输入消息，可粘贴图片").fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForFunction(n => window.__fixtureEnded >= n, ended + 1);
    assert.equal(requests.length, count);
  };
  await send("Start", 1);
  assert.ok(JSON.stringify(requests[0]).includes("NEW_STOCK_ONCE"));
  assert.ok(JSON.stringify(requests[0]).includes("PERSISTENT_NEWS"));
  assert.ok(!JSON.stringify(requests[0]).includes("REMOVED_PROMPT"));
  await page.waitForFunction(() => getChatMessages().some(m => m.message === "Fixture reply"));
  await send("Continue", 2);
  assert.ok(!JSON.stringify(requests[1]).includes("NEW_STOCK_ONCE"));
  assert.ok(JSON.stringify(requests[1]).includes("PERSISTENT_NEWS"));
  assert.deepEqual(errors, []);
  console.log("PASS: isolated frontend script switches, scope isolation, persistence/reload, original IDs, message deletion, prompt injection and once/uninject lifecycle");
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
