import { useCallback, useSyncExternalStore, type CSSProperties } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { createNativeContextTokenMeter, hasUsablePiContextUsage, type ContextTokenMeterSnapshot, type PiContextUsageStore } from "./contextTokenMeterUtils";

export function ContextTokenMeter({ snapshot, usageStore, compressionEnabled, compactionPending, busy, onAutoCompaction, onCompact, onSettings }: {
  snapshot: ContextTokenMeterSnapshot;
  usageStore: PiContextUsageStore;
  compressionEnabled: boolean;
  compactionPending: boolean;
  busy: boolean;
  onAutoCompaction: (enabled: boolean) => void | Promise<void>;
  onCompact: () => void | Promise<void>;
  onSettings: () => void;
}) {
  const subscribe = useCallback((listener: () => void) => usageStore.subscribe(snapshot.usageKey, listener), [usageStore, snapshot.usageKey]);
  const getSnapshot = useCallback(() => usageStore.getSnapshot(snapshot.usageKey), [usageStore, snapshot.usageKey]);
  const usage = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const contextTokenMeter = hasUsablePiContextUsage(usage)
    ? createNativeContextTokenMeter(snapshot.usageKey, snapshot.limitingModelId || snapshot.modelIds[0] || "", usage, snapshot.modelIds)
    : snapshot;
  const contextTokenMeterTitle = (() => {
    const current = contextTokenMeter.currentTokens.toLocaleString("zh-CN");
    if (contextTokenMeter.modelIds.length === 0) {
      return `当前上下文约 ${current} Token；当前模型尚未配置。点击打开 LLM 设置。`;
    }
    if (contextTokenMeter.missingModelIds.length > 0) {
      return `当前上下文约 ${current} Token；模型 ${contextTokenMeter.missingModelIds.join("、")} 尚未配置上下文上限。点击打开 LLM 设置。`;
    }
    const threshold = contextTokenMeter.thresholdTokens?.toLocaleString("zh-CN") ?? "未配置";
    const modelNote =
      contextTokenMeter.modelIds.length > 1
        ? `多 Agent 按最小阈值模型 ${contextTokenMeter.limitingModelId} 计算`
        : `模型 ${contextTokenMeter.limitingModelId}`;
    const compressionNote = contextTokenMeter.nativePiContext
      ? compressionEnabled
        ? "Pi 原生自动压缩已开启"
        : "Pi 原生自动压缩已关闭"
      : compressionEnabled
        ? "上下文压缩已开启"
      : contextTokenMeter.assistantWindowedMessageCount > 0
        ? "自动摘要已关闭，但发送安全窗口已生效"
        : "上下文压缩当前已关闭";
    const usageNote = contextTokenMeter.nativePiContext
      ? "按当前上下文实时估算，结合接口用量校正；生成、工具执行及压缩后持续更新"
      : contextTokenMeter.usesActualRequestTokens
      ? contextTokenMeter.compressed
        ? `按最后一次实际发送的压缩上下文计数；窗口化超长 assistant 历史 ${contextTokenMeter.assistantWindowedMessageCount} 条，高压缩工具/日志 ${contextTokenMeter.machineCompressedMessageCount} 条，AST 剪枝代码 ${contextTokenMeter.astPrunedMessageCount} 条，摘要替换较早消息 ${contextTokenMeter.removedMessageCount} 条；被缩减原文仍保留在聊天记录中但未进入本次生成请求${
            contextTokenMeter.appendedMessageCount > 0
              ? `，另计后续新增 ${contextTokenMeter.appendedMessageCount} 条消息`
              : ""
          }`
        : "按最后一次实际发送的上下文计数"
      : "当前尚无可复用的实际请求记录，使用发送前估算";
    return `当前上下文约 ${current} Token；${modelNote}，上下文上限 ${threshold} Token；${compressionNote}；${usageNote}。点击打开 LLM 设置。`;
  })();
  const contextUsagePercent =
    contextTokenMeter.usageRatio === null
      ? null
      : Math.round(Math.max(0, contextTokenMeter.usageRatio) * 100);
  const contextRingProgress =
    contextTokenMeter.usageRatio === null
      ? 0
      : Math.min(1, Math.max(0, contextTokenMeter.usageRatio)) * 100;
  const contextTokenRingStyle = {
    "--context-progress": `${contextRingProgress}%`,
  } as CSSProperties;
  const contextUsageTone =
    contextTokenMeter.usageRatio === null
      ? "usage-unknown"
      : contextTokenMeter.usageRatio >= 0.9
        ? "usage-critical"
        : contextTokenMeter.usageRatio >= 0.75
          ? "usage-high"
          : contextTokenMeter.usageRatio >= 0.5
            ? "usage-medium"
            : "usage-low";

  return (
    <details
      className={`context-token-menu ${
        compressionEnabled ? "compression-enabled" : "compression-disabled"
      } ${contextUsageTone}`}
    >
      <summary
        className="context-token-trigger"
        title={contextTokenMeterTitle}
        aria-label={contextTokenMeterTitle}
      >
        <span className="context-token-ring" style={contextTokenRingStyle}>
          <span>{contextUsagePercent === null ? "--" : `${contextUsagePercent}%`}</span>
        </span>
      </summary>
      <div className="context-token-panel">
        <header>
          <strong>上下文用量</strong>
          <span>
            {contextTokenMeter.currentTokens.toLocaleString("zh-CN")} / {contextTokenMeter.thresholdTokens?.toLocaleString("zh-CN") ?? "未配置"} Token
          </span>
        </header>
        <div className="context-token-progress" aria-hidden="true">
          <span style={contextTokenRingStyle} />
        </div>
        <section className="context-token-breakdown">
          <header>估算构成</header>
          <dl>
            {contextTokenMeter.contextBreakdown.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>~{item.tokens.toLocaleString("zh-CN")}</dd>
              </div>
            ))}
          </dl>
          <p>{contextTokenMeter.nativePiContext ? "各项为估算值；总量结合接口用量与本地上下文估算，随任务运行刷新。" : "各项为估算值，总量由模型服务提供。"}</p>
        </section>
        <dl>
          <div>
            <dt>模型</dt>
            <dd>{contextTokenMeter.limitingModelId || "未配置"}</dd>
          </div>
          <div>
            <dt>压缩</dt>
            <dd>{compressionEnabled ? "自动压缩已开启" : "自动压缩已关闭"}</dd>
          </div>
          <div>
            <dt>计数方式</dt>
            <dd>{contextTokenMeter.nativePiContext ? "实时上下文估算" : contextTokenMeter.usesActualRequestTokens ? "按最近一次请求" : "发送前估算"}</dd>
          </div>
          {contextTokenMeter.compressed && (
            <div>
              <dt>最近压缩</dt>
              <dd>
                移除 {contextTokenMeter.removedMessageCount} 条消息
                {contextTokenMeter.appendedMessageCount > 0
                  ? `，新增 ${contextTokenMeter.appendedMessageCount} 条`
                  : ""}
              </dd>
            </div>
          )}
        </dl>
        {contextTokenMeter.missingModelIds.length > 0 && (
          <p className="context-token-note">模型 {contextTokenMeter.missingModelIds.join("、")} 尚未配置上下文上限。</p>
        )}
        <div className="context-token-panel-actions">
          <label className="context-token-compression-toggle">
            <span>自动压缩</span>
            <input
              type="checkbox"
              checked={compressionEnabled}
              onChange={(event) => void onAutoCompaction(event.target.checked)}
            />
          </label>
          <button
            type="button"
            className="ghost-action"
            disabled={compactionPending || busy}
            onClick={() => void onCompact()}
            title="调用 Pi 原生压缩当前会话"
          >
            <RefreshCw size={14} />
            {compactionPending ? "压缩中..." : "立即压缩"}
          </button>
          <button
            type="button"
            className="ghost-action"
            onClick={(event) => {
              onSettings();
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <Settings2 size={14} />
            上下文设置
          </button>
        </div>
      </div>
    </details>
  );
}
