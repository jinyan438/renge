import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowLeft, BatteryFull, CalendarDays, Check, ChevronRight, Compass, Heart, Image as ImageIcon, MapPin, MessageCircle, Mic, MoreHorizontal, Plus, Search, Send, Settings, Signal, Sparkles, Square, UserRound, UserRoundPlus, Users, Wallet, Wifi, X } from "lucide-react";
import type { CharacterCard } from "./characterCardUtils";
import { PocketFriendPicker, type PocketFriendMode } from "./PocketFriendPicker";
import { availablePocketFriends, pocketFriendName, type PocketFriendContextBuilder, type PocketFriendProfile } from "./pocketFriendGeneration";
import { changedPocketLibraryContacts, changePocketFriendLibrary, loadPocketFriendLibrary, mergePocketLibraryContacts, subscribePocketFriendLibrary } from "./pocketFriendLibrary";
import type { AgentPersona } from "./types";
import { DEFAULT_POCKET_AVATAR, DEFAULT_POCKET_USER_AVATAR, emptyPocketState, getPocketConversations, getPocketGenerationMode, getPocketConversationBubbles, isPocketGroup, makePocketContact, normalizePocketState, pocketDisplayName, pocketId, pocketSpeakerName, pocketStorageKey, POCKET_AVATARS, POCKET_THEMES, resetPocketContactChat, safePocketAvatar, type PocketContact, type PocketConversation, type PocketGroup, type PocketGroupMember, type PocketMessage, type PocketSettings, type PocketState } from "./pocketPhoneState";
import { makePocketGroup, pocketGroupMember, resetPocketGroupChat, resolvePocketGroup } from "./pocketPhoneGroup";
import type { PocketContextSync, PocketConversationBuilder } from "./pocketPhoneContext";
import type { PocketRequestMessage } from "./pocketPhoneState";
import { requestPocketReply, requestPocketWechatTurn, resolvePocketModel, type PocketProvider } from "./pocketPhoneChat";
import { applyCharacterPhoneGeneration, characterPhoneGenerationPrompt, characterPhoneView, commitCharacterPhoneView, syncCharacterPhoneWallets } from "./pocketCharacterPhone";
import { applyPocketContextChanges, recordPocketContextDeletions, subscribePocketContextChanges } from "./pocketPhoneSync";
import "./pocket-phone.css";
import { PocketXiaohongshu } from "./PocketXiaohongshu";
import { getRedRoles } from "./pocketXiaohongshuGeneration";
import { normalizeRedState, redStorageKey, type RedActor } from "./pocketXiaohongshuState";
import { redContextConversation } from "./pocketXiaohongshuContext";
import { addRedWechatFriend, syncRedWechatNicknames } from "./pocketXiaohongshuFriend";
import { applyPocketInnerTurns, PocketWechatFormatError, type PocketInnerEntry, type PocketInnerState } from "./pocketPhoneInner";
import { PocketPhoneInner } from "./PocketInnerDialog";
import { PocketWechatWallet, type PocketWalletPage } from "./PocketWechatWallet";
import { PocketWechatAttachDialog, PocketWechatMessage } from "./PocketWechatAttachments";
import { appendPocketAttachment, applyPocketTransferReplies, editPocketBalance, pocketMessagePreview, pocketReplyMessages, settlePocketTransfer, type PocketAttachment } from "./pocketWechatMedia";
import { ensurePocketWechatClock, pocketWechatMessageTime, pocketWechatNow, pocketWechatTimePrompt, stampPocketWechatTimes } from "./pocketWechatClock";
import { subscribePocketWechatClock } from "./pocketWechatClockSync";
import { PocketCalendar } from "./PocketCalendar";
import { jumpPocketCalendarClock, type PocketCalendarJump } from "./pocketCalendarState";
import { PocketNotes } from "./PocketNotes";
import { applyPocketNotesGeneration, makePocketNote, pocketNotesConversation, pocketNotesGenerationPrompt } from "./pocketNotesState";
import { PocketWechatMoments } from "./PocketWechatMoments";
import { PocketPhoneSettings } from "./PocketPhoneSettings";
import { loadGlobalPocketPrompts, saveGlobalPocketPrompts, subscribeGlobalPocketPrompts } from "./pocketPhonePromptStorage";
import type { PocketPromptOverrides } from "./pocketPhonePrompts";
import { addPocketMomentComment, applyPocketMomentsGeneration, applyPocketMomentsInteraction, canSeePocketMoment, makePocketMoment, normalizePocketMoments, pocketMomentActors, pocketMomentsGenerationPrompt, pocketMomentsTask, POCKET_MOMENTS_ID, POCKET_MOMENTS_USER_ID, togglePocketMomentLike, visiblePocketMoments, type MomentDraft, type PocketMoment } from "./pocketMomentsState";

type PocketPhoneProps = {
  sessionId: string; personas: AgentPersona[]; characterCards: CharacterCard[];
  providers: PocketProvider[]; activeProviderId: string;
  userProfile: { nickname: string; bio: string; avatarImage: string };
  onSyncContext: PocketContextSync; onBuildConversation: PocketConversationBuilder;
  onBuildFriendContext: PocketFriendContextBuilder;
  onBack: () => void; onClose: () => void;
};
type PhoneApp = "home" | "wechat" | "xiaohongshu" | "settings" | "character" | "calendar" | "notes" | "moments";
type WechatTab = "chats" | "contacts" | "discover" | "me";
type ContactDraft = Pick<PocketContact, "name" | "nickname" | "avatar" | "personality" | "greeting" | "sourceLabel" | "sourceCharacterCardId">;
type Confirmation = { title: string; description: string; action: () => void };

