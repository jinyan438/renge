import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, _electron as electron } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build, with --desktop to exercise the native portal too.
const desktop = process.argv.includes("--desktop");
const root = await mkdtemp(join(tmpdir(), "renge-files-editor-"));
const filesRoot = desktop ? join(root, "Renge Agent Lab", "Temporary Files") : join(root, "temporary-files");
let server, browser, app, page;
const errors = [];
try {
  await mkdir(filesRoot, { recursive: true });
  await mkdir(join(root, "data"));
  await mkdir(".runtime", { recursive: true });
  await writeFile(join(filesRoot, "notes.md"), "# 人物记忆\n守门人在钟楼。", "utf8");
  const now = new Date().toISOString();
  const data = { version: 1, chatMode: "ai", chatSessions: [{
    id: "files-editor", title: "文件编辑测试", mode: "ai", workspaceKey: "default", workspaceName: "默认工作区",
    messages: [{ id: "seed", role: "user", content: "文件编辑测试", createdAt: now }], createdAt: now, updatedAt: now,
  }] };
  if (desktop) {
    await writeFile(join(root, "data", "app-data.json"), JSON.stringify(data));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
    Object.assign(env, { TEMP: root, TMP: root, RENGE_DATA_DIR: join(root, "data"),
      RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"), RENGE_ELECTRON_CACHE_DIR: join(root, "cache") });
    app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
    const home = await app.firstWindow();
    home.on("pageerror", error => errors.push(error.message));
    await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
    [page] = await Promise.all([app.waitForEvent("window"), home.getByRole("button", { name: "开始对话", exact: true }).click()]);
    await page.locator('body[data-desktop-window="chat"]').waitFor();
  } else {
    server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data"), temporaryFilesRoot: filesRoot });
    await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(server.url);
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
  }
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "展开右侧栏", exact: true }).click();
  await page.getByRole("button", { name: /文件.*浏览工作区/ }).click();
  const files = page.locator(".files-sidebar-panel");
  await files.locator('.files-tree-row[title="notes.md"]').click();
  await files.getByRole("button", { name: "编辑文件", exact: true }).click();
  const editor = files.getByLabel("文件编辑内容", { exact: true });
  await editor.waitFor();
  assert.equal(await editor.evaluate(node => node.ownerDocument.activeElement === node), true, "entering edit focuses the file editor without another click");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nContinuous typing 123", { delay: 70 });
  assert.equal(await editor.evaluate(node => node.ownerDocument.activeElement === node), true, "typing keeps the file editor focused");
  assert.equal(await editor.inputValue(), "# 人物记忆\n守门人在钟楼。\nContinuous typing 123");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("铜钥匙");
  const expected = "# 人物记忆\n守门人在钟楼。\nContinuous typing 1铜钥匙3";
  assert.equal(await editor.inputValue(), expected, "rerenders preserve the caret while editing in the middle of a line");
  await files.getByRole("button", { name: "保存文件", exact: true }).click();
  await files.getByText("文件已保存，下次生成将读取最新内容", { exact: true }).waitFor();
  assert.equal(await readFile(join(filesRoot, "notes.md"), "utf8"), expected);
  await files.getByRole("button", { name: "编辑文件", exact: true }).click();
  assert.equal(await editor.evaluate(node => node.ownerDocument.activeElement === node), true, "reopening edit restores focus too");
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" unsaved");
  await files.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await readFile(join(filesRoot, "notes.md"), "utf8"), expected, "cancel leaves the saved file intact");
  assert.deepEqual(errors, []);
  console.log(`File editor focus and save passed (${desktop ? "desktop" : "browser"})`);
} catch (error) {
  console.error("Focus diagnostics:", await page?.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 300), editor: document.querySelector(".files-text-editor")?.value, focused: document.hasFocus() })), errors);
  await page?.screenshot({ path: `.runtime/files-editor-${desktop ? "desktop" : "browser"}-failure.png` });
  throw error;
} finally {
  await app?.close();
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
