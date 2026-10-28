import assert from "node:assert/strict";
import test from "node:test";
import { parseChatFileLink, splitChatFilePaths, workspaceRelativeFilePath } from "../src/chatFileLinks.ts";

test("local references accept Windows, POSIX, Markdown and line suffixes", () => {
  assert.deepEqual(parseChatFileLink("E:\\工程\\src\\App.tsx:12:3"), { path: "E:\\工程\\src\\App.tsx", line: 12 });
  assert.deepEqual(parseChatFileLink("<E:/My Project/README.md#L8-L12>", true), { path: "E:/My Project/README.md", line: 8 });
  assert.deepEqual(parseChatFileLink("file:///E:/My%20Project/app.ts"), { path: "E:/My Project/app.ts" });
  assert.deepEqual(parseChatFileLink("/home/user/app.ts:5"), { path: "/home/user/app.ts", line: 5 });
  assert.deepEqual(parseChatFileLink("src/app.ts"), { path: "src/app.ts" });
  assert.deepEqual(parseChatFileLink("app.ts:2"), { path: "app.ts", line: 2 });
  assert.deepEqual(parseChatFileLink("README.md"), { path: "README.md" });
  for (const value of ["https://example.com/a.ts", "mailto:a@example.com", "javascript:alert(1)", "data:text/plain,abc", "//server/share", "\\\\server\\share", "#L2", "bad%xx.md", "3.14", "const x = 1"]) assert.equal(parseChatFileLink(value), undefined, value);
  assert.equal(parseChatFileLink("javascript%3Aalert(1)", true), undefined);
});

test("plain text links retain punctuation and do not turn URLs or dates into files", () => {
  const content = "修改 src/App.tsx，以及 E:\\工程\\README.md:12。参见 (docs/guide.md)，2026/10/28 和 https://example.com/a.ts。";
  const parts = splitChatFilePaths(content);
  assert.equal(parts.map(part => part.text).join(""), content);
  assert.deepEqual(parts.flatMap(part => part.target ? [part.target] : []), [
    { path: "src/App.tsx" }, { path: "E:\\工程\\README.md", line: 12 }, { path: "docs/guide.md" },
  ]);
});

test("file navigation stays within the active workspace", () => {
  assert.equal(workspaceRelativeFilePath("e:\\Repo\\src\\app.ts", "E:/repo"), "src/app.ts");
  assert.equal(workspaceRelativeFilePath("./src/../README.md"), "README.md");
  assert.throws(() => workspaceRelativeFilePath("E:/repo-other/app.ts", "E:/repo"));
  assert.throws(() => workspaceRelativeFilePath("../outside.txt", "E:/repo"));
});
