const PI_NATIVE_TOOL_NAMES = Object.freeze([
  "read",
  "grep",
  "find",
  "ls",
  "write",
  "edit",
  "bash",
]);

export const PI_KERNEL_ID = "@earendil-works/pi-coding-agent@0.84.3";

const PI_REPLACED_RENGE_TOOLS = new Set([
  "local_list_files",
  "local_read_file",
  "local_read_file_range",
  "local_file_info",
  "local_search_files",
  "local_create_directory",
  "local_rename_path",
  "local_run_script",
  "local_run_command",
  "local_git_status",
  "local_git_diff",
  "project_detect_stack",
  "project_find_symbols",
  "project_search_regex",
  "project_read_package_json",
  "project_todo_scan",
  "local_write_file",
  "local_edit_file",
  "local_delete_path",
]);

const EMPTY_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  }),
});

export function normalizePiSkillPaths(paths) {
  if (!Array.isArray(paths)) return [];
  return Array.from(new Set(paths.map((path) => String(path ?? "").trim()).filter(Boolean)));
}

export function shouldEnablePiTools(enableTools, skillPaths) {
  return enableTools !== false || normalizePiSkillPaths(skillPaths).length > 0;
}

export function getPiNativeToolNames(workspace, options = {}) {
  if (options.fullToolsEnabled !== false && workspace?.kind === "electron" && workspace.cwd) {
    const platform = String(
      options.platform ??
        (typeof process === "object" && typeof process.platform === "string"
          ? process.platform
          : ""),
    ).toLowerCase();
    return [
      ...PI_NATIVE_TOOL_NAMES,
      ...(platform === "win32" ? ["powershell"] : []),
    ];
  }
  return options.skillsEnabled === true ? ["read"] : [];
}

const DEFAULT_PI_COMPACTION = Object.freeze({
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
});

function normalizePositiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizePiCompactionConfig(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? DEFAULT_PI_COMPACTION.enabled : source.enabled === true,
    reserveTokens: normalizePositiveInteger(
      source.reserveTokens ?? source.reserve_tokens,
      DEFAULT_PI_COMPACTION.reserveTokens,
    ),
    keepRecentTokens: normalizePositiveInteger(
      source.keepRecentTokens ?? source.keep_recent_tokens,
      DEFAULT_PI_COMPACTION.keepRecentTokens,
    ),
  };
}

export function filterPiCustomToolDefinitions(tools, workspace, reservedNames = new Set()) {
  const source = Array.isArray(tools) ? tools : [];
  return source.filter((tool) => {
    const name = String(tool?.function?.name ?? "");
    if (!name || reservedNames.has(name)) return false;
    return workspace?.kind !== "electron" || !workspace.cwd || !PI_REPLACED_RENGE_TOOLS.has(name);
  });
}

export function normalizePiProviderConfig(body) {
  const apiBaseUrl = String(body?.apiBaseUrl ?? "").trim().replace(/\/+$/, "");
  const apiKey = String(body?.apiKey ?? "");
  const apiType = body?.apiType === "responses" ? "responses" : "chat-completions";
  const request = body?.request && typeof body.request === "object" ? body.request : {};
  const modelId = String(request.model ?? "").trim();
  if (!apiBaseUrl) throw new Error("缺少 apiBaseUrl");
  if (!modelId) throw new Error("缺少 model");
  return {
    apiBaseUrl,
    apiKey,
    apiType,
    allowImageInputs: body?.allowImageInputs === true,
    piApi: apiType === "responses" ? "openai-responses" : "openai-completions",
    modelId,
  };
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function userContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    if (part?.type !== "image_url") continue;
    const url = String(part.image_url?.url ?? "");
    const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
    if (match) {
      parts.push({ type: "image", mimeType: match[1], data: match[2] });
    } else if (url) {
      parts.push({ type: "text", text: `[Image: ${url}]` });
    }
  }
  return parts.length > 0 ? parts : "";
}

function assistantMessage(message, provider, model, timestamp) {
  const content = [];
  const reasoning = String(
    message.reasoning_content ??
      message.reasoning_text ??
      message.thinking_content ??
      message.thinking ??
      "",
  );
  if (reasoning) content.push({ type: "thinking", thinking: reasoning });
  const text = messageText(message.content);
  if (text) content.push({ type: "text", text });
  for (const toolCall of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    let args = {};
    try {
      args = JSON.parse(String(toolCall?.function?.arguments ?? "{}"));
    } catch {
      args = { raw: String(toolCall?.function?.arguments ?? "") };
    }
    content.push({
      type: "toolCall",
      id: String(toolCall?.id ?? `tool-${timestamp}-${content.length}`),
      name: String(toolCall?.function?.name ?? "unknown_tool"),
      arguments: args,
    });
  }
  return {
    role: "assistant",
    content,
    api: provider.apiType === "responses" ? "openai-responses" : "openai-completions",
    provider: provider.providerId,
    model,
    usage: structuredClone(EMPTY_USAGE),
    stopReason: content.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
    timestamp,
  };
}

export function convertOpenAiMessagesToPi(messages, options = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const provider = {
    providerId: String(options.providerId ?? "renge"),
    apiType: options.apiType === "responses" ? "responses" : "chat-completions",
  };
  const model = String(options.modelId ?? "renge-model");
  const toolNames = new Map();
  for (const message of source) {
    if (message?.role !== "assistant") continue;
    for (const toolCall of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      toolNames.set(String(toolCall?.id ?? ""), String(toolCall?.function?.name ?? "unknown_tool"));
    }
  }

  const systemPrompt = source
    .filter((message) => message?.role === "system")
    .map((message) => messageText(message.content))
    .filter(Boolean)
    .join("\n\n");
  const transcript = [];
  source.forEach((message, index) => {
    const timestamp = Date.now() - (source.length - index) * 10;
    if (message?.role === "user") {
      transcript.push({ role: "user", content: userContent(message.content), timestamp });
    } else if (message?.role === "assistant") {
      transcript.push(assistantMessage(message, provider, model, timestamp));
    } else if (message?.role === "tool") {
      const toolCallId = String(message.tool_call_id ?? `tool-${timestamp}`);
      transcript.push({
        role: "toolResult",
        toolCallId,
        toolName: toolNames.get(toolCallId) ?? "unknown_tool",
        content: [{ type: "text", text: messageText(message.content) }],
        isError: false,
        timestamp,
      });
    }
  });

  const promptIndex = transcript.at(-1)?.role === "user" ? transcript.length - 1 : -1;
  const promptMessage = promptIndex >= 0 ? transcript[promptIndex] : null;
  const history = promptIndex >= 0
    ? transcript.filter((_, index) => index !== promptIndex)
    : transcript;
  return { systemPrompt, history, promptMessage };
}

export function getPiSamplingParams(request) {
  if (!request || typeof request !== "object") return {};
  const omitted = new Set([
    "model",
    "messages",
    "tools",
    "tool_choice",
    "stream",
    "n",
    // Pi owns the output-token limit through model.maxTokens and emits the
    // single field required by the selected provider compatibility profile.
    "max_tokens",
    "max_completion_tokens",
    "max_output_tokens",
  ]);
  return Object.fromEntries(
    Object.entries(request).filter(([key, value]) => !omitted.has(key) && value !== undefined),
  );
}

export function serializePiToolResult(result) {
  if (typeof result === "string") return result;
  if (result === undefined) return "Tool completed successfully.";
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
