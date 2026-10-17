import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

// Use the real native portal: a browser-only chat has a different message sender.
const root = await mkdtemp(join(tmpdir(), "renge-html-desktop-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
Object.assign(env, {
  RENGE_DATA_DIR: join(root, "data"),
  RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"),
  RENGE_ELECTRON_CACHE_DIR: join(root, "cache"),
});
let app;
try {
  const now = new Date().toISOString();
  const document = `<!doctype html><html><head><style>body{margin:0;padding:12px}#app{min-height:180px}</style></head><body>
    <div id="app"><h2>独立窗口角色卡</h2><output id="context"></output>
    <button id="save">保存并创建消息</button><button id="fullscreen">全屏</button></div>
    <script>
      function renderContext() { document.querySelector('#context').textContent = getVariables({type:'chat'}).label || '初始状态'; }
      renderContext(); window.addEventListener('renge-html-preview-context-updated', renderContext);
      document.querySelector('#save').onclick = async () => {
        await updateVariablesWith(vars => ({...vars,label:'已保存'}), {type:'chat'});
        await createChatMessages([{role:'user',message:'卡片交互已完成'}]);
        await setInput('继续测试');
        document.querySelector('#save').textContent = '交互成功';
      };
      document.querySelector('#fullscreen').onclick = () => document.querySelector('#app').requestFullscreen();
    </script></body></html>`;
  const card = { id: "desktop-html-card", name: "窗口渲染测试", firstMessage: `\`\`\`html\n${document}\n\`\`\``,
    alternateGreetings: ["```html\n<h2>第二个开场白</h2>\n```"], createdAt: now, updatedAt: now };
  await mkdir(join(root, "data"));
  await writeFile(join(root, "data", "app-data.json"), JSON.stringify({
    version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true, chatMultiBubbleEnabled: false,
    activeCharacterCardId: card.id, characterCards: [card], chatSessions: [{ id: "desktop-html-chat", title: "窗口渲染测试",
      mode: "roleplay", roleplayCharacterCardId: card.id, roleplayGreetingIndex: 0,
      scriptVariables: {label:"初始状态"}, messages: [{ id: "desktop-html-message", role: "assistant", content: card.firstMessage,
        source: "roleplay-greeting", createdAt: now }], createdAt: now, updatedAt: now }],
  }));
  // A distinct Chromium profile avoids taking the running user's instance lock.
  app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
  const home = await app.firstWindow();
  await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
  const [chat] = await Promise.all([app.waitForEvent("window"), home.getByRole("button", { name: "开始对话", exact: true }).click()]);
  chat.setDefaultTimeout(15_000);
  const errors = [];
  home.on("pageerror", error => errors.push(error.message));
  chat.on("pageerror", error => errors.push(error.message));
  const frameElement = chat.locator("iframe.chat-html-frame").first();
  const frame = () => frameElement.contentFrame();
  await frame().getByRole("heading", { name: "独立窗口角色卡", exact: true }).waitFor();
  await frame().getByText("初始状态", { exact: true }).waitFor();
  await chat.getByRole("button", { name: /^切换到下一条开场白/ }).click();
  await frame().getByRole("heading", { name: "第二个开场白", exact: true }).waitFor();
  await chat.getByRole("button", { name: /^切换到下一条开场白/ }).click();
  await frame().getByRole("heading", { name: "独立窗口角色卡", exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    windows.find(win => !win.webContents.getURL().endsWith("/desktop-window.html")).minimize();
    windows.find(win => win.webContents.getTitle().endsWith("— Agent Chat")).setSize(960, 680);
  });
  const viewportHeight = await chat.evaluate(() => innerHeight);
  const activeFrame = await (await frameElement.elementHandle()).contentFrame();
  await activeFrame.waitForFunction(height =>
    document.documentElement.style.getPropertyValue("--TH-viewport-height") === `${height}px`, viewportHeight);
  await frame().getByRole("button", { name: "保存并创建消息", exact: true }).click();
  await frame().getByRole("button", { name: "交互成功", exact: true }).waitFor();
  await chat.getByText("卡片交互已完成", { exact: true }).waitFor();
  assert.equal(await chat.getByPlaceholder("输入消息，可粘贴图片").inputValue(), "继续测试");
  await frame().getByText("已保存", { exact: true }).waitFor();
  await frame().getByRole("button", { name: "全屏", exact: true }).click();
  await chat.waitForFunction(() => document.fullscreenElement?.matches("iframe.chat-html-frame"));
  await frame().locator("body").evaluate(body => body.ownerDocument.exitFullscreen());
  await chat.waitForFunction(() => !document.fullscreenElement);
  assert.deepEqual(errors, []);
  console.log("PASS: native desktop HTML initialization, greeting switches, resize, minimized home, variables, command replies, message creation, composer and fullscreen");
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
