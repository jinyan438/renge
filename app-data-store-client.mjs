import { Worker } from "node:worker_threads";

// The Electron main process also hosts HTTP and tool approval. JSON parsing,
// hashing and checkpointing large histories must never block those UI services.
const stores = new Map();
export function retainAppDataStore(path) {
  const store = stores.get(path) ?? { references: 0, worker: null, pending: new Map(), sequence: 0 };
  store.references++; stores.set(path, store);
}
export function releaseAppDataStore(path) {
  const store = stores.get(path);
  if (!store || --store.references > 0) return;
  stores.delete(path);
  void store.worker?.terminate();
}
export function requestAppDataStore(path, operation, payload, transfer = []) {
  const store = stores.get(path);
  if (!store) return Promise.reject(new Error("App-data store is closed"));
  if (!store.worker) {
    const worker = new Worker(new URL("./app-data-store-worker.mjs", import.meta.url), { workerData: { path } });
    store.worker = worker;
    worker.on("message", ({ id, result, error }) => {
      const pending = store.pending.get(id);
      store.pending.delete(id);
      if (!store.pending.size) worker.unref();
      if (error) pending?.reject(Object.assign(new Error(error.message), error));
      else pending?.resolve(result);
    });
    const failed = (error) => {
      if (store.worker !== worker) return;
      store.worker = null;
      for (const pending of store.pending.values()) pending.reject(error);
      store.pending.clear();
    };
    worker.on("error", failed);
    worker.on("exit", (code) => failed(new Error(`App-data worker exited (${code})`)));
    worker.unref();
  }
  return new Promise((resolve, reject) => {
    const id = ++store.sequence;
    store.pending.set(id, { resolve, reject });
    try { store.worker.ref(); store.worker.postMessage({ id, operation, payload }, transfer); }
    catch (error) { store.pending.delete(id); if (!store.pending.size) store.worker.unref(); reject(error); }
  });
}
export const readAppData = (path, sections) => requestAppDataStore(path, "read", sections);
export const writeAppData = (path, data) => requestAppDataStore(path, "replace", data);
export const clearAppData = (path) => requestAppDataStore(path, "clear");
