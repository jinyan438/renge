const RESPONSES_API_TYPE = "responses";
const CHAT_COMPLETIONS_API_TYPE = "chat-completions";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function normalizeProviderApiType(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  return normalized === "responses" || normalized === "responses-api"
    ? RESPONSES_API_TYPE
    : CHAT_COMPLETIONS_API_TYPE;
}

export function resolveStatusBarProviderApiType(providerApiType, modelId) {
  const normalizedApiType = normalizeProviderApiType(providerApiType);
  const modelSlug = String(modelId ?? "").trim().toLowerCase().split("/").pop();
  return normalizedApiType === RESPONSES_API_TYPE && modelSlug === "deepseek-v4-pro"
    ? CHAT_COMPLETIONS_API_TYPE
    : normalizedApiType;
}

function convertInputContent(content) {
  if (!Array.isArray(content)) return content;

  return content.flatMap((part) => {
    if (!isRecord(part)) return [];
    if (part.type === "text" || part.type === "output_text") {
      return typeof part.text === "string"
        ? [{ type: "input_text", text: part.text }]
        : [];
    }
    if (part.type === "image_url") {
      const imageUrl = isRecord(part.image_url) ? part.image_url.url : part.image_url;
      if (typeof imageUrl !== "string" || !imageUrl) return [];
      return [{
        type: "input_image",
        image_url: imageUrl,
        ...(isRecord(part.image_url) && typeof part.image_url.detail === "string"
          ? { detail: part.image_url.detail }
          : {}),
      }];
    }
    if (part.type === "input_text" || part.type === "input_image" || part.type === "input_file") {
      return [{ ...part }];
    }
    return [];
  });
}

function hasMessageContent(content) {
  if (typeof content === "string") return content.length > 0;
  return Array.isArray(content) && content.length > 0;
}

function convertChatMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const input = [];

  for (const message of messages) {
    if (!isRecord(message)) continue;
    const role = String(message.role ?? "user");
    const content = convertInputContent(message.content);

    if (role === "tool") {
      const callId = String(message.tool_call_id ?? "").trim();
      if (callId) {
        input.push({
          type: "function_call_output",
          call_id: callId,
          output: asText(message.content),
        });
      }
      continue;
    }

    if (role === "assistant") {
      if (Array.isArray(message.responses_reasoning_items)) {
        for (const reasoningItem of message.responses_reasoning_items) {
          if (isRecord(reasoningItem) && reasoningItem.type === "reasoning") {
            input.push({ ...reasoningItem });
          }
        }
      }
      if (hasMessageContent(content)) {
        input.push({ role: "assistant", content });
      }
      if (Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          if (!isRecord(toolCall) || !isRecord(toolCall.function)) continue;
          const callId = String(toolCall.id ?? "").trim();
          const name = String(toolCall.function.name ?? "").trim();
          if (!callId || !name) continue;
          input.push({
            type: "function_call",
            call_id: callId,
            name,
            arguments: asText(toolCall.function.arguments),
          });
        }
      }
      continue;
    }

    if (hasMessageContent(content)) {
      input.push({
        role: role === "system" || role === "developer" ? role : "user",
        content,
      });
    }
  }

  return input;
}

function convertTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  return tools.flatMap((tool) => {
    if (!isRecord(tool)) return [];
    if (tool.type !== "function" || !isRecord(tool.function)) return [{ ...tool }];
    const name = String(tool.function.name ?? "").trim();
    if (!name) return [];
    return [{
      type: "function",
      name,
      ...(typeof tool.function.description === "string"
        ? { description: tool.function.description }
        : {}),
      ...(tool.function.parameters !== undefined
        ? { parameters: tool.function.parameters }
        : {}),
      strict: tool.function.strict === true,
    }];
  });
}

function convertToolChoice(toolChoice) {
  if (!isRecord(toolChoice) || toolChoice.type !== "function") return toolChoice;
  const name = isRecord(toolChoice.function) ? toolChoice.function.name : toolChoice.name;
  return typeof name === "string" && name ? { type: "function", name } : toolChoice;
}

function convertResponseFormat(responseFormat) {
  if (!isRecord(responseFormat)) return undefined;
  if (responseFormat.type === "json_schema" && isRecord(responseFormat.json_schema)) {
    return { type: "json_schema", ...responseFormat.json_schema };
  }
  if (responseFormat.type === "json_object") return { type: "json_object" };
  if (responseFormat.type === "text") return { type: "text" };
  return undefined;
}

const responsesRequestKeys = [
  "background",
  "context_management",
  "conversation",
  "include",
  "instructions",
  "max_tool_calls",
  "metadata",
  "model",
  "moderation",
  "parallel_tool_calls",
  "previous_response_id",
  "prompt",
  "prompt_cache_key",
  "prompt_cache_options",
  "prompt_cache_retention",
  "safety_identifier",
  "service_tier",
  "store",
  "stream",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
];

