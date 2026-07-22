import test from "node:test";
import assert from "node:assert/strict";
import {
  createDelegationRoster,
  getAgentApiName,
  resolveDelegationAgentReference,
  shouldRetrySupervisorToolCompletionAsStream,
} from "../src/multiAgentUtils.ts";

const bareId = "5047d8eb-097f-4bbb-923a-aca9367d274c";
const prefixedId = "persona_8b2279bc-6b71-4d45-a609-747f72e58c37";
const agents = [
  { id: bareId, name: "秦墨白" },
  { id: prefixedId, name: "刘浩宇" },
];

function matchedId(reference, roster) {
  const result = resolveDelegationAgentReference(reference, roster);
  assert.equal(result.status, "matched");
  return result.entry.personaId;
}

test("resolves current delegation tokens and compatible exact Agent IDs", () => {
  const roster = createDelegationRoster(agents, "a1b2c3");
  const firstToken = roster.entries[0].token;

  assert.equal(matchedId(firstToken, roster), bareId);
  assert.equal(matchedId(bareId, roster), bareId);
  assert.equal(matchedId(`persona_${bareId}`, roster), bareId);
  assert.equal(matchedId(`agent_${bareId}`, roster), bareId);
  assert.equal(matchedId(getAgentApiName(bareId), roster), bareId);
  assert.equal(matchedId(prefixedId.replace(/^persona_/, ""), roster), prefixedId);
  assert.equal(matchedId(getAgentApiName(prefixedId), roster), prefixedId);
  assert.equal(matchedId("  秦墨白  ", roster), bareId);
});

test("extracts one full UUID from a wrapped model response", () => {
  const roster = createDelegationRoster(agents, "wrapped");

  assert.equal(
    matchedId(`子 Agent（ID: persona_${bareId}）`, roster),
    bareId,
  );
});

test("rejects stale, unknown, partial, and multi-Agent references", () => {
  const roster = createDelegationRoster(agents, "current");
  const staleRoster = createDelegationRoster(agents, "stale");

  assert.equal(
    resolveDelegationAgentReference(staleRoster.entries[0].token, roster).status,
    "not_found",
  );
  assert.equal(resolveDelegationAgentReference("", roster).status, "not_found");
  assert.equal(resolveDelegationAgentReference("5047d8eb", roster).status, "not_found");
  assert.equal(
    resolveDelegationAgentReference("persona_00000000-0000-4000-8000-000000000000", roster).status,
    "not_found",
  );
  assert.equal(
    resolveDelegationAgentReference(`${bareId} ${prefixedId}`, roster).status,
    "ambiguous",
  );
});

test("rejects duplicate names and reference collisions instead of guessing", () => {
  const duplicateNames = createDelegationRoster(
    [
      { id: "one", name: "审查员" },
      { id: "two", name: "审查员" },
    ],
    "duplicates",
  );
  assert.equal(
    resolveDelegationAgentReference("审查员", duplicateNames).status,
    "ambiguous",
  );

  const collidingIds = createDelegationRoster(
    [
      { id: "alpha", name: "A" },
      { id: "persona_alpha", name: "B" },
    ],
    "collisions",
  );
  assert.equal(
    resolveDelegationAgentReference("persona_alpha", collidingIds).status,
    "ambiguous",
  );
});

test("retries an empty supervisor tool completion as a stream", () => {
  assert.equal(
    shouldRetrySupervisorToolCompletionAsStream({
      supervisorMode: true,
      includedTools: true,
      content: "",
      outputText: undefined,
      toolCalls: [],
      finishReason: "stop",
    }),
    true,
  );

  assert.equal(
    shouldRetrySupervisorToolCompletionAsStream({
      supervisorMode: true,
      includedTools: true,
      content: "",
      toolCalls: [],
      finishReason: "tool_calls",
    }),
    true,
  );
});

test("does not retry non-empty, tool-free, or truncated completions", () => {
  const base = {
    supervisorMode: true,
    includedTools: true,
    content: "",
    outputText: "",
    toolCalls: [],
    finishReason: "stop",
  };

  assert.equal(
    shouldRetrySupervisorToolCompletionAsStream({ ...base, content: "最终答复" }),
    false,
  );
  assert.equal(
    shouldRetrySupervisorToolCompletionAsStream({ ...base, toolCalls: [{}] }),
    false,
  );
  assert.equal(
    shouldRetrySupervisorToolCompletionAsStream({ ...base, includedTools: false }),
    false,
  );
  assert.equal(
    shouldRetrySupervisorToolCompletionAsStream({ ...base, supervisorMode: false }),
    false,
  );
  assert.equal(
    shouldRetrySupervisorToolCompletionAsStream({ ...base, finishReason: "length" }),
    false,
  );
  assert.equal(
    shouldRetrySupervisorToolCompletionAsStream({ ...base, finishReason: "content_filter" }),
    false,
  );
  assert.equal(
    shouldRetrySupervisorToolCompletionAsStream({
      ...base,
      payloadError: { message: "upstream failed" },
    }),
    false,
  );
});
