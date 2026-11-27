import { parentPort, workerData } from "node:worker_threads";
import { dirname } from "node:path";
import { readAppData, writeAppData, clearAppData, serializeAppDataChunks } from "./app-data-store.mjs";
import { applyChatSessionPatch, createChatSessionVersionCache } from "./app-data-session-patch.mjs";

const path = workerData.path;
const STREAM_CHUNK_BYTES = 256 * 1024;
let queue = Promise.resolve();
let sessionVersions = createChatSessionVersionCache();

function* serializeHttpReadResponse(data, filePath) {
  yield Buffer.from('{"data":', "utf8");
  yield* serializeAppDataChunks(data);
  const tail = JSON.stringify({
    sessionVersions: sessionVersions(data.chatSessions),
    messagePatches: true,
    dataDir: dirname(filePath),
    dataFile: filePath,
  });
  yield Buffer.from(`,${tail.slice(1)}`, "utf8");
}

function packChunksToUint8Array(chunks, totalBytes) {
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function execute({ operation, payload }) {
  if (operation === "httpWrite") {
    let body = {};
    if (payload.body.byteLength) {
      try { body = JSON.parse(Buffer.from(payload.body.buffer, payload.body.byteOffset, payload.body.byteLength).toString("utf8")); }
      catch { throw new Error("请求体不是合法 JSON"); }
    }
    // Release transferred request buffer before applying potentially large patches.
    payload.body = null;
    if (body === null) throw new Error("应用数据必须是 JSON 对象");
    const data = body && typeof body === "object" && "data" in body ? body.data : body;
    return payload.method === "PATCH" || body?.sessionPatch
      ? execute({ operation: "patch", payload: { data, sessionPatch: body?.sessionPatch } })
      : execute({ operation: "replace", payload: data ?? {} });
  }
  if (operation === "httpStreamRead") {
    const port = payload.port;
    let cancelled = false;
    let resumeNext = null;
    port.on("message", (signal) => {
      if (signal === "cancel") cancelled = true;
      const resume = resumeNext;
      resumeNext = null;
      resume?.();
    });
    try {
      const data = await readAppData(path);
      const pendingChunks = [];
      let pendingBytes = 0;
      const flushChunk = async () => {
        if (!pendingBytes || cancelled) return;
        const chunk = packChunksToUint8Array(pendingChunks, pendingBytes);
        pendingChunks.length = 0;
        pendingBytes = 0;
        const waitNext = new Promise((resolve) => { resumeNext = resolve; });
        port.postMessage({ chunk }, [chunk.buffer]);
        await waitNext;
      };
      for (const piece of serializeHttpReadResponse(data, path)) {
        if (cancelled) break;
        pendingChunks.push(piece);
        pendingBytes += piece.byteLength;
        if (pendingBytes >= STREAM_CHUNK_BYTES) await flushChunk();
      }
      await flushChunk();
      if (!cancelled) port.postMessage({ end: true });
    } catch (error) {
      if (!cancelled) {
        port.postMessage({ error: { message: error.message, status: error.status, code: error.code } });
      }
    } finally {
      port.close();
    }
    return;
  }
  if (operation === "read" || operation === "httpRead" || operation === "characterChats") {
    const data = await readAppData(path);
    if (operation === "httpRead") {
      const chunks = [];
      let totalBytes = 0;
      for (const piece of serializeHttpReadResponse(data, path)) {
        chunks.push(piece);
        totalBytes += piece.byteLength;
      }
      return packChunksToUint8Array(chunks, totalBytes);
    }
    if (operation === "characterChats") {
      const card = data.characterCards?.find((card) => card.avatarDataUrl === payload || `${card.id}.png` === payload);
      return card ? (data.chatSessions ?? []).filter((session) => session.roleplayCharacterCardId === card.id).map((session) => ({ file_name: `${session.id}.jsonl` })) : [];
    }
    return payload ? Object.fromEntries(payload.map((key) => [key, data[key]])) : data;
  }
  if (operation === "clear") {
    await clearAppData(path); sessionVersions = createChatSessionVersionCache();
    return;
  }
  if (operation === "removeExtension") {
    await writeAppData(path, (data) => ({ ...data, extensions: Array.isArray(data.extensions) ? data.extensions.filter((extension) => extension?.id !== payload) : [] }));
    return;
  }
  if (operation === "replace") {
    await writeAppData(path, payload);
    return sessionVersions(payload.chatSessions);
  }
  if (operation === "patch") {
    let next;
    await writeAppData(path, (data) => {
      const patch = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : {};
      if (Object.hasOwn(patch, "chatSessions")) throw Object.assign(new Error("请使用带版本校验的会话增量保存，刷新页面后重试。"), { status: 409 });
      const sessions = payload.sessionPatch ? applyChatSessionPatch(data.chatSessions, payload.sessionPatch, sessionVersions(data.chatSessions)) : undefined;
      next = { ...data, ...patch, ...(sessions ? { chatSessions: sessions } : {}) };
      return next;
    });
    return sessionVersions(next.chatSessions);
  }
  throw new Error(`Unknown app-data operation: ${operation}`);
}

parentPort.on("message", (request) => {
  queue = queue.catch(() => undefined).then(async () => {
    try {
      const result = await execute(request);
      parentPort.postMessage({ id: request.id, result }, result instanceof Uint8Array ? [result.buffer] : []);
    } catch (error) {
      parentPort.postMessage({ id: request.id, error: { message: error.message, status: error.status, code: error.code } });
    }
  });
});