export function buildResponsesApiRequest(chatRequest) {
  if (!isRecord(chatRequest)) return {};
  const request = {};
  for (const key of responsesRequestKeys) {
    if (chatRequest[key] !== undefined) request[key] = chatRequest[key];
  }

  request.input = chatRequest.input ?? convertChatMessages(chatRequest.messages);

  const maxOutputTokens =
    chatRequest.max_output_tokens ??
    chatRequest.max_completion_tokens ??
    chatRequest.max_tokens;
  if (maxOutputTokens !== undefined) request.max_output_tokens = maxOutputTokens;

  const tools = convertTools(chatRequest.tools ?? chatRequest.functions);
  if (tools !== undefined) request.tools = tools;

  const toolChoice = convertToolChoice(chatRequest.tool_choice ?? chatRequest.function_call);
  if (toolChoice !== undefined) request.tool_choice = toolChoice;

  const text = isRecord(chatRequest.text) ? { ...chatRequest.text } : {};
  const format = convertResponseFormat(chatRequest.response_format);
  if (format) text.format = format;
  if (chatRequest.verbosity !== undefined) text.verbosity = chatRequest.verbosity;
  if (Object.keys(text).length > 0) request.text = text;

  const reasoning = isRecord(chatRequest.reasoning) ? { ...chatRequest.reasoning } : {};
  if (reasoning.enabled === false && reasoning.effort === undefined) reasoning.effort = "none";
  delete reasoning.enabled;
  if (typeof chatRequest.reasoning_effort === "string") {
    reasoning.effort = chatRequest.reasoning_effort;
  }
  if (
    typeof reasoning.effort === "string" &&
    reasoning.effort !== "none" &&
    reasoning.summary === undefined
  ) {
    reasoning.summary = "auto";
  }
  if (Object.keys(reasoning).length > 0) request.reasoning = reasoning;

  if (
    isRecord(chatRequest.stream_options) &&
    typeof chatRequest.stream_options.include_obfuscation === "boolean"
  ) {
    request.stream_options = {
      include_obfuscation: chatRequest.stream_options.include_obfuscation,
    };
  }

  return request;
}

function getResponseObject(payload) {
  if (!isRecord(payload)) return null;
  return isRecord(payload.response) ? payload.response : payload;
}

function collectTextParts(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      return typeof part.text === "string" ? part.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function extractResponsesApiOutput(payload) {
  const response = getResponseObject(payload);
  if (!response) {
    return {
      content: "",
      reasoning: "",
      reasoningItems: [],
      toolCalls: [],
      finishReason: "",
    };
  }

  const contentParts = [];
  const reasoningParts = [];
  const reasoningItems = [];
  const toolCalls = [];
  const output = Array.isArray(response.output) ? response.output : [];

  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === "message") {
      const text = collectTextParts(item.content);
      if (text) contentParts.push(text);
      continue;
    }
    if (item.type === "reasoning") {
      reasoningItems.push({ ...item });
      const reasoning = collectTextParts(item.summary) || collectTextParts(item.content);
      if (reasoning) reasoningParts.push(reasoning);
      continue;
    }
    if (item.type === "function_call") {
      const id = String(item.call_id ?? item.id ?? "").trim();
      const name = String(item.name ?? "").trim();
      if (!id || !name) continue;
      toolCalls.push({
        id,
        type: "function",
        function: { name, arguments: asText(item.arguments) },
      });
    }
  }

  const content = contentParts.join("\n\n") ||
    (typeof response.output_text === "string" ? response.output_text : "");
  const status = String(response.status ?? "").trim();
  const incompleteReason = isRecord(response.incomplete_details)
    ? String(response.incomplete_details.reason ?? "").trim()
    : "";
  const finishReason = incompleteReason ||
    (toolCalls.length > 0 ? "tool_calls" : status === "failed" ? "error" : "stop");

  return {
    content,
    reasoning: reasoningParts.join("\n\n"),
    reasoningItems,
    toolCalls,
    finishReason,
  };
}

function isResponsesPayload(payload) {
  if (!isRecord(payload)) return false;
  return payload.object === "response" ||
    (typeof payload.type === "string" && payload.type.startsWith("response.")) ||
    (isRecord(payload.response) && payload.response.object === "response");
}

