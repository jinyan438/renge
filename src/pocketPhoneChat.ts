import { renderPocketPrompt, type PocketPromptOverrides } from "./pocketPhonePrompts.ts";
import { buildProviderReasoningDisableRequest, shouldUseResponsesApiForLocalQwen } from "./reasoningUtils";
import { extractResponsesApiOutput, type ProviderApiType } from "./responsesApiUtils.mjs";
import type { PocketRequestMessage } from "./pocketPhoneState";
import { parsePocketWechatTurn, pocketHormoneUpdatePrompt, pocketWechatOutputInstruction, PocketWechatFormatError, type PocketInnerState, type PocketInnerTurn } from "./pocketPhoneInner";

export type PocketProvider = {
  id: string; name: string; apiBaseUrl: string; apiKey: string; apiType: ProviderApiType;
  modelId: string; models: string[]; reasoningEnabled?: boolean;
};

export class PocketEmptyReplyError extends Error {}

function pocketReplyText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(part => typeof part === "string" ? part : pocketReplyText(part?.text)).join("");
  if (value && typeof value === "object" && "value" in value) return pocketReplyText(value.value);
  return "";
}

export function resolvePocketModel(providers: PocketProvider[], activeProviderId: string, providerId: string, modelId: string) {
  const provider = providerId ? providers.find(item => item.id === providerId) : providers.find(item => item.id === activeProviderId) ?? providers[0];
  return { provider, modelId: providerId ? modelId || provider?.modelId || provider?.models[0] || "" : provider?.modelId || provider?.models[0] || "" };
}

export async function requestPocketReply(provider: PocketProvider | undefined, modelId: string, messages: PocketRequestMessage[], signal: AbortSignal, maxTokens = 2048): Promise<string> {
  if (!provider?.apiBaseUrl.trim() || !modelId.trim()) throw new Error("先去手机设置里选择已配置的模型，再来聊天吧。");
  const requestProvider = { ...provider, modelId };
  const response = await fetch("/api/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({
      apiBaseUrl: provider.apiBaseUrl.trim().replace(/\/+$/, ""), apiKey: provider.apiKey,
      apiType: shouldUseResponsesApiForLocalQwen(requestProvider) ? "responses" : provider.apiType,
      request: { model: modelId, messages, stream: false, max_tokens: maxTokens, ...buildProviderReasoningDisableRequest(requestProvider) },
    }),
  });
  let payload;
  try { payload = await response.json(); }
  catch { signal.throwIfAborted(); throw new Error(`聊天服务暂时没有返回有效消息（${response.status}），请稍后重试。`); }
  signal.throwIfAborted();
  if (!payload || typeof payload !== "object") throw new Error("聊天服务返回了无效消息，请稍后重试。");
  if (!response.ok || payload.error) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || `消息发送失败（${response.status}）。`);
  const message = payload.choices?.[0]?.message;
  // Some compatible gateways leave content empty while returning the actual
  // answer in output_text, legacy text, or a parsed structured response.
  const reply = [message?.content, payload.output_text, payload.choices?.[0]?.text,
    Array.isArray(payload.output) ? extractResponsesApiOutput(payload).content : "",
    message?.parsed && typeof message.parsed === "object" ? JSON.stringify(message.parsed) : "",
  ].map(value => pocketReplyText(value).trim()).find(Boolean);
  // reasoning_content is never an answer or a character profile.
  if (!reply) throw new PocketEmptyReplyError("TA 暂时没有回复，点重试再问一次吧。");
  return reply;
}

export async function requestPocketWechatTurn(provider: PocketProvider | undefined, modelId: string, messages: PocketRequestMessage[], signal: AbortSignal, previous?: PocketInnerState, group = false, prompts?: PocketPromptOverrides): Promise<PocketInnerTurn> {
  // Historical replies are plain chat messages. Repeat the wire format after
  // that history so the model does not imitate their old output format.
  const instruction = pocketWechatOutputInstruction(group, prompts);
  const hormoneUpdate = pocketHormoneUpdatePrompt(previous, prompts);
  const request: PocketRequestMessage[] = [...messages, { role: "user", content: renderPocketPrompt("wechat.task", prompts, { hormones: hormoneUpdate, output: instruction }) }];
  const raw = await requestPocketReply(provider, modelId, request, signal, 4096);
  try { return parsePocketWechatTurn(raw, previous, group); }
  catch (error) {
    if (!(error instanceof PocketWechatFormatError)) throw error;
    signal.throwIfAborted();
    // Repair with the same frozen context. Only model-generated, fully validated
    // turns reach storage; malformed attempts never become chat/history entries.
    const repaired = await requestPocketReply(provider, modelId, [...request, { role: "user", content: renderPocketPrompt("wechat.repair", prompts, { raw: JSON.stringify(raw), hormones: hormoneUpdate, output: instruction }) }], signal, 6144);
    return parsePocketWechatTurn(repaired, previous, group);
  }
}
