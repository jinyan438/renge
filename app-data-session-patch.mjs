import { createHash } from "node:crypto";

export function getChatSessionVersions(sessions = []) {
  return createChatSessionVersionCache()(sessions);
}

/** Opaque versions include metadata, message content and order. The store owns
 * immutable snapshots, so unchanged large messages need hashing only once. */
export function createChatSessionVersionCache() {
  const messageHashes = new WeakMap();
  const sessionHashes = new WeakMap();
  const messageHash = (message) => {
    if (message && typeof message === "object" && messageHashes.has(message)) return messageHashes.get(message);
    const hash = createHash("sha256").update(JSON.stringify(message) ?? "null").digest("hex");
    if (message && typeof message === "object") messageHashes.set(message, hash);
    return hash;
  };
  return (sessions = []) => Object.fromEntries(sessions.map((session) => {
    let version = sessionHashes.get(session);
    if (!version) {
      const messages = session.messages;
      const metadata = Array.isArray(messages) ? { ...session, messages: undefined } : session;
      const hash = createHash("sha256").update("session-v2\0").update(JSON.stringify(metadata)).update("\0");
      if (Array.isArray(messages)) hash.update(JSON.stringify(messages.map(messageHash)));
      version = hash.digest("hex");
      sessionHashes.set(session, version);
    }
    return [session.id, version];
  }));
}

export function applyChatSessionPatch(sessions = [], patch, knownVersions) {
  if (!patch || !Array.isArray(patch.upserts) || !Array.isArray(patch.deletes)) {
    throw new Error("无效的会话增量保存请求");
  }
  const versions = knownVersions ?? getChatSessionVersions(sessions);
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
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const upserts = new Map(patch.upserts.map((change) => {
    let session = change.session;
    if (change.messagesPatch) {
      const previous = byId.get(session.id);
      const { order, upserts } = change.messagesPatch;
      if (!previous || !Array.isArray(previous.messages) || !Array.isArray(order) || !Array.isArray(upserts) ||
        order.some((id) => typeof id !== "string" || !id) || new Set(order).size !== order.length ||
        upserts.some((message) => !message || typeof message.id !== "string" || !order.includes(message.id)) ||
        new Set(upserts.map((message) => message.id)).size !== upserts.length) throw new Error("无效的消息增量保存请求");
      const messages = new Map(previous.messages.map((message) => [message.id, message]));
      for (const message of upserts) messages.set(message.id, message);
      if (order.some((id) => !messages.has(id))) throw new Error("消息增量引用不存在的消息");
      session = { ...session, messages: order.map((id) => messages.get(id)) };
    }
    return [session.id, session];
  }));
  const result = sessions.filter((session) => !deleted.has(session.id)).map((session) => {
    const replacement = upserts.get(session.id);
    upserts.delete(session.id);
    return replacement ?? session;
  });
  return [...result, ...upserts.values()];
}
