import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, _electron as electron } from "playwright";
import { startRengeServer } from "../server.mjs";

const desktop = process.argv.includes("--desktop");
const root = await mkdtemp(join(tmpdir(), "renge-file-cards-"));
const filesRoot = desktop ? join(root, "Renge Agent Lab", "Temporary Files") : join(root, "files");
let server, browser, app, page;
const errors = [], requests = [];
const files = [{ path: "README.md", description: "项目说明：功能边界、文件清单与用法" }, { path: "shim.cpp", description: "C++ 源码与接口实现" }];
const upstream = createServer(async (request, response) => {
  let raw = ""; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  const hasDelivery = body.messages.some(message => message.role === "tool");
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const delta = hasDelivery ? { role: "assistant", content: "说明文档和源码已准备好，可以在下方预览或打开。" } : {
    role: "assistant", tool_calls: [{ index: 0, id: "deliver-files", type: "function", function: { name: "chat_present_files", arguments: JSON.stringify({ files }) } }],
  };
  const chunk = choices => `data: ${JSON.stringify({ id: "cards", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices })}\n\n`;
  response.write(chunk([{ index: 0, delta, finish_reason: null }]));
  response.write(chunk([{ index: 0, delta: {}, finish_reason: hasDelivery ? "stop" : "tool_calls" }]));
  response.end("data: [DONE]\n\n");
});
try {
  await mkdir(filesRoot, { recursive: true }); await mkdir(join(root, "data")); await mkdir(".runtime", { recursive: true });
  await writeFile(join(filesRoot, "README.md"), "# 文件交付演示\n\n说明、清单与使用方法。\n");
  const cpp = "#include <string>\nstd::string greeting() { return \"Hello\"; }\n";
  await writeFile(join(filesRoot, "shim.cpp"), cpp);
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const now = new Date().toISOString();
  const provider = { id: "fixture", name: "Fixture", apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture", apiType: "chat-completions", modelId: "fixture-model", models: ["fixture-model"], updatedAt: now };
  const data = { version: 1, chatMode: "ai", activeProviderId: provider.id, providers: [provider], contextCompressionSettings: { enabled: false },
    llmContextSettings: { ai: { skills: false, mcpTools: false, workspaceTools: true } },
    chatSessions: [{ id: "file-cards", title: "文件交付卡片演示", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: "seed", role: "user", content: "文件交付卡片演示", createdAt: now }], createdAt: now, updatedAt: now }] };
  if (desktop) {
    await writeFile(join(root, "data", "app-data.json"), JSON.stringify(data));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
    Object.assign(env, { TEMP: root, TMP: root, RENGE_DATA_DIR: join(root, "data"), RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"), RENGE_ELECTRON_CACHE_DIR: join(root, "cache") });
    app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
    // Keep native open/reveal deterministic; never launch an external editor in tests.
    await app.evaluate(({ ipcMain }) => { globalThis.__cardActions = []; ipcMain.removeHandler("sidebar-files:system-action"); ipcMain.handle("sidebar-files:system-action", (_event, options) => { globalThis.__cardActions.push(options); return { ok: true }; }); });
    const home = await app.firstWindow(); await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
    [page] = await Promise.all([app.waitForEvent("window"), home.getByRole("button", { name: "开始对话", exact: true }).click()]);
    await page.locator('body[data-desktop-window="chat"]').waitFor();
  } else {
    server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data"), temporaryFilesRoot: filesRoot });
    await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
    browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, permissions: ["clipboard-read", "clipboard-write"] });
    await page.goto(server.url); await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click(); await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  }
  page.setDefaultTimeout(20_000); page.on("pageerror", error => errors.push(error.message));
  await page.getByPlaceholder("输入消息，可粘贴图片").fill("交付 README.md 和 shim.cpp，附上用途说明");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const cards = page.getByRole("region", { name: "交付文件", exact: true });
  await cards.getByText("README.md", { exact: true }).waitFor();
  assert.equal(await cards.locator(".chat-presented-file").count(), 2);
  assert.match(await cards.locator("xpath=ancestor::article").textContent(), /说明文档和源码已准备好/);
  assert.match(await cards.textContent(), /项目说明：功能边界、文件清单与用法/);
  assert.ok(requests[0].tools.some(tool => tool.function.name === "chat_present_files"), "the delivery tool is available to the real model request");
  await cards.getByRole("button", { name: "预览文件 README.md", exact: true }).click();
  const panel = page.locator(".files-sidebar-panel"); await panel.getByRole("heading", { name: "文件交付演示", exact: true }).waitFor();
  await cards.getByRole("button", { name: "shim.cpp 文件操作", exact: true }).click();
  const menu = page.getByRole("menu", { name: "shim.cpp 的文件操作", exact: true });
  await menu.getByRole("menuitem", { name: "在侧栏预览", exact: true }).click();
  await panel.locator(".files-source-preview").waitFor();
  if (desktop) {
    for (const [label, action] of [["用默认应用打开", "default"], ["在文件夹中显示", "reveal"], ["选择打开方式", "openWith"]]) {
      await cards.getByRole("button", { name: "shim.cpp 文件操作", exact: true }).click(); await menu.getByRole("menuitem", { name: label, exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.chat-presented-file[data-presented-path="shim.cpp"] [role="status"]') &&
        !document.querySelector('.chat-presented-file[data-presented-path="shim.cpp"] button[disabled]'));
      assert.equal((await app.evaluate(() => globalThis.__cardActions)).at(-1).action, action);
    }
  } else {
    await cards.getByRole("button", { name: "shim.cpp 文件操作", exact: true }).click();
    assert.equal(await menu.getByRole("menuitem", { name: "用默认应用打开", exact: true }).count(), 0);
    await menu.getByRole("menuitem", { name: "复制文件路径", exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "shim.cpp");
    await cards.getByRole("button", { name: "shim.cpp 文件操作", exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), menu.getByRole("menuitem", { name: "下载文件", exact: true }).click()]);
    assert.equal(download.suggestedFilename(), "shim.cpp"); assert.equal(await readFile(await download.path(), "utf8"), cpp);
  }
  await cards.getByRole("button", { name: "README.md 文件操作", exact: true }).click(); await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("menu").count(), 0);
  await cards.getByText(files[1].description, { exact: true }).waitFor();
  await page.getByText("说明文档和源码已准备好，可以在下方预览或打开。", { exact: true }).click();
  const hideSidebar = page.getByRole("button", { name: "隐藏右侧栏", exact: true });
  if (await hideSidebar.count()) await hideSidebar.click();
  await cards.screenshot({ path: `.runtime/chat-presented-files-${desktop ? "desktop" : "web"}.png` });
  await page.locator(".chat-workspace").screenshot({ path: `.runtime/chat-presented-files-context-${desktop ? "desktop" : "web"}.png` });
  if (!desktop) {
    await page.waitForFunction(async () => (await (await fetch("/api/app-data")).json()).data?.chatSessions?.some(session => session.messages.some(message => message.toolVisualization?.name === "chat_present_files" && message.toolVisualization.status === "done")));
    await page.reload(); await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click(); await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    await cards.getByText("README.md", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 }); await cards.scrollIntoViewIfNeeded();
    assert.ok(await cards.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    const bounds = await cards.locator(".chat-presented-file").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top)); assert.ok(bounds[1] > bounds[0]);
    await cards.screenshot({ path: ".runtime/chat-presented-files-mobile.png" });
    await rm(join(filesRoot, "shim.cpp"));
    await cards.getByRole("button", { name: "预览文件 shim.cpp", exact: true }).click();
    await panel.getByText("无法预览", { exact: true }).waitFor();
  }
  assert.deepEqual(errors, []);
  console.log(`File delivery tool, cards, actions and persistence passed (${desktop ? "desktop" : "web"}).`);
} catch (error) {
  console.error("Delivery diagnostics:", requests.map(request => ({ tools: request.tools?.map(tool => tool.function.name), results: request.messages.filter(message => message.role === "tool") })), errors);
  await page?.screenshot({ path: `.runtime/chat-presented-files-failure-${desktop ? "desktop" : "web"}.png` }); throw error;
} finally {
  await app?.close(); await browser?.close(); server?.server.closeAllConnections(); if (server) await new Promise(resolve => server.server.close(resolve));
  upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); await rm(root, { recursive: true, force: true });
}
