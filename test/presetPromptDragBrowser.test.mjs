import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run against npm run build; the fixture never reads or writes real user data.
const root = await mkdtemp(join(tmpdir(), "renge-preset-drag-"));
let server, browser, page;
const errors = [];
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const makePrompt = (id) => ({
    identifier: id, name: `模块 ${id}`, content: `内容 ${id}`, role: "system", enabled: id !== "c",
    marker: false, systemPrompt: false, injectionPosition: 0, injectionDepth: 0, injectionOrder: 23,
  });
  const seed = { version: 1, activeChatPresetId: "short", chatPresets: [
    { id: "short", name: "排序测试", prompts: ["a", "b", "c", "d", "e", "f"].map(makePrompt) },
    { id: "long", name: "长列表", prompts: Array.from({ length: 30 }, (_, i) => makePrompt(`long-${i}`)) },
  ] };
  assert.equal((await fetch(`${server.url}/api/app-data`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }),
  })).ok, true);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  const list = page.getByRole("list", { name: "提示词模块", exact: true });
  const order = () => list.locator(".preset-prompt-item").evaluateAll(rows => rows.map(row => row.dataset.promptIdentifier));
  const handle = (id) => list.getByRole("button", { name: `拖动排序 模块 ${id}`, exact: true });
  const gap = (index) => list.locator(`[data-insertion-index="${index}"]`);
  async function openPresets() {
    await page.getByRole("button", { name: "打开系统设置", exact: true }).click();
    await page.getByRole("button", { name: "打开设置", exact: true }).click();
    await page.locator(".settings-nav").getByRole("button", { name: "预设", exact: true }).click();
    await list.waitFor();
  }
  async function startMove(id, index) {
    await list.scrollIntoViewIfNeeded();
    await handle(id).scrollIntoViewIfNeeded();
    const source = await handle(id).boundingBox();
    const target = await gap(index).boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
    await gap(index).and(page.locator(".active")).waitFor();
  }
  async function move(id, index, expected) {
    await startMove(id, index);
    await page.mouse.up();
    assert.deepEqual(await order(), expected);
    assert.equal(await list.locator(".preset-prompt-drop-slot.active").count(), 0);
    assert.equal(await page.locator(".preset-prompt-editor").getByLabel("模块名称", { exact: true }).inputValue(), `模块 ${id}`);
  }
  async function waitSaved(expected, presetId = "short") {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const data = (await (await fetch(`${server.url}/api/app-data`)).json()).data;
      const ids = data.chatPresets.find(preset => preset.id === presetId).prompts.map(prompt => prompt.identifier);
      if (JSON.stringify(ids) === JSON.stringify(expected)) return data;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail("drag order did not persist");
  }
  await page.goto(server.url);
  await openPresets();
  assert.equal(await list.locator('[title="上移"], [title="下移"]').count(), 0);
  await move("a", 4, ["b", "c", "d", "a", "e", "f"]);
  await move("f", 1, ["b", "f", "c", "d", "a", "e"]);
  await move("b", 6, ["f", "c", "d", "a", "e", "b"]);
  await move("b", 0, ["b", "f", "c", "d", "a", "e"]);
  const expected = await order();
  await move("d", 4, expected);
  assert.equal(await list.getByRole("checkbox", { name: "启用 模块 c", exact: true }).isChecked(), false);
  await startMove("a", 1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual(await order(), expected);
  await startMove("a", 1);
  const bounds = await list.boundingBox();
  await page.mouse.move(bounds.x + bounds.width + 60, bounds.y + 80);
  await page.mouse.up();
  assert.deepEqual(await order(), expected, "dropping outside the list cancels sorting");
  await handle("e").focus();
  await page.keyboard.press("ArrowUp");
  assert.deepEqual(await order(), ["b", "f", "c", "d", "e", "a"]);
  await page.keyboard.press("ArrowDown");
  assert.deepEqual(await order(), expected);
  const saved = await waitSaved(expected);
  for (const prompt of saved.chatPresets.find(preset => preset.id === "short").prompts) {
    assert.deepEqual(prompt, makePrompt(prompt.identifier), "sorting preserves all module settings");
  }
  await page.reload();
  await openPresets();
  assert.deepEqual(await order(), expected);

  // Hold the pointer at the bottom edge; scrolling must continue without moves.
  await page.locator(".preset-list-panel .provider-item").filter({ hasText: "长列表" }).click();
  await list.scrollIntoViewIfNeeded();
  await handle("long-0").scrollIntoViewIfNeeded();
  const first = await handle("long-0").boundingBox(), longBounds = await list.boundingBox();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(longBounds.x + longBounds.width / 2, Math.min(1090, longBounds.y + longBounds.height) - 5, { steps: 8 });
  await page.waitForFunction(() => {
    const element = document.querySelector(".preset-prompt-list");
    return element.scrollTop >= element.scrollHeight - element.clientHeight - 1;
  });
  await gap(30).and(page.locator(".active")).waitFor();
  await page.screenshot({ path: ".runtime/preset-drag-insertion.png", animations: "disabled" });
  await page.mouse.up();
  assert.equal((await order()).at(-1), "long-0");
  await waitSaved([...Array.from({ length: 29 }, (_, i) => `long-${i + 1}`), "long-0"], "long");

  // A real touch pointer exercises capture and prevents touch scrolling on the handle.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".preset-list-panel .provider-item").filter({ hasText: "排序测试" }).click();
  await list.scrollIntoViewIfNeeded();
  await handle("b").scrollIntoViewIfNeeded();
  const touchSource = await handle("b").boundingBox(), touchTarget = await gap(3).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const point = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(touchSource)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(touchTarget)] });
  await gap(3).and(page.locator(".active")).waitFor();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.deepEqual(await order(), ["f", "c", "b", "d", "a", "e"]);
  assert.equal(await list.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await waitSaved(["f", "c", "b", "d", "a", "e"]);
  await cdp.detach();
  assert.deepEqual(errors, []);
  console.log("Preset drag browser checks passed: gap insertion, both directions, first/last, no-op, cancellation, keyboard, selection/settings, persistence, edge scrolling and touch.");
} catch (error) {
  await page?.screenshot({ path: ".runtime/preset-drag-failure.png" }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-preset-drag-")));
  await rm(root, { recursive: true, force: true });
}
