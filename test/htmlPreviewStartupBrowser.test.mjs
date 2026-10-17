import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Common libraries must work offline, retain their realm and initialize before
// card head scripts. No user data or external service is needed for this test.
const root = await mkdtemp(join(tmpdir(), "renge-html-startup-"));
let server, browser;
try {
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const requests = [];
  server.server.on("request", request => {
    if (request.url.includes("html-preview-libraries-")) requests.push(request.headers.host);
  });
  const now = new Date().toISOString();
  const documents = [0, 1, 2].map(index => `<!doctype html><html><head><script>
    if (typeof $.fn.on !== 'function' || typeof Vue.compile !== 'function') throw new Error('Classic libraries missing');
    if (_([3,1,2]).sortBy().value().join() !== '1,2,3') throw new Error('Lodash chain missing');
    if (z.z.object({name:z.string().prefault('旅人')}).parse({}).name !== '旅人') throw new Error('Zod namespace missing');
    if (getVariables({type:'chat'}).label !== '初始化完成') throw new Error('Frontend ran before startup settled');
    </script></head><body><h2>本地依赖卡片 ${index}</h2><button onclick="this.textContent='按钮已响应'">测试交互</button></body></html>`);
  const card = { id: "local-libraries", name: "本地库兼容测试", firstMessage: "test", createdAt: now, updatedAt: now };
  const script = { id: "local-startup", name: "基础库与初始化顺序", enabled: true, autoRun: true, runOn: "startup", content: `
    export {};
    await new Promise(resolve => setTimeout(resolve, 120));
    const data = z.z.object({label:z.string()}).parse(YAML.parse('label: 初始化完成'));
    if (!Vue.compile || !_.chain || !jQuery.fn.on || z.z.ZodObject !== z.ZodObject) throw new Error('Startup interfaces changed');
    const schema = z.object({value:z.number().prefault(3)});
    if (schema.parse({}).value !== 3 || !YAML.stringify({value:3}).includes('3')) throw new Error('Schema or YAML failed');
    await replaceVariables(data, {type:'chat'});
    parent.__localStartupDone = true;
  ` };
  const data = { version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true, chatMultiBubbleEnabled: false,
    activeCharacterCardId: card.id, characterCards: [card], tavernScripts: [script], chatSessions: [{ id: "local-library-chat", mode: "roleplay",
      roleplayCharacterCardId: card.id, messages: documents.map((document, index) => ({ id: `local-${index}`, role: "assistant",
        content: `\`\`\`html\n${document}\n\`\`\``, createdAt: now })), createdAt: now, updatedAt: now }] };
  assert.ok((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) })).ok);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.setDefaultTimeout(10_000);
  // CDP blocking leaves the HTTP cache enabled; Playwright routes disable it.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setBlockedURLs", { urls: ["https://*"] });
  const errors = [], externalRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().startsWith("https://")) externalRequests.push(request.url()); });
  const started = performance.now();
  await page.goto(server.url);
  await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
  await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  let dependencyUrl;
  for (let index = 0; index < documents.length; index++) {
    const message = page.locator(`#chat .mes[mesid="${index}"]`);
    await message.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await message.frameLocator("iframe.chat-html-frame").getByRole("heading", { name: `本地依赖卡片 ${index}`, exact: true }).waitFor();
    const frame = message.frameLocator("iframe.chat-html-frame");
    const url = await frame.locator("script[data-renge-html-preview-dependencies]").getAttribute("src");
    if (dependencyUrl) assert.equal(url, dependencyUrl, "Previews share one versioned library resource");
    dependencyUrl = url;
    assert.ok(await frame.locator("head").evaluate(head => head.innerHTML.length < 180_000), "Preview messages do not embed library source");
    await frame.getByRole("button", { name: "测试交互", exact: true }).click();
    await frame.getByRole("button", { name: "按钮已响应", exact: true }).waitFor();
  }
  assert.equal(await page.evaluate(() => window.__localStartupDone), true);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  const previewRequests = requests.filter(host => host.startsWith("preview.localhost:"));
  assert.equal(previewRequests.length, 1, "All isolated previews reuse the cached library bytes");
  const response = await fetch(dependencyUrl.replace("preview.localhost", "127.0.0.1"));
  assert.match(response.headers.get("cache-control"), /immutable/);
  assert.match(response.headers.get("content-type"), /javascript/);
  // LAN/srcdoc loads the app's absolute URL. Android serves the same bytes
  // from its native isolated HTTPS origin without requesting loopback access.
  const originalFrame = await (await page.locator("iframe.chat-html-frame").first().elementHandle()).contentFrame();
  const document = (await originalFrame.content()).replaceAll(dependencyUrl, dependencyUrl.replace("preview.localhost", "127.0.0.1"));
  const fallback = await browser.newPage();
  fallback.setDefaultTimeout(10_000);
  fallback.on("pageerror", error => errors.push(error.message));
  await fallback.goto(`${server.url}/desktop-window.html`);
  await fallback.evaluate(document => {
    const frame = window.document.createElement("iframe");
    frame.sandbox.add("allow-scripts");
    frame.srcdoc = document;
    window.document.body.append(frame);
  }, document);
  await fallback.frameLocator("iframe").getByRole("heading", { name: "本地依赖卡片 0", exact: true }).waitFor();
  await fallback.frameLocator("iframe").getByRole("button").click();
  await fallback.frameLocator("iframe").getByRole("button", { name: "按钮已响应", exact: true }).waitFor();
  await fallback.locator("iframe").evaluate(frame => frame.remove());
  const bootstrap = await readFile(new URL("../public/html-preview-frame.html", import.meta.url), "utf8");
  const nativeDependencyUrl = dependencyUrl.replace(new URL(dependencyUrl).origin, "https://html-preview.renge.invalid");
  const library = await readFile(new URL("../dist" + new URL(dependencyUrl).pathname, import.meta.url));
  await fallback.route(nativeDependencyUrl, route => route.fulfill({ contentType: "application/javascript", body: library }));
  await fallback.route("https://html-preview.renge.invalid/html-preview-frame.html", route => route.fulfill({ contentType: "text/html", body: bootstrap }));
  await fallback.evaluate(document => {
    const frame = window.document.createElement("iframe");
    frame.src = "https://html-preview.renge.invalid/html-preview-frame.html#native-fixture";
    frame.onload = () => {
      frame.onload = null;
      frame.contentWindow.postMessage({ type: "renge-html-preview-frame-init", id: "native-fixture", document }, "https://html-preview.renge.invalid");
    };
    window.document.body.append(frame);
  }, document.replaceAll(dependencyUrl.replace("preview.localhost", "127.0.0.1"), nativeDependencyUrl));
  await fallback.frameLocator("iframe").getByRole("heading", { name: "本地依赖卡片 0", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS: offline startup, initialization ordering, complete libraries, synchronous head scripts, cache reuse, opaque srcdoc, native HTTPS origin and interactions (${Math.round(performance.now() - started)} ms)`);
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
