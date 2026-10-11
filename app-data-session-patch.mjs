import { createHash } from "node:crypto";

export function getChatSessionVersions(sessions = []) {
  return Object.fromEntries(sessions.map((session) => [
    session.id, createHash("sha256").update(JSON.stringify(session)).digest("hex"),
  ]));
}

export function applyChatSessionPatch(sessions = [], patch) {
  if (!patch || !Array.isArray(patch.upserts) || !Array.isArray(patch.deletes)) {
    throw new Error("无效的会话增量保存请求");
  }
  const versions = getChatSessionVersions(sessions);
  const changes = [...patch.upserts.map((change) => ({ ...change, id: change.session?.id })), ...patch.deletes];
  const seen = new Set();
  for (const change of changes) {
    if (typeof change.id !== "string" || !change.id || seen.has(change.id) || !Object.hasOwn(change, "expectedVersion")) {
      throw new Error("无效或重复的会话 ID");
    }
    seen.add(change.id);
    if ((versions[change.id] ?? null) !== change.expectedVersion) {
      throw Object.assign(new Error("会话已被另一窗口修改。本页改动尚未保存，请先导出备份，再刷新并合并。"), {
        status: 409, sessionId: change.id,
      });
    }
  }
  const deleted = new Set(patch.deletes.map((change) => change.id));
  const upserts = new Map(patch.upserts.map((change) => [change.session.id, change.session]));
  const result = sessions.filter((session) => !deleted.has(session.id)).map((session) => {
    const replacement = upserts.get(session.id);
    upserts.delete(session.id);
    return replacement ?? session;
  });
  return [...result, ...upserts.values()];
}
