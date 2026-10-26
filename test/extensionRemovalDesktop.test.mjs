import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { createPiRemovalFixture } from "./helpers/piRemovalFixture.mjs";

// Run after npm run build. The application and package storage are isolated.
const root = await mkdtemp(join(tmpdir(), "renge-extension-removal-desktop-"));
const fixture = await createPiRemovalFixture(root);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
Object.assign(env, { RENGE_DATA_DIR: fixture.dataDir, RENGE_ELECTRON_SESSION_DATA_DIR: join(root, "session"),
  RENGE_ELECTRON_CACHE_DIR: join(root, "cache") });
let app, home, manager;
const errors = [];
try {
  await mkdir(".runtime", { recursive: true });
  app = await electron.launch({ args: [resolve("electron/main.mjs"), `--user-data-dir=${join(root, "profile")}`], env, timeout: 60_000 });
  app.context().on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  home = await app.firstWindow();
  home.on("pageerror", (error) => errors.push(error.message));
  home.setDefaultTimeout(15_000);
  async function openManager() {
    await home.getByRole("button", { name: "开始对话", exact: true }).waitFor();
    const summaryWindow = app.waitForEvent("window");
    await home.getByRole("button", { name: "打开扩展中心", exact: true }).click();
    const summary = await summaryWindow;
    const managerWindow = app.waitForEvent("window");
    await summary.getByRole("button", { name: "管理扩展", exact: true }).click().catch((error) => {
      if (!summary.isClosed()) throw error;
    });
    manager = await managerWindow;
    manager.setDefaultTimeout(15_000);
    await manager.locator(".extension-manager-shell").waitFor();
    await home.evaluate(() => { window.confirm = () => { throw new Error("Confirmation was shown on the desktop home"); }; });
  }
  const card = (name) => manager.locator("article.extension-card").filter({ has: manager.getByRole("heading", { name, exact: true }) });
  await openManager();
  await card("pi-gpt-search").getByRole("button", { name: "删除", exact: true }).click();
  await manager.locator("dialog.desktop-message-dialog").getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await card("pi-gpt-search").count(), 1, "cancel keeps the package card");
  assert.ok((await stat(fixture.npmPath)).isDirectory());
  for (const extension of fixture.targets) {
    const deleted = home.waitForResponse((response) => response.request().method() === "DELETE" &&
      new URL(response.url()).pathname === `/api/extensions/${extension.id}`);
    await card(extension.packageName).getByRole("button", { name: "删除", exact: true }).click();
    await manager.locator("dialog.desktop-message-dialog").getByRole("button", { name: "确定", exact: true }).click();
    const response = await deleted;
    assert.equal(response.status(), 200, await response.text());
    await card(extension.packageName).waitFor({ state: "detached" });
    const data = JSON.parse(await readFile(join(fixture.dataDir, "app-data.json"), "utf8"));
    assert.ok(!data.extensions.some((entry) => entry.id === extension.id), "success is already durable");
    // Reload immediately, without waiting for the renderer's idle autosave.
    await home.reload();
    await openManager();
    assert.equal(await card(extension.packageName).count(), 0, "deleted cards stay absent after reload");
  }
  assert.equal(await stat(fixture.npmPath).catch(() => null), null);
  assert.equal(await stat(fixture.gitPath).catch(() => null), null);
  assert.equal(await card(fixture.kept.displayName).count(), 1);
  assert.equal(await readFile(join(fixture.localPath, "keep.txt"), "utf8"), "keep local source");
  const settings = JSON.parse(await readFile(join(fixture.agentDir, "settings.json"), "utf8"));
  assert.deepEqual(settings.packages.map((entry) => entry.source), [fixture.localPath]);
  await manager.screenshot({ path: ".runtime/extension-removal-desktop.png" });
  assert.deepEqual(errors, []);
  console.log("Desktop extension removal passed: cancel, disabled npm/Git packages, legacy source, durable deletion, immediate reload and unrelated package preservation.");
} catch (error) {
  await manager?.screenshot({ path: ".runtime/extension-removal-desktop-failure.png" }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  assert.ok(root.startsWith(join(tmpdir(), "renge-extension-removal-desktop-")));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
