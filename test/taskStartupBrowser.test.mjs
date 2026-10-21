import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron } from "playwright";
import { seedColdPiSession } from "./piStartupFixture.mjs";

const root = await mkdtemp(join(tmpdir(), "renge-desktop-startup-"));
const calls = [], reports = [];
let app;
let finishResponses = false;
const finish = (response) => response.end(`data: ${JSON.stringify({ id: "startup", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 } })}\n\ndata: [DONE]\n\n`);
const upstream = createServer(async (request, response) => {
  const call = { response, bytes: 0, ready: false };
  calls.push(call);
  for await (const chunk of request) call.bytes += chunk.length;
  call.ready = true;
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({ id: "startup", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "启动成功" }, finish_reason: null }] })}\n\n`);
  if (finishResponses) finish(response);
});
try {
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const dataDir = join(root, "data");
  await mkdir(dataDir);
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture", apiType: "chat-completions", modelId: "fixture", models: ["fixture"], updatedAt: now };
  await writeFile(join(dataDir, "app-data.json"), JSON.stringify({ version: 1, chatMode: "ai", providers: [provider], activeProviderId: "fixture",
    contextCompressionSettings: { enabled: true }, llmContextSettings: { skills: false, mcpTools: false, workspaceTools: false },
    chatSessions: [{ id: "startup-stress", title: "冷启动验收", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", createdAt: now, updatedAt: now,
      messages: [{ id: "seed", role: "user", content: "冷启动验收", createdAt: now }] }],
  }));
  const env = { ...process.env, RENGE_DATA_DIR: dataDir, RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"), RENGE_ELECTRON_CACHE_DIR: join(root, "cache") };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
  const home = await app.firstWindow();
  await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
  const [page] = await Promise.all([app.waitForEvent("window"), home.getByRole("button", { name: "开始对话", exact: true }).click()]);
  page.setDefaultTimeout(30_000);
  await page.locator(".chat-session-item").filter({ hasText: "冷启动验收" }).click();
  const input = page.locator("#send_textarea");
  const installProbe = () => {
    window.__startup = { active: false, frames: [], tasks: [], blurs: 0 };
    let previous;
    const frame = (time) => { if (previous && window.__startup.active) window.__startup.frames.push(time - previous); previous = time; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    new PerformanceObserver((list) => { if (window.__startup.active) window.__startup.tasks.push(...list.getEntries().map((entry) => entry.duration)); }).observe({ entryTypes: ["longtask"] });
    document.addEventListener("focusout", (event) => { if (window.__startup.active && event.target.id === "send_textarea") window.__startup.blurs++; });
  };
  await home.evaluate(installProbe); await page.evaluate(installProbe);
  await delay(1_000);
  for (const mode of ["mouse", "enter"]) {
    // Recreate a cold native history for each input method. Pi also compacts it
    // before the ordinary model turn, which must stay responsive and cancellable.
    await seedColdPiSession(dataDir, "startup-stress", ["main-text", "main-vision"]);
    await delay(1_000);
    const index = calls.length;
    finishResponses = false;
    await input.fill(`启动验收 ${mode}`);
    for (const target of [home, page]) await target.evaluate(() => { Object.assign(window.__startup, { active: true, frames: [], tasks: [], blurs: 0 }); });
    const started = Date.now();
    if (mode === "mouse") await page.locator("#send_but").click(); else await input.press("Enter");
    const latencies = [];
    let typed = "";
    for (let step = 0; step < 20 || !calls[index]?.ready; step++) {
      assert.ok(Date.now() - started < 30_000, "real Pi session must reach the local model");
      assert.equal(await input.evaluate((node) => node.ownerDocument.activeElement === node), true, `${mode}: input stays focused without automation refocusing it`);
      const before = Date.now();
      await page.keyboard.insertText("a"); typed += "a"; latencies.push(Date.now() - before);
      await delay(100);
    }
    assert.equal(await input.inputValue(), typed, "all typing during cold initialization survives");
    const metrics = await page.evaluate(() => { window.__startup.active = false; return window.__startup; });
    const main = await home.evaluate(() => { window.__startup.active = false; return window.__startup; });
    metrics.frames.push(...main.frames); metrics.tasks.push(...main.tasks);
    const report = { mode, bytes: calls[index].bytes, longestFrame: Math.max(...metrics.frames), longestTask: Math.max(0, ...metrics.tasks), inputMax: Math.max(...latencies), blurs: metrics.blurs };
    reports.push(report); console.log(JSON.stringify(report));
    assert.ok(report.bytes > 45_000_000, "tens of megabytes of native persisted history actually reach the model");
    assert.equal(report.blurs, 0, "starting a task never resets the native input focus");
    assert.ok(report.longestTask < 50, "cold startup must not monopolize the UI thread");
    assert.ok(report.longestFrame < 50, "cold startup must keep painting frames");
    assert.ok(report.inputMax < 100, "typing remains responsive during real session initialization");
    // Deliberately move focus while a task is running: the fix must not steal it back.
    await page.locator(".chat-thread").click({ position: { x: 20, y: 20 } });
    await delay(200);
    assert.equal(await input.evaluate((node) => node.ownerDocument.activeElement === node), false);
    finishResponses = true;
    // Release compaction and any following generation requests naturally.
    for (const call of calls.slice(index)) if (call.ready && !call.response.writableEnded) finish(call.response);
    await page.locator(".chat-session-item").filter({ hasText: "冷启动验收" }).locator(".chat-session-running").waitFor({ state: "hidden" });
    await page.locator(".chat-status.loading").waitFor({ state: "hidden" });
  }
  await mkdir(".runtime", { recursive: true });
  await writeFile(".runtime/task-cold-startup-desktop.json", JSON.stringify(reports, null, 2));
} finally {
  for (const call of calls) call.response.destroy();
  await app?.close(); upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
