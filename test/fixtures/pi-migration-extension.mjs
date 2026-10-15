import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const params = { type: "object", properties: { text: { type: "string" }, fail: { type: "boolean" }, count: { type: "integer", minimum: 1, maximum: 5, default: 1 } } };
const text = (value) => ({ content: [{ type: "text", text: String(value) }] });

export default function (pi) {
  let streamEvents = 0;
  const mcpFile = new URL("./migration-mcp.json", import.meta.url);
  if (existsSync(mcpFile)) pi.registerMcpServer("registered-server", JSON.parse(readFileSync(mcpFile, "utf8")));
  pi.registerTool({
    name: "audit_leaf", label: "Audit leaf", description: "Structured child operation", parameters: params,
    outputSchema: { type: "array", items: { type: "string" } },
    namespace: { name: "audit", aliases: ["audit-alias"], description: "Audit namespace" },
    async execute(_id, args, _signal, update) {
      update(text("child update"));
      return { ...text(args.text || "leaf"), structuredContent: [args.text || "leaf"], isError: args.fail === true,
        usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0.01, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 } } };
    },
  });
  pi.registerTool({
    name: "audit_parent", label: "Audit parent", description: "Calls another tool", parameters: params,
    reachesTools: ["audit_leaf"],
    async execute(_id, _args, _signal, _update, ctx) {
      const result = await ctx.executeTool("audit_leaf", { text: "nested failure", fail: true });
      return { ...text(JSON.stringify({ isError: result.isError, data: result.result.structuredContent })), details: result };
    },
  });
  pi.registerTool({ name: "audit_hidden", description: "Must stay hidden", exposure: "hidden", parameters: params, execute: async () => text("hidden") });
  pi.registerTool({ name: "audit_wait", description: "Wait for input", parameters: params, execute: async (_id, _args, _signal, _update, ctx) => { await ctx.ui.confirm("audit-queue-wait", "Wait"); return text("released"); } });
  pi.on("input", (event) => {
    if (event.text.startsWith("transform-queued")) return { action: "transform", text: "transformed queued input" };
    if (event.text.startsWith("handle-queued")) return { action: "handled" };
  });
  pi.on("before_agent_start", async (event, ctx) => {
    ctx.ui.notify(`audit-start:${event.messageType}:${ctx.isIdle() ? "idle" : "busy"}`);
    ctx.ui.notify(ctx.ui.theme.style("audit-theme", { fg: ctx.ui.theme.colors.accent }));
    if (event.messageType === "user" && event.prompt.includes("hold-start")) {
      await ctx.ui.confirm("audit-start-blocked", "Wait for cancellation");
    }
    if (event.messageType === "user" && event.prompt.includes("startup-messages")) {
      pi.sendMessage({ customType: "startup-notice", content: "CUSTOM_DURING_START", display: false }, { triggerTurn: true });
      pi.sendUserMessage("USER_DURING_START", { deliverAs: "steer" });
    }
    return { systemPrompt: "AUDIT_SETUP: keep this section throughout the run." };
  });
  pi.on("provider_stream_event", () => { streamEvents++; });
  pi.on("agent_settled", (event, ctx) => ctx.ui.notify(`audit-settled:${event.aborted}:${streamEvents}`));
  pi.on("session_shutdown", (event, ctx) => appendFileSync(join(ctx.cwd, "shutdown-events.txt"), `${event.reason}\n`));
  pi.on("session_start", (event, ctx) => { if (event.reason === "reload") ctx.ui.notify(`audit-reloaded:${pi.getActiveTools().join(",")}`); });
  pi.registerCommand("audit-trigger", { description: "Start a custom-message turn", handler: () => {
    pi.sendMessage({ customType: "next-turn", content: "NEXT_TURN_CONTEXT", display: false }, { deliverAs: "nextTurn" });
    pi.sendMessage({ customType: "audit-trigger", content: "Audit custom turn", display: false }, { triggerTurn: true });
  } });
  pi.registerCommand("audit-reload", { description: "Reload resources", handler: async (_args, ctx) => { await ctx.reload(); } });
  pi.registerCommand("audit-enable-codemode", { description: "Enable a newly configured default", handler: async (_args, ctx) => {
    const settingsFile = new URL("../agent/settings.json", import.meta.url);
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    writeFileSync(settingsFile, JSON.stringify({ ...settings, defaultTools: ["+codemode"] }));
    await ctx.reload();
  } });
  pi.registerCommand("audit-virtual", { description: "Route a virtual model", handler: async (_args, ctx) => {
    const physical = ctx.model;
    pi.registerVirtualModel({
      provider: physical.provider, id: "audit-virtual", name: "Audit virtual", contextWindow: 128000, maxTokens: 1024,
      route: (request) => ({ model: physical, thinkingLevel: "off", state: { routed: true, reason: request.reason } }),
    });
    if (!await pi.setModel(ctx.modelRegistry.find(physical.provider, "audit-virtual"))) throw new Error("Virtual model unavailable");
    pi.sendMessage({ customType: "audit-virtual", content: "Virtual model request", display: false }, { triggerTurn: true });
  } });
  pi.registerCommand("audit-model-operations", { description: "Use multi-operation provider APIs", handler: async (_args, ctx) => {
    pi.registerProvider("audit-operations", {
      baseUrl: "http://127.0.0.1/unused", apiKey: "operation-key", api: "openai-completions",
      models: [
        { type: "image", id: "image", name: "Image", api: "audit-image" },
        { type: "classifier", id: "classifier", name: "Classifier", api: "audit-classifier", contextWindow: 4096, input: ["text", "image"] },
      ],
      images: { "audit-image": { generateImages: async (model, _context, options) => ({ api: model.api, provider: model.provider, model: model.id, output: [], stopReason: options.apiKey === "operation-key" ? "stop" : "error", timestamp: Date.now() }) } },
      classifiers: { "audit-classifier": { classify: async (model, context, options) => ({ api: model.api, provider: model.provider, model: model.id, answers: {}, stopReason: options.apiKey === "operation-key" && context.images?.length === 1 ? "stop" : "error", timestamp: Date.now() }) } },
    });
    const models = ctx.modelRegistry;
    const image = models.findOfType("image", "audit-operations", "image");
    const classifier = models.findOfType("classifier", "audit-operations", "classifier");
    const generated = await models.generateImages(image, { input: [{ type: "text", text: "fixture image" }] });
    const classified = await models.classify(classifier, { state: {}, questions: {}, images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }] });
    ctx.ui.notify(`audit-operations:${generated.stopReason}:${classified.stopReason}`);
  } });
}
