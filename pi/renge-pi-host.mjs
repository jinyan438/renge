import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  estimateTokens,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createPiMcpAdapter, normalizePiMcpConfig } from "./pi-mcp-adapter-bridge.mjs";
import { installContinuousPiRetry } from "./continuous-retry.mjs";
import {
  convertOpenAiMessagesToPi,
  filterPiCustomToolDefinitions,
  getPiNativeToolNames,
  getPiSamplingParams,
  normalizePiCompactionConfig,
  normalizePiSkillPaths,
  normalizePiProviderConfig,
  PI_KERNEL_ID,
  serializePiToolResult,
  shouldEnablePiTools,
} from "../src/piBridgeUtils.mjs";

const TOOL_RESULT_TIMEOUT_MS = 10 * 60 * 1000;
// Match PiDeck's default model budget. Reasoning-heavy local models such as
// Qwen3.8 can consume 16k tokens before they reach the first tool call.
const DEFAULT_PI_MODEL_MAX_TOKENS = 65_536;

function estimateSessionContextTokens(session) {
  const messageTokens = Array.isArray(session?.messages)
    ? session.messages.reduce((total, message) => total + estimateTokens(message), 0)
    : 0;
  const systemPromptTokens = Math.ceil(String(session?.systemPrompt ?? "").length / 4);
  let toolDefinitionTokens = 0;
  try {
    toolDefinitionTokens = Math.ceil(JSON.stringify(session?.getAllTools?.() ?? []).length / 4);
  } catch {
    // Tool schemas are best-effort accounting data and must not break a run.
  }
  return Math.max(0, messageTokens + systemPromptTokens + toolDefinitionTokens);
}

function getReliableContextUsage(session) {
  const usage = session?.getContextUsage?.() ?? null;
  const contextWindow = Number(usage?.contextWindow ?? session?.model?.contextWindow ?? 0);
  const reportedTokens = usage?.tokens === null ? null : Number(usage?.tokens);
  const estimatedTokens = estimateSessionContextTokens(session);
  // Gateways frequently report only the latest completion's usage. That value
  // is not a safe representation of the complete prompt, so never let a
  // smaller reported value suppress our local session estimate.
  const reliableTokens = Math.max(
    Number.isFinite(reportedTokens) && reportedTokens > 0 ? reportedTokens : 0,
    estimatedTokens,
  );
  if (reliableTokens <= 0) return usage;
  return {
    ...(usage ?? {}),
    tokens: reliableTokens,
    contextWindow,
    percent: contextWindow > 0 ? (reliableTokens / contextWindow) * 100 : null,
  };
}

function estimatePendingPromptTokens(prompt) {
  const text = String(prompt?.text ?? "");
  const images = Array.isArray(prompt?.images) ? prompt.images : [];
  return estimateTokens({
    role: "user",
    content: [
      { type: "text", text },
      ...images.map(() => ({ type: "image" })),
    ],
  });
}

