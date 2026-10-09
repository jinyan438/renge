import { getPocketMessageIdentity, type PocketContextMessage } from "./pocketPhoneContext";
import { emptyPocketState, getPocketConversations, normalizePocketState, pocketStorageKey, type PocketContextDeletion, type PocketConversation, type PocketGroupMember, type PocketState } from "./pocketPhoneState";
import { applyRedContextChanges } from "./pocketXiaohongshuContext";
import { normalizeRedState, RED_CONTEXT_ID, redStorageKey } from "./pocketXiaohongshuState";
import { getPocketContextRecords } from "./pocketPhoneInner";
import { applyPocketNoteChanges, pocketNotesContextId } from "./pocketNotesState";
import { applyPocketMomentChanges, pocketMomentsConversation, POCKET_MOMENTS_ID, type PocketMoment } from "./pocketMomentsState";

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
  const remaining = new Set(getPocketConversations(next).flatMap(contact => getPocketContextRecords(contact).map(message => messageKey(contact.id, message.id))));
  const deleted = getPocketConversations(previous).flatMap(contact => getPocketContextRecords(contact).filter(message => !remaining.has(messageKey(contact.id, message.id)))
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
  const moments = state.moments ? applyPocketMomentChanges(state.moments, changes.filter(change => change.contactId === POCKET_MOMENTS_ID)) : state.moments;
  const update = <T extends PocketConversation>(conversation: T): T => {
    let changed = false;
    let messages = conversation.messages.flatMap(message => {
      const key = messageKey(conversation.id, message.id);
      if (!byKey.has(key) || byKey.get(key) === message.content) return [message];
      changed = true;
      const content = byKey.get(key)!;
      return content === null ? [] : [{ ...message, content }];
    });
    const innerHistory = conversation.innerHistory?.flatMap(entry => {
      const key = messageKey(conversation.id, `inner:${entry.id}`);
      if (!byKey.has(key) || byKey.get(key) === entry.content) return [entry];
      changed = true;
      const content = byKey.get(key)!;
      return content === null ? [] : [{ ...entry, content }];
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
    return { ...conversation, messages, ...(innerHistory ? { innerHistory } : {}), ...("members" in conversation && conversation.replyContextMessageId !== undefined
      ? { replyContextMessageId: repairMarker(conversation.replyContextMessageId) } : {}) };
  };
  const updatedContacts = state.contacts.map(update);
  const updatedGroups = state.groups.map(update);
  const oldInner = getPocketConversations(state).flatMap(conversation => (conversation.innerHistory || []).map(entry => ({ entry, key: messageKey(conversation.id, `inner:${entry.id}`) }))).filter(item => byKey.has(item.key));
  const remainingInner = [...updatedContacts, ...updatedGroups].flatMap(conversation => conversation.innerHistory || []);
  const refreshInner = <T extends PocketGroupMember>(person: T): T => {
    const current = person.innerState;
    const changed = current && oldInner.find(item => item.entry.speaker.id === person.id && item.entry.createdAt === current.updatedAt && item.entry.content === current.monologue);
    if (!changed) return person;
    const replacement = byKey.get(changed.key);
    const content = replacement ?? remainingInner.filter(entry => entry.speaker.id === person.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)?.content;
    if (content === current.monologue) return person;
    return { ...person, innerState: content ? { ...current, monologue: content } : undefined };
  };
  const contacts = updatedContacts.map(refreshInner);
  const groups = updatedGroups.map(group => {
    const members = group.members.map(refreshInner);
    return members.every((member, index) => member === group.members[index]) ? group : { ...group, members };
  });
  const deletedContextMessages = mergeDeletions(state.deletedContextMessages, changes.filter(change => change.content === null)
    .map(({ contactId, messageId }) => ({ contactId, messageId })));
  let nestedChanged = false;
  const characterPhones = state.characterPhones ? Object.fromEntries(Object.entries(state.characterPhones).map(([id, phone]) => {
    const ids = new Set([...phone.contacts, ...phone.groups].map(contact => contact.id));
    const relevant = changes.filter(change => ids.has(change.contactId));
    const noteChanges = changes.filter(change => change.contactId === pocketNotesContextId(id));
    const previousNotes = phone.notes || [];
    const notes = applyPocketNoteChanges(previousNotes, noteChanges);
    if (!relevant.length && !noteChanges.length) return [id, phone];
    const base = { ...emptyPocketState(), contacts: phone.contacts, groups: phone.groups };
    const next = applyPocketContextChanges(base, relevant);
    if (next === base && notes === previousNotes) return [id, phone];
    nestedChanged = true;
    return [id, { ...phone, contacts: next.contacts, groups: next.groups, notes }];
  })) : undefined;
  const next = nestedChanged || moments !== state.moments || deletedContextMessages !== state.deletedContextMessages || contacts.some((contact, index) => contact !== state.contacts[index]) || groups.some((group, index) => group !== state.groups[index])
    ? { ...state, contacts, groups, deletedContextMessages, ...(state.moments ? { moments } : {}), ...(characterPhones ? { characterPhones } : {}) } : state;
  return moments !== state.moments ? recordPocketContextDeletions(state, next) : next;
}

const POCKET_CONTEXT_CHANGED = "renge:pocket-context-changed";
type PocketContextEvent = { sessionId: string; changes: PocketContextChange[]; storageWarning: string };

// A main-chat post edit also updates the topic carried by its interactions.
// Removing the post removes its dependent records immediately, even with the
// phone closed. Unrelated or restored records absent locally stay untouched.
export function reconcilePocketMomentsContext<T extends PocketContextMessage>(history: T[], previous: PocketMoment[], posts: PocketMoment[]): T[] {
  const before = new Set(pocketMomentsConversation(previous).messages.map(message => message.id));
  const current = new Map(pocketMomentsConversation(posts).messages.map(message => [message.id, message]));
  let changed = false;
  const next = history.flatMap(message => {
    const identity = getPocketMessageIdentity(message);
    if (identity?.contactId !== POCKET_MOMENTS_ID) return [message];
    const record = current.get(identity.messageId);
    if (!record) { if (before.has(identity.messageId)) { changed = true; return []; } return [message]; }
    if (message.content === record.content && JSON.stringify(message.extra?.pocketMoment) === JSON.stringify(record.moment)) return [message];
    changed = true;
    return [{ ...message, content: record.content, extra: { ...message.extra, pocketMoment: record.moment } }];
  });
  return changed ? next : history;
}

export function syncPocketPhoneFromContext<T extends PocketContextMessage>(sessionId: string, previous: T[], next: T[]): T[] {
  const changes = getPocketContextChanges(previous, next);
  if (!sessionId || !changes.length) return next;
  let storageWarning = "";
  let reconciled = next;
  try {
    const key = pocketStorageKey(sessionId);
    const saved = localStorage.getItem(key);
    const state = saved ? normalizePocketState(JSON.parse(saved)) : emptyPocketState();
    const updated = applyPocketContextChanges(state, changes);
    if (updated.moments !== state.moments) reconciled = reconcilePocketMomentsContext(next, state.moments || [], updated.moments || []);
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
  return reconciled;
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
