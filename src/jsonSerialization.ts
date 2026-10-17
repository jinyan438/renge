/** Release the temporary worker and its copy of history as soon as a save finishes. */
export function serializeJsonOffThread(value: unknown): Promise<string> {
  if (typeof Worker !== "function") return Promise.resolve(JSON.stringify(value));
  return new Promise((resolve, reject) => {
    const fallback = () => {
      try { resolve(JSON.stringify(value)); } catch (error) { reject(error); }
    };
    let worker: Worker;
    try {
      worker = new Worker(new URL("./jsonSerialization.worker.ts", import.meta.url), { type: "module" });
    } catch {
      fallback();
      return;
    }
    worker.onmessage = (event: MessageEvent<{ json?: string; error?: string }>) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.json ?? "null");
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      fallback();
    };
    try {
      worker.postMessage(value);
    } catch (error) {
      worker.terminate();
      // JSON allows functions/undefined in legacy extension data; structured clone does not.
      if (error instanceof DOMException && error.name === "DataCloneError") resolve(JSON.stringify(value));
      else reject(error);
    }
  });
}
