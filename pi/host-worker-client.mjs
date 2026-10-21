import { SHARE_ENV, Worker } from "node:worker_threads";

/** Keep SDK session loading, token estimation and provider encoding off the
 * Electron main loop. Native tool approval stays on its original UI thread. */
export function createRengePiWorkerHost({ authorizeTool, ...options } = {}) {
  let worker = null, sequence = 0, disposed = false, disposal;
  const pending = new Map(), approvals = new Map();
  const send = (target, message) => { try { target.postMessage(message); } catch { /* closing */ } };
  const start = () => {
    if (worker) return worker;
    const target = new Worker(new URL("./host-worker.mjs", import.meta.url), { env: SHARE_ENV, workerData: { options, authorize: typeof authorizeTool === "function" } });
    worker = target;
    const fail = (error) => {
      if (worker !== target) return;
      worker = null;
      for (const controller of approvals.values()) controller.abort();
      approvals.clear();
      for (const request of pending.values()) { request.cleanup(); request.reject(error); request.response?.destroy(error); }
      pending.clear();
    };
    target.on("error", fail);
    target.on("exit", (code) => fail(new Error(`Pi host worker exited (${code})`)));
    target.on("message", (message) => {
      if (worker !== target) return;
      if (message.type === "authorize") {
        const controller = new AbortController();
        approvals.set(message.id, controller);
        void Promise.resolve().then(() => authorizeTool({ ...message.payload, signal: controller.signal })).then(
          () => send(target, { type: "authorization", id: message.id }),
          (error) => send(target, { type: "authorization", id: message.id, error: error instanceof Error ? error.message : String(error) }),
        ).finally(() => { if (approvals.get(message.id) === controller) approvals.delete(message.id); });
        return;
      }
      if (message.type === "cancelAuthorization") { approvals.get(message.id)?.abort(); return; }
      const request = pending.get(message.id);
      if (!request) return;
      if (message.type === "head") { request.response.writeHead(message.status, message.headers); return; }
      if (message.type === "data") {
        if (!request.response.destroyed) request.response.write(Buffer.from(message.bytes.buffer, message.bytes.byteOffset, message.bytes.byteLength));
        return;
      }
      if (message.type === "end") { request.response.end(); return; }
      request.cleanup();
      pending.delete(message.id);
      if (!pending.size) target.unref();
      if (message.error) request.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else request.resolve(message.result);
    });
    target.unref();
    return target;
  };
  const call = (method, args = [], response) => {
    if (disposed) return Promise.reject(new Error("Pi Host 已关闭"));
    const target = start(), id = ++sequence;
    return new Promise((resolve, reject) => {
      const close = () => { if (!response.writableEnded) send(target, { type: "cancel", id }); };
      const cleanup = () => response?.off("close", close);
      pending.set(id, { resolve, reject, response, cleanup });
      response?.once("close", close);
      target.ref();
      try { target.postMessage({ type: "call", id, method, args }); }
      catch (error) { cleanup(); pending.delete(id); if (!pending.size) target.unref(); reject(error); }
    });
  };
  return {
    ...Object.fromEntries(["handleToolResult", "handleAbort", "handleInput", "handleCompact", "handleSetAutoCompaction", "handleSessionActivity", "handleDeleteSession", "installPiPackage", "updatePiPackage", "setPiPackageEnabled", "removePiPackage"].map((method) => [method, (...args) => call(method, args)])),
    handleChat: (body, _request, response) => call("handleChat", [body], response),
    dispose: () => disposal ??= (async () => {
      try { if (worker) await call("dispose"); }
      finally {
        disposed = true;
        for (const controller of approvals.values()) controller.abort();
        await worker?.terminate();
      }
    })(),
  };
}
