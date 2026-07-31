import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LLM_CONTEXT_SETTINGS,
  normalizeLlmContextSettings,
  updateLlmContextSource,
} from "../src/llmContextSettings.ts";

test("uses tool-rich defaults outside roleplay and lean defaults for roleplay", () => {
  const settings = normalizeLlmContextSettings(null);

  assert.deepEqual(settings.ai, {
    skills: true,
    workspaceTools: true,
    browserTools: true,
    terminalTools: true,
    mcpTools: true,
  });
  assert.deepEqual(settings.roleplay, {
    skills: false,
    workspaceTools: false,
    browserTools: false,
    terminalTools: false,
    mcpTools: false,
  });
});

test("normalizes partial saved settings without losing new context sources", () => {
  const settings = normalizeLlmContextSettings({
    ai: { terminalTools: false },
    roleplay: { workspaceTools: true },
  });

  assert.equal(settings.ai.terminalTools, false);
  assert.equal(settings.ai.browserTools, true);
  assert.equal(settings.roleplay.workspaceTools, true);
  assert.equal(settings.roleplay.browserTools, false);
  assert.deepEqual(settings.persona, DEFAULT_LLM_CONTEXT_SETTINGS.persona);
});

test("updates one mode and source immutably", () => {
  const original = normalizeLlmContextSettings(null);
  const updated = updateLlmContextSource(original, "roleplay", "terminalTools", true);

  assert.equal(original.roleplay.terminalTools, false);
  assert.equal(updated.roleplay.terminalTools, true);
  assert.deepEqual(updated.ai, original.ai);
});