export function normalizeResponsesApiPayload(payload) {
  if (!isResponsesPayload(payload)) return payload;
  const response = getResponseObject(payload);
  if (!response) return payload;
  const output = extractResponsesApiOutput(response);
  const usage = isRecord(response.usage)
    ? {
        ...response.usage,
        prompt_tokens: response.usage.input_tokens ?? response.usage.prompt_tokens,
        completion_tokens: response.usage.output_tokens ?? response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
      }
    : undefined;

  return {
    ...response,
    output_text: output.content,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: output.content || null,
        ...(output.reasoning ? { reasoning_content: output.reasoning } : {}),
        ...(output.reasoningItems.length > 0
          ? { responses_reasoning_items: output.reasoningItems }
          : {}),
        ...(output.toolCalls.length > 0 ? { tool_calls: output.toolCalls } : {}),
      },
      finish_reason: output.finishReason,
    }],
    ...(usage ? { usage } : {}),
  };
}

function functionCallDeltaFromItem(item, outputIndex) {
  if (!isRecord(item) || item.type !== "function_call") return null;
  const name = String(item.name ?? "").trim();
  const id = String(item.call_id ?? item.id ?? "").trim();
  return {
    index: Number.isFinite(outputIndex) ? Number(outputIndex) : 0,
    ...(id ? { id } : {}),
    type: "function",
    function: {
      ...(name ? { name } : {}),
      ...(item.arguments !== undefined ? { arguments: asText(item.arguments) } : {}),
    },
  };
}

export function extractResponsesApiStreamEvent(payload) {
  if (!isRecord(payload)) return null;
  const type = String(payload.type ?? "");

  if (type === "response.output_text.delta" || type === "response.refusal.delta") {
    return { content: String(payload.delta ?? ""), reasoning: "", mode: "delta" };
  }
  if (type === "response.output_text.done" || type === "response.refusal.done") {
    return { content: String(payload.text ?? payload.refusal ?? ""), reasoning: "", mode: "cumulative" };
  }
  if (
    type === "response.reasoning_summary_text.delta" ||
    type === "response.reasoning_text.delta"
  ) {
    return { content: "", reasoning: String(payload.delta ?? ""), mode: "delta" };
  }
  if (
    type === "response.reasoning_summary_text.done" ||
    type === "response.reasoning_text.done"
  ) {
    return { content: "", reasoning: String(payload.text ?? ""), mode: "cumulative" };
  }
  if (type === "response.output_item.added") {
    const delta = functionCallDeltaFromItem(payload.item, payload.output_index);
    return delta
      ? { content: "", reasoning: "", mode: "delta", toolCallDeltas: [delta] }
      : { content: "", reasoning: "", mode: "delta" };
  }
  if (type === "response.function_call_arguments.delta") {
    return {
      content: "",
      reasoning: "",
      mode: "delta",
      toolCallDeltas: [{
        index: Number.isFinite(payload.output_index) ? Number(payload.output_index) : 0,
        type: "function",
        function: { arguments: String(payload.delta ?? "") },
      }],
    };
  }
  if (type === "response.function_call_arguments.done") {
    return {
      content: "",
      reasoning: "",
      mode: "delta",
      toolCallDeltas: [{
        index: Number.isFinite(payload.output_index) ? Number(payload.output_index) : 0,
        type: "function",
        function: {
          ...(typeof payload.name === "string" ? { name: payload.name } : {}),
          arguments: String(payload.arguments ?? ""),
        },
      }],
    };
  }
  if (type === "response.output_item.done" && isRecord(payload.item)) {
    if (payload.item.type === "function_call") {
      const output = extractResponsesApiOutput({ object: "response", output: [payload.item] });
      return {
        content: "",
        reasoning: "",
        mode: "delta",
        finishReason: "tool_calls",
        toolCalls: output.toolCalls,
      };
    }
    if (payload.item.type === "message") {
      return {
        content: collectTextParts(payload.item.content),
        reasoning: "",
        mode: "cumulative",
      };
    }
    if (payload.item.type === "reasoning") {
      return {
        content: "",
        reasoning: collectTextParts(payload.item.summary) || collectTextParts(payload.item.content),
        mode: "cumulative",
        responsesReasoningItems: [{ ...payload.item }],
      };
    }
  }
  if (
    type === "response.completed" ||
    type === "response.incomplete" ||
    type === "response.failed" ||
    payload.object === "response"
  ) {
    const output = extractResponsesApiOutput(payload);
    return {
      content: output.content,
      reasoning: output.reasoning,
      mode: "cumulative",
      finishReason: output.finishReason,
      toolCalls: output.toolCalls,
      responsesReasoningItems: output.reasoningItems,
    };
  }

  return type.startsWith("response.")
    ? { content: "", reasoning: "", mode: "delta" }
    : null;
}

export function getResponsesApiErrorMessage(payload) {
  if (!isRecord(payload)) return "";
  if (payload.type === "error" && typeof payload.message === "string") {
    return payload.message.trim();
  }
  const response = isRecord(payload.response) ? payload.response : payload;
  const error = response.error ?? payload.error;
  if (typeof error === "string") return error.trim();
  if (!isRecord(error)) return "";
  return typeof error.message === "string" ? error.message.trim() : "";
}
