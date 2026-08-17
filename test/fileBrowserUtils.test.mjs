import assert from "node:assert/strict";
import test from "node:test";

import {
  formatFileBrowserSize,
  getFileBrowserAbsolutePath,
  getFileBrowserMimeType,
  getFileBrowserPreviewKind,
  getFileBrowserRootPath,
  getWorkspaceHandleKey,
  normalizeFileBrowserEntries,
  normalizeTextFileWritePath,
  scopeWorkspaceHandleToSession,
} from "../src/fileBrowserUtils.ts";

test("classifies source, markdown, image, and unsupported files", () => {
  assert.equal(getFileBrowserPreviewKind("src/App.tsx"), "text");
  assert.equal(getFileBrowserPreviewKind("README.MD"), "markdown");
  assert.equal(getFileBrowserPreviewKind("assets/photo.webp"), "image");
  assert.equal(getFileBrowserPreviewKind("release/app.apk"), "unsupported");
  assert.equal(getFileBrowserMimeType("photo.JPG"), "image/jpeg");
});

test("normalizes and sorts directory listing payloads", () => {
  const payload = {
    rootPath: "E:\\project",
    entries: [
      { path: "src/z.ts", kind: "file", size: 12 },
      { path: "src", kind: "directory" },
      { path: "README.md", kind: "file", size: 20, absolutePath: "E:\\project\\README.md" },
      { path: "invalid" },
    ],
  };

  assert.deepEqual(normalizeFileBrowserEntries(payload), [
    { name: "src", path: "src", kind: "directory" },
    {
      name: "README.md",
      path: "README.md",
      kind: "file",
      size: 20,
      absolutePath: "E:\\project\\README.md",
    },
    { name: "z.ts", path: "src/z.ts", kind: "file", size: 12 },
  ]);
  assert.equal(getFileBrowserRootPath(payload), "E:\\project");
  assert.equal(
    getFileBrowserAbsolutePath("E:\\project", { path: "src/App.tsx" }),
    "E:\\project\\src\\App.tsx",
  );
});

test("formats compact file sizes", () => {
  assert.equal(formatFileBrowserSize(850), "850 B");
  assert.equal(formatFileBrowserSize(1536), "1.5 KB");
  assert.equal(formatFileBrowserSize(5 * 1024 * 1024), "5.0 MB");
});

test("turns workspace-directory text writes into concrete file paths", () => {
  const html = "<!DOCTYPE html><html><body>game</body></html>";
  assert.equal(normalizeTextFileWritePath("", html), "index.html");
  assert.equal(
    normalizeTextFileWritePath("E:\\AI\\test", html, "E:\\AI\\test"),
    "index.html",
  );
  assert.equal(normalizeTextFileWritePath("generated/", html), "generated/index.html");
  assert.equal(normalizeTextFileWritePath("game.html", html), "game.html");
  assert.equal(normalizeTextFileWritePath("", "<svg></svg>"), "image.svg");
});

test("scopes file handles to the chat workspace and excludes the default workspace", () => {
  const electronHandle = { kind: "electron", path: "E:\\projects\\test3" };
  const androidHandle = { kind: "android", uri: "root:/data/project" };
  const pcHandle = { kind: "pc", baseUrl: "http://127.0.0.1:5191", path: "E:\\pc" };
  const browserHandle = { kind: "directory", name: "browser-project" };

  assert.equal(getWorkspaceHandleKey(electronHandle), "E:\\projects\\test3");
  assert.equal(getWorkspaceHandleKey(androidHandle), "android:root:/data/project");
  assert.equal(getWorkspaceHandleKey(pcHandle), "pc:http://127.0.0.1:5191:E:\\pc");
  assert.equal(getWorkspaceHandleKey(browserHandle), "browser:browser-project");
  assert.equal(scopeWorkspaceHandleToSession(electronHandle, electronHandle.path), electronHandle);
  assert.equal(scopeWorkspaceHandleToSession(electronHandle, "default"), null);
  assert.equal(scopeWorkspaceHandleToSession(electronHandle, "E:\\projects\\other"), null);
});
