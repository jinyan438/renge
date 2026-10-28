import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, _electron as electron } from "playwright";
import { startRengeServer } from "../server.mjs";

// Reproduce opening forms that first save an assistant message, then submit
// through the legacy composer. Use isolated data and a mocked model response.
const desktop = process.argv.includes("--desktop");
const root = await mkdtemp(join(tmpdir(), "renge-html-send-"));
let server, browser, app, page;
const errors = [], requests = [];
try {
  const now = new Date().toISOString();
  const document = `<!doctype html><html><head><style>body{margin:0;padding:16px}</style></head><body>
    <label>姓名<input id="name" value="旅人"></label><button id="enter">进入轮回</button><output></output>
    <script>
      document.getElementById('enter').onclick = async function() {
        this.disabled = true;
        await triggerSlash('/sendas name=Guide 已保存开局配置');
        await new Promise(resolve => setTimeout(resolve, 300));
        const input = document.getElementById('send_textarea');
        const button = document.getElementById('send_but');
        input.value = '开始旅程：' + document.getElementById('name').value;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        button.click();
        document.querySelector('output').textContent = '已进入';
      };
    </script></body></html>`;
  const card = { id: "send-card", name: "开局测试", firstMessage: `\`\`\`html\n${document}\n\`\`\``, createdAt: now, updatedAt: now };
  card.regexScripts = [{ id: "status", scriptName: "当前楼层状态", findRegex: "<StatusPlaceHolderImpl/>",
    replaceString: '<div class="fixture-status">当前状态</div>', placement: [2], markdownOnly: true, disabled: false }];
  card.tavernScripts = [{ id: "runtime", name: "开局脚本", enabled: true, autoRun: true, runOn: "load", content: "parent.__openingRuntimeReady = true;" }];
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture", apiType: "chat-completions", modelId: "fixture", models: ["fixture"], updatedAt: now };
  const data = { version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true, chatMultiBubbleEnabled: false,
    activeCharacterCardId: card.id, characterCards: [card], activeProviderId: provider.id, providers: [provider],
    chatSessions: [{ id: "send-chat", title: "开局发送测试", mode: "roleplay", roleplayCharacterCardId: card.id,
      messages: [{ id: "opening", role: "assistant", content: card.firstMessage, source: "roleplay-greeting", createdAt: now }], createdAt: now, updatedAt: now }] };
  const mock = async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({choices:[{index:0,delta:{content:"旅程已开始"},finish_reason:null}]})}\n\ndata: [DONE]\n\n` });
  };
  if (desktop) {
    await mkdir(join(root, "data"));
    await writeFile(join(root, "data", "app-data.json"), JSON.stringify(data));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
    Object.assign(env, { RENGE_DATA_DIR: join(root, "data"), RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"), RENGE_ELECTRON_CACHE_DIR: join(root, "cache") });
    app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
    const home = await app.firstWindow();
    await home.context().route("**/api/chat/completions", mock);
    await home.context().route("**/api/pi/chat", mock);
    await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
    [page] = await Promise.all([app.waitForEvent("window"), home.getByRole("button", { name: "开始对话", exact: true }).click()]);
    home.on("pageerror", error => errors.push(error.message));
  } else {
    server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
    assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({data}) })).ok, true);
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route("**/api/chat/completions", mock);
    await page.route("**/api/pi/chat", mock);
    await page.goto(server.url);
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  }
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  const frame = page.frameLocator("iframe.chat-html-frame").first();
  await frame.getByLabel("姓名").fill("林风");
  await page.evaluate(() => { window.__openingFrame = document.querySelector("iframe.chat-html-frame"); });
  await page.locator('#chat .mes[mesid="0"] .fixture-status').waitFor();
  await frame.getByRole("button", { name: "进入轮回", exact: true }).click();
  await frame.getByText("已进入", { exact: true }).waitFor();
  await page.getByText("开始旅程：林风", { exact: true }).waitFor();
  await page.getByText("旅程已开始", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector("iframe.chat-html-frame") === window.__openingFrame), true,
    "moving the status panel preserves the opening iframe and its pending submission");
  assert.equal(await frame.getByLabel("姓名").inputValue(), "林风");
  assert.equal(await page.locator("#chat .fixture-status").count(), 1);
  await page.locator("#chat .mes").last().locator(".fixture-status").waitFor();
  assert.equal(requests.length, 1);
  assert.match(JSON.stringify(requests[0]), /已保存开局配置/);
  assert.match(JSON.stringify(requests[0]), /开始旅程：林风/);
  assert.deepEqual(errors, []);
  console.log(`PASS: opening configuration, legacy input and send, model request and response (${desktop ? "desktop" : "web"})`);
} catch (error) {
  console.error("Opening send diagnostics:", errors, "requests:", requests.length);
  console.error(await page?.locator("#chat .mes").evaluateAll(messages => messages.map(m => ({role:m.getAttribute('is_user'),text:m.innerText.slice(0,100)}))));
  throw error;
} finally {
  await app?.close();
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
