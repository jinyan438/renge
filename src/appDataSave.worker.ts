import { sendAppDataJson } from "./appDataSaveTransport";
import { applyAppDataSavePart, type AppDataSavePart } from "./appDataSaveChunks";

type SaveMessage = { id: number; action: string; url: string; method: string; part: AppDataSavePart };
const jobs = new Map<number, { url: string; method: string; data: unknown }>();
self.onmessage = async (event: MessageEvent<SaveMessage>) => {
  const { id, action, url, method, part } = event.data;
  try {
    if (action === "begin") { jobs.set(id, { url, method, data: undefined }); return; }
    const job = jobs.get(id);
    if (!job) return;
    if (action === "part") { job.data = applyAppDataSavePart(job.data, part); return; }
    jobs.delete(id);
    if (action === "commit") self.postMessage({ id, result: await sendAppDataJson(job.url, job.method, job.data) });
  } catch (error) {
    jobs.delete(id);
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
self.postMessage({ ready: true });
