import { exceedsJsonStringBudget } from "./appDataPersistenceUtils";
import { sendAppDataJson, type AppDataSaveResult } from "./appDataSaveTransport";
import { splitAppDataSave } from "./appDataSaveChunks";

type PendingSave = { resolve: (result: AppDataSaveResult) => void; reject: (error: Error) => void };
let nextId = 0;
let workerReady: Promise<Worker | null> | undefined;
const pendingSaves = new Map<number, PendingSave>();
// Tavern scripts temporarily wrap host timers and clear their owned callbacks
// on teardown. A card switch must never cancel an awaited persistence yield.
const scheduleTimeout = window.setTimeout.bind(window);
const cancelTimeout = window.clearTimeout.bind(window);

function getSaveWorker() {
  if (workerReady) return workerReady;
  workerReady = new Promise(resolve => {
    if (typeof Worker !== "function") { resolve(null); return; }
    let worker: Worker;
    try { worker = new Worker(new URL("./appDataSave.worker.ts", import.meta.url), { type: "module" }); }
    catch { resolve(null); return; }
    let ready = false;
    const disable = () => {
      cancelTimeout(timer);
      worker.terminate();
      // Retrying a request after its worker sent it could duplicate a write.
      // Only future saves use the fallback after an in-flight worker failure.
      pendingSaves.forEach(save => save.reject(new Error("后台保存线程不可用，请重试保存。")));
      pendingSaves.clear();
      workerReady = Promise.resolve(null);
      resolve(null);
    };
    const timer = scheduleTimeout(disable, 5000);
    worker.onerror = event => { event.preventDefault(); disable(); };
    worker.onmessageerror = disable;
    worker.onmessage = (event: MessageEvent<{ ready?: boolean; id: number; result: AppDataSaveResult; error?: string }>) => {
      if (event.data.ready) {
        ready = true;
        cancelTimeout(timer);
        resolve(worker);
        return;
      }
      if (!ready) return;
      const save = pendingSaves.get(event.data.id);
      if (!save) return;
      pendingSaves.delete(event.data.id);
      if (event.data.error) save.reject(new Error(event.data.error));
      else save.resolve(event.data.result);
    };
  });
  return workerReady;
}

export async function sendAppDataSave(method: string, data: unknown) {
  const url = new URL("/api/app-data", window.location.href).href;
  // Small incremental saves stay cheap. Large saves must not encode their
  // JSON/UTF-8 request body on the same thread as the rendered character card.
  if (!exceedsJsonStringBudget(data, 256 * 1024)) return sendAppDataJson(url, method, data);
  const worker = await getSaveWorker();
  if (!worker) return sendAppDataJson(url, method, data);
  const id = ++nextId;
  return new Promise<AppDataSaveResult>((resolve, reject) => {
    pendingSaves.set(id, { resolve, reject });
    void (async () => {
      try {
        worker.postMessage({ id, action: "begin", url, method });
        let yieldAt = performance.now() + 8;
        for (const part of splitAppDataSave(data)) {
          if (!pendingSaves.has(id)) return;
          worker.postMessage({ id, action: "part", part });
          if (performance.now() >= yieldAt) {
            await new Promise<void>(resume => scheduleTimeout(resume, 0));
            yieldAt = performance.now() + 8;
          }
        }
        if (pendingSaves.has(id)) worker.postMessage({ id, action: "commit" });
      } catch {
        if (!pendingSaves.has(id)) return;
        // No request is sent before commit. Unsupported clone/toJSON values
        // can therefore use the existing JSON path without a duplicate write.
        pendingSaves.delete(id);
        try { worker.postMessage({ id, action: "cancel" }); } catch { /* Worker already stopped. */ }
        void sendAppDataJson(url, method, data).then(resolve, reject);
      }
    })();
  });
}
