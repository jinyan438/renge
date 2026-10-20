import { estimateTokens } from "@earendil-works/pi-coding-agent";

function estimateSessionTokens(session, cache) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const counts = new Map(["系统提示词", "工具定义", "用户提示词", "助手消息", "工具结果", "摘要", "其他 / 协议开销"].map((label) => [label, 0]));
  const estimateMessage = (message) => {
    if (cache?.has(message)) return cache.get(message);
    const tokens = estimateTokens(message);
    cache?.set(message, tokens);
    return tokens;
  };
  // System sections and tool schemas also occur in the transcript. Count the
  // current prompt and active tool loadout once, rather than the whole registry.
  for (const message of messages) {
    if (message.role === "system") continue;
    const label = message.role === "user" ? "用户提示词" : message.role === "assistant" ? "助手消息"
      : ["toolResult", "bashExecution"].includes(message.role) ? "工具结果"
      : ["compactionSummary", "branchSummary"].includes(message.role) ? "摘要" : "其他 / 协议开销";
    counts.set(label, counts.get(label) + estimateMessage(message));
  }
  counts.set("系统提示词", typeof session?.systemPrompt === "string"
    ? Math.ceil(session.systemPrompt.length / 4)
    : estimateTokens(messages.findLast((message) => message.role === "system") ?? { role: "user", content: "" }));
  const tools = session?.agent?.state?.tools ?? session?.getAllTools?.() ?? [];
  try {
    counts.set("工具定义", Math.ceil(JSON.stringify(tools.map(({ name, description, parameters }) => ({ name, description, parameters }))).length / 4));
  } catch {
    // Accounting must not interrupt a task if an extension exposes a schema
    // that cannot be serialized. Native usage remains the other lower bound.
  }
  return { tokens: [...counts.values()].reduce((sum, count) => sum + count, 0), breakdown: [...counts].map(([label, tokens]) => ({ label, tokens })) };
}

export function getReliableContextUsage(session, cache, { includeStreaming = true } = {}) {
  const usage = session?.getContextUsage?.() ?? null;
  const contextWindow = Number(usage?.contextWindow ?? session?.model?.contextWindow ?? 0);
  const reportedTokens = usage?.tokens === null ? null : Number(usage?.tokens);
  const partial = session?.agent?.state?.streamingMessage;
  // A partial assistant is not in the finalized transcript yet. Add it to both
  // usage-backed and locally estimated counts so streaming always moves the meter.
  const partialTokens = includeStreaming && partial?.role === "assistant" && !session.messages?.includes(partial)
    ? estimateTokens(partial) : 0;
  const estimated = estimateSessionTokens(session, cache);
  const tokens = Math.max(
    Number.isFinite(reportedTokens) && reportedTokens > 0 ? reportedTokens : 0,
    estimated.tokens,
  ) + partialTokens;
  const breakdown = estimated.breakdown.map((part) => ({ ...part, tokens: part.tokens +
    (part.label === "助手消息" ? partialTokens : part.label === "其他 / 协议开销" ? tokens - estimated.tokens - partialTokens : 0) }));
  return {
    ...(usage ?? {}),
    tokens,
    contextWindow,
    percent: contextWindow > 0 ? (tokens / contextWindow) * 100 : null,
    breakdown,
  };
}

/** Publish live usage and compact at the safe boundary before a model request. */
export function installPiLiveContext(session, { onUsage, intervalMs = 500 } = {}) {
  const cache = new WeakMap();
  let baseline;
  let baselineDirty = true;
  let streamedChars = null;
  const readUsage = (refresh = false) => {
    if (refresh || baselineDirty || !baseline) {
      baseline = getReliableContextUsage(session, cache, { includeStreaming: false });
      baselineDirty = false;
    }
    const partial = session.agent.state.streamingMessage;
    const partialTokens = partial?.role === "assistant"
      ? streamedChars === null ? estimateTokens(partial) : Math.ceil(streamedChars / 4) : 0;
    const tokens = baseline.tokens + partialTokens;
    return {
      ...baseline, tokens,
      percent: baseline.contextWindow > 0 ? tokens / baseline.contextWindow * 100 : null,
      breakdown: baseline.breakdown.map((part) => part.label === "助手消息" ? { ...part, tokens: part.tokens + partialTokens } : part),
    };
  };
  const originalPrepareRequest = session.agent.prepareRequest;
  const prepareRequest = async (request, signal) => {
    const prepared = await originalPrepareRequest?.call(session.agent, request, signal);
    signal?.throwIfAborted();
    const settings = session.settingsManager.getCompactionSettings(session.model);
    const usage = readUsage(true);
    if (settings.enabled && usage.contextWindow > 0 &&
      usage.tokens > usage.contextWindow - settings.reserveTokens) {
      // compact() aborts the current agent run. The native auto-compaction path
      // preserves the tool-result boundary, queued input and the ongoing task.
      // prepareRequest runs after queued steering has been persisted too.
      await session._runAutoCompaction("threshold", false);
      baselineDirty = true;
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
  const flush = (refresh = true) => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed) return;
    const usage = readUsage(refresh);
    const signature = `${usage.tokens}:${usage.contextWindow}:${usage.breakdown.map((part) => part.tokens).join(",")}`;
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
    queueMicrotask(() => { boundaryQueued = false; flush(true); });
  };

  return {
    flush,
    handleEvent(event) {
      if (disposed) return;
      if (event.type === "message_update") {
        const delta = event.assistantMessageEvent?.delta;
        if (typeof delta === "string") streamedChars = (streamedChars ?? 0) + delta.length;
        else if (event.assistantMessageEvent?.type === "toolcall_start") {
          streamedChars = (streamedChars ?? 0) + String(event.assistantMessageEvent.partial?.content?.[event.assistantMessageEvent.contentIndex]?.name ?? "").length;
        } else if (!event.assistantMessageEvent) streamedChars = null;
        if (timer || boundaryQueued) return;
        const delay = Math.max(0, intervalMs - (Date.now() - lastEmissionAt));
        if (delay === 0) flush(false);
        else timer = setTimeout(() => flush(false), delay);
      } else if (["message_start", "message_end", "turn_end", "compaction_start", "compaction_end", "auto_retry_end"].includes(event.type)) {
        baselineDirty = true;
        if (event.type === "message_start" && event.message?.role === "assistant") streamedChars = 0;
        else if (event.type === "message_end") streamedChars = null;
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