function extractContextWindowFromError(error) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const patterns = [
    /available\s+context\s+size\s*\(?\s*([\d,]+)/i,
    /(?:maximum|max)\s+context(?:\s+length|\s+size)?[^\d]{0,32}([\d,]+)/i,
    /context\s+window[^\d]{0,32}([\d,]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = Number(String(match?.[1] ?? "").replace(/,/g, ""));
    if (Number.isFinite(value) && value >= 512) return Math.floor(value);
  }
  return null;
}

function getSessionFinishReason(session, streamedStopReason = "") {
  const lastAssistant = [...(session?.messages ?? [])]
    .reverse()
    .find((message) => message?.role === "assistant");
  const stopReason = String(streamedStopReason || lastAssistant?.stopReason || "").trim();
  return /^(?:length|max_tokens|max_output_tokens|token_limit)$/i.test(stopReason)
    ? "length"
    : "stop";
}

function writeSse(response, payload) {
  if (response.destroyed || response.writableEnded) return;
  response.write(`data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`);
}

function completionChunk(runId, delta, finishReason = null) {
  return {
    id: runId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "pi",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function piEvent(type, payload = {}) {
  return { pi: { type, ...payload } };
}

function toolContent(result, allowImageInputs = true) {
  const content = result?.result?.content ?? result?.content;
  if (Array.isArray(content)) {
    const blocks = content.flatMap((item) => {
      if (item?.type === "text" && typeof item.text === "string") {
        return [{ type: "text", text: item.text }];
      }
      if (allowImageInputs && item?.type === "image" && typeof item.data === "string") {
        const dataUrl = item.data.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
        return [{
          type: "image",
          data: dataUrl?.[2] ?? item.data,
          mimeType: dataUrl?.[1] ?? String(item.mimeType ?? item.mime_type ?? "image/png"),
        }];
      }
      return [];
    });
    if (blocks.length > 0) return blocks;
  }
  return [{ type: "text", text: serializePiToolResult(result) }];
}

function safeSchema(parameters) {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return Type.Object({});
  }
  return Type.Unsafe(parameters);
}

function resolvePrompt(promptMessage) {
  if (!promptMessage) return { text: "Continue the conversation.", images: [] };
  if (typeof promptMessage.content === "string") {
    return { text: promptMessage.content || "Continue the conversation.", images: [] };
  }
  const images = [];
  const text = [];
  for (const part of promptMessage.content ?? []) {
    if (part.type === "text") text.push(part.text);
    if (part.type === "image") {
      images.push({
        type: "image",
        source: {
          type: "base64",
          mediaType: part.mimeType,
          data: part.data,
        },
      });
    }
  }
  return { text: text.join("\n") || "Inspect the attached image.", images };
}

function stableProviderId(provider) {
  const key = [
    provider.apiType,
    provider.apiBaseUrl,
    provider.modelId,
    provider.apiKey,
    provider.allowImageInputs ? "vision" : "text",
  ].join("\u0000");
  return `renge-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function normalizeSessionId(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .slice(0, 80);
  return normalized || `renge-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function sessionFilePath(sessionDir, ownerSessionId, sessionScope, cwd) {
  const owner = normalizeSessionId(ownerSessionId);
  const ownerHash = createHash("sha256").update(owner).digest("hex").slice(0, 24);
  const fingerprint = createHash("sha256")
    .update(`${resolve(cwd)}\u0000${owner}\u0000${sessionScope}`)
    .digest("hex")
    .slice(0, 24);
  return join(sessionDir, ownerHash, `${fingerprint}.jsonl`);
}

async function ensureSessionFile(filePath, sessionId, cwd) {
  if (existsSync(filePath)) return;
  await mkdir(resolve(filePath, ".."), { recursive: true });
  const header = {
    type: "session",
    version: 3,
    id: normalizeSessionId(sessionId),
    timestamp: new Date().toISOString(),
    cwd: resolve(cwd),
  };
  try {
    await writeFile(filePath, `${JSON.stringify(header)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

function appendPromptToSystemPrompt(prompt) {
  const normalized = String(prompt ?? "").trim();
  if (!normalized) return "";
  return normalized;
}

export function createRengePiHost({
  defaultCwd = process.cwd(),
  dataDir = process.cwd(),
  agentDir = getAgentDir(),
} = {}) {
  const runs = new Map();
  // Keep the last idle AgentSession available for PiDeck-compatible manual
  // compaction. The next chat request replaces it, while the session file
  // remains the source of truth for normal persistence.
  const idleSessions = new Map();
  const sessionDir = join(resolve(dataDir), ".pi", "sessions");
  const providerUsers = new Map();
  let modelRuntimePromise;

  const getModelRuntime = () => {
    modelRuntimePromise ??= ModelRuntime.create({
      authPath: join(resolve(agentDir), "auth.json"),
      modelsPath: join(resolve(agentDir), "models.json"),
    });
    return modelRuntimePromise;
  };

  const settlePendingTools = (run, error) => {
    for (const pending of run.pendingTools.values()) pending.reject(error);
    run.pendingTools.clear();
  };

  const releaseSessionResource = (entry) => {
    if (!entry) return;
    entry.session?.dispose();
    if (entry.providerId && entry.modelRuntime) {
      const remaining = (providerUsers.get(entry.providerId) ?? 1) - 1;
      if (remaining > 0) providerUsers.set(entry.providerId, remaining);
      else {
        providerUsers.delete(entry.providerId);
        entry.modelRuntime.unregisterProvider(entry.providerId);
      }
    }
  };

  const contextWindowOverrides = new Map();

  const providerContextKey = (provider) =>
    `${provider.apiBaseUrl}\u0000${provider.modelId}`;

  const resolveContextWindow = (body, provider) => {
    const requested = Number(body?.contextWindow ?? 128_000);
    const requestedWindow = Number.isFinite(requested) && requested > 0
      ? Math.floor(requested)
      : 128_000;
    const override = contextWindowOverrides.get(providerContextKey(provider));
    return override ? Math.min(requestedWindow, override) : requestedWindow;
  };

  const rememberContextWindow = (provider, discoveredWindow) => {
    if (!Number.isFinite(discoveredWindow) || discoveredWindow < 512) return;
    const key = providerContextKey(provider);
    const current = contextWindowOverrides.get(key);
    contextWindowOverrides.set(key, current ? Math.min(current, discoveredWindow) : discoveredWindow);
  };

  const maybeAutoCompact = async (session, compaction, pendingPromptTokens = 0) => {
    if (!compaction.enabled || typeof session?.getContextUsage !== "function") return false;
    const usage = getReliableContextUsage(session);
    const contextWindow = Number(usage?.contextWindow ?? 0);
    const contextTokens = Number(usage?.tokens ?? NaN);
    const triggerTokens = contextWindow - compaction.reserveTokens;
    if (
      !Number.isFinite(contextTokens) ||
      !Number.isFinite(contextWindow) ||
      contextWindow <= 0 ||
      triggerTokens <= 0 ||
      contextTokens + Math.max(0, pendingPromptTokens) <= triggerTokens
    ) {
      return false;
    }
    try {
      await session.compact();
      return true;
    } catch (error) {
      // Pi already emits a compaction_end event with the failure. Preserve the
      // completed response and let the next request retry the same operation.
      console.warn("[pi] automatic compaction skipped:", error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const createCustomTool = (definition, run) => {
    const name = String(definition?.function?.name ?? "").trim();
    return {
      name,
      label: name,
      description: String(definition?.function?.description ?? `Renge tool ${name}`),
      parameters: safeSchema(definition?.function?.parameters),
      executionMode: "sequential",
      execute: async (toolCallId, params, signal) => {
        const result = await new Promise((resolveResult, rejectResult) => {
          const timeout = setTimeout(() => {
            run.pendingTools.delete(toolCallId);
            rejectResult(new Error(`等待工具 ${name} 返回结果超时`));
          }, TOOL_RESULT_TIMEOUT_MS);
          const cleanup = () => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", onAbort);
          };
          const onAbort = () => {
            run.pendingTools.delete(toolCallId);
            cleanup();
            rejectResult(signal?.reason instanceof Error ? signal.reason : new Error("工具调用已中止"));
          };
          run.pendingTools.set(toolCallId, {
            resolve: (value) => {
              cleanup();
              resolveResult(value);
            },
            reject: (error) => {
              cleanup();
              rejectResult(error);
            },
          });
          signal?.addEventListener("abort", onAbort, { once: true });
          writeSse(run.response, piEvent("tool_request", {
            runId: run.id,
            toolCallId,
            toolName: name,
            arguments: params,
          }));
        });
        return {
          content: toolContent(result, run.allowImageInputs),
          details: result,
          ...(name === "chat_present_options" ? { terminate: true } : {}),
        };
      },
    };
  };

  const handleChat = async (body, request, response) => {
    const runId = String(body?.runId ?? "").trim() || randomUUID();
    if (runs.has(runId)) throw new Error("重复的 Pi runId");
    const provider = normalizePiProviderConfig(body);
    const requestBody = body?.request && typeof body.request === "object"
      ? body.request
      : {};
    const workspace = body.workspace && typeof body.workspace === "object" ? body.workspace : null;
    const cwd = workspace?.kind === "electron" && workspace.cwd
      ? resolve(String(workspace.cwd))
      : resolve(defaultCwd);
    const ownerSessionId = normalizeSessionId(body?.sessionId || runId);
    const requestedSessionScope = normalizeSessionId(body?.piSessionScope || "main");
    const sessionScope = /-(?:text|vision)$/.test(requestedSessionScope)
      ? requestedSessionScope
      : `${requestedSessionScope}-${provider.allowImageInputs ? "vision" : "text"}`;
    const requestedSessionId = String(body?.piSessionId ?? "").trim();
    const piSessionId = normalizeSessionId(
      requestedSessionId || (sessionScope === "main" ? ownerSessionId : `${ownerSessionId}-${sessionScope}`),
    );
    const sessionKey = sessionFilePath(sessionDir, ownerSessionId, sessionScope, cwd);
    const previousIdleSession = idleSessions.get(sessionKey);
    if (previousIdleSession) {
      idleSessions.delete(sessionKey);
      releaseSessionResource(previousIdleSession);
    }
    const compaction = normalizePiCompactionConfig(body?.piCompaction);
    const additionalSkillPaths = normalizePiSkillPaths(body?.piSkillPaths)
      .map((skillPath) => resolve(skillPath));
    const requestedToolsEnabled = body?.enableTools !== false;
    const mcpConfig = normalizePiMcpConfig(body?.mcpConfig ?? body?.mcpServers ?? {});
    const hasMcpServers = requestedToolsEnabled && Object.keys(mcpConfig.mcpServers).length > 0;
    const toolsEnabled = shouldEnablePiTools(body?.enableTools, additionalSkillPaths);
    const requestedToolDefinitions = Array.isArray(requestBody.tools)
      ? requestBody.tools
      : [];
    const nativeTools = toolsEnabled
      ? getPiNativeToolNames(workspace, {
          fullToolsEnabled: requestedToolsEnabled,
          skillsEnabled: additionalSkillPaths.length > 0,
        })
      : [];
    let customToolNames = new Set();

    response.writeHead(200, {
      "Content-Type": "text/event-stream;charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const run = {
      id: runId,
      response,
      pendingTools: new Map(),
      streamingToolCalls: new Map(),
      session: null,
      settingsManager: null,
      sessionKey,
      allowImageInputs: provider.allowImageInputs,
      lastAssistantStopReason: "",
      completed: false,
    };
    runs.set(runId, run);
    writeSse(response, piEvent("run_start", {
      runId,
      sessionId: piSessionId,
      kernel: PI_KERNEL_ID,
      kernelMode: "full",
      compaction: { engine: "pi", ...compaction },
      nativeTools,
      mcp: hasMcpServers ? { engine: "pi-mcp-adapter", mode: "native" } : { enabled: false },
    }));

    const abortRun = () => {
      if (run.completed) return;
      void run.session?.abort();
      settlePendingTools(run, new Error("Pi 会话连接已关闭"));
    };
    response.once("close", abortRun);

    let unsubscribe = () => {};
    let providerId = "";
    let modelRuntime;
    let effectiveContextWindow = 0;
    try {
      const contextWindow = resolveContextWindow(body, provider);
      effectiveContextWindow = contextWindow;
      providerId = stableProviderId({ ...provider, apiKey: provider.apiKey });
      modelRuntime = await getModelRuntime();
      providerUsers.set(providerId, (providerUsers.get(providerId) ?? 0) + 1);
      const samplingParams = getPiSamplingParams(requestBody);
      const requestedMaxTokens = Number(
        requestBody.max_tokens ??
          requestBody.max_completion_tokens ??
          requestBody.max_output_tokens ??
          DEFAULT_PI_MODEL_MAX_TOKENS,
      );
      modelRuntime.registerProvider(providerId, {
        name: "Renge OpenAI Compatible",
        baseUrl: provider.apiBaseUrl,
        apiKey: provider.apiKey || "unused",
        api: provider.piApi,
        models: [{
          id: provider.modelId,
          name: provider.modelId,
          api: provider.piApi,
          baseUrl: provider.apiBaseUrl,
          reasoning: Boolean(
            requestBody.reasoning_effort ||
              requestBody.include_reasoning ||
              requestBody.enable_thinking,
          ),
          input: provider.allowImageInputs ? ["text", "image"] : ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow,
          maxTokens: Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
            ? requestedMaxTokens
            : DEFAULT_PI_MODEL_MAX_TOKENS,
          samplingParams,
        }],
      });
      const model = modelRuntime.getModel(providerId, provider.modelId);
      if (!model) throw new Error(`Pi 未找到模型 ${provider.modelId}`);

      const converted = convertOpenAiMessagesToPi(requestBody.messages, {
        providerId,
        apiType: provider.apiType,
        modelId: provider.modelId,
      });
      const settingsManager = SettingsManager.create(cwd, agentDir);
      settingsManager.applyOverrides({
        compaction,
        // A long reasoning phase can legitimately remain quiet for more than
        // Pi's five-minute default. Zero selects Pi's effectively-unbounded
        // idle timeout while the run remains cancellable through its signal.
        httpIdleTimeoutMs: 0,
      });
      run.settingsManager = settingsManager;
      const extensionFactories = hasMcpServers
        ? [await createPiMcpAdapter(mcpConfig, { agentDir })]
        : [];
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        extensionFactories,
        // Reuse enabled Renge skills through Pi's native Skill loader.
        additionalSkillPaths,
        appendSystemPromptOverride: (base) => [
          ...base,
          ...(converted.systemPrompt ? [appendPromptToSystemPrompt(converted.systemPrompt)] : []),
        ],
      });
      await resourceLoader.reload();
      const extensionToolNames = resourceLoader
        .getExtensions()
        .extensions
        .flatMap((extension) => Array.from(extension.tools.keys()));
      const customDefinitionsForRun = requestedToolsEnabled ? filterPiCustomToolDefinitions(
        requestedToolDefinitions,
        workspace,
        new Set([...nativeTools, ...extensionToolNames]),
      ) : [];
      const customTools = customDefinitionsForRun.map((definition) => createCustomTool(definition, run));
      customToolNames = new Set(customTools.map((tool) => tool.name));
      const sessionFile = sessionKey;
      await ensureSessionFile(sessionFile, piSessionId, cwd);
      const sessionManager = SessionManager.open(sessionFile, sessionDir, cwd);
      if (sessionManager.buildSessionContext().messages.length === 0) {
        if (converted.history.length > 0) {
          sessionManager.appendModelChange(providerId, provider.modelId);
        }
        for (const message of converted.history) sessionManager.appendMessage(message);
      }
      const reasoningLevel = String(requestBody.reasoning_effort ?? "").trim();
      const thinkingLevel = ["minimal", "low", "medium", "high", "xhigh", "max"].includes(reasoningLevel)
        ? reasoningLevel
        : "off";
      const { session } = await createAgentSession({
        cwd,
        modelRuntime,
        model,
        thinkingLevel,
        tools: toolsEnabled
          ? [
              ...nativeTools,
              ...(requestedToolsEnabled ? extensionToolNames : []),
              ...customTools.map((tool) => tool.name),
            ]
          : [],
        customTools,
        resourceLoader,
        settingsManager,
        sessionManager,
      });
      run.session = session;
      installContinuousPiRetry(session);
      await session.bindExtensions({
        mode: "json",
        commandContextActions: {
          waitForIdle: () => session.waitForIdle(),
          newSession: async () => ({ cancelled: true }),
          fork: async () => ({ cancelled: true }),
          navigateTree: async (targetId, options) => {
            const result = await session.navigateTree(targetId, options);
            return { cancelled: result.cancelled };
          },
          switchSession: async () => ({ cancelled: true }),
          reload: async () => session.reload(),
        },
      });

      unsubscribe = session.subscribe((event) => {
        if (event.type === "message_end" && event.message?.role === "assistant") {
          run.lastAssistantStopReason = String(event.message.stopReason ?? "");
        }
        if (event.type === "message_update") {
          if (event.assistantMessageEvent.type === "text_delta") {
            writeSse(response, completionChunk(runId, { content: event.assistantMessageEvent.delta }));
          } else if (event.assistantMessageEvent.type === "thinking_delta") {
            writeSse(response, completionChunk(runId, {
              reasoning_content: event.assistantMessageEvent.delta,
            }));
          } else if (event.assistantMessageEvent.type === "toolcall_start") {
            const toolCall = event.assistantMessageEvent;
            const partialToolCall = toolCall.partial?.content?.[toolCall.contentIndex];
            const toolCallId = String(toolCall.id ?? partialToolCall?.id ?? `stream-tool-call-${toolCall.contentIndex}`);
            const toolName = String(
              toolCall.toolName ?? toolCall.name ?? partialToolCall?.name ?? "unknown_tool",
            );
            run.streamingToolCalls.set(String(toolCall.contentIndex), {
              toolCallId,
              toolName,
              argumentsText: "",
            });
            writeSse(response, piEvent("tool_call_start", {
              runId,
              toolCallId,
              toolName,
              contentIndex: toolCall.contentIndex,
            }));
          } else if (event.assistantMessageEvent.type === "toolcall_delta") {
            const toolCall = event.assistantMessageEvent;
            const key = String(toolCall.contentIndex);
            const current = run.streamingToolCalls.get(key) ?? {
              toolCallId: `stream-tool-call-${toolCall.contentIndex}`,
              toolName: "unknown_tool",
              argumentsText: "",
            };
            current.argumentsText += toolCall.delta;
            run.streamingToolCalls.set(key, current);
            writeSse(response, piEvent("tool_call_delta", {
              runId,
              toolCallId: current.toolCallId,
              contentIndex: toolCall.contentIndex,
              delta: toolCall.delta,
            }));
          } else if (event.assistantMessageEvent.type === "toolcall_end") {
            const toolCall = event.assistantMessageEvent;
            const key = String(toolCall.contentIndex);
            const current = run.streamingToolCalls.get(key);
            run.streamingToolCalls.delete(key);
            writeSse(response, piEvent("tool_call_end", {
              runId,
              toolCallId: current?.toolCallId ?? `stream-tool-call-${toolCall.contentIndex}`,
              contentIndex: toolCall.contentIndex,
              toolCall: toolCall.toolCall,
              ...(current?.argumentsText ? { argumentsText: current.argumentsText } : {}),
            }));
          }
          return;
        }
        if (
          event.type === "tool_execution_start" &&
          !customToolNames.has(event.toolName)
        ) {
          writeSse(response, piEvent("tool_start", {
            runId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            arguments: event.args,
          }));
          return;
        }
        if (
          event.type === "tool_execution_end" &&
          !customToolNames.has(event.toolName)
        ) {
          writeSse(response, piEvent("tool_end", {
            runId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            isError: event.isError,
            result: event.result,
          }));
          return;
        }
        if (event.type === "compaction_start" || event.type === "compaction_end" ||
          event.type === "auto_retry_start" || event.type === "auto_retry_end") {
          writeSse(response, piEvent(event.type, { runId, ...event }));
        }
      });

      const prompt = resolvePrompt(converted.promptMessage);
      const pendingPromptTokens = estimatePendingPromptTokens(prompt);
      // PiDeck performs native auto-compaction before a prompt when the
      // context is over the reserve threshold. Keep that behavior even when
      // a local OpenAI-compatible gateway omits usage metadata.
      await maybeAutoCompact(session, compaction, pendingPromptTokens);
      const promptOptions = prompt.images.length > 0 ? { images: prompt.images } : undefined;
      try {
        await session.prompt(prompt.text, promptOptions);
        const errorMessage = session.agent.state.errorMessage;
        if (errorMessage) throw new Error(errorMessage);
      } catch (promptError) {
        const discoveredWindow = extractContextWindowFromError(promptError);
        if (!discoveredWindow) throw promptError;
        rememberContextWindow(provider, discoveredWindow);
        effectiveContextWindow = Math.min(effectiveContextWindow || discoveredWindow, discoveredWindow);
        try {
          if (session.model) session.model.contextWindow = effectiveContextWindow;
        } catch {
          // Some SDK model wrappers expose contextWindow as read-only.
        }

        // Some gateways reject the first request before Pi can run its own
        // overflow recovery. Compact once with the discovered hard limit and
        // retry the same prompt so the user does not lose the turn.
        const recoveryCompaction = {
          ...compaction,
          enabled: true,
          reserveTokens: Math.max(compaction.reserveTokens, 16_384),
        };
        let recovered = await maybeAutoCompact(
          session,
          recoveryCompaction,
          pendingPromptTokens,
        );
        if (!recovered) {
          try {
            await session.compact();
            recovered = true;
          } catch {
            recovered = false;
          }
        }
        if (!recovered) throw promptError;
        await session.prompt(prompt.text, promptOptions);
        const retryError = session.agent.state.errorMessage;
        if (retryError) throw new Error(retryError);
      }
      const finishReason = getSessionFinishReason(session, run.lastAssistantStopReason);
      for (const pendingToolCall of run.streamingToolCalls.values()) {
        writeSse(response, piEvent("tool_call_incomplete", {
          runId,
          toolCallId: pendingToolCall.toolCallId,
          toolName: pendingToolCall.toolName,
          argumentsText: pendingToolCall.argumentsText,
          finishReason,
        }));
      }
      run.streamingToolCalls.clear();
      // Some local gateways report zero usage, so the SDK cannot run its
      // post-turn threshold check. Re-check Pi's own message estimator here.
      await maybeAutoCompact(session, compaction);
      writeSse(response, piEvent("context_usage", {
        runId,
        usage: getReliableContextUsage(session),
      }));
      writeSse(response, completionChunk(runId, {}, finishReason));
      writeSse(response, "[DONE]");
    } catch (error) {
      if (!response.destroyed && !response.writableEnded) {
        writeSse(response, { error: { message: error instanceof Error ? error.message : String(error) } });
        writeSse(response, "[DONE]");
      }
    } finally {
      run.completed = true;
      response.off("close", abortRun);
      unsubscribe();
      settlePendingTools(run, new Error("Pi 会话已结束"));
      if (run.session && run.sessionKey) {
        idleSessions.set(run.sessionKey, {
          session: run.session,
          providerId,
          modelRuntime,
          settingsManager: run.settingsManager,
          ownerSessionId,
          sessionScope,
          cwd,
        });
      } else {
        releaseSessionResource({ session: run.session, providerId, modelRuntime });
      }
      runs.delete(runId);
      if (!response.destroyed && !response.writableEnded) response.end();
    }
  };

  const resolveSessionKeyFromBody = (body) => {
    const ownerSessionId = normalizeSessionId(body?.sessionId);
    const requestedSessionScope = normalizeSessionId(body?.piSessionScope || "main");
    const workspace = body?.workspace && typeof body.workspace === "object" ? body.workspace : null;
    const cwd = workspace?.kind === "electron" && workspace.cwd
      ? resolve(String(workspace.cwd))
      : resolve(defaultCwd);
    return sessionFilePath(sessionDir, ownerSessionId, requestedSessionScope, cwd);
  };

  const resolveIdleSession = (body) => {
    const requestedSessionScope = normalizeSessionId(body?.piSessionScope || "main");
    const scopeCandidates = /-(?:text|vision)$/.test(requestedSessionScope)
      ? [requestedSessionScope]
      : [requestedSessionScope, `${requestedSessionScope}-text`, `${requestedSessionScope}-vision`];
    const ownerSessionId = normalizeSessionId(body?.sessionId);
    const workspace = body?.workspace && typeof body.workspace === "object" ? body.workspace : null;
    const cwd = workspace?.kind === "electron" && workspace.cwd
      ? resolve(String(workspace.cwd))
      : resolve(defaultCwd);
    for (const scope of scopeCandidates) {
      const sessionKey = sessionFilePath(sessionDir, ownerSessionId, scope, cwd);
      const exact = idleSessions.get(sessionKey);
      if (exact) return { sessionKey, entry: exact };
    }
    for (const [key, entry] of idleSessions) {
      if (entry.ownerSessionId === ownerSessionId && scopeCandidates.includes(entry.sessionScope)) {
        return { sessionKey: key, entry };
      }
    }
    return { sessionKey: resolveSessionKeyFromBody(body), entry: null };
  };

  const handleCompact = async (body) => {
    const { entry } = resolveIdleSession(body);
    if (!entry) return { ok: false, status: 404, error: "Pi 会话尚未建立或已被新的请求替换" };
    if (!entry.session?.isIdle) return { ok: false, status: 409, error: "Pi 会话正在运行" };
    const compaction = normalizePiCompactionConfig(body?.piCompaction);
    entry.settingsManager?.applyOverrides({ compaction });
    try {
      const result = await entry.session.compact(String(body?.instructions ?? "").trim() || undefined);
      return {
        ok: true,
        status: 200,
        result,
        contextUsage: getReliableContextUsage(entry.session),
      };
    } catch (error) {
      return { ok: false, status: 500, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleSetAutoCompaction = (body) => {
    const { entry } = resolveIdleSession(body);
    if (!entry) return { ok: false, status: 404, error: "Pi 会话尚未建立或已被新的请求替换" };
    const enabled = body?.enabled === true;
    entry.session?.setAutoCompactionEnabled(enabled);
    return { ok: true, status: 200, enabled };
  };

  const handleToolResult = (body) => {
    const runId = String(body?.runId ?? "");
    const toolCallId = String(body?.toolCallId ?? "");
    const run = runs.get(runId);
    const pending = run?.pendingTools.get(toolCallId);
    if (!run || !pending) return { ok: false, status: 404, error: "Pi 工具调用不存在或已经结束" };
    run.pendingTools.delete(toolCallId);
    if (body?.error) pending.reject(new Error(String(body.error)));
    else pending.resolve(body?.result);
    return { ok: true, status: 200 };
  };

  const handleAbort = async (body) => {
    const runId = String(body?.runId ?? "");
    const run = runs.get(runId);
    if (!run) return { ok: true, aborted: false };
    settlePendingTools(run, new Error("Pi 会话已由用户中止"));
    await run.session?.abort();
    return { ok: true, aborted: true };
  };

  const handleDeleteSession = async (body) => {
    const requestedSessionId = String(body?.sessionId ?? "").trim();
    if (!requestedSessionId) return { ok: false, status: 400, error: "缺少 sessionId" };
    const ownerSessionId = normalizeSessionId(requestedSessionId);
    const ownerHash = createHash("sha256").update(ownerSessionId).digest("hex").slice(0, 24);
    await rm(join(sessionDir, ownerHash), { recursive: true, force: true });
    for (const [key, entry] of idleSessions) {
      if (key.includes(`${ownerHash}`)) {
        idleSessions.delete(key);
        releaseSessionResource(entry);
      }
    }
    return { ok: true, status: 200 };
  };

  const dispose = async () => {
    await Promise.all(Array.from(runs.values()).map(async (run) => {
      settlePendingTools(run, new Error("Pi Host 已关闭"));
      await run.session?.abort();
      run.session?.dispose();
    }));
    for (const entry of idleSessions.values()) releaseSessionResource(entry);
    idleSessions.clear();
    runs.clear();
  };

  return {
    handleChat,
    handleToolResult,
    handleAbort,
    handleCompact,
    handleSetAutoCompaction,
    handleDeleteSession,
    dispose,
  };
}
