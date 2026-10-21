import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. Keep all settings and model requests isolated.
const root = await mkdtemp(join(tmpdir(), "renge-context-limit-"));
let server, browser, page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: root });
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1/v1", apiKey: "fixture-key", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  const response = await fetch(`${server.url}/api/app-data`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {
      version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider],
      contextCompressionSettings: { enabled: true, modelLimits: [
        { id: "limit", modelId: provider.modelId, maxContextTokens: 63_107 },
        { id: "small", modelId: "small-model", maxContextTokens: 100 },
      ] },
    } }),
  });
  assert.equal(response.status, 200);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/pi/chat", route => route.abort());
  async function openSettings() {
    await page.getByRole("button", { name: "打开系统设置", exact: true }).click();
    await page.getByRole("button", { name: "打开设置", exact: true }).click();
    await page.locator(".settings-nav").getByRole("button", { name: "LLM", exact: true }).click();
  }
  const inputs = page.getByRole("textbox", { name: "上下文上限（K Token）", exact: true });
  const input = inputs.first();
  const savedTokens = async id => {
    const saved = await (await fetch(`${server.url}/api/app-data`)).json();
    return saved.data.contextCompressionSettings.modelLimits.find(limit => limit.id === id).maxContextTokens;
  };
  async function expectSaved(id, tokens) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await savedTokens(id) === tokens) return;
      await delay(100);
    }
    assert.equal(await savedTokens(id), tokens, "wait for the actual persisted Token value");
  }
  await page.goto(server.url);
  await openSettings();
  assert.equal(await input.inputValue(), "63.107", "existing Token values display in decimal K");
  assert.equal(await inputs.nth(1).inputValue(), "0.1", "small saved limits are preserved");
  assert.equal(await input.getAttribute("min"), null);
  assert.equal(await input.getAttribute("max"), null);
  await page.getByText("按 K 输入，1 K = 1000 Token，支持小数。", { exact: false }).waitFor();

  await input.fill("");
  assert.equal(await input.inputValue(), "", "clearing does not restore or clamp the previous value");
  await expectSaved("limit", 63_107);
  for (const [character, expected] of [["1", "1"], ["2", "12"], ["8", "128"], [".", "128."], ["5", "128.5"], ["0", "128.50"]]) {
    await input.pressSequentially(character);
    assert.equal(await input.inputValue(), expected, "typing keeps each intermediate string intact");
  }
  await input.blur();
  assert.equal(await input.inputValue(), "128.50", "blur does not rewrite the typed value");
  await expectSaved("limit", 128_500);
  await input.fill("0.001");
  await expectSaved("limit", 1);
  assert.equal(await input.inputValue(), "0.001", "values below the old minimum are accepted");
  await input.fill("invalid");
  await input.blur();
  assert.equal(await input.inputValue(), "invalid", "invalid drafts are preserved instead of replaced");
  assert.equal(await input.getAttribute("aria-invalid"), "true");
  assert.equal(await savedTokens("limit"), 1, "invalid drafts keep the last valid saved limit");
  await input.fill("63.107");
  await expectSaved("limit", 63_107);
  await input.fill("12345.678");
  await expectSaved("limit", 12_345_678);
  await page.reload();
  await openSettings();
  assert.equal(await input.inputValue(), "12345.678", "large limits survive reload without the old cap");
  assert.equal(await inputs.nth(1).inputValue(), "0.1");

  await page.getByRole("button", { name: "添加模型上限", exact: true }).click();
  const added = page.locator(".context-compression-limit-row").last();
  await added.getByLabel("模型 ID", { exact: true }).fill("new-model");
  await inputs.last().fill("2000");
  assert.equal(await inputs.last().inputValue(), "2000");
  await added.getByRole("button", { name: "删除 new-model 的上下文上限", exact: true }).click();
  assert.equal(await inputs.count(), 2, "adding and deleting rows preserve the other inputs");
  await page.locator(".context-compression-limits").screenshot({ path: ".runtime/context-limit-input.png" });
  assert.deepEqual(errors, []);
  console.log("PASS: decimal K conversion, clearing and incremental typing, no forced changes, validation, unrestricted positive limits, save/reload, and row controls.");
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: ".runtime/context-limit-input-failure.png" });
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  const resolvedRoot = resolve(root);
  assert.ok(resolvedRoot.startsWith(resolve(tmpdir(), "renge-context-limit-")));
  await rm(resolvedRoot, { recursive: true, force: true });
}
