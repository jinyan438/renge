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
import { createPiPackageManager } from "./pi-package-manager.mjs";
import { installContinuousPiRetry } from "./continuous-retry.mjs";
import { createPiRequestBodyRecoveryFetch } from "./request-body-recovery.mjs";
import { getReliableContextUsage, installPiLiveContext } from "./live-context.mjs";
import { createPermissionCheckedPiTools } from "./permission-tools.mjs";
import { createShellSessionManager } from "./shell-sessions.mjs";
import {
  convertOpenAiMessagesToPi,
  filterPiCustomToolDefinitions,
  getPiNativeToolNames,
  getPiReasoningModelConfig,
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

function flushIncompleteStreamingToolCalls(
  run,
  { finishReason = "error", willRetry = false } = {},
) {
  const pendingById = new Map();
  for (const pendingToolCall of [
    ...run.streamingToolCalls.values(),
    ...run.unexecutedToolCalls.values(),
  ]) {
    pendingById.set(pendingToolCall.toolCallId, pendingToolCall);
  }
  for (const pendingToolCall of pendingById.values()) {
    writeSse(run.response, piEvent("tool_call_incomplete", {
      runId: run.id,
      toolCallId: pendingToolCall.toolCallId,
      toolName: pendingToolCall.toolName,
      argumentsText: pendingToolCall.argumentsText,
      finishReason,
      willRetry,
    }));
  }
  run.streamingToolCalls.clear();
  run.unexecutedToolCalls.clear();
  run.executionToolCallAliases.clear();
}

/**
 * Resolves the preview id the UI already rendered for an execution event.
 * Pi numbers tool calls per assistant message, so the oldest unexecuted
 * preview with the same tool name belongs to this execution.
 */
function resolvePreviewToolCallId(run, executionToolCallId, toolName) {
  const executionId = String(executionToolCallId ?? "");
  const known = run.executionToolCallAliases.get(executionId);
  if (known) return known;

  for (const [previewId, preview] of run.unexecutedToolCalls) {
    if (toolName && preview.toolName !== toolName) continue;
    run.executionToolCallAliases.set(executionId, previewId);
    run.unexecutedToolCalls.delete(previewId);
    return previewId;
  }

  run.executionToolCallAliases.set(executionId, executionId);
  return executionId;
}

function toolContent(result, allowImageInputs = true) {
  const content = result?.result?.content ?? result?.content;
  if (Array.isArray(content)) {
    const blocks = content.flatMap((item) => {
      if (item?.type === "text" && typeof item.text === "string") {
        return [{ type: "text", text: item.text }];
      }
      if (allowImageInputs && item?.type === "image" && typeof item.data === "string") {
        const rawData = item.data.trim();
        const dataUrl = rawData.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
        if (/^data:/i.test(rawData) && !dataUrl) return [];
        const mimeType = dataUrl?.[1] ?? item.mimeType ?? item.mime_type;
        const data = (dataUrl?.[2] ?? rawData).replace(/\s+/g, "");
        if (!data) return [];
        return [{
          type: "image",
          data,
          mimeType: normalizeImageMimeType(mimeType),
        }];
      }
      return [];
    });
    if (blocks.length > 0) return blocks;
  }
  return [{ type: "text", text: serializePiToolResult(result) }];
}

const IMAGE_MIME_TYPE_PATTERN = /^image\/[a-z0-9][a-z0-9.+-]*$/i;

function normalizeImageMimeType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return IMAGE_MIME_TYPE_PATTERN.test(normalized) ? normalized : "image/png";
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
      const data = typeof part.data === "string" ? part.data.trim() : "";
      if (!data) continue;
      images.push({
        type: "image",
        mimeType: normalizeImageMimeType(part.mimeType),
        data: data.replace(/\s+/g, ""),
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
  authorizeTool,
} = {}) {
  const runs = new Map();
  // Keep the last idle AgentSession available for PiDeck-compatible manual
  // compaction. The next chat request replaces it, while the session file
  // remains the source of truth for normal persistence.
  const idleSessions = new Map();
  const coldSessions = new Map();
  const frozenOwners = new Set();
  const sessionDir = join(resolve(dataDir), ".pi", "sessions");
  const piPackageManager = createPiPackageManager({ cwd: defaultCwd, agentDir });
  const providerUsers = new Map();
  const requestBodyLimits = new Map();
  const closingSessions = new WeakMap();
  let modelRuntimePromise;
  let disposed = false;

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

  const shutdownSession = (session, reason = "resume") => {
    if (!session) return Promise.resolve();
    const closing = closingSessions.get(session);
    if (closing) return closing;
    const operation = Promise.resolve().then(async () => {
      try {
        await session.extensionRunner?.emit({ type: "session_shutdown", reason });
      } catch (error) {
        console.warn("[pi-extension] session shutdown failed:", error instanceof Error ? error.message : String(error));
      } finally {
        session.dispose();
      }
    });
    closingSessions.set(session, operation);
    return operation;
  };

  const releaseSessionResource = async (entry, reason = "resume") => {
    if (!entry) return;
    await entry.closing;
    await shutdownSession(entry.session, reason);
    if (entry.providerId && entry.modelRuntime) {
      const remaining = (providerUsers.get(entry.providerId) ?? 1) - 1;
      if (remaining > 0) providerUsers.set(entry.providerId, remaining);
      else {
        providerUsers.delete(entry.providerId);
        entry.modelRuntime.unregisterProvider(entry.providerId);
      }
    }
  };

  const invalidateIdleSessions = async (reason = "reload") => {
    const entries = [...idleSessions.values(), ...coldSessions.values()];
    idleSessions.clear();
    coldSessions.clear();
    for (const entry of entries) await releaseSessionResource(entry, reason);
  };

  const suspendSession = async (sessionKey, entry) => {
    const { session, ...metadata } = entry;
    const model = session.model;
    // The transcript stays in Pi's session file. Drop extensions, listeners,
    // retry state and the AgentSession's duplicate in-memory history.
    const cold = { ...metadata, model, closing: shutdownSession(session) };
    coldSessions.set(sessionKey, cold);
    try { await cold.closing; } finally { delete cold.closing; }
  };

  const handleSessionActivity = async (body) => {
    const requestedId = String(body?.sessionId ?? "").trim();
    if (!requestedId || typeof body?.frozen !== "boolean") {
      return { ok: false, status: 400, error: "缺少 sessionId 或 frozen" };
    }
    const ownerSessionId = normalizeSessionId(requestedId);
    let released = 0;
    if (body.frozen) {
      frozenOwners.add(ownerSessionId);
      for (const [key, entry] of idleSessions) {
        if (entry.ownerSessionId !== ownerSessionId) continue;
        idleSessions.delete(key);
        await suspendSession(key, entry);
        released += 1;
      }
    } else frozenOwners.delete(ownerSessionId);
    return { ok: true, status: 200, released, pending: [...runs.values()].filter((run) => run.ownerSessionId === ownerSessionId).length };
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
        if (run.cancelled || signal?.aborted) throw new Error("工具调用已中止");
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
    // Rewrites use the supplied transcript without changing the normal Pi tree.
    const replaceHistory = body?.piHistoryMode === "replace";
    const sessionKey = replaceHistory ? "" : sessionFilePath(sessionDir, ownerSessionId, sessionScope, cwd);
    if ([...runs.values()].some((run) => sessionKey && run.sessionKey === sessionKey && !run.completed)) {
      response.writeHead(409, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "此会话已有任务正在运行，请追加消息或等待完成。" }));
      return;
    }
    const previousIdleSession = idleSessions.get(sessionKey);
    if (previousIdleSession) {
      idleSessions.delete(sessionKey);
    }
    const previousColdSession = coldSessions.get(sessionKey);
    if (previousColdSession) {
      coldSessions.delete(sessionKey);
    }
    // Reserve the new run before awaiting extension shutdown so a second request
    // cannot enter this same session during asynchronous lifecycle cleanup.
    const previousResourcesReleased = Promise.all([
      releaseSessionResource(previousIdleSession, "reload"), releaseSessionResource(previousColdSession),
    ]);
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
      shellSessions: null,
      streamingToolCalls: new Map(),
      // A toolcall_end event only means the JSON parser closed. Keep the
      // preview here until tool_execution_start proves the tool really ran.
      unexecutedToolCalls: new Map(),
      // Pi executes tool calls with its own toolCallId, which can differ from
      // the id used while streaming the preview. Keep the join so tool_start /
      // tool_end can update the preview in place instead of appending a new
      // message under later text.
      executionToolCallAliases: new Map(),
      session: null,
      settingsManager: null,
      sessionKey,
      allowImageInputs: provider.allowImageInputs,
      lastAssistantStopReason: "",
      completed: false,
      cancelled: false,
      ownerSessionId,
      acceptingInput: false,
      inputs: new Map(),
    };
    run.shellSessions = createShellSessionManager({
      onBackgroundUpdate: ({ toolCallId, toolName, result, finished, isError }) => {
        if (run.completed || run.cancelled) return;
        writeSse(response, piEvent(finished ? "tool_end" : "tool_update", {
          runId,
          toolCallId: resolvePreviewToolCallId(run, toolCallId, toolName),
          executionToolCallId: toolCallId,
          toolName, result, isError,
        }));
      },
    });
    runs.set(runId, run);
    const abortRun = () => {
      if (run.completed) return;
      run.cancelled = true;
      run.shellSessions.dispose();
      void run.session?.abort();
      settlePendingTools(run, new Error("Pi 会话连接已关闭"));
    };
    const checkCancelled = () => {
      if (run.cancelled || response.destroyed || response.writableEnded) {
        throw Object.assign(new Error("Pi 会话已中止"), { name: "AbortError" });
      }
    };
    response.once("close", abortRun);
    writeSse(response, piEvent("run_start", {
      runId,
      sessionId: piSessionId,
      kernel: PI_KERNEL_ID,
      kernelMode: "full",
      compaction: { engine: "pi", ...compaction },
      nativeTools,
      mcp: hasMcpServers ? { engine: "pi-mcp-adapter", mode: "native" } : { enabled: false },
    }));

    let unsubscribe = () => {};
    let liveContext;
    let providerId = "";
    let modelRuntime;
    let effectiveContextWindow = 0;
    try {
      await previousResourcesReleased;
      checkCancelled();
      const contextWindow = resolveContextWindow(body, provider);
      effectiveContextWindow = contextWindow;
      providerId = stableProviderId({ ...provider, apiKey: provider.apiKey });
      modelRuntime = await getModelRuntime();
      providerUsers.set(providerId, (providerUsers.get(providerId) ?? 0) + 1);
      checkCancelled();
      const samplingParams = getPiSamplingParams(requestBody);
      const reasoningConfig = getPiReasoningModelConfig(requestBody);
      const configuredMaxOutputTokens = Number(body?.modelMaxOutputTokens);
      const requestedMaxTokens = Number(
        Number.isSafeInteger(configuredMaxOutputTokens) && configuredMaxOutputTokens > 0
          ? configuredMaxOutputTokens
          : requestBody.max_tokens ??
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
          reasoning: reasoningConfig.reasoning,
          ...(reasoningConfig.thinkingLevelMap
            ? { thinkingLevelMap: reasoningConfig.thinkingLevelMap }
            : {}),
          ...(reasoningConfig.compat ? { compat: reasoningConfig.compat } : {}),
          input: provider.allowImageInputs ? ["text", "image"] : ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow,
          maxTokens: Number.isSafeInteger(requestedMaxTokens) && requestedMaxTokens > 0
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
        lastUserPromptFallback: body?.piLastUserPromptFallback === true,
      });
      run.compactionResources = { mcpConfig, hasMcpServers, additionalSkillPaths, systemPrompt: converted.systemPrompt };
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
      checkCancelled();
      const extensionToolNames = resourceLoader
        .getExtensions()
        .extensions
        .flatMap((extension) => Array.from(extension.tools.keys()));
      const localCustomTools = createPermissionCheckedPiTools({
        cwd, nativeTools, sessionId: ownerSessionId, authorizeTool, checkCancelled,
        shellSessions: run.shellSessions,
      });
      const customDefinitionsForRun = requestedToolsEnabled ? filterPiCustomToolDefinitions(
        requestedToolDefinitions,
        workspace,
        new Set([...nativeTools, ...extensionToolNames, ...localCustomTools.map((tool) => tool.name)]),
      ) : [];
      const bridgedCustomTools = customDefinitionsForRun.map(
        (definition) => createCustomTool(definition, run),
      );
      // Override Pi's whole-file write with a bounded, offset-checked version.
      // A local gateway that cuts a long stream can no longer leave a giant
      // write call perpetually "running" or duplicate an already-applied chunk.
      const customTools = [...bridgedCustomTools, ...localCustomTools];
      const initialActiveToolNames = toolsEnabled
        ? [
            ...nativeTools,
            ...(requestedToolsEnabled ? extensionToolNames : []),
            ...customTools.map((tool) => tool.name),
          ]
        : [];
      const allowDynamicExtensionTools = toolsEnabled && requestedToolsEnabled;
      // Only tools bridged back to the renderer suppress native execution
      // events. The local resumable write tool must still paint start/end.
      customToolNames = new Set(bridgedCustomTools.map((tool) => tool.name));
      const sessionFile = sessionKey;
      if (!replaceHistory) await ensureSessionFile(sessionFile, piSessionId, cwd);
      checkCancelled();
      const sessionManager = replaceHistory
        ? SessionManager.inMemory(cwd)
        : SessionManager.open(sessionFile, sessionDir, cwd);
      const isNewSession = sessionManager.buildSessionContext().messages.length === 0;
      if (isNewSession) {
        if (converted.history.length > 0) {
          sessionManager.appendModelChange(providerId, provider.modelId);
        }
        for (const message of converted.history) sessionManager.appendMessage(message);
      }
      const { session } = await createAgentSession({
        cwd,
        modelRuntime,
        model,
        thinkingLevel: reasoningConfig.thinkingLevel,
        // An explicit tools list is an SDK allowlist. Omit it when tools are
        // enabled so Pi extensions may register tools during session_start.
        ...(allowDynamicExtensionTools ? {} : { tools: initialActiveToolNames }),
        customTools,
        resourceLoader,
        settingsManager,
        sessionManager,
      });
      run.session = session;
      const streamFunction = session.agent.streamFunction;
      session.agent.streamFunction = (requestModel, context, options) => streamFunction(requestModel, context, {
        ...options,
        fetch: createPiRequestBodyRecoveryFetch({
          fetchImpl: options?.fetch ?? globalThis.fetch,
          limits: requestBodyLimits,
          providerKey: `${providerId}\u0000${provider.modelId}`,
        }),
      });
      checkCancelled();
      if (allowDynamicExtensionTools) {
        session.setActiveToolsByName(initialActiveToolNames);
      }
      installContinuousPiRetry(session);
      liveContext = installPiLiveContext(session, {
        onUsage: (usage) => {
          if (!run.cancelled) writeSse(response, piEvent("context_usage", { runId, usage }));
        },
      });
      await session.bindExtensions({
        mode: "json",
        onError: (extensionError) => {
          console.warn(
            `[pi-extension] ${extensionError.extensionPath} ${extensionError.event}: ${extensionError.error}`,
          );
          writeSse(response, piEvent("extension_error", {
            runId,
            extensionPath: extensionError.extensionPath,
            event: extensionError.event,
            error: extensionError.error,
          }));
        },
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
        liveContext.handleEvent(event);
        if (event.type === "message_start" && event.message?.role === "user") {
          const input = run.inputs.get(event.message.rengeInputId);
          if (input && !input.delivered) {
            input.delivered = true;
            writeSse(response, piEvent("input_delivered", { runId, inputId: input.id, mode: input.mode }));
          }
        }
        if (event.type === "message_end" && event.message?.role === "assistant") {
          run.lastAssistantStopReason = String(event.message.stopReason ?? "");
        }
        if (event.type === "auto_retry_start") {
          // Pi may emit toolcall_end after repairing partial JSON even though
          // no tool_execution_start occurred. Close every unexecuted preview
          // before the next attempt so the UI never mistakes it for a write.
          flushIncompleteStreamingToolCalls(run, {
            finishReason: "error",
            willRetry: true,
          });
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
            const endedToolCall = event.assistantMessageEvent.toolCall;
            const toolCallId = current?.toolCallId ?? String(
              endedToolCall?.id ?? `stream-tool-call-${toolCall.contentIndex}`,
            );
            const toolName = current?.toolName ?? String(
              endedToolCall?.name ?? "unknown_tool",
            );
            const argumentsText = current?.argumentsText || JSON.stringify(
              endedToolCall?.arguments ?? {},
            );
            run.unexecutedToolCalls.set(toolCallId, {
              toolCallId,
              toolName,
              argumentsText,
            });
            writeSse(response, piEvent("tool_call_end", {
              runId,
              toolCallId,
              contentIndex: toolCall.contentIndex,
              toolCall: toolCall.toolCall,
              ...(argumentsText ? { argumentsText } : {}),
            }));
          }
          return;
        }
        if (
          event.type === "tool_execution_start" &&
          !customToolNames.has(event.toolName)
        ) {
          const previewToolCallId = resolvePreviewToolCallId(
            run,
            event.toolCallId,
            event.toolName,
          );
          writeSse(response, piEvent("tool_start", {
            runId,
            toolCallId: previewToolCallId,
            executionToolCallId: event.toolCallId,
            toolName: event.toolName,
            arguments: event.args,
          }));
          return;
        }
        if (event.type === "tool_execution_start") {
          resolvePreviewToolCallId(run, event.toolCallId, event.toolName);
        }
        if (event.type === "tool_execution_update" && !customToolNames.has(event.toolName)) {
          writeSse(response, piEvent("tool_update", {
            runId,
            toolCallId: resolvePreviewToolCallId(run, event.toolCallId, event.toolName),
            executionToolCallId: event.toolCallId,
            toolName: event.toolName,
            result: event.partialResult,
          }));
          return;
        }
        if (
          event.type === "tool_execution_end" &&
          !customToolNames.has(event.toolName)
        ) {
          writeSse(response, piEvent("tool_end", {
            runId,
            toolCallId: resolvePreviewToolCallId(run, event.toolCallId, event.toolName),
            executionToolCallId: event.toolCallId,
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

      const prompt = resolvePrompt(
        converted.promptMessage ?? converted.fallbackPromptMessage,
      );
      checkCancelled();
      const pendingPromptTokens = estimatePendingPromptTokens(prompt);
      // PiDeck performs native auto-compaction before a prompt when the
      // context is over the reserve threshold. Keep that behavior even when
      // a local OpenAI-compatible gateway omits usage metadata.
      await maybeAutoCompact(session, compaction, pendingPromptTokens);
      checkCancelled();
      const promptOptions = prompt.images.length > 0 ? { images: prompt.images } : undefined;
      run.acceptingInput = true;
      writeSse(response, piEvent("run_ready", { runId, sessionId: ownerSessionId }));
      try {
        await session.prompt(prompt.text, promptOptions);
        const errorMessage = session.agent.state.errorMessage;
        if (errorMessage) throw new Error(errorMessage);
      } catch (promptError) {
        checkCancelled();
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
        checkCancelled();
        await session.prompt(prompt.text, promptOptions);
        const retryError = session.agent.state.errorMessage;
        if (retryError) throw new Error(retryError);
      }
      const finishReason = getSessionFinishReason(session, run.lastAssistantStopReason);
      await run.shellSessions.dispose();
      run.acceptingInput = false;
      flushIncompleteStreamingToolCalls(run, { finishReason, willRetry: false });
      // Some local gateways report zero usage, so the SDK cannot run its
      // post-turn threshold check. Re-check Pi's own message estimator here.
      if (!run.cancelled) await maybeAutoCompact(session, compaction);
      liveContext.flush();
      writeSse(response, completionChunk(runId, {}, finishReason));
      writeSse(response, "[DONE]");
    } catch (error) {
      if (!response.destroyed && !response.writableEnded) {
        writeSse(response, { error: { message: error instanceof Error ? error.message : String(error) } });
        writeSse(response, "[DONE]");
      }
    } finally {
      run.acceptingInput = false;
      run.completed = true;
      liveContext?.dispose();
      await run.shellSessions.dispose();
      response.off("close", abortRun);
      if (run.cancelled) await run.session?.abort();
      unsubscribe();
      settlePendingTools(run, new Error("Pi 会话已结束"));
      if (run.session && run.sessionKey && !disposed) {
        const entry = {
          session: run.session,
          providerId,
          modelRuntime,
          settingsManager: run.settingsManager,
          compactionResources: run.compactionResources,
          thinkingLevel: run.session.thinkingLevel,
          ownerSessionId,
          sessionScope,
          cwd,
        };
        if (frozenOwners.has(ownerSessionId)) await suspendSession(run.sessionKey, entry);
        else idleSessions.set(run.sessionKey, entry);
      } else {
        await releaseSessionResource({ session: run.session, providerId, modelRuntime });
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

  const resolveIdleSession = async (body) => {
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
      const exact = idleSessions.get(sessionKey) ?? coldSessions.get(sessionKey);
      if (exact) return { sessionKey, entry: await restoreColdSession(sessionKey, exact) };
    }
    for (const [key, entry] of [...idleSessions, ...coldSessions]) {
      if (entry.ownerSessionId === ownerSessionId && scopeCandidates.includes(entry.sessionScope)) {
        return { sessionKey: key, entry: await restoreColdSession(key, entry) };
      }
    }
    return { sessionKey: resolveSessionKeyFromBody(body), entry: null };
  };

  const restoreColdSession = async (sessionKey, entry) => {
    if (entry.session) return entry;
    await entry.closing;
    if ([...runs.values()].some((run) => run.sessionKey === sessionKey && !run.completed)) {
      throw Object.assign(new Error("Pi 会话正在运行"), { status: 409 });
    }
    const resources = entry.compactionResources ?? {};
    const resourceLoader = new DefaultResourceLoader({
      cwd: entry.cwd, agentDir, settingsManager: entry.settingsManager,
      additionalSkillPaths: resources.additionalSkillPaths ?? [],
      extensionFactories: resources.hasMcpServers ? [await createPiMcpAdapter(resources.mcpConfig, { agentDir })] : [],
      appendSystemPromptOverride: (base) => [...base, ...(resources.systemPrompt ? [appendPromptToSystemPrompt(resources.systemPrompt)] : [])],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: entry.cwd,
      modelRuntime: entry.modelRuntime,
      model: entry.model,
      thinkingLevel: entry.thinkingLevel,
      settingsManager: entry.settingsManager,
      sessionManager: SessionManager.open(sessionKey, sessionDir, entry.cwd),
      resourceLoader,
      tools: [],
    });
    await session.bindExtensions({ mode: "json" });
    const restored = { ...entry, session };
    coldSessions.delete(sessionKey);
    idleSessions.set(sessionKey, restored);
    return restored;
  };

  const handleCompact = async (body) => {
    const { entry } = await resolveIdleSession(body);
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

  const handleSetAutoCompaction = async (body) => {
    const { entry } = await resolveIdleSession(body);
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
    run.cancelled = true;
    run.shellSessions.dispose();
    settlePendingTools(run, new Error("Pi 会话已由用户中止"));
    await run.session?.abort();
    return { ok: true, aborted: true };
  };

  const handleInput = async (body) => {
    const run = runs.get(String(body?.runId ?? ""));
    if (!run || run.completed || run.cancelled || !run.acceptingInput || !run.session) {
      return { ok: false, status: 409, error: "本轮任务尚未准备好或已经结束。" };
    }
    if (normalizeSessionId(body?.sessionId) !== run.ownerSessionId) {
      return { ok: false, status: 403, error: "追加消息不属于当前运行会话。" };
    }
    const id = String(body?.inputId ?? "").trim();
    const text = String(body?.content ?? "").trim();
    const mode = body?.mode;
    if (!id || !text || !["queue", "steer"].includes(mode)) {
      return { ok: false, status: 400, error: "缺少追加消息或发送方式。" };
    }
    const existing = run.inputs.get(id);
    if (existing) return existing.text === text && existing.mode === mode
      ? { ok: true, status: 200, inputId: id }
      : { ok: false, status: 409, error: "追加消息编号已被其他内容使用。" };
    // Register before queueing: a running tool can settle during this await.
    run.inputs.set(id, { id, text, mode, delivered: false });
    try {
      // The public core queue preserves correlation metadata without exposing
      // it in the model prompt or relying on matching duplicate user text.
      run.session.agent[mode === "steer" ? "steer" : "followUp"]({
        role: "user", content: [{ type: "text", text }], timestamp: Date.now(), rengeInputId: id,
      });
      return { ok: true, status: 200, inputId: id };
    } catch (error) {
      run.inputs.delete(id);
      return { ok: false, status: 409, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleDeleteSession = async (body) => {
    const requestedSessionId = String(body?.sessionId ?? "").trim();
    if (!requestedSessionId) return { ok: false, status: 400, error: "缺少 sessionId" };
    const ownerSessionId = normalizeSessionId(requestedSessionId);
    const ownerHash = createHash("sha256").update(ownerSessionId).digest("hex").slice(0, 24);
    for (const [key, entry] of idleSessions) {
      if (key.includes(`${ownerHash}`)) {
        idleSessions.delete(key);
        await releaseSessionResource(entry, "new");
      }
    }
    for (const [key, entry] of coldSessions) {
      if (entry.ownerSessionId !== ownerSessionId) continue;
      coldSessions.delete(key);
      await releaseSessionResource(entry, "new");
    }
    await rm(join(sessionDir, ownerHash), { recursive: true, force: true });
    frozenOwners.delete(ownerSessionId);
    return { ok: true, status: 200 };
  };

  const installPiPackage = async (source) => {
    const extension = await piPackageManager.install(source);
    await invalidateIdleSessions();
    return extension;
  };

  const updatePiPackage = async (source) => {
    const extension = await piPackageManager.update(source);
    await invalidateIdleSessions();
    return extension;
  };

  const setPiPackageEnabled = async (source, enabled) => {
    const result = await piPackageManager.setEnabled(source, enabled);
    await invalidateIdleSessions();
    return result;
  };

  const removePiPackage = async (source) => {
    const result = await piPackageManager.remove(source);
    await invalidateIdleSessions();
    return result;
  };

  const dispose = async () => {
    disposed = true;
    await Promise.all(Array.from(runs.values()).map(async (run) => {
      run.cancelled = true;
      run.shellSessions.dispose();
      settlePendingTools(run, new Error("Pi Host 已关闭"));
      await run.session?.abort();
      await shutdownSession(run.session, "quit");
      return undefined;
    }));
    await invalidateIdleSessions("quit");
    frozenOwners.clear();
    runs.clear();
  };

  return {
    handleChat,
    handleToolResult,
    handleAbort,
    handleInput,
    handleCompact,
    handleSetAutoCompaction,
    handleSessionActivity,
    handleDeleteSession,
    installPiPackage,
    updatePiPackage,
    setPiPackageEnabled,
    removePiPackage,
    dispose,
  };
}
