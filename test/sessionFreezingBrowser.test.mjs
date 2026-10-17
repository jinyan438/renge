import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-session-freezing-"));
let server, browser;
try {
  const now = new Date().toISOString();
  const messages = Array.from({ length: 320 }, (_, index) => ({
    id: `message-${index}`, role: index % 2 ? "assistant" : "user",
    content: index === 0 ? "超长会话" : `历史消息 ${index}`, createdAt: now,
  }));
  messages.push({ id: "large-tool", role: "assistant", content: "", createdAt: now,
    toolVisualization: { name: "read", status: "done", args: { path: "large-history.txt" },
      result: { content: [{ type: "text", text: "完整工具结果\n".repeat(200_000) }] } } });
  messages.push({ id: "last", role: "assistant", content: "历史末尾", createdAt: now });
  const script = { id: "timer-owner", name: "会话生命周期", enabled: true, autoRun: true, runOn: "startup", content: `
    const owner = SillyTavern.chatId;
    setInterval(() => { parent.__freezeTicks[owner] = (parent.__freezeTicks[owner] || 0) + 1; }, 25);
  ` };
  await mkdir(join(root, "data"));
  await writeFile(join(root, "data", "app-data.json"), JSON.stringify({
    version: 1, chatMode: "ai", chatMultiBubbleEnabled: false, tavernScripts: [script],
    chatSessions: [
      { id: "long", title: "超长会话", mode: "ai", messages, createdAt: now, updatedAt: now },
      { id: "short", title: "短会话", mode: "ai", messages: [{ id: "short-message", role: "assistant", content: "短会话正文", createdAt: now }], createdAt: now, updatedAt: now },
    ],
  }));
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20_000);
  const errors = [], cacheHistoryWrites = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__freezeTicks = {};
    window.__historyCacheWrites = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "renge_chat_sessions") window.__historyCacheWrites += 1;
      return Reflect.apply(original, this, [key, value]);
    };
  });
  page.on("worker", (worker) => cacheHistoryWrites.push(worker.url()));
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  const select = (title) => page.locator(".chat-session-item").filter({ hasText: title }).locator("button").first().click();
  await select("超长会话");
  await page.getByText("历史末尾", { exact: true }).waitFor();
  assert.ok(await page.locator("#chat > .mes").count() <= 80);
  assert.equal(await page.locator('#chat .mes[mesid="0"]').count(), 0);
  assert.equal(await page.locator(".pi-tool-visualization-body").count(), 0, "closed history never builds tool output DOM");
  await page.locator(".chat-tool-run > summary").click();
  await page.locator(".pi-tool-visualization > summary").click();
  await page.locator(".pi-tool-visualization-body").waitFor();
  await page.locator(".chat-tool-run > summary").click();
  await page.locator(".pi-tool-visualization-body").waitFor({ state: "detached" });
  for (let index = 0; index < 4; index++) await page.getByRole("button", { name: "查看更早的消息", exact: true }).click();
  await page.locator('#chat .mes[mesid="0"]').getByText("超长会话", { exact: true }).waitFor();
  assert.ok(await page.locator("#chat > .mes").count() <= 80);
  await page.getByRole("button", { name: "回到最新消息", exact: true }).click();
  await page.getByText("历史末尾", { exact: true }).waitFor();
  await page.waitForFunction(() => window.__freezeTicks.long >= 2);
  await select("短会话");
  await page.getByText("短会话正文", { exact: true }).waitFor();
  await page.waitForFunction(() => window.__freezeTicks.short >= 2);
  const before = await page.evaluate(() => ({ ...window.__freezeTicks }));
  await page.waitForFunction((value) => window.__freezeTicks.short >= value + 4, before.short);
  assert.equal(await page.evaluate(() => window.__freezeTicks.long), before.long, "old session timers are destroyed even with identical script configuration");
  assert.equal(await page.locator('#chat .mes').count(), 1, "the previous session DOM is released");
  await select("超长会话");
  await page.waitForFunction((value) => window.__freezeTicks.long > value, before.long);
  await page.getByText("历史末尾", { exact: true }).waitFor();
  // Script APIs and persisted history still include every floor, not only the displayed page.
  const runtimeFrame = await (await page.locator('iframe[title="酒馆脚本运行环境"]').elementHandle()).contentFrame();
  assert.ok(runtimeFrame, "active script environment exists");
  assert.equal(await runtimeFrame.evaluate(() => getChatMessages("0-{{lastMessageId}}").length), messages.length);
  await page.waitForFunction(() => window.__historyCacheWrites === 0);
  // Saving a script variable exercises the worker serializer and a durable reload.
  await runtimeFrame.evaluate(() => replaceVariables({ probe: "durable" }, { type: "chat" }));
  await page.waitForFunction(() => window.__historyCacheWrites === 0);
  await page.waitForTimeout(900);
  const saved = (await (await fetch(`${server.url}/api/app-data`)).json()).data;
  assert.equal(saved.chatSessions.find((session) => session.id === "long").messages.length, messages.length);
  assert.equal(saved.chatSessions.find((session) => session.id === "long").scriptVariables.probe, "durable");
  assert.ok(cacheHistoryWrites.some((url) => url.includes("jsonSerialization.worker")), "save serialization runs in a temporary worker");
  await page.reload();
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  await page.getByText("历史末尾", { exact: true }).waitFor();
  const restoredRuntime = await (await page.locator('iframe[title="酒馆脚本运行环境"]').elementHandle()).contentFrame();
  await restoredRuntime.waitForFunction(() => typeof getVariables === "function");
  assert.equal(await restoredRuntime.evaluate(() => getVariables({ type: "chat" }).probe), "durable");
  assert.deepEqual(errors, []);
  console.log("PASS: bounded 80-message pages, full history APIs, lazy tool bodies, frozen session timers, worker saves and preserved history");
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise((resolve) => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
