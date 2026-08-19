import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  convertOpenAiMessagesToPi,
  filterPiCustomToolDefinitions,
  getPiNativeToolNames,
  getPiSamplingParams,
  normalizePiProviderConfig,
  serializePiToolResult,
} from "../src/piBridgeUtils.mjs";

const TOOL_RESULT_TIMEOUT_MS = 10 * 60 * 1000;

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

function toolContent(result) {
  const content = result?.result?.content ?? result?.content;
  if (Array.isArray(content)) {
    const blocks = content.flatMap((item) => {
      if (item?.type === "text" && typeof item.text === "string") {
        return [{ type: "text", text: item.text }];
      }
      if (item?.type === "image" && typeof item.data === "string") {
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
  const key = [provider.apiType, provider.apiBaseUrl, provider.modelId, provider.apiKey].join("\u0000");
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
          content: toolContent(result),
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
    const sessionScope = normalizeSessionId(body?.piSessionScope || "main");
    const requestedSessionId = String(body?.piSessionId ?? "").trim();
    const piSessionId = normalizeSessionId(
      requestedSessionId || (sessionScope === "main" ? ownerSessionId : `${ownerSessionId}-${sessionScope}`),
    );
    const toolsEnabled = body?.enableTools !== false;
    const requestedToolDefinitions = Array.isArray(requestBody.tools)
      ? requestBody.tools
      : [];
    const nativeTools = toolsEnabled
      ? getPiNativeToolNames(workspace)
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
      session: null,
      completed: false,
    };
    runs.set(runId, run);
    writeSse(response, piEvent("run_start", {
      runId,
      sessionId: piSessionId,
      kernel: "@earendil-works/pi-coding-agent@0.84.2",
      kernelMode: "full",
      compaction: "pi",
      nativeTools,
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
    try {
      providerId = stableProviderId({ ...provider, apiKey: provider.apiKey });
      modelRuntime = await getModelRuntime();
      providerUsers.set(providerId, (providerUsers.get(providerId) ?? 0) + 1);
      const samplingParams = getPiSamplingParams(requestBody);
      const requestedMaxTokens = Number(
        requestBody.max_tokens ?? requestBody.max_completion_tokens ?? 16384,
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
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: Number(body.contextWindow ?? 128000),
          maxTokens: Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
            ? requestedMaxTokens
            : 16384,
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
      const additionalSkillPaths = Array.isArray(body?.piSkillPaths)
        ? body.piSkillPaths
            .map((skillPath) => String(skillPath ?? "").trim())
            .filter(Boolean)
            .map((skillPath) => resolve(skillPath))
        : [];
      const settingsManager = SettingsManager.create(cwd, agentDir);
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
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
      const customDefinitionsForRun = toolsEnabled ? filterPiCustomToolDefinitions(
        requestedToolDefinitions,
        workspace,
        new Set([...nativeTools, ...extensionToolNames]),
      ) : [];
      const customTools = customDefinitionsForRun.map((definition) => createCustomTool(definition, run));
      customToolNames = new Set(customTools.map((tool) => tool.name));
      const sessionFile = sessionFilePath(sessionDir, ownerSessionId, sessionScope, cwd);
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
          ? [...nativeTools, ...extensionToolNames, ...customTools.map((tool) => tool.name)]
          : [],
        customTools,
        resourceLoader,
        settingsManager,
        sessionManager,
      });
      run.session = session;
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
        if (event.type === "message_update") {
          if (event.assistantMessageEvent.type === "text_delta") {
            writeSse(response, completionChunk(runId, { content: event.assistantMessageEvent.delta }));
          } else if (event.assistantMessageEvent.type === "thinking_delta") {
            writeSse(response, completionChunk(runId, {
              reasoning_content: event.assistantMessageEvent.delta,
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
      await session.prompt(prompt.text, prompt.images.length > 0 ? { images: prompt.images } : undefined);
      const errorMessage = session.agent.state.errorMessage;
      if (errorMessage) throw new Error(errorMessage);
      writeSse(response, completionChunk(runId, {}, "stop"));
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
      run.session?.dispose();
      if (providerId && modelRuntime) {
        const remaining = (providerUsers.get(providerId) ?? 1) - 1;
        if (remaining > 0) providerUsers.set(providerId, remaining);
        else {
          providerUsers.delete(providerId);
          modelRuntime.unregisterProvider(providerId);
        }
      }
      runs.delete(runId);
      if (!response.destroyed && !response.writableEnded) response.end();
    }
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
    return { ok: true, status: 200 };
  };

  const dispose = async () => {
    await Promise.all(Array.from(runs.values()).map(async (run) => {
      settlePendingTools(run, new Error("Pi Host 已关闭"));
      await run.session?.abort();
      run.session?.dispose();
    }));
    runs.clear();
  };

  return { handleChat, handleToolResult, handleAbort, handleDeleteSession, dispose };
}
