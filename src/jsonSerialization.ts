export type OffThreadJsonResponse = { ok: boolean; status: number; payload: unknown };
let sharedWorker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, { resolve: (response: OffThreadJsonResponse) => void; reject: (error: unknown) => void }>();

function getSerializationWorker() {
  if (sharedWorker) return sharedWorker;
  const worker = new Worker(new URL("./jsonSerialization.worker.ts", import.meta.url), { type: "module" });
  sharedWorker = worker;
  worker.onmessage = (event: MessageEvent<{ id: number; response?: OffThreadJsonResponse; error?: string }>) => {
    const request = pending.get(event.data.id);
    pending.delete(event.data.id);
    if (event.data.error) request?.reject(new Error(event.data.error));
    else if (event.data.response) request?.resolve(event.data.response);
    else request?.reject(new Error("应用数据保存未返回结果"));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    if (sharedWorker !== worker) return;
    sharedWorker = null;
    worker.terminate();
    // A write may already have committed. Reject instead of replaying it.
    const error = new Error(event.message || "应用数据保存线程异常");
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  return worker;
}

/** Serialize AND send in the worker. Returning a large JSON string to fetch on
 * the UI thread still blocks native input while Chromium encodes its body.
 * Reuse the worker so checkpoints do not repeatedly create rendering threads;
 * its handlers release each incremental payload as soon as the request ends. */
export function sendJsonOffThread(url: string, method: "PATCH" | "PUT", value: unknown): Promise<OffThreadJsonResponse> {
  const fallback = async () => {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    return { ok: response.ok, status: response.status, payload: await response.json().catch(() => ({})) };
  };
  if (typeof Worker !== "function") return fallback();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = getSerializationWorker();
    } catch {
      void fallback().then(resolve, reject);
      return;
    }
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, url, method, value });
    } catch (error) {
      pending.delete(id);
      // JSON allows functions/undefined in legacy extension data; structured clone does not.
      if (error instanceof DOMException && error.name === "DataCloneError") void fallback().then(resolve, reject);
      else reject(error);
    }
  });
}
