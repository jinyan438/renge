import { parentPort, workerData } from "node:worker_threads";
import { EventEmitter } from "node:events";
import { createRengePiHost } from "./renge-pi-host.mjs";

const approvals = new Map(), streams = new Map();
let sequence = 0;
const host = createRengePiHost({ ...workerData.options, ...(workerData.authorize ? { authorizeTool: ({ signal, ...payload }) => {
  if (signal?.aborted) return Promise.reject(new Error("操作已中止"));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const abort = () => {
      approvals.delete(id);
      parentPort.postMessage({ type: "cancelAuthorization", id });
      reject(new Error("操作已中止"));
    };
    approvals.set(id, { resolve, reject, cleanup: () => signal?.removeEventListener("abort", abort) });
    signal?.addEventListener("abort", abort, { once: true });
    parentPort.postMessage({ type: "authorize", id, payload });
  });
} } : {}) });

class StreamResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  constructor(id) { super(); this.id = id; }
  writeHead(status, headers) { parentPort.postMessage({ type: "head", id: this.id, status, headers }); return this; }
  write(value) {
    if (this.destroyed || this.writableEnded) return false;
    const bytes = new TextEncoder().encode(value);
    parentPort.postMessage({ type: "data", id: this.id, bytes }, [bytes.buffer]);
    return true;
  }
  end(value) {
    if (this.writableEnded) return;
    if (value) this.write(value);
    this.writableEnded = true;
    parentPort.postMessage({ type: "end", id: this.id });
  }
  cancel() { this.destroyed = true; this.emit("close"); }
}

parentPort.on("message", async (message) => {
  if (message.type === "authorization") {
    const approval = approvals.get(message.id);
    if (!approval) return;
    approvals.delete(message.id); approval.cleanup();
    if (message.error) approval.reject(new Error(message.error)); else approval.resolve();
    return;
  }
  if (message.type === "cancel") { streams.get(message.id)?.cancel(); return; }
  if (message.type !== "call") return;
  const callId = message.id;
  const method = message.method;
  const args = Array.isArray(message.args) ? message.args : [];
  message.args = null;
  try {
    let result;
    if (method === "handleChat") {
      const chatBody = args[0];
      args.length = 0;
      const response = new StreamResponse(callId);
      streams.set(callId, response);
      result = await host.handleChat(chatBody, new EventEmitter(), response);
    } else {
      result = await host[method](...args);
      args.length = 0;
    }
    parentPort.postMessage({ id: callId, result });
  } catch (error) {
    parentPort.postMessage({ id: callId, error: { message: error instanceof Error ? error.message : String(error), code: error?.code } });
  } finally { streams.delete(callId); }
});
