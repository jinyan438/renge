/** Refresh proxy routes without interrupting requests already using the old agent. */
export function createUpstreamDispatcherCache({ readOptions, createDispatcher, refreshMs = 1000, now = Date.now }) {
  let checkedAt = -Infinity;
  let signature;
  let dispatcher;
  return () => {
    const time = now();
    if (dispatcher && time - checkedAt < refreshMs) return dispatcher;
    const options = readOptions();
    const nextSignature = JSON.stringify(options);
    checkedAt = time;
    if (!dispatcher || signature !== nextSignature) {
      const next = createDispatcher(options);
      const previous = dispatcher;
      dispatcher = next;
      signature = nextSignature;
      // close() drains pending requests; destroy() would abort in-flight generations.
      if (previous) void previous.close().catch(() => {});
    }
    return dispatcher;
  };
}

export function describeUpstreamNetworkError(error) {
  const pending = [error];
  const seen = new Set();
  const codes = new Set();
  while (pending.length && seen.size < 20) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (typeof current.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(current.code)) codes.add(current.code);
    pending.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  const code = [...codes].join(", ");
  const hint = codes.has("ECONNREFUSED") ? "连接被拒绝，请检查 API 服务和系统代理是否运行。"
    : codes.has("ENOTFOUND") || codes.has("EAI_AGAIN") ? "无法解析 API 或代理域名，请检查网络和地址。"
      : [...codes].some((value) => /TIMEOUT|TIMEDOUT/.test(value)) ? "上游请求超时，请检查网络、代理或模型服务。"
        : [...codes].some((value) => /CERT|TLS|SSL/.test(value)) ? "TLS 证书验证失败，请检查 API 和代理证书。"
          : "无法连接模型服务，请检查 API 地址、网络和系统代理。";
  return `${hint}${code ? ` (${code})` : ""}`;
}
