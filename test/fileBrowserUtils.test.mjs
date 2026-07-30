import assert from "node:assert/strict";
import test from "node:test";

import {
  formatFileBrowserSize,
  getFileBrowserAbsolutePath,
  getFileBrowserMimeType,
  getFileBrowserPreviewKind,
  getFileBrowserRootPath,
  normalizeFileBrowserEntries,
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
