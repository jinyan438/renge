const MAX_RECOVERY_ATTEMPTS = 4;
const HISTORY_MARKER = "【请求体超限：部分较早的上下文已从本次请求省略，原始会话记录仍保留。】";
const IMAGE_MARKER = "[请求体超限：较早的图片已省略，原图仍保留在会话中。]";
const OUTPUT_MARKER = "\n[请求体超限：工具输出中间部分已省略，可重新读取所需片段。]\n";

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
const isSystem = (message) => message?.role === "system" || message?.role === "developer";
const isImage = (part) => part?.type === "image_url" || part?.type === "input_image";
const contentField = (message) => Array.isArray(message?.output) ? "output" : "content";

function isToolImageMessage(messages, index) {
  const message = messages[index];
  // Pi's Chat Completions adapter sends tool images in a synthetic user
  // message. It is part of the preceding tool exchange, not new user input.
  return message?.role === "user" && Array.isArray(message.content) &&
    message.content[0]?.text === "Attached image(s) from tool result:" &&
    (messages[index - 1]?.role === "tool" ||
      (messages[index - 1]?.role === "assistant" && messages[index - 2]?.role === "tool"));
}

function shortenOutput(text, limit) {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  const bytes = Buffer.from(text, "utf8");
  const side = Math.max(0, Math.floor((limit - Buffer.byteLength(OUTPUT_MARKER)) / 2));
  let end = side;
  let start = bytes.length - side;
  while ((bytes[end] & 0xc0) === 0x80) end -= 1;
  while ((bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(0, end).toString("utf8") + OUTPUT_MARKER + bytes.subarray(start).toString("utf8");
}

// Keep an assistant's calls and all their results together. Responses may put
// reasoning, parallel calls and outputs in separate top-level input items.
function groupMessages(messages, responses) {
  const groups = [];
  let group;
  let hasOutput = false;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (isSystem(message)) {
      groups.push({ indices: [index], pinned: true });
      group = undefined;
      continue;
    }
    const output = message.role === "tool" || message.type === "function_call_output" || message.type === "custom_tool_call_output";
    const call = message.type === "function_call" || message.type === "custom_tool_call";
    const user = message.role === "user" && !isToolImageMessage(messages, index);
    const assistant = message.role === "assistant" || message.type === "reasoning" || call;
    const assistantBoundary = responses
      ? assistant && (hasOutput || messages[group?.indices[0]]?.role === "user")
      : message.role === "assistant" && !isToolImageMessage(messages, index + 1);
    const newGroup = !group || user || assistantBoundary;
    if (newGroup && !output) {
      group = { indices: [], pinned: false };
      groups.push(group);
      hasOutput = false;
    }
    // Malformed orphan outputs must never become independent removal groups.
    if (!group) return [];
    group.indices.push(index);
    hasOutput ||= output;
  }
  return groups;
}

/** Project a smaller wire payload without editing the persisted transcript. */
export function reducePiRequestPayload(payload, targetBytes) {
  const field = Array.isArray(payload?.messages) ? "messages" : Array.isArray(payload?.input) ? "input" : null;
  if (!field || !Number.isFinite(targetBytes) || byteLength(payload) <= targetBytes) return payload;
  const reduced = structuredClone(payload);
  const messages = reduced[field];
  const lastUser = messages.findLastIndex((message, index) => message?.role === "user" && !isToolImageMessage(messages, index));
  const lastImage = messages.findLastIndex((message) => Array.isArray(message?.[contentField(message)]) && message[contentField(message)].some(isImage));

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (isSystem(message) || index === lastUser || (index === lastImage && index > lastUser)) continue;
    const key = contentField(message);
    if (Array.isArray(message[key])) {
      message[key] = message[key].map((part) => isImage(part)
        ? { type: field === "input" ? "input_text" : "text", text: IMAGE_MARKER }
        : part);
    }
  }
  if (byteLength(reduced) <= targetBytes) return reduced;

  const outputLimit = Math.max(1_024, Math.min(16_384, Math.floor(targetBytes / 8)));
  for (const message of messages) {
    if (message.role === "tool") {
      if (typeof message.content === "string") message.content = shortenOutput(message.content, outputLimit);
      else if (Array.isArray(message.content)) {
        message.content = message.content.map((part) => part?.type === "text"
          ? { ...part, text: shortenOutput(part.text ?? "", outputLimit) }
          : part);
      }
    } else if ((message.type === "function_call_output" || message.type === "custom_tool_call_output") && typeof message.output === "string") {
      message.output = shortenOutput(message.output, outputLimit);
    } else if (Array.isArray(message.output)) {
      message.output = message.output.map((part) => part?.type === "input_text"
        ? { ...part, text: shortenOutput(part.text ?? "", outputLimit) }
        : part);
    }
  }
  if (byteLength(reduced) <= targetBytes) return reduced;

  const groups = groupMessages(messages, field === "input");
  const removed = new Set();
  let firstRemoved = -1;
  for (const group of groups.slice(0, -1)) {
    if (group.pinned || group.indices.includes(lastUser)) continue;
    for (const index of group.indices) removed.add(index);
    if (firstRemoved < 0) firstRemoved = group.indices[0];
    reduced[field] = messages.flatMap((message, index) => index === firstRemoved
      ? [{ role: "assistant", content: HISTORY_MARKER }]
      : removed.has(index) ? [] : [message]);
    if (byteLength(reduced) <= targetBytes) break;
  }
  return reduced;
}

function requestTooLargeResponse() {
  return new Response(JSON.stringify({ error: { message: [
    "HTTP 413：模型接口限制了请求体大小（与 Token 上下文占用不同）。",
    "已尝试缩减较早的历史记录；当前消息、附件、系统提示词或工具定义仍可能过大。",
    "请缩小当前图片/附件，或压缩上下文后重试。",
  ].join("") } }), { status: 413, headers: { "Content-Type": "application/json" } });
}

/** Retry only rejected HTTP requests; never replay accepted tool executions. */
export function createPiRequestBodyRecoveryFetch({
  fetchImpl = globalThis.fetch,
  limits = new Map(),
  providerKey = "default",
} = {}) {
  return async (input, init) => {
    if (typeof init?.body !== "string") return fetchImpl(input, init);
    let payload;
    try { payload = JSON.parse(init.body); } catch { return fetchImpl(input, init); }
    if (!Array.isArray(payload?.messages) && !Array.isArray(payload?.input)) return fetchImpl(input, init);

    let budget = limits.get(providerKey) ?? Infinity;
    let current = reducePiRequestPayload(payload, budget);
    let body = current === payload ? init.body : JSON.stringify(current);
    for (let attempt = 0; ; attempt += 1) {
      init.signal?.throwIfAborted();
      const headers = new Headers(init.headers);
      headers.delete("content-length");
      const response = await fetchImpl(input, { ...init, headers, body });
      if (response.status !== 413) {
        if (response.ok && Number.isFinite(budget)) limits.set(providerKey, budget);
        return response;
      }
      await response.body?.cancel();
      if (attempt >= MAX_RECOVERY_ATTEMPTS) return requestTooLargeResponse();
      budget = Math.floor(Buffer.byteLength(body, "utf8") / 2);
      const next = reducePiRequestPayload(current, budget);
      const nextBody = JSON.stringify(next);
      if (Buffer.byteLength(nextBody, "utf8") >= Buffer.byteLength(body, "utf8")) return requestTooLargeResponse();
      current = next;
      body = nextBody;
    }
  };
}
