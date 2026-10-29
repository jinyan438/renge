import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

// Exercise the real component with independently controlled directory and preview
// responses so the race does not depend on filesystem speed or network timing.
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { FilesSidebarPanel } from "./src/FilesSidebarPanel";
      const root = createRoot(document.getElementById("root"));
      const requests = [];
      function request(source, operation, path) {
        return new Promise((resolve, reject) => requests.push({ source, operation, path, resolve, reject }));
      }
      window.fixture = {
        requests,
        render(id, path, requestId = 1, rootPath = "C:/workspace") {
          const source = { id, kind: "workspace", name: id, rootPath,
            listDirectory: path => request(id, "list", path),
            readText: path => request(id, "text", path),
            readBinary: path => request(id, "binary", path) };
          root.render(React.createElement(FilesSidebarPanel, {
            source, openRequest: path ? { id: requestId, path } : null,
            onBack() {}, onClose() {},
          }));
        },
        settle(index, value, error) {
          const request = requests[index];
          if (error) request.reject(new Error(error));
          else request.resolve(value);
        },
      };
    `,
  },
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "empty" },
});
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/fixture.js" ? "text/javascript" : "text/html; charset=utf-8");
  response.end(request.url === "/fixture.js" ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/fixture.js"></script>');
});
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(5_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const panel = page.locator(".files-sidebar-panel");
  const loading = panel.getByText("正在读取文件…", { exact: true });
  async function requestIndex(source, operation, path = "", after = -1) {
    const criteria = { source, operation, path, after };
    await page.waitForFunction(({ source, operation, path, after }) => window.fixture.requests.some((request, index) =>
      index > after && request.source === source && request.operation === operation && request.path === path), criteria);
    return page.evaluate(({ source, operation, path, after }) => window.fixture.requests.findIndex((request, index) =>
      index > after && request.source === source && request.operation === operation && request.path === path), criteria);
  }
  const settle = (index, value, error) => page.evaluate(async ({ index, value, error }) => {
    window.fixture.settle(index, value, error);
    // Let React commit before checking that stale responses changed nothing.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  }, { index, value, error });
  const entries = name => ({ entries: [{ path: name, name, kind: "file" }] });
  const render = (id, path, requestId = 1, rootPath) => page.evaluate(args => window.fixture.render(...args), [id, path, requestId, rootPath]);

  await render("image", "pelican.svg");
  const imageList = await requestIndex("image", "list");
  const imageRead = await requestIndex("image", "binary", "pelican.svg");
  await loading.waitFor();
  await settle(imageRead, { base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString("base64") });
  await panel.locator(".files-preview-content img").waitFor();
  assert.equal(await loading.count(), 1, "the pending directory remains loading while the SVG preview is ready");
  await settle(imageList, entries("pelican.svg"));
  await panel.locator('.files-tree-row[title="pelican.svg"]').waitFor();
  assert.equal(await loading.count(), 0, "opening a preview must not discard the directory result or its completion");

  await render("failure", "notes.txt");
  const failedList = await requestIndex("failure", "list");
  const pendingRead = await requestIndex("failure", "text", "notes.txt");
  await settle(failedList, null, "目录读取失败，请重试");
  await panel.getByText("目录读取失败，请重试", { exact: true }).waitFor();
  assert.equal(await loading.count(), 0, "a directory failure clears loading even while a preview is pending");
  await settle(pendingRead, { content: "preview survives directory failure" });
  await panel.locator(".files-source-preview").getByText("preview survives directory failure").waitFor();
  await panel.getByRole("button", { name: "刷新文件", exact: true }).click();
  const retryList = await requestIndex("failure", "list", "", failedList);
  await settle(retryList, entries("notes.txt"));
  await panel.locator('.files-tree-row[title="notes.txt"]').waitFor();

  await render("returning", "notes.txt");
  const staleList = await requestIndex("returning", "list");
  const staleRead = await requestIndex("returning", "text", "notes.txt");
  await panel.getByRole("button", { name: "刷新文件", exact: true }).click();
  const staleRefresh = await requestIndex("returning", "list", "", staleList);
  await render("other", "other.txt");
  const otherList = await requestIndex("other", "list");
  const otherRead = await requestIndex("other", "text", "other.txt");
  await render("returning", "notes.txt");
  const currentList = await requestIndex("returning", "list", "", staleRefresh);
  const currentRead = await requestIndex("returning", "text", "notes.txt", staleRead);
  await settle(staleList, entries("stale.txt"));
  await settle(staleRead, { content: "stale preview" });
  await settle(otherList, null, "stale error");
  await settle(otherRead, { content: "other preview" });
  assert.equal(await loading.count(), 1, "stale responses cannot clear the current workspace's loading state");
  await settle(currentList, entries("notes.txt"));
  await settle(currentRead, { content: "current preview" });
  await panel.locator('.files-tree-row[title="notes.txt"]').waitFor();
  await panel.locator(".files-source-preview").getByText("current preview", { exact: true }).waitFor();
  await settle(staleRefresh, entries("stale-refresh.txt"));
  assert.doesNotMatch(await panel.textContent(), /stale|other preview/);

  await render("returning", "slow.txt", 2);
  const slowRead = await requestIndex("returning", "text", "slow.txt");
  await render("returning", "fast.txt", 3);
  const fastRead = await requestIndex("returning", "text", "fast.txt");
  await settle(fastRead, { content: "latest preview" });
  await panel.locator(".files-source-preview").getByText("latest preview", { exact: true }).waitFor();
  await settle(slowRead, { content: "outdated preview" });
  assert.equal(await panel.locator(".files-source-preview").getByText("latest preview", { exact: true }).count(), 1);
  assert.equal(await panel.getByText("outdated preview", { exact: true }).count(), 0);
  assert.equal(await loading.count(), 0);
  assert.deepEqual(errors, []);
  console.log("File sidebar concurrent directory/preview loading, failure/retry, workspace switches and stale responses passed.");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
