export type ProviderApiType = "chat-completions" | "responses";

export type CompatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type CompatToolCallDelta = {
  index?: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
};

export type ResponsesStreamContent = {
  content: string;
  reasoning: string;
  mode: "delta" | "cumulative";
  finishReason?: string;
  toolCallDeltas?: CompatToolCallDelta[];
  toolCalls?: CompatToolCall[];
  responsesReasoningItems?: unknown[];
};

export function normalizeProviderApiType(value: unknown): ProviderApiType;
export function buildResponsesApiRequest(chatRequest: unknown): Record<string, unknown>;
export function extractResponsesApiOutput(payload: unknown): {
  content: string;
  reasoning: string;
  reasoningItems: unknown[];
  toolCalls: CompatToolCall[];
  finishReason: string;
};
export function normalizeResponsesApiPayload(payload: unknown): unknown;
export function extractResponsesApiStreamEvent(payload: unknown): ResponsesStreamContent | null;
export function getResponsesApiErrorMessage(payload: unknown): string;
