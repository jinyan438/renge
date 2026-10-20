import { estimateTokens } from "@earendil-works/pi-coding-agent";

function estimateSessionTokens(session, cache) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const estimateMessage = (message) => {
    if (cache?.has(message)) return cache.get(message);
    const tokens = estimateTokens(message);
    cache?.set(message, tokens);
    return tokens;
  };
  // System sections and tool schemas also occur in the transcript. Count the
  // current prompt and active tool loadout once, rather than the whole registry.
  let tokens = messages.reduce((total, message) => message.role === "system"
    ? total : total + estimateMessage(message), 0);
  tokens += typeof session?.systemPrompt === "string"
    ? Math.ceil(session.systemPrompt.length / 4)
    : estimateTokens(messages.findLast((message) => message.role === "system") ?? { role: "user", content: "" });
  const tools = session?.agent?.state?.tools ?? session?.getAllTools?.() ?? [];
  try {
    tokens += Math.ceil(JSON.stringify(tools.map(({ name, description, parameters }) => ({ name, description, parameters }))).length / 4);
  } catch {
    // Accounting must not interrupt a task if an extension exposes a schema
    // that cannot be serialized. Native usage remains the other lower bound.
  }
  return Math.max(0, tokens);
}

export function getReliableContextUsage(session, cache) {
  const usage = session?.getContextUsage?.() ?? null;
  const contextWindow = Number(usage?.contextWindow ?? session?.model?.contextWindow ?? 0);
  const reportedTokens = usage?.tokens === null ? null : Number(usage?.tokens);
  const partial = session?.agent?.state?.streamingMessage;
  // A partial assistant is not in the finalized transcript yet. Add it to both
  // usage-backed and locally estimated counts so streaming always moves the meter.
  const partialTokens = partial?.role === "assistant" && !session.messages?.includes(partial)
    ? estimateTokens(partial) : 0;
  const tokens = Math.max(
    Number.isFinite(reportedTokens) && reportedTokens > 0 ? reportedTokens : 0,
    estimateSessionTokens(session, cache),
  ) + partialTokens;
  return {
    ...(usage ?? {}),
    tokens,
    contextWindow,
    percent: contextWindow > 0 ? (tokens / contextWindow) * 100 : null,
  };
}

/** Publish live usage and compact at the safe boundary before a model request. */
export function installPiLiveContext(session, { onUsage, intervalMs = 500 } = {}) {
  const cache = new WeakMap();
  const originalPrepareRequest = session.agent.prepareRequest;
  const prepareRequest = async (request, signal) => {
    const prepared = await originalPrepareRequest?.call(session.agent, request, signal);
    signal?.throwIfAborted();
    const settings = session.settingsManager.getCompactionSettings(session.model);
    const usage = getReliableContextUsage(session, cache);
    if (settings.enabled && usage.contextWindow > 0 &&
      usage.tokens > usage.contextWindow - settings.reserveTokens) {
      // compact() aborts the current agent run. The native auto-compaction path
      // preserves the tool-result boundary, queued input and the ongoing task.
      // prepareRequest runs after queued steering has been persisted too.
      await session._runAutoCompaction("threshold", false);
      signal?.throwIfAborted();
      return {
        ...prepared,
        context: {
          ...(prepared?.context ?? request.context),
          messages: session.sessionManager.buildSessionProjection().messages,
        },
      };
    }
    return prepared;
  };
  session.agent.prepareRequest = prepareRequest;

  let timer;
  let disposed = false;
  let boundaryQueued = false;
  let lastEmissionAt = 0;
  let lastSignature = "";
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed) return;
    const usage = getReliableContextUsage(session, cache);
    const signature = `${usage.tokens}:${usage.contextWindow}`;
    lastEmissionAt = Date.now();
    if (signature === lastSignature) return;
    lastSignature = signature;
    onUsage?.(usage);
  };
  const boundary = () => {
    clearTimeout(timer);
    timer = undefined;
    if (boundaryQueued) return;
    boundaryQueued = true;
    // Public message_end listeners run just before Pi persists the message.
    // Read native usage after that synchronous persistence has completed.
    queueMicrotask(() => { boundaryQueued = false; flush(); });
  };

  return {
    flush,
    handleEvent(event) {
      if (disposed) return;
      if (event.type === "message_update") {
        if (timer || boundaryQueued) return;
        const delay = Math.max(0, intervalMs - (Date.now() - lastEmissionAt));
        if (delay === 0) flush();
        else timer = setTimeout(flush, delay);
      } else if (["message_start", "message_end", "turn_end", "compaction_start", "compaction_end", "auto_retry_end"].includes(event.type)) {
        boundary();
      }
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      if (session.agent.prepareRequest === prepareRequest) {
        session.agent.prepareRequest = originalPrepareRequest;
      }
    },
  };
}
