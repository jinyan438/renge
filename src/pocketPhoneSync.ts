import { getPocketMessageIdentity, type PocketContextMessage } from "./pocketPhoneContext";
import { emptyPocketState, getPocketConversations, normalizePocketState, pocketStorageKey, type PocketContextDeletion, type PocketConversation, type PocketState } from "./pocketPhoneState";
import { applyRedContextChanges } from "./pocketXiaohongshuContext";
import { normalizeRedState, RED_CONTEXT_ID, redStorageKey } from "./pocketXiaohongshuState";

export type PocketContextChange = { contactId: string; messageId: string; content: string | null };
const messageKey = (contactId: string, messageId: string) => JSON.stringify([contactId, messageId]);

function mergeDeletions(previous: PocketContextDeletion[], added: PocketContextDeletion[]) {
  const keys = new Set(previous.map(item => messageKey(item.contactId, item.messageId)));
  const missing = added.filter(item => {
    const key = messageKey(item.contactId, item.messageId);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  return missing.length ? [...previous, ...missing] : previous;
}

export function recordPocketContextDeletions(previous: PocketState, next: PocketState): PocketState {
  const remaining = new Set(getPocketConversations(next).flatMap(contact => contact.messages.map(message => messageKey(contact.id, message.id))));
  const deleted = getPocketConversations(previous).flatMap(contact => contact.messages.filter(message => !remaining.has(messageKey(contact.id, message.id)))
    .map(message => ({ contactId: contact.id, messageId: message.id })));
  const deletedContextMessages = mergeDeletions(next.deletedContextMessages, deleted);
  return deletedContextMessages === next.deletedContextMessages ? next : { ...next, deletedContextMessages };
}

// Compare known mirrored records only. Unrelated main messages, restored records
// and phone messages not yet injected into the main history remain untouched.
export function getPocketContextChanges(previous: PocketContextMessage[], next: PocketContextMessage[]): PocketContextChange[] {
  const nextByKey = new Map(next.flatMap(message => {
    const identity = getPocketMessageIdentity(message);
    return identity ? [[messageKey(identity.contactId, identity.messageId), message.content] as const] : [];
  }));
  return previous.flatMap(message => {
    const identity = getPocketMessageIdentity(message);
    if (!identity) return [];
    const key = messageKey(identity.contactId, identity.messageId);
    const content = nextByKey.get(key) ?? null;
    return content === message.content ? [] : [{ contactId: identity.contactId, messageId: identity.messageId, content }];
  });
}

export function applyPocketContextChanges(state: PocketState, changes: PocketContextChange[]): PocketState {
  changes = changes.filter(change => change.contactId !== RED_CONTEXT_ID);
  if (!changes.length) return state;
  const byKey = new Map(changes.map(change => [messageKey(change.contactId, change.messageId), change.content]));
  const update = <T extends PocketConversation>(conversation: T): T => {
    let changed = false;
    let messages = conversation.messages.flatMap(message => {
      const key = messageKey(conversation.id, message.id);
      if (!byKey.has(key) || byKey.get(key) === message.content) return [message];
      changed = true;
      const content = byKey.get(key)!;
      return content === null ? [] : [{ ...message, content }];
    });
    if (!changed) return conversation;
    const remainingIds = new Set(messages.map(message => message.id));
    const repairMarker = (marker: string | undefined) => {
      if (!marker || remainingIds.has(marker)) return marker;
      const index = conversation.messages.findIndex(message => message.id === marker);
      if (index < 0) return marker;
      return conversation.messages.slice(0, index).reverse().find(message => remainingIds.has(message.id))?.id || "";
    };
    messages = messages.map(message => message.replyContextMessageId === undefined ? message : {
      ...message, replyContextMessageId: repairMarker(message.replyContextMessageId),
    });
    return { ...conversation, messages, ...("members" in conversation && conversation.replyContextMessageId !== undefined
      ? { replyContextMessageId: repairMarker(conversation.replyContextMessageId) } : {}) };
  };
  const contacts = state.contacts.map(update);
  const groups = state.groups.map(update);
  const deletedContextMessages = mergeDeletions(state.deletedContextMessages, changes.filter(change => change.content === null)
    .map(({ contactId, messageId }) => ({ contactId, messageId })));
  return deletedContextMessages !== state.deletedContextMessages || contacts.some((contact, index) => contact !== state.contacts[index]) || groups.some((group, index) => group !== state.groups[index])
    ? { ...state, contacts, groups, deletedContextMessages } : state;
}

const POCKET_CONTEXT_CHANGED = "renge:pocket-context-changed";
type PocketContextEvent = { sessionId: string; changes: PocketContextChange[]; storageWarning: string };

export function syncPocketPhoneFromContext(sessionId: string, previous: PocketContextMessage[], next: PocketContextMessage[]) {
  const changes = getPocketContextChanges(previous, next);
  if (!sessionId || !changes.length) return;
  let storageWarning = "";
  try {
    const key = pocketStorageKey(sessionId);
    const saved = localStorage.getItem(key);
    const state = saved ? normalizePocketState(JSON.parse(saved)) : emptyPocketState();
    const updated = applyPocketContextChanges(state, changes);
    if (updated !== state) localStorage.setItem(key, JSON.stringify(updated));
    const redKey = redStorageKey(sessionId);
    const redState = normalizeRedState(JSON.parse(localStorage.getItem(redKey) || "null"));
    const redUpdated = applyRedContextChanges(redState, changes);
    if (redUpdated !== redState) localStorage.setItem(redKey, JSON.stringify(redUpdated));
  } catch {
    storageWarning = "手机存储空间不足或不可用，这次改动暂未保存。请保留当前页面。";
  }
  // A mounted phone receives the same patch synchronously, without echoing it
  // back into the main timeline or overwriting its current drafts/settings.
  window.dispatchEvent(new CustomEvent<PocketContextEvent>(POCKET_CONTEXT_CHANGED, { detail: { sessionId, changes, storageWarning } }));
}

export function subscribePocketContextChanges(sessionId: string, receive: (changes: PocketContextChange[], storageWarning: string) => void) {
  const target = window;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PocketContextEvent>).detail;
    if (detail.sessionId === sessionId) receive(detail.changes, detail.storageWarning);
  };
  target.addEventListener(POCKET_CONTEXT_CHANGED, listener);
  return () => target.removeEventListener(POCKET_CONTEXT_CHANGED, listener);
}
