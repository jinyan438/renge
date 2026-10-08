import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run after npm run build. Everything uses an isolated local app-data directory.
const root = await mkdtemp(join(tmpdir(), "renge-red-browser-"));
let server, browser, page;
try {
  await mkdir(".runtime", { recursive: true });
  server = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  const now = new Date().toISOString();
  const seed = {
    version: 1, chatMode: "ai", userProfile: { nickname: "小月", bio: "", avatarImage: "" },
    chatSessions: ["one", "two"].map(id => ({ id: `red-${id}`, title: `Red ${id}`, mode: "ai", workspaceKey: "default", workspaceName: "默认工作区", messages: [{ id: `message-${id}`, role: "user", content: `Red ${id}`, createdAt: now }], createdAt: now, updatedAt: now })),
  };
  assert.equal((await fetch(`${server.url}/api/app-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: seed }) })).ok, true);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"], reducedMotion: "reduce" });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  const pageErrors = [], remoteRequests = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => { if (request.url().startsWith("http") && !request.url().startsWith(server.url)) remoteRequests.push(request.url()); });
  const phone = page.locator(".pocket-panel"), red = phone.locator(".xhs-app");
  async function openPhone() {
    await page.getByRole("button", { name: "打开Agent Chat", exact: true }).click();
    await page.getByRole("button", { name: "开始对话", exact: true }).last().click();
    const maximize = page.getByRole("button", { name: "最大化窗口", exact: true });
    if (await maximize.isVisible()) await maximize.click();
    await page.getByRole("button", { name: "展开右侧栏", exact: true }).click();
    await page.getByRole("button", { name: /手机.*可爱手机/ }).click();
    await phone.getByRole("button", { name: "打开小红书", exact: true }).click();
  }
  async function home() { await red.getByRole("button", { name: "首页", exact: true }).click(); }
  async function openWork() { await red.getByRole("button", { name: "打开笔记：为什么领导很少请假？", exact: true }).click(); }
  await page.goto(server.url); await openPhone();
  assert.equal(await red.locator(".xhs-card").count(), 4);
  assert.equal(await red.locator(".xhs-column").count(), 2);
  await red.locator(".xhs-card-cover").evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await phone.screenshot({ path: ".runtime/xiaohongshu-home.png", animations: "disabled" });
  await red.getByRole("button", { name: /打开笔记：别动我大河/ }).click();
  await red.locator(".xhs-carousel > img").evaluate(image => image.decode());
  await phone.screenshot({ path: ".runtime/xiaohongshu-game.png", animations: "disabled" });
  await red.getByRole("button", { name: "点赞笔记", exact: true }).click();
  assert.equal(await red.getByRole("button", { name: "取消点赞笔记", exact: true }).getAttribute("aria-pressed"), "true");
  await red.getByRole("button", { name: "收藏笔记", exact: true }).click();
  await red.getByRole("button", { name: "关注", exact: true }).click();
  await red.getByRole("button", { name: "查看评论", exact: true }).click();
  await red.getByText("为什么要下架", { exact: true }).waitFor();
  await phone.screenshot({ path: ".runtime/xiaohongshu-game-comments.png", animations: "disabled" });
  await red.getByRole("button", { name: "说点什么...", exact: true }).click();
  await red.getByRole("textbox", { name: "评论内容", exact: true }).fill("这条评论会保存到手机里");
  await red.getByRole("button", { name: "发送", exact: true }).click();
  await red.getByText("这条评论会保存到手机里", { exact: true }).waitFor();
  const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem("renge_pocket_red_v1:red-one")));
  assert.deepEqual((await readState()).liked, ["game"]);
  assert.deepEqual((await readState()).saved, ["game"]);
  assert.equal((await readState()).comments.length, 1);
  await red.getByRole("button", { name: "分享笔记", exact: true }).click();
  await red.getByRole("button", { name: "复制笔记内容", exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /别动我大河/);
  await red.getByRole("button", { name: "返回小红书列表", exact: true }).click();
  await openWork();
  await red.locator(".xhs-carousel > img").evaluate(image => image.decode());
  await phone.screenshot({ path: ".runtime/xiaohongshu-work.png", animations: "disabled" });
  await red.getByRole("button", { name: "下一张图片", exact: true }).click();
  assert.match(await red.locator(".xhs-carousel > img").getAttribute("src"), /work-standing/);
  await red.locator(".xhs-carousel").focus(); await page.keyboard.press("ArrowRight");
  assert.match(await red.locator(".xhs-carousel > img").getAttribute("src"), /work-seated/);
  await red.getByRole("button", { name: "第1张图片", exact: true }).click();
  await red.getByRole("button", { name: "查看评论", exact: true }).click();
  await red.getByText("老板是老板，领导是领导", { exact: true }).waitFor();
  await phone.screenshot({ path: ".runtime/xiaohongshu-work-comments.png", animations: "disabled" });
  await red.getByRole("button", { name: "展开 21 条回复", exact: true }).click();
  const comment = red.locator(".xhs-comment").filter({ hasText: "老板是老板，领导是领导" });
  await comment.getByRole("button", { name: "回复", exact: true }).click();
  await red.getByRole("textbox", { name: "评论内容", exact: true }).fill("回复也能保存");
  await red.getByRole("button", { name: "发送", exact: true }).click();
  assert.equal((await readState()).comments.at(-1).parentId, "work-watermelon");
  await red.getByRole("button", { name: "返回小红书列表", exact: true }).click();
  await red.getByRole("button", { name: "搜索小红书", exact: true }).click();
  await red.getByRole("textbox", { name: "搜索笔记", exact: true }).fill("之心城");
  await red.getByRole("button", { name: "搜索", exact: true }).click();
  assert.equal(await red.locator(".xhs-card").count(), 1);
  await home();
  await red.getByRole("button", { name: "关注", exact: true }).click();
  assert.equal(await red.locator(".xhs-card").count(), 1);
  await red.getByRole("button", { name: "发现", exact: true }).click();
  await red.getByRole("button", { name: "展开频道分类", exact: true }).click();
  await red.locator(".xhs-category-picker").getByRole("button", { name: "职场", exact: true }).click();
  assert.equal(await red.locator(".xhs-card").count(), 1);
  await red.getByRole("button", { name: "推荐", exact: true }).click();
  await red.getByRole("button", { name: "发布笔记", exact: true }).click();
  await red.getByRole("textbox", { name: "笔记标题", exact: true }).fill("我的截图风格笔记");
  await red.getByRole("textbox", { name: "笔记正文", exact: true }).fill("今天也是可爱的一天 #日常");
  await red.getByLabel("添加笔记图片", { exact: true }).setInputFiles("public/xiaohongshu/mall-cover.jpg");
  await red.getByAltText("待发布图片1").waitFor();
  await red.getByRole("dialog").getByRole("button", { name: "发布笔记", exact: true }).click();
  await red.getByRole("heading", { name: "我的截图风格笔记", exact: true }).waitFor();
  assert.equal((await readState()).notes.length, 1);
  assert.match((await readState()).notes[0].images[0], /^data:image\/jpeg;base64,/);
  await phone.getByRole("button", { name: "回到手机桌面", exact: true }).click();
  await phone.getByRole("button", { name: "打开小红书", exact: true }).click();
  await red.getByRole("button", { name: "我", exact: true }).click();
  assert.equal(await red.locator(".xhs-card").count(), 1);
  await red.getByRole("button", { name: "收藏", exact: true }).click();
  assert.equal(await red.locator(".xhs-card").count(), 1);
  await red.getByRole("button", { name: /打开笔记：别动我大河/ }).click();
  assert.equal(await red.getByRole("button", { name: "取消点赞笔记", exact: true }).count(), 1);
  assert.equal(await red.getByRole("button", { name: "取消收藏笔记", exact: true }).count(), 1);
  await page.reload(); await openPhone();
  assert.equal(await red.locator(".xhs-card").count(), 5);
  await page.locator(".chat-session-item").filter({ hasText: "Red two" }).click();
  await phone.getByRole("button", { name: "打开小红书", exact: true }).click();
  assert.equal(await red.locator(".xhs-card").count(), 4);
  await red.getByRole("button", { name: "我", exact: true }).click();
  assert.equal(await red.locator(".xhs-card").count(), 0);
  await page.locator(".chat-session-item").filter({ hasText: "Red one" }).click();
  await phone.getByRole("button", { name: "打开小红书", exact: true }).click();
  assert.equal(await red.locator(".xhs-card").count(), 5);
  await openWork();
  await page.evaluate(() => localStorage.setItem("renge-chat-right-sidebar-width", "260"));
  await page.reload(); await openPhone(); await openWork();
  assert.ok(await page.locator(".status-bar-sidebar").evaluate(node => node.clientWidth <= 270));
  assert.equal(await red.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  assert.equal(await red.locator(".xhs-interactions").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await phone.screenshot({ path: ".runtime/xiaohongshu-narrow.png", animations: "disabled" });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(remoteRequests.filter(url => /xiaohongshu|xhscdn|xhslink/.test(url)), []);
  console.log("PASS: screenshot feed/details, local image assets, carousel, nested comments, search, filters, clipboard sharing, publishing, persistence, conversation isolation, and narrow layout");
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: ".runtime/xiaohongshu-test-failure.png" }); console.error((await page.locator("body").innerText()).slice(-3000)); }
  throw error;
} finally {
  await browser?.close(); server?.server.closeAllConnections();
  if (server) await new Promise(resolve => server.server.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "renge-red-browser-")));
  await rm(root, { recursive: true, force: true });
}
