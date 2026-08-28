export const PI_CONTINUOUS_RETRY_BASE_DELAY_MS = 2_000;
export const PI_CONTINUOUS_RETRY_MAX_DELAY_MS = 30_000;
const PARTIAL_PROGRESS_TAIL_CHARS = 4_000;

export function getContinuousRetryDelayMs(
  attempt,
  {
    baseDelayMs = PI_CONTINUOUS_RETRY_BASE_DELAY_MS,
    maxDelayMs = PI_CONTINUOUS_RETRY_MAX_DELAY_MS,
  } = {},
) {
  const normalizedAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  const normalizedBaseDelay = Math.max(0, Math.floor(Number(baseDelayMs) || 0));
  const normalizedMaxDelay = Math.max(
    normalizedBaseDelay,
    Math.floor(Number(maxDelayMs) || 0),
  );
  const exponent = Math.min(normalizedAttempt - 1, 30);
  return Math.min(normalizedMaxDelay, normalizedBaseDelay * 2 ** exponent);
}

function waitForRetryDelay(delayMs, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function getAssistantProgressText(message) {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .flatMap((part) => {
      if (part?.type === "thinking" && typeof part.thinking === "string") {
        return [part.thinking];
      }
      if (part?.type === "text" && typeof part.text === "string") {
        return [part.text];
      }
      return [];
    })
    .join("\n")
    .trim();
}

function buildPartialProgressContinuationMessage(progress) {
  const tail = progress.slice(-PARTIAL_PROGRESS_TAIL_CHARS);
  return {
    role: "user",
    content: [{
      type: "text",
      text: [
        "【内部断点续执行指令：不要向用户复述】",
        "上一轮模型流在已经产生思考结果后意外结束。上一个 assistant 消息及下面的末尾片段就是已完成进度。",
        "禁止重新分析、重新规划、复述用户需求或再次输出长思维链。直接沿用已有结论，立即执行尚未完成的动作；有可用工具时优先调用工具，否则直接给出尚未完成的最终正文。",
        "不要从“用户想要”、需求清单、设计思路或任务概述重新开始。",
        "<previous_progress_tail>",
        tail,
        "</previous_progress_tail>",
      ].join("\n\n"),
    }],
    timestamp: Date.now(),
  };
}

function buildPartialProgressAssistantCheckpoint(message, progress) {
  const {
    errorMessage: _errorMessage,
    rawStopReason: _rawStopReason,
    ...checkpoint
  } = message;
  return {
    ...checkpoint,
    // A reasoning-only assistant message can be discarded by some compatible
    // adapters during replay. Store the completed progress as ordinary
    // assistant text so every provider receives the exact checkpoint once.
    content: [{
      type: "text",
      text: [
        "【内部已完成思维状态：继续执行时不要复述】",
        progress,
      ].join("\n\n"),
    }],
    stopReason: "stop",
  };
}

/**
 * Pi's stock retry loop stops after a finite number of attempts and lets its
 * exponential delay grow without a ceiling. Renge keeps the same retryable
 * error classification, but retries until the run is aborted and caps the
 * wait so a recovered local model is reached promptly.
 */
export function installContinuousPiRetry(
  session,
  {
    baseDelayMs = PI_CONTINUOUS_RETRY_BASE_DELAY_MS,
    maxDelayMs = PI_CONTINUOUS_RETRY_MAX_DELAY_MS,
  } = {},
) {
  if (!session || typeof session._prepareRetry !== "function") return false;
  if (session.__rengeContinuousRetryInstalled === true) return true;

  session.__rengeContinuousRetryInstalled = true;
  let thinkingLevelBeforePartialResume;
  const restoreThinkingLevel = () => {
    if (thinkingLevelBeforePartialResume === undefined) return;
    if (session.agent?.state) {
      session.agent.state.thinkingLevel = thinkingLevelBeforePartialResume;
    }
    thinkingLevelBeforePartialResume = undefined;
  };
  session.subscribe?.((event) => {
    if (event?.type === "auto_retry_end") restoreThinkingLevel();
  });

  session._prepareRetry = async (message) => {
    session._retryAttempt = Math.max(0, Number(session._retryAttempt) || 0) + 1;
    const attempt = session._retryAttempt;
    const delayMs = getContinuousRetryDelayMs(attempt, { baseDelayMs, maxDelayMs });
    const partialProgress = getAssistantProgressText(message);
    const resumeFromProgress = Boolean(partialProgress);
    session._emit({
      type: "auto_retry_start",
      attempt,
      continuous: true,
      resumeFromProgress,
      delayMs,
      errorMessage: message?.errorMessage || "Unknown error",
    });

    const messages = session.agent?.state?.messages;
    if (!resumeFromProgress && Array.isArray(messages) && messages.at(-1)?.role === "assistant") {
      // A connection failure before any output is safe to replay from the
      // original user message, matching Pi's normal retry behavior.
      session.agent.state.messages = messages.slice(0, -1);
    }

    if (resumeFromProgress && session.agent?.state) {
      if (thinkingLevelBeforePartialResume === undefined) {
        thinkingLevelBeforePartialResume = session.agent.state.thinkingLevel;
      }
      // The previous assistant turn already did the expensive reasoning. The
      // continuation should execute that result instead of starting a second
      // reasoning pass. This is restored when the retry succeeds or ends.
      session.agent.state.thinkingLevel = "off";
      if (Array.isArray(messages) && messages.at(-1)?.role === "assistant") {
        session.agent.state.messages = [
          ...messages.slice(0, -1),
          buildPartialProgressAssistantCheckpoint(message, partialProgress),
        ];
      }
    }

    const controller = new AbortController();
    session._retryAbortController = controller;
    try {
      await waitForRetryDelay(delayMs, controller.signal);
    } catch {
      const cancelledAttempt = session._retryAttempt;
      session._retryAttempt = 0;
      session._emit({
        type: "auto_retry_end",
        success: false,
        attempt: cancelledAttempt,
        continuous: true,
        finalError: "Retry cancelled",
      });
      restoreThinkingLevel();
      return false;
    } finally {
      session._retryAbortController = undefined;
    }
    if (resumeFromProgress) {
      // Keep the partial assistant in active context and queue a user boundary.
      // Agent.continue() will consume this steering message rather than reject
      // an assistant as the final transcript item.
      session.agent?.steer?.(
        buildPartialProgressContinuationMessage(partialProgress),
      );
    }
    return true;
  };
  return true;
}
