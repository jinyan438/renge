import { parentPort, workerData } from "node:worker_threads";
import { dirname } from "node:path";
import { readAppData, writeAppData, clearAppData } from "./app-data-store.mjs";
import { applyChatSessionPatch, createChatSessionVersionCache } from "./app-data-session-patch.mjs";

const path = workerData.path;
let queue = Promise.resolve();
let sessionVersions = createChatSessionVersionCache();

async function execute({ operation, payload }) {
  if (operation === "httpWrite") {
    let body = {};
    if (payload.body.byteLength) {
      try { body = JSON.parse(Buffer.from(payload.body.buffer, payload.body.byteOffset, payload.body.byteLength).toString("utf8")); }
      catch { throw new Error("请求体不是合法 JSON"); }
    }
    if (body === null) throw new Error("应用数据必须是 JSON 对象");
    const data = body && typeof body === "object" && "data" in body ? body.data : body;
    return payload.method === "PATCH" || body?.sessionPatch
      ? execute({ operation: "patch", payload: { data, sessionPatch: body?.sessionPatch } })
      : execute({ operation: "replace", payload: data ?? {} });
  }
  if (operation === "read" || operation === "httpRead" || operation === "characterChats") {
    const data = await readAppData(path);
    if (operation === "httpRead") return new TextEncoder().encode(JSON.stringify({ data, sessionVersions: sessionVersions(data.chatSessions), messagePatches: true, dataDir: dirname(path), dataFile: path }));
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
