export const PI_CONTINUOUS_RETRY_BASE_DELAY_MS = 2_000;
export const PI_CONTINUOUS_RETRY_MAX_DELAY_MS = 30_000;

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
  session._prepareRetry = async (message) => {
    session._retryAttempt = Math.max(0, Number(session._retryAttempt) || 0) + 1;
    const attempt = session._retryAttempt;
    const delayMs = getContinuousRetryDelayMs(attempt, { baseDelayMs, maxDelayMs });
    session._emit({
      type: "auto_retry_start",
      attempt,
      continuous: true,
      delayMs,
      errorMessage: message?.errorMessage || "Unknown error",
    });

    // Match Pi's normal retry preparation: keep the failed attempt in the
    // transcript, but remove it from active model state before continuing.
    const messages = session.agent?.state?.messages;
    if (Array.isArray(messages) && messages.at(-1)?.role === "assistant") {
      session.agent.state.messages = messages.slice(0, -1);
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
      return false;
    } finally {
      session._retryAbortController = undefined;
    }
    return true;
  };
  return true;
}
