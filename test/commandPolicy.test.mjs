import assert from "node:assert/strict";
import test from "node:test";

import {
  createCommandApprovalSessionStore,
  looksLikePackageManagerOutput,
  normalizeCommandLine,
  splitCommandLine,
} from "../electron/command-policy.mjs";

const whitelistedCommands = ["npm", "pnpm", "yarn", "node", "git"];

test("unwraps extra quotes around a complete whitelisted command", () => {
  assert.equal(normalizeCommandLine('"npm install"', whitelistedCommands), "npm install");
  assert.equal(normalizeCommandLine('\\"npm install\\"', whitelistedCommands), "npm install");
  assert.equal(normalizeCommandLine(`'\\"npm install\\"'`, whitelistedCommands), "npm install");
  assert.deepEqual(splitCommandLine(normalizeCommandLine('"npm install"', whitelistedCommands)), [
    "npm",
    "install",
  ]);
});

test("preserves a quoted executable path that is not a wrapped command", () => {
  const command = '"C:\\Program Files\\Tool\\tool.exe"';
  assert.equal(normalizeCommandLine(command, whitelistedCommands), command);
});

test("does not treat package-manager log output as a direct whitelist invocation", () => {
  assert.equal(looksLikePackageManagerOutput("npm", ["error", "A complete log"]), true);
  assert.equal(looksLikePackageManagerOutput("npm", ["ERR!", "code", "1"]), true);
  assert.equal(looksLikePackageManagerOutput("yarn", ["warning", "deprecated"]), true);
  assert.equal(looksLikePackageManagerOutput("npm", ["install"]), false);
  assert.equal(looksLikePackageManagerOutput("git", ["error"]), false);
});

test("keeps non-whitelist command approval scoped to one chat session", () => {
  const approvals = createCommandApprovalSessionStore();
  assert.equal(approvals.has("session-a"), false);
  assert.equal(approvals.approve("session-a"), true);
  assert.equal(approvals.has("session-a"), true);
  assert.equal(approvals.has("session-b"), false);
  assert.equal(approvals.approve(""), false);
  assert.equal(approvals.has(""), false);
});
