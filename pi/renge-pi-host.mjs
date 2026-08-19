import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
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

export function createRengePiHost({ defaultCwd = process.cwd() } = {}) {
  const runs = new Map();
  let modelRuntimePromise;

  const getModelRuntime = () => {
    modelRuntimePromise ??= ModelRuntime.create();
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
    const runId = String(body?.runId ?? "").trim() || crypto.randomUUID();
    if (runs.has(runId)) throw new Error("重复的 Pi runId");
    const provider = normalizePiProviderConfig(body);
    const requestBody = body?.request && typeof body.request === "object"
      ? body.request
      : {};
    const workspace = body.workspace && typeof body.workspace === "object" ? body.workspace : null;
    const cwd = workspace?.kind === "electron" && workspace.cwd
      ? resolve(String(workspace.cwd))
      : resolve(defaultCwd);
    const requestedToolDefinitions = Array.isArray(requestBody.tools)
      ? requestBody.tools
      : [];
    const nativeTools = requestedToolDefinitions.length > 0
      ? getPiNativeToolNames(workspace)
      : [];
    const customDefinitions = filterPiCustomToolDefinitions(requestedToolDefinitions, workspace);
    const customToolNames = new Set(
      customDefinitions.map((tool) => String(tool?.function?.name ?? "")).filter(Boolean),
    );

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
      kernel: "@earendil-works/pi-coding-agent@0.84.2",
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
      providerId = `renge-${runId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48)}`;
      modelRuntime = await getModelRuntime();
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
      const settingsManager = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: true },
      });
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: join(tmpdir(), "renge-pi-agent"),
        settingsManager,
        systemPromptOverride: () => converted.systemPrompt,
        appendSystemPromptOverride: () => [],
      });
      await resourceLoader.reload();
      const customTools = customDefinitions.map((definition) => createCustomTool(definition, run));
      const reasoningLevel = String(requestBody.reasoning_effort ?? "").trim();
      const thinkingLevel = ["minimal", "low", "medium", "high", "xhigh", "max"].includes(reasoningLevel)
        ? reasoningLevel
        : "off";
      const { session } = await createAgentSession({
        cwd,
        modelRuntime,
        model,
        thinkingLevel,
        tools: [...nativeTools, ...customToolNames],
        customTools,
        resourceLoader,
        settingsManager,
        sessionManager: SessionManager.inMemory(cwd),
      });
      run.session = session;
      session.agent.state.messages = converted.history;

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
      if (providerId && modelRuntime) modelRuntime.unregisterProvider(providerId);
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

  const dispose = async () => {
    await Promise.all(Array.from(runs.values()).map(async (run) => {
      settlePendingTools(run, new Error("Pi Host 已关闭"));
      await run.session?.abort();
      run.session?.dispose();
    }));
    runs.clear();
  };

  return { handleChat, handleToolResult, handleAbort, dispose };
}
