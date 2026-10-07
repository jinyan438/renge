import { buildProviderReasoningDisableRequest, shouldUseResponsesApiForLocalQwen } from "./reasoningUtils";
import { extractResponsesApiOutput, type ProviderApiType } from "./responsesApiUtils.mjs";
import type { PocketRequestMessage } from "./pocketPhoneState";

export type PocketProvider = {
  id: string; name: string; apiBaseUrl: string; apiKey: string; apiType: ProviderApiType;
  modelId: string; models: string[]; reasoningEnabled?: boolean;
};

export function resolvePocketModel(providers: PocketProvider[], activeProviderId: string, providerId: string, modelId: string) {
  const provider = providerId ? providers.find(item => item.id === providerId) : providers.find(item => item.id === activeProviderId) ?? providers[0];
  return { provider, modelId: providerId ? modelId || provider?.modelId || provider?.models[0] || "" : provider?.modelId || provider?.models[0] || "" };
}

export async function requestPocketReply(provider: PocketProvider | undefined, modelId: string, messages: PocketRequestMessage[], signal: AbortSignal): Promise<string> {
  if (!provider?.apiBaseUrl.trim() || !modelId.trim()) throw new Error("先去手机设置里选择已配置的模型，再来聊天吧。");
  const requestProvider = { ...provider, modelId };
  const response = await fetch("/api/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({
      apiBaseUrl: provider.apiBaseUrl.trim().replace(/\/+$/, ""), apiKey: provider.apiKey,
      apiType: shouldUseResponsesApiForLocalQwen(requestProvider) ? "responses" : provider.apiType,
      request: { model: modelId, messages, stream: false, max_tokens: 2048, ...buildProviderReasoningDisableRequest(requestProvider) },
    }),
  });
  let payload;
  try { payload = await response.json(); }
  catch { signal.throwIfAborted(); throw new Error(`聊天服务暂时没有返回有效消息（${response.status}），请稍后重试。`); }
  signal.throwIfAborted();
  if (!payload || typeof payload !== "object") throw new Error("聊天服务返回了无效消息，请稍后重试。");
  if (!response.ok || payload.error) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || `消息发送失败（${response.status}）。`);
  const content = payload.choices?.[0]?.message?.content ?? payload.output_text ?? (Array.isArray(payload.output) ? extractResponsesApiOutput(payload).content : "");
  const reply = (typeof content === "string" ? content : Array.isArray(content) ? content.map(part => typeof part?.text === "string" ? part.text : "").join("") : "").trim();
  if (!reply) throw new Error("TA 暂时没有回复，点重试再问一次吧。");
  return reply;
}
