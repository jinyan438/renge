import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Opt-in integration test: production build plus the user's unmodified scripts.
assert.ok(
  process.env.TAVERN_DATABASE_SCRIPT_FILE,
  "Set TAVERN_DATABASE_SCRIPT_FILE to the Xinghe database script JSON",
);
assert.ok(
  process.env.TAVERN_DICE_SCRIPT_FILE,
  "Set TAVERN_DICE_SCRIPT_FILE to the dice auto-updater script JSON",
);

const [databaseScript, diceScript] = await Promise.all([
  readFile(process.env.TAVERN_DATABASE_SCRIPT_FILE, "utf8").then(JSON.parse),
  readFile(process.env.TAVERN_DICE_SCRIPT_FILE, "utf8").then(JSON.parse),
]);
const root = await mkdtemp(join(tmpdir(), "renge-dice-auto-update-"));
const dataDir = join(root, "data");
const profile = join(root, "browser");
const launchOptions = {
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
};
const now = new Date().toISOString();
const seed = {
  version: 1,
  tavernScripts: [
    {
      ...databaseScript,
      id: "fixture-database",
      enabled: true,
      autoRun: true,
      runOn: "startup",
    },
    {
      ...diceScript,
      id: "fixture-dice",
      enabled: true,
      autoRun: true,
      runOn: "startup",
    },
  ],
  chatMode: "roleplay",
  activeCharacterCardId: "fixture-card",
  chatSessions: [{
    id: "fixture-chat",
    title: "Dice compatibility fixture",
    mode: "roleplay",
    roleplayCharacterCardId: "fixture-card",
    messages: [{
      id: "greeting",
      role: "assistant",
      content: "The story begins.",
      createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  }],
  characterCards: [{
    id: "fixture-card",
    name: "Fixture",
    firstMessage: "The story begins.",
    characterBook: { id: "fixture-book", name: "Fixture World", entries: [] },
    createdAt: now,
    updatedAt: now,
  }],
};

let server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
let context;
const closeServer = () => new Promise(resolve => server.server.close(resolve));
const requiredDatabaseMethods = [
  "exportTableAsJson",
  "updateCell",
  "insertRow",
  "deleteRow",
  "getTableTemplate",
  "importTemplateFromData",
  "refreshDataAndWorldbook",
  "registerTableUpdateCallback",
  "registerTableFillStartCallback",
  "lockTableCell",
  "lockTableRow",
  "getTableLockState",
  "openSettings",
  "openVisualizer",
];

try {
  const seedResponse = await fetch(`${server.url}/api/app-data`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: seed }),
  });
  assert.equal(seedResponse.ok, true);

  context = await chromium.launchPersistentContext(profile, launchOptions);
  let page = await context.newPage();
  const moduleRequests = [];
  page.on("request", request => {
    if (request.url().includes("/api/tavern-module-proxy")) moduleRequests.push(request.url());
  });

  const waitForScripts = async currentPage => {
    await currentPage.goto(server.url);
    await currentPage.waitForFunction(
      () => window.__ACU_STAR_DB_III_LOADED__ && window.__AcuDiceHistoryStore__,
      null,
      { timeout: 90_000 },
    );
    await currentPage.waitForFunction(
      () => Object.keys(window.AutoCardUpdaterAPI?.exportTableAsJson() ?? {})
        .some(key => key.startsWith("sheet_")),
      null,
      { timeout: 60_000 },
    );
  };

  await waitForScripts(page);
  assert.ok(
    moduleRequests.some(requestUrl => {
      const remoteUrl = new URL(requestUrl).searchParams.get("url") ?? "";
      return /\/my-tavern-scripts@[^/]+\/dist\//.test(remoteUrl);
    }),
    "the dice auto-updater must request a resolved version through the module proxy",
  );
  assert.equal(
    moduleRequests.some(requestUrl => /%24%7Bversion%7D/i.test(requestUrl)),
    false,
    "the module proxy must not receive the literal ${version} placeholder",
  );
  const tablerCssUrl =
    "https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css";
  const cssResponse = await fetch(
    `${server.url}/api/tavern-module-proxy?url=${encodeURIComponent(tablerCssUrl)}`,
  );
  assert.equal(cssResponse.ok, true);
  assert.match(cssResponse.headers.get("content-type") ?? "", /^text\/css/);

  const apiState = await page.evaluate(requiredMethods => {
    const databaseApi = window.AutoCardUpdaterAPI;
    const context = window.SillyTavern?.getContext?.();
    return {
      databaseMethods: Object.fromEntries(
        requiredMethods.map(method => [method, typeof databaseApi?.[method]]),
      ),
      helperMethods: {
        getChatMessages: typeof window.getChatMessages,
        saveChat: typeof window.saveChat,
        triggerSlash: typeof window.triggerSlash,
        generate: typeof window.TavernHelper?.generate,
      },
      events: {
        source: typeof window.SillyTavern?.eventSource?.on,
        messageSent: context?.eventTypes?.MESSAGE_SENT,
        generationAfterCommands: context?.eventTypes?.GENERATION_AFTER_COMMANDS,
      },
      tableCount: Object.keys(databaseApi.exportTableAsJson()).length,
    };
  }, requiredDatabaseMethods);
  assert.ok(apiState.tableCount >= 8);
  assert.ok(Object.values(apiState.databaseMethods).every(type => type === "function"));
  assert.ok(Object.values(apiState.helperMethods).every(type => type === "function"));
  assert.equal(apiState.events.source, "function");
  assert.equal(apiState.events.messageSent, "message_sent");
  assert.equal(apiState.events.generationAfterCommands, "generation_after_commands");

  await page.evaluate(() => document.querySelector('[data-desktop-project-icon="chat"]')?.click());
  const startChatButton = page.getByRole("dialog", { name: "Agent Chat" })
    .getByRole("button", { name: "开始对话", exact: true });
  await startChatButton.waitFor();
  await startChatButton.evaluate(button => button.click());
  await page.locator("#chat").waitFor();
  assert.deepEqual(await page.evaluate(() => {
    const textarea = window.jQuery("#send_textarea").first();
    const sendButton = window.jQuery("#send_but").first();
    textarea.val("dice-composer-persistence-marker");
    textarea.trigger("input");
    textarea.trigger("change");
    return {
      chatMessages: document.querySelectorAll("#chat .mes, #chat .message-body").length,
      textareaVisible: textarea[0]?.getBoundingClientRect().width > 0,
      sendButtonVisible: sendButton[0]?.getBoundingClientRect().width > 0,
      sendButtonEnabled: sendButton[0]?.disabled === false,
      helperInput: window.TavernHelper.getInput(),
      dicePanelCount: document.querySelectorAll(".acu-wrapper.acu-dice-ui-root").length,
    };
  }), {
    chatMessages: 1,
    textareaVisible: true,
    sendButtonVisible: true,
    sendButtonEnabled: true,
    helperInput: "dice-composer-persistence-marker",
    dicePanelCount: 1,
  });

  assert.equal(await page.evaluate(async () => {
    let calls = 0;
    const context = window.SillyTavern.getContext();
    const listener = context.eventSource.on(
      context.eventTypes.GENERATION_AFTER_COMMANDS,
      () => { calls += 1; },
    );
    await context.eventSource.emit(
      context.eventTypes.GENERATION_AFTER_COMMANDS,
      "normal",
      { prompt: "event compatibility marker", user_input: "event compatibility marker" },
      false,
    );
    listener.stop();
    return calls;
  }), 1);

  const persistedState = await page.evaluate(async () => {
    const api = window.AutoCardUpdaterAPI;
    const sheetKey = Object.keys(api.exportTableAsJson()).find(key => key.startsWith("sheet_"));
    localStorage.setItem("acu_ui_config_v19", JSON.stringify({
      positionMode: "viewport",
      theme: "modern",
      persistenceMarker: "dice-settings-survived-restart",
    }));
    await Promise.resolve(api.refreshDataAndWorldbook());
    await window.SillyTavern.getContext().saveChat();
    return { sheetKey };
  });
  assert.ok(persistedState.sheetKey);

  await context.close();
  context = null;
  const port = server.port;
  await closeServer();
  server = await startRengeServer({ host: "127.0.0.1", port, dataDir });
  context = await chromium.launchPersistentContext(profile, launchOptions);
  page = await context.newPage();
  await waitForScripts(page);

  const restored = await page.evaluate(() => ({
    config: JSON.parse(localStorage.getItem("acu_ui_config_v19") ?? "null"),
    viewportPanel: Boolean(document.querySelector(".acu-wrapper.acu-dice-ui-root.acu-mode-viewport")),
    tableCount: Object.keys(window.AutoCardUpdaterAPI.exportTableAsJson()).length,
  }));
  assert.equal(restored.config.persistenceMarker, "dice-settings-survived-restart");
  assert.equal(restored.config.positionMode, "viewport");
  assert.equal(restored.viewportPanel, true);
  assert.ok(restored.tableCount >= 8);
  console.log(
    "PASS: real dice auto-updater, Xinghe APIs, Tavern events/composer and restart persistence",
  );
} finally {
  await context?.close();
  await closeServer();
  await rm(root, { recursive: true, force: true });
}
