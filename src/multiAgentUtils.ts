import type { AgentPersona } from "./types";

export type DelegationRosterEntry = {
  token: string;
  personaId: string;
  personaName: string;
};

export type DelegationRoster = {
  entries: DelegationRosterEntry[];
};

export type DelegationAgentResolution =
  | { status: "matched"; entry: DelegationRosterEntry }
  | { status: "not_found" }
  | { status: "ambiguous" };

type SupervisorToolCompletionRetryInput = {
  supervisorMode: boolean;
  includedTools: boolean;
  content?: unknown;
  outputText?: unknown;
  toolCalls?: readonly unknown[];
  finishReason?: unknown;
  payloadError?: unknown;
};

const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const delegationTokenPattern = /delegate_[a-z0-9]+_\d+/gi;

function normalizeReference(value: string) {
  return value.trim().toLowerCase();
}

function normalizeScopeToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12) || "request";
}

function createScopeToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function getAgentApiName(personaId: string) {
  const normalizedId = personaId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "persona";
  return `agent_${normalizedId}`.slice(0, 64);
}

export function createDelegationRoster(
  personas: Pick<AgentPersona, "id" | "name">[],
  scopeToken = createScopeToken(),
): DelegationRoster {
  const scope = normalizeScopeToken(scopeToken);
  return {
    entries: personas.map((persona, index) => ({
      token: `delegate_${scope}_${index + 1}`,
      personaId: persona.id,
      personaName: persona.name,
    })),
  };
}

function getEntryReferences(entry: DelegationRosterEntry) {
  const references = new Set([
    entry.token,
    entry.personaId,
    entry.personaName,
    `persona_${entry.personaId}`,
    `agent_${entry.personaId}`,
    getAgentApiName(entry.personaId),
  ]);
  if (/^persona_/i.test(entry.personaId)) {
    references.add(entry.personaId.replace(/^persona_/i, ""));
  }
  if (/^agent_/i.test(entry.personaId)) {
    references.add(entry.personaId.replace(/^agent_/i, ""));
  }
  return Array.from(references, normalizeReference).filter(Boolean);
}

function getReferenceCandidates(reference: string) {
  const normalized = normalizeReference(reference);
  const candidates = new Set<string>([normalized]);
  for (const match of reference.match(uuidPattern) ?? []) {
    candidates.add(normalizeReference(match));
  }
  for (const match of reference.match(delegationTokenPattern) ?? []) {
    candidates.add(normalizeReference(match));
  }
  return candidates;
}

export function resolveDelegationAgentReference(
  reference: unknown,
  roster: DelegationRoster,
): DelegationAgentResolution {
  if (typeof reference !== "string" || !reference.trim()) {
    return { status: "not_found" };
  }

  const candidates = getReferenceCandidates(reference);
  const matchedEntries = roster.entries.filter((entry) =>
    getEntryReferences(entry).some((entryReference) => candidates.has(entryReference)),
  );

  if (matchedEntries.length === 1) {
    return { status: "matched", entry: matchedEntries[0] };
  }
  return matchedEntries.length > 1
    ? { status: "ambiguous" }
    : { status: "not_found" };
}

export function shouldRetrySupervisorToolCompletionAsStream({
  supervisorMode,
  includedTools,
  content,
  outputText,
  toolCalls,
  finishReason,
  payloadError,
}: SupervisorToolCompletionRetryInput) {
  if (!supervisorMode || !includedTools) return false;
  if (payloadError !== undefined && payloadError !== null && payloadError !== "") return false;
  if (typeof content === "string" && content.trim()) return false;
  if (typeof outputText === "string" && outputText.trim()) return false;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) return false;

  const normalizedFinishReason =
    typeof finishReason === "string" ? finishReason.trim().toLowerCase() : "";
  return (
    !normalizedFinishReason ||
    normalizedFinishReason === "stop" ||
    normalizedFinishReason === "tool_calls" ||
    normalizedFinishReason === "function_call"
  );
}