function Avatar({ avatar, name, self = false, onClick }: { avatar: string; name: string; self?: boolean; onClick?: () => void }) {
  const safeAvatar = safePocketAvatar(avatar);
  const content = <span className={`pocket-avatar${self ? " is-self" : ""}`}>
    <img src={safeAvatar} alt={name} decoding="async" onError={event => { if (event.currentTarget.getAttribute("src") !== DEFAULT_POCKET_AVATAR) event.currentTarget.src = DEFAULT_POCKET_AVATAR; }} />
  </span>;
  return onClick ? <button className="pocket-avatar-button" type="button" aria-label={`查看${name}的内心独白`} onClick={onClick}>{content}</button> : content;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function ConversationAvatar({ conversation }: { conversation: PocketConversation }) {
  return isPocketGroup(conversation) ? <span className="pocket-group-avatar" aria-label="群头像">{conversation.members.slice(0, 4).map(member => <Avatar key={member.id} avatar={member.avatar} name={pocketDisplayName(member)} />)}</span> : <Avatar avatar={conversation.avatar} name={pocketDisplayName(conversation)} />;
}

export function PocketPhone(props: PocketPhoneProps) {
  const storageKey = pocketStorageKey(props.sessionId);
  const [promptSettings, setPromptSettings] = useState(() => loadGlobalPocketPrompts(storageKey));
  const promptsRef = useRef(promptSettings.prompts);
  const [storageWarning, setStorageWarning] = useState("");
  const [rootState, setRootState] = useState<PocketState>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      const loaded = saved ? normalizePocketState(JSON.parse(saved)) : emptyPocketState();
      // Remove the legacy session copy only after global persistence succeeds.
      if (!promptSettings.storageWarning) delete loaded.settings.promptOverrides;
      return stampPocketWechatTimes(ensurePocketWechatClock(loaded));
    }
    catch { return ensurePocketWechatClock(emptyPocketState()); }
  });
  const rootRef = useRef(rootState);
  const [ownerId, setOwnerId] = useState("");
  const owner = rootState.contacts.find(contact => contact.id === ownerId);
  const userProfile = owner ? { nickname: pocketDisplayName(owner), bio: owner.personality, avatarImage: owner.avatar } : props.userProfile;
  const state = owner ? characterPhoneView(rootState, owner.id, props.userProfile) : { ...rootState, characterPhones: undefined };
  const stateRef = useRef(state);
  stateRef.current = state;
  const [app, setApp] = useState<PhoneApp>("home");
  const [tab, setTab] = useState<WechatTab>("chats");
  const [contactId, setContactId] = useState("");
  const [mePage, setMePage] = useState<PocketWalletPage>("me");
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachmentKind, setAttachmentKind] = useState<PocketAttachment["kind"] | null>(null);
  const closeAttachment = useCallback(() => setAttachmentKind(null), []);
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<{ id?: string; draft: ContactDraft } | null>(null);
  const [friendMode, setFriendMode] = useState<PocketFriendMode>("manual");
  const [friendLibrary, setFriendLibrary] = useState(() => loadPocketFriendLibrary(storageKey));
  const [groupEditor, setGroupEditor] = useState<{ id?: string; name: string; memberIds: string[]; members: PocketGroupMember[] } | null>(null);
  const [editorError, setEditorError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [innerPersonId, setInnerPersonId] = useState("");
  const [pendingContactId, setPendingContactId] = useState("");
  const [pendingSpeaker, setPendingSpeaker] = useState<PocketGroupMember | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [momentFeedback, setMomentFeedback] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const calendarJumpRef = useRef<PocketCalendarJump | null>(null);
  const mountedRef = useRef(true);
  const editorRef = useRef<HTMLFormElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  const wechatNow = new Date(pocketWechatNow(rootState.wechatClock!, now.getTime()));
  const conversations = getPocketConversations(state).filter(contact => isPocketGroup(contact) || contact.app !== "moments");
  const momentCircle = pocketMomentActors(rootState, ownerId, props.userProfile);
  const activeContact = conversations.find(contact => contact.id === contactId);
  const innerPerson = state.contacts.find(person => person.id === innerPersonId) || (activeContact && isPocketGroup(activeContact) ? activeContact.members.find(person => person.id === innerPersonId) : undefined);
  const nickname = owner ? pocketDisplayName(owner) : state.settings.nickname.trim() || props.userProfile.nickname.trim() || "小小的我";
  const selection = resolvePocketModel(props.providers, props.activeProviderId, state.settings.providerId, state.settings.modelId);
  const currentTheme = POCKET_THEMES.find(theme => theme.id === state.settings.theme)!;
  const canChat = !!selection.provider?.apiBaseUrl.trim() && !!selection.modelId.trim();

  function updateState(change: (previous: PocketState) => PocketState, calendarJump?: PocketCalendarJump) {
    const previous = rootRef.current;
    const changed = change(stateRef.current);
    const resolved = { ...changed, groups: changed.groups.map(group => resolvePocketGroup(group, changed.contacts)) };
    const merged = owner ? commitCharacterPhoneView(previous, owner.id, resolved) : { ...resolved, characterPhones: previous.characterPhones };
    const timed = calendarJump ? { ...merged, wechatClock: jumpPocketCalendarClock(previous.wechatClock!, calendarJump) } : merged;
    const next = stampPocketWechatTimes(recordPocketContextDeletions(previous, syncCharacterPhoneWallets(previous, timed)));
    rootRef.current = next;
    stateRef.current = owner ? characterPhoneView(next, owner.id, props.userProfile) : { ...next, characterPhones: undefined };
    setRootState(next);
    setNow(new Date());
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageWarning(""); }
    catch { setStorageWarning("手机存储空间不足或不可用，这次改动暂未保存。请保留当前页面。"); }
    const changedContacts = changedPocketLibraryContacts(previous, next);
    if (changedContacts.length) setFriendLibrary(changePocketFriendLibrary(storageKey, characters => mergePocketLibraryContacts(characters, changedContacts)));
    return props.onSyncContext(props.sessionId, getPocketConversations(previous), getPocketConversations(next), next.settings.nickname.trim() || props.userProfile.nickname.trim() || "小小的我", next.deletedContextMessages, calendarJump);
  }
  function jumpCalendar(time: string) {
    controllerRef.current?.abort();
    const jump = calendarJumpRef.current?.time === time ? calendarJumpRef.current : { id: `calendar:${pocketId()}`, time, createdAt: new Date().toISOString() };
    calendarJumpRef.current = jump;
    return Promise.resolve(updateState(previous => previous, jump)).then(() => {
      if (calendarJumpRef.current === jump) calendarJumpRef.current = null;
    });
  }
  function updateSettings(patch: Partial<PocketSettings>) { updateState(previous => ({ ...previous, settings: { ...previous.settings, ...patch } })); }
  function updatePrompts(prompts: PocketPromptOverrides) {
    const saved = saveGlobalPocketPrompts(prompts);
    promptsRef.current = saved.prompts;
    setPromptSettings(saved);
    return saved.storageWarning;
  }
  const buildConversation: PocketConversationBuilder = (sessionId, contact, user, mode, speaker, excludedIds) => props.onBuildConversation(sessionId, contact, user, mode, speaker, excludedIds, promptsRef.current);
  function updateContact(id: string, change: (contact: PocketContact) => PocketContact) {
    updateState(previous => ({ ...previous, contacts: previous.contacts.map(contact => contact.id === id ? change(contact) : contact) }));
  }
  function updateGroup(id: string, change: (group: PocketGroup) => PocketGroup) {
    updateState(previous => ({ ...previous, groups: previous.groups.map(group => group.id === id ? change(group) : group) }));
  }
  function appendMessages(id: string, messages: PocketMessage[]) {
    updateState(previous => ({ ...previous,
      contacts: previous.contacts.map(contact => contact.id === id ? { ...contact, messages: [...contact.messages, ...messages] } : contact),
      groups: previous.groups.map(group => group.id === id ? { ...group, messages: [...group.messages, ...messages] } : group),
    }));
  }
  function withWechatTime(messages: PocketRequestMessage[]): PocketRequestMessage[] {
    const prompt = pocketWechatTimePrompt(rootRef.current.wechatClock!, Date.now(), promptsRef.current);
    return messages[0]?.role === "system" ? [{ ...messages[0], content: `${messages[0].content}\n\n${prompt}` }, ...messages.slice(1)] : [{ role: "system", content: prompt }, ...messages];
  }
  function refreshRedNicknames() {
    try {
      const red = normalizeRedState(JSON.parse(localStorage.getItem(redStorageKey(props.sessionId)) || "null"));
      const next = syncRedWechatNicknames(stateRef.current, red);
      if (next !== stateRef.current) updateState(() => next);
    } catch { /* Keep existing contacts if local storage is unavailable. */ }
  }
  function openWechat(nextTab: WechatTab = "chats") { if (!owner) refreshRedNicknames(); setApp("wechat"); setTab(nextTab); setMePage("me"); setContactId(""); setQuery(""); }
  function switchOwner(id: string) {
    controllerRef.current?.abort();
    setPendingContactId(""); setPendingSpeaker(null); setErrors({}); setMomentFeedback(""); setOwnerId(id); setContactId(""); setInnerPersonId(""); setQuery(""); setTab("chats"); setApp(id ? "home" : "character");
  }
  function openContact(contact: PocketConversation) { setContactId(contact.id); setApp("wechat"); setQuery(""); }
  function openRedFriend(actor: RedActor) {
    const result = addRedWechatFriend(stateRef.current, actor);
    if (result.state !== stateRef.current) updateState(() => result.state);
    openContact(result.contact);
  }
  function addContact() { setEditorError(""); setFriendMode("manual"); setEditor({ draft: { name: "", avatar: DEFAULT_POCKET_AVATAR, personality: "", greeting: "", sourceLabel: "自定义角色" } }); }
  function editContact(contact: PocketContact) { setEditorError(""); setEditor({ id: contact.id, draft: { name: contact.name, nickname: contact.nickname, avatar: contact.avatar, personality: contact.personality, greeting: contact.greeting, sourceLabel: contact.sourceLabel, sourceCharacterCardId: contact.sourceCharacterCardId } }); }
  function editGroup(group?: PocketGroup) {
    setEditorError(""); setEditor(null);
    setGroupEditor({ id: group?.id, name: group?.name || "", memberIds: group?.members.map(member => member.id) || [], members: group?.members || [] });
  }

  useEffect(() => { setAttachOpen(false); setAttachmentKind(null); }, [contactId, app]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => subscribePocketFriendLibrary(setFriendLibrary), []);
  useEffect(() => subscribeGlobalPocketPrompts(settings => {
    controllerRef.current?.abort();
    promptsRef.current = settings.prompts;
    setPromptSettings(settings);
  }), []);
  useEffect(() => subscribePocketWechatClock(props.sessionId, (clock, warning) => {
    const next = stampPocketWechatTimes({ ...rootRef.current, wechatClock: clock });
    rootRef.current = next;
    stateRef.current = owner ? characterPhoneView(next, owner.id, props.userProfile) : { ...next, characterPhones: undefined };
    setRootState(next); setNow(new Date()); setStorageWarning(warning);
  }), [props.sessionId, ownerId]);
  useEffect(() => subscribePocketContextChanges(props.sessionId, (changes, warning) => {
    const previous = rootRef.current;
    const next = applyPocketContextChanges(previous, changes);
    if (next === previous) return;
    if (changes.some(change => change.contactId === pendingContactId)) {
      controllerRef.current?.abort();
    }
    rootRef.current = next;
    stateRef.current = owner ? characterPhoneView(next, owner.id, props.userProfile) : { ...next, characterPhones: undefined };
    setRootState(next);
    setStorageWarning(warning);
  }), [props.sessionId, pendingContactId, ownerId]);
  useEffect(() => {
    mountedRef.current = true;
    try { localStorage.setItem(storageKey, JSON.stringify(rootRef.current)); }
    catch { setStorageWarning("手机存储空间不足或不可用，微信时间暂未保存。请保留当前页面。"); }
    props.onSyncContext(props.sessionId, null, getPocketConversations(rootRef.current), nickname, rootRef.current.deletedContextMessages);
    try {
      const redState = normalizeRedState(JSON.parse(localStorage.getItem(redStorageKey(props.sessionId)) || "null"));
      props.onSyncContext(props.sessionId, null, [redContextConversation(redState)], nickname, redState.deletedContextMessages);
      const next = syncRedWechatNicknames(stateRef.current, redState);
      if (next !== stateRef.current) updateState(() => next);
    } catch { /* Keep existing main context when local phone storage is unavailable. */ }
    return () => { mountedRef.current = false; controllerRef.current?.abort(); };
  }, []);
  useEffect(() => { const node = conversationRef.current; if (node) node.scrollTop = node.scrollHeight; }, [contactId, activeContact?.messages.length, pendingContactId, errors[contactId], attachOpen]);
  useEffect(() => {
    const dialog = innerPerson ? innerRef.current : confirmation ? confirmationRef.current : editor || groupEditor ? editorRef.current : null;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]'));
    if (confirmation || innerPerson) focusables()[0]?.focus();
    const trapFocus = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key === "Escape") { event.preventDefault(); if (innerPerson) setInnerPersonId(""); else if (confirmation) setConfirmation(null); else { setEditor(null); setGroupEditor(null); } }
      if (event.key !== "Tab") return;
      const elements = focusables();
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener("keydown", trapFocus);
    return () => { dialog.removeEventListener("keydown", trapFocus); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [!!editor, !!groupEditor, !!confirmation, innerPersonId]);

  function importCharacter(value: string) {
    if (!editor || !value) return;
    const libraryCharacter = friendLibrary.characters.find(item => `library:${item.id}` === value);
    const persona = props.personas.find(item => `persona:${item.id}` === value);
    const draft = libraryCharacter ? {
      name: libraryCharacter.name, nickname: libraryCharacter.nickname, avatar: libraryCharacter.avatar, sourceLabel: "来自角色库", sourceCharacterCardId: libraryCharacter.sourceCharacterCardId,
      personality: libraryCharacter.personality, greeting: libraryCharacter.greeting,
    } : persona ? {
      name: persona.name, avatar: safePocketAvatar(persona.avatarImage), sourceLabel: "来自人格", sourceCharacterCardId: undefined,
      personality: [persona.description, ...persona.entryTypes.flatMap(type => type.entries.filter(entry => entry.enabled).map(entry => `${type.name} · ${entry.key}：${entry.value}`))].filter(Boolean).join("\n"), greeting: "",
    } : null;
    if (draft) setEditor({ ...editor, draft });
  }

  function addSelectedFriends(profiles: PocketFriendProfile[]) {
    try {
      const fresh = availablePocketFriends(profiles, stateRef.current.contacts, [nickname, props.userProfile.nickname]);
      if (!fresh.length) throw new Error("所选角色已经添加，请选择其他朋友。");
      const contacts = fresh.map(profile => resetPocketContactChat(makePocketContact(profile), nickname));
      updateState(previous => ({ ...previous, contacts: [...previous.contacts, ...contacts] }));
      setEditor(null); setEditorError("");
      if (contacts.length === 1) openContact(contacts[0]); else { setContactId(""); setTab("contacts"); }
    } catch (error) { setEditorError(error instanceof Error ? error.message : "联系人没有保存成功。"); }
  }

  function saveContact(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    try {
      const validated = makePocketContact(editor.draft);
      if (owner && stateRef.current.contacts.some(contact => contact.syncedOwnerId && [validated.name, validated.nickname].filter(Boolean).some(name => name?.normalize("NFKC").trim().toLocaleLowerCase() === contact.name.normalize("NFKC").trim().toLocaleLowerCase()))) throw new Error("与你的聊天已同步，请直接打开同步联系人。");
      if (editor.id) {
        const previous = stateRef.current.contacts.find(contact => contact.id === editor.id);
        const roleChanged = previous && (previous.name !== validated.name || previous.nickname !== validated.nickname || previous.personality !== validated.personality || previous.sourceCharacterCardId !== validated.sourceCharacterCardId);
        const pending = getPocketConversations(stateRef.current).find(contact => contact.id === pendingContactId);
        // A reply already in flight carries the old role, including group rounds.
        if (roleChanged && pending && (pending.id === editor.id || isPocketGroup(pending) && pending.members.some(member => member.id === editor.id))) controllerRef.current?.abort();
        updateContact(editor.id, contact => ({ ...contact, ...editor.draft, name: validated.name, nickname: validated.nickname, personality: validated.personality, avatar: validated.avatar, greeting: validated.greeting }));
      }
      else {
        if (stateRef.current.contacts.some(person => pocketFriendName(person.name) === pocketFriendName(validated.name))) throw new Error("这位同名朋友已经在通讯录里了。");
        const contact = resetPocketContactChat(validated, nickname);
        updateState(previous => ({ ...previous, contacts: [...previous.contacts, contact] }));
        openContact(contact);
      }
      setEditor(null);
    } catch (error) { setEditorError(error instanceof Error ? error.message : "联系人没有保存成功。"); }
  }

  function sendMessage() {
    const contact = getPocketConversations(stateRef.current).find(item => item.id === contactId);
    if (!contact) return;
    const content = (drafts[contact.id] || "").trim();
    if (!content) { void generateReply(); return; }
    appendMessages(contact.id, [{ id: pocketId(), role: "user", content, createdAt: new Date().toISOString() }]);
    setDrafts(previous => ({ ...previous, [contact.id]: "" }));
    setErrors(previous => ({ ...previous, [contact.id]: "" }));
  }

  async function generateCharacterWechat(contactsOnly = false) {
    if (!owner || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller; setPendingContactId(`generate:${owner.id}`); setErrors(previous => ({ ...previous, generation: "" }));
    const timeout = setTimeout(() => controller.abort(new Error("生成等待超时，请重试。")), 120000);
    try {
      const view = stateRef.current;
      const task: PocketContact = { ...owner, id: `generate:${owner.id}`, phoneOwner: owner, messages: [], greeting: "", contextCharacterCardIds: owner.sourceCharacterCardId ? [owner.sourceCharacterCardId] : [] };
      const context = withWechatTime(buildConversation(props.sessionId, task, { nickname, bio: owner.personality }, "reply"));
      const raw = await requestPocketReply(selection.provider, selection.modelId, [...context, { role: "user", content: characterPhoneGenerationPrompt(owner, view, props.userProfile, contactsOnly, promptsRef.current) }], controller.signal, 8192);
      if (controller.signal.aborted || !mountedRef.current) return;
      // Validate the complete response before changing storage or shared history.
      const generated = applyCharacterPhoneGeneration(stateRef.current, raw, [props.userProfile.nickname, rootRef.current.settings.nickname], owner, contactsOnly);
      updateState(() => generated);
    } catch (error) {
      if (mountedRef.current && (!controller.signal.aborted || controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError")) setErrors(previous => ({ ...previous, generation: error instanceof Error ? error.message : "生成失败，请重试。" }));
    } finally {
      clearTimeout(timeout);
      if (controllerRef.current === controller) { controllerRef.current = null; if (mountedRef.current) setPendingContactId(""); }
    }
  }

  function saveNote(id: string | undefined, title: string, body: string) {
    const note = makePocketNote(title, body, pocketWechatNow(rootRef.current.wechatClock!));
    updateState(previous => {
      const notes = previous.notes || [];
      if (id && !notes.some(note => note.id === id)) throw new Error("这条便签已被删除，请返回列表。");
      return { ...previous, notes: id ? notes.map(saved => saved.id === id ? { ...saved, title: note.title, body: note.body } : saved) : [...notes, note] };
    });
  }

  async function generateCharacterNotes() {
    if (!owner || controllerRef.current) return;
    const controller = new AbortController();
    const task = pocketNotesConversation(owner, stateRef.current.notes || []);
    controllerRef.current = controller; setPendingContactId(task.id); setErrors(previous => ({ ...previous, notes: "" }));
    const timeout = setTimeout(() => controller.abort(new Error("生成等待超时，请重试。")), 120000);
    try {
      const realUser = { nickname: rootRef.current.settings.nickname.trim() || props.userProfile.nickname, bio: props.userProfile.bio };
      const context = withWechatTime(buildConversation(props.sessionId, task, realUser, "reply"));
      const raw = await requestPocketReply(selection.provider, selection.modelId, [...context, { role: "user", content: pocketNotesGenerationPrompt(owner, stateRef.current.notes || [], realUser, promptsRef.current) }], controller.signal, 6144);
      if (controller.signal.aborted || !mountedRef.current) return;
      updateState(previous => ({ ...previous, notes: applyPocketNotesGeneration(previous.notes || [], raw, pocketWechatNow(rootRef.current.wechatClock!)) }));
    } catch (error) {
      if (mountedRef.current && (!controller.signal.aborted || controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError")) setErrors(previous => ({ ...previous, notes: error instanceof Error ? error.message : "便签生成失败，请重试。" }));
    } finally {
      clearTimeout(timeout);
      if (controllerRef.current === controller) { controllerRef.current = null; if (mountedRef.current) setPendingContactId(""); }
    }
  }

  function updateMoment(id: string, change: (post: PocketMoment) => PocketMoment) {
    updateState(previous => {
      const post = previous.moments?.find(post => post.id === id);
      const circle = pocketMomentActors(rootRef.current, ownerId, props.userProfile);
      if (!post || !canSeePocketMoment(post, circle.viewer.id)) throw new Error("这条动态已删除或不可见，请刷新列表。");
      return { ...previous, moments: previous.moments!.map(post => post.id === id ? change(post) : post) };
    });
  }
  function publishMoment(draft: MomentDraft, id?: string) {
    const circle = pocketMomentActors(rootRef.current, ownerId, props.userProfile);
    const post = makePocketMoment(circle.viewer, draft, circle.friends, pocketWechatNow(rootRef.current.wechatClock!));
    if (id) updateMoment(id, saved => {
      if (saved.author.id !== circle.viewer.id) throw new Error("只能编辑自己的朋友圈。");
      return normalizePocketMoments([{ ...saved, text: post.text, pic: post.pic, images: post.images, location: post.location, visibility: post.visibility, visibleTo: post.visibleTo, audienceIds: post.audienceIds, audiencePeople: post.audiencePeople }])[0];
    });
    else updateState(previous => ({ ...previous, moments: [...previous.moments || [], post] }));
    setMomentFeedback(id ? "朋友圈已保存。" : "朋友圈已发表。");
  }
  async function generateMoments(kind: "feed" | "self" | "interact" | "reply", postId?: string) {
    if (controllerRef.current) return;
    const circle = pocketMomentActors(rootRef.current, ownerId, props.userProfile);
    const target = postId ? stateRef.current.moments?.find(post => post.id === postId) : undefined;
    const actors = [circle.viewer, ...circle.friends];
    const eligible = (kind === "self" ? [circle.viewer] : target ? actors.filter(actor => canSeePocketMoment(target, actor.id) && (kind !== "reply" || actor.id === target.author.id)) : circle.friends).filter(actor => actor.id !== POCKET_MOMENTS_USER_ID);
    setErrors(previous => ({ ...previous, moments: "" })); setMomentFeedback("");
    if (!eligible.length || postId && !target) { setErrors(previous => ({ ...previous, moments: target ? "这条动态暂时没有可以互动的好友。" : "先添加或生成一位微信好友，再刷新朋友圈。" })); return; }
    const task = pocketMomentsTask(circle.viewer, actors, eligible.map(actor => actor.id));
    const controller = new AbortController(); controllerRef.current = controller; setPendingContactId(POCKET_MOMENTS_ID);
    const timeout = setTimeout(() => controller.abort(new Error("生成等待超时，请重试。")), 120000);
    try {
      const realUser = { nickname: rootRef.current.settings.nickname.trim() || props.userProfile.nickname, bio: props.userProfile.bio };
      const context = withWechatTime(buildConversation(props.sessionId, task, realUser, "reply"));
      const visible = visiblePocketMoments(stateRef.current.moments || [], circle.viewer, circle.friends).filter(post => eligible.every(actor => canSeePocketMoment(post, actor.id)));
      const raw = await requestPocketReply(selection.provider, selection.modelId, [...context, { role: "user", content: pocketMomentsGenerationPrompt(circle.viewer, circle.friends, visible, kind === "self", target, kind === "reply", promptsRef.current) }], controller.signal, 6144);
      if (controller.signal.aborted || !mountedRef.current) return;
      let friendRaw: string | undefined;
      const friendActors = circle.friends.filter(actor => actor.id !== POCKET_MOMENTS_USER_ID);
      if (kind === "self" && friendActors.length) {
        // The owner's private background must not reach their contacts.
        const friendTask = pocketMomentsTask(circle.viewer, actors, friendActors.map(actor => actor.id));
        const friendContext = withWechatTime(buildConversation(props.sessionId, friendTask, realUser, "reply"));
        const friendVisible = visiblePocketMoments(stateRef.current.moments || [], circle.viewer, circle.friends).filter(post => friendActors.every(actor => canSeePocketMoment(post, actor.id)));
        friendRaw = await requestPocketReply(selection.provider, selection.modelId, [...friendContext, { role: "user", content: pocketMomentsGenerationPrompt(circle.viewer, circle.friends, friendVisible, false, undefined, false, promptsRef.current) }], controller.signal, 6144);
        if (controller.signal.aborted || !mountedRef.current) return;
      }
      const now = pocketWechatNow(rootRef.current.wechatClock!);
      const currentCircle = pocketMomentActors(rootRef.current, ownerId, props.userProfile);
      if (target) updateMoment(target.id, saved => applyPocketMomentsInteraction(saved, raw, eligible.filter(actor => [currentCircle.viewer, ...currentCircle.friends].some(current => current.id === actor.id)), now));
      else {
        const before = stateRef.current.moments || [];
        let moments = applyPocketMomentsGeneration(before, raw, currentCircle.viewer, currentCircle.friends, now, kind === "self");
        if (friendRaw !== undefined) moments = applyPocketMomentsGeneration(moments, friendRaw, currentCircle.viewer, currentCircle.friends, now);
        updateState(previous => ({ ...previous, moments }));
        setMomentFeedback(moments.length > before.length ? `新增 ${moments.length - before.length} 条朋友圈。` : "这次没有新增动态。");
      }
      if (target) setMomentFeedback("好友互动已更新。");
    } catch (error) {
      if (mountedRef.current && (!controller.signal.aborted || controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError")) setErrors(previous => ({ ...previous, moments: error instanceof Error ? error.message : "朋友圈生成失败，请重试。" }));
    } finally {
      clearTimeout(timeout);
      if (controllerRef.current === controller) { controllerRef.current = null; if (mountedRef.current) setPendingContactId(""); }
    }
  }

  async function generateReply() {
    const found = getPocketConversations(stateRef.current).find(item => item.id === contactId);
    const contact = found && isPocketGroup(found) ? resolvePocketGroup(found, stateRef.current.contacts) : found;
    if (!contact || controllerRef.current) return;
    if (!canChat) { setErrors(previous => ({ ...previous, [contact.id]: "先到手机设置选择聊天模型，就可以收到 TA 的回复啦。" })); return; }
    const mode = getPocketGenerationMode(contact);
    const replyContextMessageId = contact.messages.at(-1)?.id || "";
    const controller = new AbortController();
    controllerRef.current = controller;
    setPendingContactId(contact.id);
    setErrors(previous => ({ ...previous, [contact.id]: "" }));
    const snapshotIds = new Set(contact.messages.map(message => message.id));
    const request = async (conversation: PocketConversation, speaker?: PocketGroupMember) => {
      const timeout = setTimeout(() => controller.abort(new Error("等待有点久，点重试再发送一次吧。")), 120000);
      // Exclude only messages sent locally during this round. Restored shared
      // records absent from local storage must still remain in the context.
      const excludedIds = isPocketGroup(contact) ? stateRef.current.groups.find(group => group.id === contact.id)?.messages.filter(message => !snapshotIds.has(message.id)).map(message => message.id) : undefined;
      try { return await requestPocketWechatTurn(selection.provider, selection.modelId, withWechatTime(buildConversation(props.sessionId, conversation, { nickname, bio: userProfile.bio }, mode, speaker, excludedIds)), controller.signal, speaker?.innerState || (!isPocketGroup(conversation) ? conversation.innerState : undefined), isPocketGroup(conversation), promptsRef.current); }
      catch (error) { if (speaker && error instanceof PocketWechatFormatError) throw new Error(`${speaker.name}的群聊回复格式有误，请重试。`); throw error; }
      finally { clearTimeout(timeout); }
    };
    try {
      if (isPocketGroup(contact)) {
        const replies: PocketMessage[] = [];
        const turns: { speaker: PocketGroupMember; innerState: PocketInnerState }[] = [];
        const innerEntries: PocketInnerEntry[] = [];
        for (const member of contact.members) {
          setPendingSpeaker(member);
          const turn = await request({ ...contact, messages: [...contact.messages, ...replies], innerHistory: [...(contact.innerHistory || []), ...innerEntries], members: contact.members.map(person => ({ ...person, innerState: turns.find(turn => turn.speaker.id === person.id)?.innerState || person.innerState })) }, member);
          if (controller.signal.aborted) return;
          if (turn.speak) replies.push(...pocketReplyMessages(turn.texts, turn.innerState.updatedAt, replyContextMessageId, member));
          turns.push({ speaker: member, innerState: turn.innerState });
          innerEntries.push({ id: pocketId(), content: turn.innerState.monologue, createdAt: turn.innerState.updatedAt, speaker: { id: member.id, name: pocketDisplayName(member), avatar: member.avatar } });
        }
        updateState(previous => applyPocketInnerTurns(applyPocketTransferReplies(previous, contact.id, replies), contact.id, turns, replies, replyContextMessageId));
        if (!replies.length) setErrors(previous => ({ ...previous, [contact.id]: "本轮暂无新消息。" }));
      } else {
        const turn = await request(contact);
        if (controller.signal.aborted) return;
        const replies = pocketReplyMessages(turn.texts, turn.innerState.updatedAt, replyContextMessageId);
        updateState(previous => applyPocketInnerTurns(applyPocketTransferReplies(previous, contact.id, replies), contact.id, [{ speaker: contact, innerState: turn.innerState }], replies, replyContextMessageId));
      }
    } catch (error) {
      if (mountedRef.current && (!controller.signal.aborted || controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError")) setErrors(previous => ({ ...previous, [contact.id]: error instanceof Error ? error.message : "暂时没有连接上，请重试。" }));
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; if (mountedRef.current) { setPendingContactId(""); setPendingSpeaker(null); } }
    }
  }

  function settleTransfer(messageId: string, action: "received" | "returned") {
    try {
      updateState(previous => settlePocketTransfer(previous, contactId, messageId, action, "user"));
      setErrors(previous => ({ ...previous, [contactId]: "" }));
    } catch (cause) { setErrors(previous => ({ ...previous, [contactId]: cause instanceof Error ? cause.message : "转账处理失败。" })); }
  }
  function toggleVoice(messageId: string) {
    const update = <T extends PocketConversation>(conversation: T): T => conversation.id === contactId ? { ...conversation, messages: conversation.messages.map(message => message.id === messageId && message.attachment?.kind === "voice" ? { ...message, attachment: { ...message.attachment, shown: !message.attachment.shown } } : message) } : conversation;
    updateState(previous => ({ ...previous, contacts: previous.contacts.map(update), groups: previous.groups.map(update) }));
  }

  const searchedContacts = conversations.filter(contact => [contact.name, pocketDisplayName(contact)].some(name => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const listedContacts = [...searchedContacts].sort((a, b) => tab === "contacts" ? pocketDisplayName(a).localeCompare(pocketDisplayName(b), "zh-CN") : (b.messages.at(-1)?.createdAt || b.createdAt).localeCompare(a.messages.at(-1)?.createdAt || a.createdAt));
  const draft = activeContact ? drafts[activeContact.id] || "" : "";
  const patchDraft = (patch: Partial<ContactDraft>) => setEditor(previous => previous ? { ...previous, draft: { ...previous.draft, ...patch } } : null);
  const groupChoices = groupEditor ? [...state.contacts.map(pocketGroupMember), ...groupEditor.members.filter(member => !state.contacts.some(contact => contact.id === member.id))] : [];
  function saveGroup(event: FormEvent) {
    event.preventDefault(); if (!groupEditor) return;
    try {
      const members = groupEditor.memberIds.map(id => groupChoices.find(member => member.id === id)).filter((member): member is PocketGroupMember => !!member);
      const validated = makePocketGroup(groupEditor.name, members, nickname);
      if (groupEditor.id) updateGroup(groupEditor.id, group => ({ ...group, name: validated.name, members: validated.members }));
      else { updateState(previous => ({ ...previous, groups: [...previous.groups, validated] })); openContact(validated); }
      setGroupEditor(null);
    } catch (error) { setEditorError(error instanceof Error ? error.message : "群聊没有保存成功。"); }
  }

  return <section className="pocket-panel" aria-label="口袋手机">
    <header className="pocket-panel-header">
      <button type="button" onClick={props.onBack} aria-label="返回右侧工具"><ArrowLeft size={17} /></button>
      <span><strong>{owner ? `${pocketDisplayName(owner)}的手机` : "口袋手机"}</strong><small>{owner ? "收藏 ta 的聊天和生活" : "把可爱和想念，随身收藏"}</small></span>
      <button type="button" onClick={props.onClose} aria-label="关闭手机模块"><X size={17} /></button>
    </header>
    <div className="pocket-stage">
      <div className={`pocket-device theme-${state.settings.theme}${state.settings.largeText ? " large-text" : ""}`} style={{ "--pocket-swatch": currentTheme.color } as CSSProperties}>
        <div className="pocket-side-button" aria-hidden="true" />
        <div className={`pocket-screen app-${app}`}>
          <div className="pocket-status"><span>{formatTime(wechatNow.toISOString())}</span><div className="pocket-island" aria-hidden="true"><i /></div><span aria-label="信号良好，电量充足"><Signal size={12} /><Wifi size={12} /><BatteryFull size={17} /></span></div>
          {(storageWarning || promptSettings.storageWarning || friendLibrary.storageWarning) && <div className="pocket-storage-warning" role="alert">{[storageWarning, promptSettings.storageWarning, friendLibrary.storageWarning].filter(Boolean).join(" ")}</div>}
          <div className="pocket-content" key={app} inert={editor || groupEditor || confirmation || innerPerson || attachmentKind ? true : undefined}>
            {app === "home" ? <div className="pocket-home">
              {owner && <button className="pocket-owner-back" type="button" onClick={() => switchOwner("")}><ArrowLeft size={16} />选择其他角色</button>}
              <div className="pocket-home-date"><span>{wechatNow.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</span><strong>{formatTime(wechatNow.toISOString())}</strong></div>
              <div className="pocket-app-grid">
                <button className="pocket-app-icon" type="button" onClick={() => openWechat()} aria-label="打开微信"><span className="pocket-icon-wechat"><MessageCircle size={33} strokeWidth={2.3} fill="white" /><MessageCircle className="pocket-chat-icon-small" size={23} fill="#d8f4dc" /></span><strong>微信</strong></button>
                {owner && <button className="pocket-app-icon" type="button" onClick={() => setApp("notes")} aria-label="打开便签"><span className="pocket-icon-notes" /><strong>便签</strong></button>}
                {!owner && <button className="pocket-app-icon" type="button" onClick={() => setApp("xiaohongshu")} aria-label="打开小红书"><span className="pocket-icon-xiaohongshu"><b>小红书</b></span><strong>小红书</strong></button>}
                {!owner && <button className="pocket-app-icon" type="button" onClick={() => setApp("character")} aria-label="打开ta的手机"><span className="pocket-icon-character"><UserRound size={33} /></span><strong>ta 的手机</strong></button>}
                <button className="pocket-app-icon" type="button" onClick={() => setApp("calendar")} aria-label="打开日历"><span className="pocket-icon-calendar"><CalendarDays size={33} /></span><strong>日历</strong></button>
                <button className="pocket-app-icon" type="button" onClick={() => setApp("settings")} aria-label="打开手机设置"><span className="pocket-icon-settings"><Settings size={34} strokeWidth={1.7} /></span><strong>设置</strong></button>
              </div>
            </div> : app === "moments" ? <PocketWechatMoments viewer={momentCircle.viewer} friends={momentCircle.friends} posts={state.moments || []} cover={state.momentCovers?.[momentCircle.viewer.id] || ""} busy={!!pendingContactId} pending={pendingContactId === POCKET_MOMENTS_ID} error={errors.moments || ""} feedback={momentFeedback}
              onPublish={publishMoment} onLike={id => updateMoment(id, post => togglePocketMomentLike(post, momentCircle.viewer, pocketWechatNow(rootRef.current.wechatClock!)))}
              onComment={(id, text, replyTo) => updateMoment(id, post => addPocketMomentComment(post, momentCircle.viewer, text, pocketWechatNow(rootRef.current.wechatClock!), replyTo))}
              onDelete={id => setConfirmation({ title: "删除这条朋友圈？", description: "动态及其点赞、评论和对应会话记录将同步删除。", action: () => { if (pendingContactId === POCKET_MOMENTS_ID) controllerRef.current?.abort(); updateState(previous => ({ ...previous, moments: (previous.moments || []).filter(post => post.id !== id) })); } })}
              onDeleteComment={(id, commentId) => updateMoment(id, post => ({ ...post, comments: post.comments.filter(comment => comment.id !== commentId || comment.person.id !== momentCircle.viewer.id && post.author.id !== momentCircle.viewer.id) }))}
              onGenerate={(kind, id) => void generateMoments(kind, id)} onCancel={() => controllerRef.current?.abort()}
              onClear={ids => setConfirmation({ title: "清空当前朋友圈？", description: "当前列表中的动态及对应会话记录将删除。", action: () => { if (pendingContactId === POCKET_MOMENTS_ID) controllerRef.current?.abort(); updateState(previous => ({ ...previous, moments: (previous.moments || []).filter(post => !ids.includes(post.id)) })); } })}
              onCover={url => updateState(previous => ({ ...previous, momentCovers: { ...previous.momentCovers, [momentCircle.viewer.id]: url } }))} onExit={() => { setApp("wechat"); setContactId(""); }}
            /> : app === "notes" && owner ? <PocketNotes notes={state.notes || []} pending={pendingContactId === `notes:${owner.id}`} busy={!!pendingContactId} error={errors.notes || ""} onGenerate={() => void generateCharacterNotes()} onCancel={() => controllerRef.current?.abort()} onSave={saveNote} onDelete={id => setConfirmation({ title: "删除这条便签？", description: "便签及当前会话中的对应记录将删除。", action: () => { updateState(previous => ({ ...previous, notes: (previous.notes || []).filter(note => note.id !== id) })); } })} onExit={() => setApp("home")} /> : app === "calendar" ? <PocketCalendar now={wechatNow.toISOString()} onJump={jumpCalendar} onExit={() => setApp("home")} /> : app === "character" ? <div className="pocket-list-body pocket-scroll">
              <div className="pocket-app-heading"><button type="button" onClick={() => setApp("home")} aria-label="返回手机桌面"><ArrowLeft size={19} /></button><h2>ta 的手机</h2></div>
              <p className="pocket-character-note">选择手机主人，看看 ta 的微信、朋友圈和便签。与你的聊天会同步显示。</p>
              {rootState.contacts.map(contact => <button className="pocket-contact-row" type="button" key={contact.id} onClick={() => switchOwner(contact.id)} aria-label={`查看${pocketDisplayName(contact)}的手机`}><Avatar avatar={contact.avatar} name={pocketDisplayName(contact)} /><span><strong>{pocketDisplayName(contact)}</strong></span><ChevronRight size={16} /></button>)}
              {!rootState.contacts.length && <div className="pocket-empty"><p>先在你的微信通讯录添加一位角色。</p><button className="pocket-primary" type="button" onClick={() => { openWechat("contacts"); addContact(); }}>添加手机主人</button></div>}
            </div> : app === "xiaohongshu" ? <PocketXiaohongshu sessionId={props.sessionId} nickname={nickname} bio={props.userProfile.bio} avatar={userProfile.avatarImage} roles={getRedRoles(state.contacts, props.personas)} provider={selection.provider} modelId={selection.modelId} promptOverrides={promptSettings.prompts} onBuildConversation={buildConversation} onSyncContext={props.onSyncContext} onMessage={openRedFriend} onSettings={() => setApp("settings")} onExit={() => setApp("home")} /> : app === "settings" ? <PocketPhoneSettings key={props.sessionId} settings={state.settings} promptOverrides={promptSettings.prompts} nickname={nickname} owner={!!owner} providers={props.providers} provider={selection.provider} modelId={selection.modelId} canChat={canChat} onChange={updateSettings} onPromptChange={updatePrompts} onExit={() => setApp("home")} /> : <div className="pocket-wechat">
              {(activeContact || tab !== "me") && <header className={`pocket-wechat-header${owner && !activeContact && tab !== "discover" ? " has-character-actions" : ""}`}>
                <button type="button" onClick={() => activeContact ? setContactId("") : setApp("home")} aria-label={activeContact ? "返回微信列表" : "返回手机桌面"}><ArrowLeft size={19} /></button>
                {activeContact && !isPocketGroup(activeContact) && <Avatar avatar={activeContact.avatar} name={pocketDisplayName(activeContact)} onClick={() => setInnerPersonId(activeContact.id)} />}
                <span><strong>{(activeContact ? pocketDisplayName(activeContact) : "") || (tab === "discover" ? "发现" : tab === "contacts" ? "通讯录" : owner ? `${pocketDisplayName(owner)}的微信` : "微信")}{activeContact && isPocketGroup(activeContact) && <em> ({activeContact.members.length + 1})</em>}</strong>{activeContact && pendingContactId === activeContact.id && <small>{pendingSpeaker ? `${pocketDisplayName(pendingSpeaker)}正在输入…` : "对方正在输入…"}</small>}</span>
                {owner && !activeContact && tab !== "discover" && <>
                  <button type="button" disabled={!!pendingContactId} aria-label="生成联系人" title="生成联系人和群聊" aria-busy={pendingContactId === `generate:${owner.id}`} onClick={() => void generateCharacterWechat(true)}><UserRoundPlus size={20} /></button>
                  <button type="button" disabled={!!pendingContactId} aria-label="生成聊天记录" title={pendingContactId === `generate:${owner.id}` ? "正在生成…" : "生成私聊和群聊记录"} aria-busy={pendingContactId === `generate:${owner.id}`} onClick={() => void generateCharacterWechat()}><Sparkles size={20} /></button>
                </>}
                {!activeContact && tab !== "discover" && <button type="button" onClick={() => editGroup()} aria-label="发起群聊" title="发起群聊"><Users size={20} /></button>}
                {(activeContact || tab !== "discover") && <button type="button" onClick={() => activeContact ? isPocketGroup(activeContact) ? editGroup(activeContact) : editContact(activeContact) : addContact()} disabled={!!activeContact && !isPocketGroup(activeContact) && !!activeContact.syncedOwnerId} title={activeContact && !isPocketGroup(activeContact) && activeContact.syncedOwnerId ? "用户资料与聊天跟随你的手机同步" : undefined} aria-label={activeContact ? isPocketGroup(activeContact) ? "群聊设置" : "编辑联系人" : "添加联系人"}>{activeContact ? <MoreHorizontal size={22} /> : <Plus size={22} />}</button>}
              </header>}
              {owner && !activeContact && tab !== "me" && errors.generation && <p className="pocket-generation-error" role="alert">{errors.generation}</p>}
              {activeContact ? <>
                {isPocketGroup(activeContact) && <div className="pocket-group-people">{activeContact.members.map(member => <Avatar key={member.id} avatar={member.avatar} name={pocketDisplayName(member)} onClick={() => setInnerPersonId(member.id)} />)}</div>}
                <div className="pocket-conversation pocket-scroll" ref={conversationRef} role="log" aria-label={`${pocketDisplayName(activeContact)}的聊天记录`} aria-live="polite">
                  {activeContact.messages.map((message, index) => <div key={message.id} className="pocket-message-group" data-message-id={message.id}>
                    {(index === 0 || Math.abs(Date.parse(pocketWechatMessageTime(message)) - Date.parse(pocketWechatMessageTime(activeContact.messages[index - 1]))) > 300000) && <time className="pocket-message-time">{new Date(pocketWechatMessageTime(message)).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} {formatTime(pocketWechatMessageTime(message))}</time>}
                    {getPocketConversationBubbles(activeContact, message).map((content, segmentIndex) => <div key={segmentIndex} className={`pocket-message ${message.role}`}><Avatar avatar={message.role === "user" ? userProfile.avatarImage || DEFAULT_POCKET_USER_AVATAR : isPocketGroup(activeContact) ? message.speaker?.avatar || DEFAULT_POCKET_AVATAR : activeContact.avatar} name={message.role === "user" ? nickname : pocketSpeakerName(activeContact, message)} self={message.role === "user"} onClick={message.role === "assistant" ? () => setInnerPersonId(isPocketGroup(activeContact) ? message.speaker!.id : activeContact.id) : undefined} /><div className="pocket-message-body">{isPocketGroup(activeContact) && message.role === "assistant" && <button className="pocket-speaker-name" type="button" title={`@${pocketSpeakerName(activeContact, message)}`} onClick={() => setDrafts(previous => ({ ...previous, [activeContact.id]: `${previous[activeContact.id] || ""}@${pocketSpeakerName(activeContact, message)} ` }))}>{pocketSpeakerName(activeContact, message)}</button>}<PocketWechatMessage message={{ ...message, content }} onVoice={() => toggleVoice(message.id)} onTransfer={action => settleTransfer(message.id, action)} /></div></div>)}
                  </div>)}
                  {pendingContactId === activeContact.id && <div className="pocket-message assistant"><Avatar avatar={isPocketGroup(activeContact) ? pendingSpeaker?.avatar || DEFAULT_POCKET_AVATAR : activeContact.avatar} name={pendingSpeaker ? pocketDisplayName(pendingSpeaker) : pocketDisplayName(activeContact)} onClick={() => setInnerPersonId(pendingSpeaker?.id || activeContact.id)} /><div className="pocket-typing" aria-label="对方正在输入"><i /><i /><i /></div></div>}
                  {errors[activeContact.id] && <div className="pocket-chat-error" role="alert"><span>{errors[activeContact.id]}</span><div>{canChat && <button type="button" disabled={!!pendingContactId} onClick={() => void generateReply()}>重试回复</button>}<button type="button" onClick={() => setApp("settings")}>手机设置</button></div></div>}
                  {!canChat && !errors[activeContact.id] && <button className="pocket-model-hint" type="button" onClick={() => setApp("settings")}>选一个聊天模型，收到 TA 的回复 <ChevronRight size={14} /></button>}
                </div>
                {attachOpen && <div className="pocket-wx-attach-panel" aria-label="聊天附件">{([{ kind: "transfer", label: "转账", icon: Wallet }, { kind: "image", label: "图片", icon: ImageIcon }, { kind: "voice", label: "语音", icon: Mic }, { kind: "location", label: "位置", icon: MapPin }] as const).map(item => <button type="button" key={item.kind} onClick={() => setAttachmentKind(item.kind)}><span><item.icon size={25} strokeWidth={1.7} /></span><small>{item.label}</small></button>)}</div>}
                <form className="pocket-composer" onSubmit={event => { event.preventDefault(); void sendMessage(); }}><textarea rows={1} aria-label={`给${pocketDisplayName(activeContact)}发消息`} placeholder="发消息…" value={draft} onChange={event => setDrafts(previous => ({ ...previous, [activeContact.id]: event.target.value }))} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); } }} /><button className="pocket-attach-toggle" type="button" aria-label="更多聊天功能" aria-expanded={attachOpen} onClick={() => setAttachOpen(!attachOpen)}><Plus size={23} /></button>{pendingContactId === activeContact.id && !draft.trim() ? <button type="button" aria-label="停止回复" onClick={event => { event.preventDefault(); controllerRef.current?.abort(); setErrors(previous => ({ ...previous, [activeContact.id]: "已停止等待，可以重试回复。" })); }}><Square size={15} fill="currentColor" /></button> : <button className="pocket-send" type="submit" aria-label="发送消息" title={draft.trim() ? "发送消息" : getPocketGenerationMode(activeContact) === "reply" ? "生成回复" : "让对方主动发消息"} disabled={!draft.trim() && !!pendingContactId}><Send size={17} /></button>}</form>
              </> : <>
                {tab === "discover" ? <div className="pocket-list-body pocket-scroll"><button className="pocket-moments-discover" type="button" onClick={() => setApp("moments")}><span aria-hidden="true" /><strong>朋友圈</strong><ChevronRight size={16} /></button></div> : tab === "me" ? <PocketWechatWallet wallet={state.wallet} nickname={nickname} avatar={userProfile.avatarImage} page={mePage} onPage={setMePage} onBalance={amount => updateState(previous => editPocketBalance(previous, amount))} onSettings={() => setApp("settings")} onMoments={() => setApp("moments")} /> : <div className="pocket-list-body pocket-scroll">
                  <label className="pocket-search"><Search size={15} /><input aria-label="搜索联系人" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)} /></label>
                  {tab === "contacts" && <button className="pocket-new-friend" type="button" onClick={addContact}><span><Plus size={21} /></span><strong>新的朋友</strong><small>添加</small><ChevronRight size={15} /></button>}
                  {!!listedContacts.length && <div className="pocket-list-label">{tab === "contacts" ? `我的朋友 · ${listedContacts.length}` : "最近的聊天"}</div>}
                  {listedContacts.map(contact => <button className="pocket-contact-row" type="button" key={contact.id} onClick={() => openContact(contact)}><ConversationAvatar conversation={contact} /><span><strong>{pocketDisplayName(contact)}</strong>{(pendingContactId === contact.id || tab !== "contacts" || isPocketGroup(contact)) && <small>{pendingContactId === contact.id ? "对方正在输入…" : tab === "contacts" && isPocketGroup(contact) ? `${contact.members.length + 1} 位群成员` : contact.messages.at(-1) ? `${isPocketGroup(contact) && contact.messages.at(-1)?.speaker ? `${pocketSpeakerName(contact, contact.messages.at(-1)!)}：` : ""}${pocketMessagePreview(contact.messages.at(-1)!)}` : "轻轻打个招呼吧 ♡"}</small>}</span><time>{tab === "contacts" ? <ChevronRight size={14} /> : formatTime(contact.messages.at(-1) ? pocketWechatMessageTime(contact.messages.at(-1)!) : "")}</time></button>)}
                  {!listedContacts.length && <div className="pocket-empty">{query ? <span>还没有找到这位朋友</span> : <button className="pocket-primary" type="button" onClick={addContact}><Plus size={16} /> 添加第一位朋友</button>}</div>}
                </div>}
                {(tab !== "me" || mePage === "me") && <nav className="pocket-wechat-tabs" aria-label="微信导航">{([{ id: "chats", label: "微信", icon: MessageCircle }, { id: "contacts", label: "通讯录", icon: Users }, { id: "discover", label: "发现", icon: Compass }, { id: "me", label: "我", icon: UserRound }] as const).map(item => <button type="button" key={item.id} className={tab === item.id ? "is-active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); setMePage("me"); setQuery(""); }}><item.icon size={21} /><span>{item.label}</span></button>)}</nav>}
              </>}
            </div>}
          </div>
          <button type="button" className="pocket-home-indicator" inert={editor || groupEditor || confirmation || attachmentKind ? true : undefined} onClick={() => setApp("home")} aria-label="回到手机桌面"><span /></button>
          {editor && <div className="pocket-sheet-backdrop"><form ref={editorRef} className="pocket-sheet pocket-scroll" inert={confirmation ? true : undefined} role="dialog" aria-modal="true" aria-labelledby="pocket-editor-title" onSubmit={saveContact}><header><div><small>A NEW LITTLE STORY</small><h3 id="pocket-editor-title">{editor.id ? "朋友的小档案" : "认识一位新朋友"}</h3></div><button type="button" aria-label="关闭联系人编辑" onClick={() => setEditor(null)}><X size={18} /></button></header>
            {!editor.id && <PocketFriendPicker mode={friendMode} onMode={mode => { setFriendMode(mode); setEditorError(""); }} sessionId={props.sessionId} cards={props.characterCards} existing={state.contacts} excludedNames={[nickname, props.userProfile.nickname]} provider={selection.provider} modelId={selection.modelId} buildContext={props.onBuildFriendContext} library={friendLibrary} onAdd={addSelectedFriends} onDelete={character => setConfirmation({ title: `从角色库删除${character.name}？`, description: "各会话已有的联系人和聊天会保留，删除后不能再从角色库导入这份人设。", action: () => setFriendLibrary(changePocketFriendLibrary(storageKey, characters => characters.filter(person => person.id !== character.id))) })} />}
            {(editor.id || friendMode === "manual") && <>
            {!editor.id && <label className="pocket-field">从已有角色导入<select defaultValue="" onChange={event => importCharacter(event.target.value)}><option value="">自己创建一个角色</option><optgroup label="角色库">{friendLibrary.characters.map(person => <option key={person.id} value={`library:${person.id}`} disabled={state.contacts.some(contact => pocketFriendName(contact.name) === pocketFriendName(person.name))}>{person.name}</option>)}</optgroup><optgroup label="人格">{props.personas.map(persona => <option key={persona.id} value={`persona:${persona.id}`}>{persona.name}</option>)}</optgroup></select></label>}
            <div className="pocket-editor-avatar"><Avatar avatar={editor.draft.avatar} name={editor.draft.name} /><span>选一枚可爱的头像</span></div><div className="pocket-avatar-picker">{POCKET_AVATARS.map((avatar, index) => <button type="button" key={avatar} aria-label={`选择头像${index + 1}`} aria-pressed={editor.draft.avatar === avatar} className={editor.draft.avatar === avatar ? "is-selected" : ""} onClick={() => patchDraft({ avatar })}><img src={avatar} alt="" loading="lazy" decoding="async" /></button>)}</div>
            <label className="pocket-field">朋友的名字<input autoFocus required maxLength={30} placeholder="比如：奶糖、月岛、你的专属角色" value={editor.draft.name} onChange={event => patchDraft({ name: event.target.value })} /></label>
            <label className="pocket-field">昵称<input maxLength={30} value={editor.draft.nickname || ""} onChange={event => patchDraft({ nickname: event.target.value })} /></label>
            <label className="pocket-field">角色设定 <span>性格、身份，以及你们的关系</span><textarea required rows={4} placeholder="TA 是谁？说话是什么语气？和你有什么关系？越具体，聊天就越有角色的感觉。" value={editor.draft.personality} onChange={event => patchDraft({ personality: event.target.value })} /></label>
            <label className="pocket-field">第一句招呼 <span>可选</span><textarea rows={2} placeholder="嗨，今天有没有想我呀？" value={editor.draft.greeting} onChange={event => patchDraft({ greeting: event.target.value })} /></label>
            <button type="submit" className="pocket-primary"><Heart size={16} />{editor.id ? "保存小档案" : "添加到通讯录"}</button>
            </>}
            {editorError && <p className="pocket-editor-error" role="alert">{editorError}</p>}
            {editor.id && <div className="pocket-contact-actions"><button type="button" disabled={pendingContactId === editor.id} onClick={() => { const id = editor.id!; setConfirmation({ title: "清空这段聊天？", description: "联系人会保留，微信及当前会话中的对应记录将清空，无法恢复。", action: () => { updateContact(id, contact => resetPocketContactChat(contact, nickname)); setErrors(previous => ({ ...previous, [id]: "" })); setEditor(null); } }); }}>清空聊天</button><button type="button" disabled={pendingContactId === editor.id} onClick={() => { const id = editor.id!; setConfirmation({ title: "删除这位联系人？", description: "这位朋友和你们的聊天记录将从手机及当前会话中删除。", action: () => { updateState(previous => ({ ...previous, contacts: previous.contacts.filter(contact => contact.id !== id) })); setContactId(""); setEditor(null); } }); }}>删除联系人</button></div>}
          </form></div>}
          {groupEditor && <div className="pocket-sheet-backdrop"><form ref={editorRef} className="pocket-sheet pocket-scroll" inert={confirmation ? true : undefined} role="dialog" aria-modal="true" aria-labelledby="pocket-group-title" onSubmit={saveGroup}>
            <header><h3 id="pocket-group-title">{groupEditor.id ? "群聊设置" : "发起群聊"}</h3><button type="button" aria-label="关闭群聊设置" onClick={() => setGroupEditor(null)}><X size={18} /></button></header>
            <label className="pocket-field">群名称<input autoFocus maxLength={30} placeholder="群名称" value={groupEditor.name} onChange={event => setGroupEditor(previous => previous ? { ...previous, name: event.target.value } : null)} /></label>
            <div className="pocket-group-label">群成员 ({groupEditor.memberIds.length + 1})</div>
            <div className="pocket-member-self"><input type="checkbox" checked disabled aria-label={nickname} /><Avatar avatar={userProfile.avatarImage || DEFAULT_POCKET_USER_AVATAR} name={nickname} self /><strong>{nickname}</strong><span>我</span></div>
            <div className="pocket-group-picker">{groupChoices.map(member => <label key={member.id} className="pocket-member-choice"><input type="checkbox" checked={groupEditor.memberIds.includes(member.id)} onChange={event => { const checked = event.target.checked; setGroupEditor(previous => previous ? { ...previous, memberIds: checked ? [...previous.memberIds, member.id] : previous.memberIds.filter(id => id !== member.id) } : null); }} /><Avatar avatar={member.avatar} name={pocketDisplayName(member)} /><strong>{pocketDisplayName(member)}</strong></label>)}</div>
            {!groupChoices.length && <button type="button" className="pocket-new-friend" onClick={() => { setGroupEditor(null); addContact(); }}><Plus size={17} /> 添加联系人</button>}
            {editorError && <p className="pocket-editor-error" role="alert">{editorError}</p>}
            <button type="submit" className="pocket-primary" disabled={!!groupEditor.id && pendingContactId === groupEditor.id}><Users size={16} />{groupEditor.id ? "保存群聊" : "创建群聊"}</button>
            {groupEditor.id && <div className="pocket-contact-actions"><button type="button" disabled={pendingContactId === groupEditor.id} onClick={() => { const id = groupEditor.id!; setConfirmation({ title: "清空群聊记录？", description: "群成员会保留，群聊及当前会话中的对应记录将清空，无法恢复。", action: () => { updateGroup(id, resetPocketGroupChat); setErrors(previous => ({ ...previous, [id]: "" })); setGroupEditor(null); } }); }}>清空聊天</button><button type="button" disabled={pendingContactId === groupEditor.id} onClick={() => { const id = groupEditor.id!; setConfirmation({ title: "解散这个群聊？", description: "群聊和对应记录将从手机及当前会话中删除。", action: () => { updateState(previous => ({ ...previous, groups: previous.groups.filter(group => group.id !== id) })); setContactId(""); setGroupEditor(null); } }); }}>解散群聊</button></div>}
          </form></div>}
          {attachmentKind && activeContact && <PocketWechatAttachDialog key={`${activeContact.id}:${attachmentKind}`} kind={attachmentKind} conversation={activeContact} balance={state.wallet.balance} onClose={closeAttachment} onSend={attachment => { updateState(previous => appendPocketAttachment(previous, activeContact.id, attachment)); setAttachOpen(false); setErrors(previous => ({ ...previous, [activeContact.id]: "" })); }} />}
          {innerPerson && <PocketPhoneInner person={innerPerson} dialogRef={innerRef} onClose={() => setInnerPersonId("")} />}
          {confirmation && <div className="pocket-confirm-backdrop"><div ref={confirmationRef} className="pocket-confirm" role="alertdialog" aria-modal="true" aria-labelledby="pocket-confirm-title"><Heart size={25} /><h3 id="pocket-confirm-title">{confirmation.title}</h3><p>{confirmation.description}</p><div><button type="button" onClick={() => setConfirmation(null)}>再想想</button><button type="button" onClick={() => { confirmation.action(); setConfirmation(null); }}>确认</button></div></div></div>}
        </div>
      </div>
    </div>
    <footer className="pocket-panel-footer"><Heart size={10} /><span>小小的屏幕，装下大大的喜欢</span><Heart size={10} /></footer>
  </section>;
}
