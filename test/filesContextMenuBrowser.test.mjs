import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, _electron as electron } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. All mutations stay in an isolated temporary root.
const desktop = process.argv.includes("--desktop");
const root = await mkdtemp(join(tmpdir(), "renge-files-actions-"));
const workspace = process.argv.includes("--workspace");
const filesRoot = workspace ? join(root, "workspace") : desktop
  ? join(root, "Renge Agent Lab", "Temporary Files") : join(root, "temporary-files");
let server, browser, app, page;
const errors = [];
try {
  await mkdir(join(filesRoot, "folder"), { recursive: true });
  await mkdir(join(root, "data"));
  await mkdir(".runtime", { recursive: true });
  await writeFile(join(filesRoot, "notes.md"), "# Notes\nOriginal", "utf8");
  await writeFile(join(filesRoot, "occupied.md"), "keep", "utf8");
  await writeFile(join(filesRoot, "folder", "child.md"), "# Child\nNested", "utf8");
  await writeFile(join(filesRoot, "binary.bin"), Buffer.from([0, 255, 128]));
  const now = new Date().toISOString();
  const data = { version: 1, chatMode: "ai", chatSessions: [{
    id: "files-actions", title: "文件菜单测试", mode: "ai", workspaceKey: workspace ? filesRoot : "default",
    workspaceName: workspace ? "workspace" : "默认工作区", ...(workspace ? { workspacePath: filesRoot } : {}),
    messages: [{ id: "seed", role: "user", content: "文件菜单测试", createdAt: now }], createdAt: now, updatedAt: now,
  }] };
  if (desktop) {
    await writeFile(join(root, "data", "app-data.json"), JSON.stringify(data));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
    Object.assign(env, { TEMP: root, TMP: root, RENGE_DATA_DIR: join(root, "data"),
      RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"), RENGE_ELECTRON_CACHE_DIR: join(root, "cache") });
    app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
    if (workspace) await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, filesRoot);
    const home = await app.firstWindow();
    home.on("pageerror", error => errors.push(error.message));
    await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
    [page] = await Promise.all([app.waitForEvent("window"), home.getByRole("button", { name: "开始对话", exact: true }).click()]);
    await page.locator('body[data-desktop-window="chat"]').waitFor();
  } else {
    server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data"), temporaryFilesRoot: filesRoot });
    if (workspace) {
      data.pcConnection = { baseUrl: server.url, workspacePath: filesRoot, workspaceName: "workspace" };
      data.chatSessions[0].workspaceKey = `pc:${server.url}:${filesRoot}`;
    }
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
  const row = path => files.locator(`.files-tree-row[title="${path}"]`);
  let capturedMenu = false;
  const openAction = async (path, action) => {
    await row(path).click({ button: "right" });
    if (desktop && !capturedMenu) {
      await page.screenshot({ path: ".runtime/files-actions-desktop-menu.png" });
      capturedMenu = true;
    }
    await page.getByRole("menuitem", { name: action, exact: true }).click();
    return page.getByRole("dialog", { name: action === "重命名" ? "重命名" : "删除确认", exact: true });
  };
  await row("notes.md").click();
  await files.getByRole("button", { name: "编辑文件", exact: true }).click();
  const editor = files.getByLabel("文件编辑内容", { exact: true });
  await editor.fill("# Notes\nUnsaved draft");
  let dialog = await openAction("notes.md", "重命名");
  if (desktop) await page.screenshot({ path: ".runtime/files-actions-desktop-rename.png" });
  const nameInput = dialog.getByLabel("新名称", { exact: true });
  assert.equal(await nameInput.evaluate(node => node.ownerDocument.activeElement === node), true);
  await nameInput.fill("occupied.md");
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "已存在" }).waitFor();
  assert.equal(await readFile(join(filesRoot, "occupied.md"), "utf8"), "keep");
  await nameInput.fill("../escape.md");
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "有效" }).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await editor.inputValue(), "# Notes\nUnsaved draft");
  dialog = await openAction("notes.md", "重命名");
  await dialog.getByLabel("新名称").fill("renamed.txt");
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
  await row("renamed.txt").waitFor();
  assert.equal(await row("notes.md").count(), 0);
  assert.equal(await editor.inputValue(), "# Notes\nUnsaved draft", "rename keeps the active draft");
  await files.getByRole("button", { name: "保存文件", exact: true }).click();
  await files.getByText("文件已保存，下次生成将读取最新内容", { exact: true }).waitFor();
  assert.equal(await readFile(join(filesRoot, "renamed.txt"), "utf8"), "# Notes\nUnsaved draft");
  await assert.rejects(access(join(filesRoot, "notes.md")), /ENOENT/);
  dialog = await openAction("renamed.txt", "删除");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await readFile(join(filesRoot, "renamed.txt"), "utf8"), "# Notes\nUnsaved draft");
  dialog = await openAction("renamed.txt", "删除");
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await row("renamed.txt").waitFor({ state: "detached" });
  await files.getByText("选择文件以预览", { exact: true }).waitFor();
  await assert.rejects(access(join(filesRoot, "renamed.txt")), /ENOENT/);

  await row("folder").click();
  await row("folder/child.md").click();
  await files.getByRole("heading", { name: "Child", exact: true }).waitFor();
  dialog = await openAction("folder", "重命名");
  await dialog.getByLabel("新名称").fill("renamed-folder");
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
  await row("renamed-folder/child.md").waitFor();
  await files.locator('.files-tree-row.is-selected[title="renamed-folder/child.md"]').waitFor();
  await files.getByRole("heading", { name: "Child", exact: true }).waitFor();
  await files.getByRole("button", { name: "编辑文件", exact: true }).click();
  await editor.fill("# Child\nChanged under renamed directory");
  await files.getByRole("button", { name: "保存文件", exact: true }).click();
  await files.getByText("文件已保存，下次生成将读取最新内容", { exact: true }).waitFor();
  assert.equal(await readFile(join(filesRoot, "renamed-folder", "child.md"), "utf8"), "# Child\nChanged under renamed directory");
  dialog = await openAction("renamed-folder", "删除");
  await dialog.getByText(/及其全部内容/).waitFor();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await row("renamed-folder").waitFor({ state: "detached" });
  await assert.rejects(access(join(filesRoot, "renamed-folder")), /ENOENT/);
  dialog = await openAction("binary.bin", "删除");
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await row("binary.bin").waitFor({ state: "detached" });
  assert.equal(await readFile(join(filesRoot, "occupied.md"), "utf8"), "keep");
  assert.deepEqual(errors, []);
  console.log(`File context menu rename/delete passed (${desktop ? "desktop" : "browser"}, ${workspace ? "workspace" : "temporary"})`);
} catch (error) {
  console.error("Page errors:", errors);
  await page?.screenshot({ path: `.runtime/files-actions-${desktop ? "desktop" : "browser"}-failure.png` });
  throw error;
} finally {
  await app?.close();
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-files-actions-")));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
