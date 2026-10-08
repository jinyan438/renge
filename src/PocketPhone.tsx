import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowLeft, BatteryFull, Check, ChevronRight, Heart, MessageCircle, MoreHorizontal, Plus, Search, Send, Settings, Signal, Sparkles, Square, Users, Wifi, X } from "lucide-react";
import type { CharacterCard } from "./characterCardUtils";
import type { AgentPersona } from "./types";
import { DEFAULT_POCKET_AVATAR, DEFAULT_POCKET_USER_AVATAR, emptyPocketState, getPocketConversations, getPocketGenerationMode, getPocketMessageBubbles, isPocketGroup, makePocketContact, normalizePocketState, pocketId, pocketStorageKey, POCKET_AVATARS, POCKET_THEMES, resetPocketContactChat, safePocketAvatar, type PocketContact, type PocketConversation, type PocketGroup, type PocketGroupMember, type PocketMessage, type PocketSettings, type PocketState } from "./pocketPhoneState";
import { makePocketGroup, parsePocketGroupReply, pocketGroupMember, resolvePocketGroup } from "./pocketPhoneGroup";
import type { PocketContextSync, PocketConversationBuilder } from "./pocketPhoneContext";
import { requestPocketReply, resolvePocketModel, type PocketProvider } from "./pocketPhoneChat";
import { applyPocketContextChanges, recordPocketContextDeletions, subscribePocketContextChanges } from "./pocketPhoneSync";
import "./pocket-phone.css";
import { PocketXiaohongshu } from "./PocketXiaohongshu";
import { getRedRoles } from "./pocketXiaohongshuGeneration";
import { normalizeRedState, redStorageKey } from "./pocketXiaohongshuState";
import { redContextConversation } from "./pocketXiaohongshuContext";

type PocketPhoneProps = {
  sessionId: string; personas: AgentPersona[]; characterCards: CharacterCard[];
  providers: PocketProvider[]; activeProviderId: string;
  userProfile: { nickname: string; bio: string; avatarImage: string };
  onSyncContext: PocketContextSync; onBuildConversation: PocketConversationBuilder;
  onBack: () => void; onClose: () => void;
};
type PhoneApp = "home" | "wechat" | "xiaohongshu" | "settings";
type WechatTab = "chats" | "contacts";
type ContactDraft = Pick<PocketContact, "name" | "avatar" | "personality" | "greeting" | "sourceLabel" | "sourceCharacterCardId">;
type Confirmation = { title: string; description: string; action: () => void };

function Avatar({ avatar, name, self = false }: { avatar: string; name: string; self?: boolean }) {
  const safeAvatar = safePocketAvatar(avatar);
  return <span className={`pocket-avatar${self ? " is-self" : ""}`}>
    <img src={safeAvatar} alt={name} decoding="async" onError={event => { if (event.currentTarget.getAttribute("src") !== DEFAULT_POCKET_AVATAR) event.currentTarget.src = DEFAULT_POCKET_AVATAR; }} />
  </span>;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function ConversationAvatar({ conversation }: { conversation: PocketConversation }) {
  return isPocketGroup(conversation) ? <span className="pocket-group-avatar" aria-label="群头像">{conversation.members.slice(0, 4).map(member => <Avatar key={member.id} avatar={member.avatar} name={member.name} />)}</span> : <Avatar avatar={conversation.avatar} name={conversation.name} />;
}

export function PocketPhone(props: PocketPhoneProps) {
  const storageKey = pocketStorageKey(props.sessionId);
  const [storageWarning, setStorageWarning] = useState("");
  const [state, setState] = useState<PocketState>(() => {
    try { const saved = localStorage.getItem(storageKey); return saved ? normalizePocketState(JSON.parse(saved)) : emptyPocketState(); }
    catch { return emptyPocketState(); }
  });
  const stateRef = useRef(state);
  const [app, setApp] = useState<PhoneApp>("home");
  const [tab, setTab] = useState<WechatTab>("chats");
  const [contactId, setContactId] = useState("");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<{ id?: string; draft: ContactDraft } | null>(null);
  const [groupEditor, setGroupEditor] = useState<{ id?: string; name: string; memberIds: string[]; members: PocketGroupMember[] } | null>(null);
  const [editorError, setEditorError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pendingContactId, setPendingContactId] = useState("");
  const [pendingSpeaker, setPendingSpeaker] = useState<PocketGroupMember | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const editorRef = useRef<HTMLFormElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  const conversations = getPocketConversations(state);
  const activeContact = conversations.find(contact => contact.id === contactId);
  const nickname = state.settings.nickname.trim() || props.userProfile.nickname.trim() || "小小的我";
  const selection = resolvePocketModel(props.providers, props.activeProviderId, state.settings.providerId, state.settings.modelId);
  const currentTheme = POCKET_THEMES.find(theme => theme.id === state.settings.theme)!;
  const canChat = !!selection.provider?.apiBaseUrl.trim() && !!selection.modelId.trim();

  function updateState(change: (previous: PocketState) => PocketState) {
    const previous = stateRef.current;
    const changed = change(previous);
    const next = recordPocketContextDeletions(previous, { ...changed, groups: changed.groups.map(group => resolvePocketGroup(group, changed.contacts)) });
    stateRef.current = next;
    setState(next);
    props.onSyncContext(props.sessionId, getPocketConversations(previous), getPocketConversations(next), next.settings.nickname.trim() || props.userProfile.nickname.trim() || "小小的我", next.deletedContextMessages);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageWarning(""); }
    catch { setStorageWarning("手机存储空间不足或不可用，这次改动暂未保存。请保留当前页面。"); }
  }
  function updateSettings(patch: Partial<PocketSettings>) { updateState(previous => ({ ...previous, settings: { ...previous.settings, ...patch } })); }
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
  function openWechat(nextTab: WechatTab = "chats") { setApp("wechat"); setTab(nextTab); setContactId(""); setQuery(""); }
  function openContact(contact: PocketConversation) { setContactId(contact.id); setApp("wechat"); setQuery(""); }
  function addContact() { setEditorError(""); setEditor({ draft: { name: "", avatar: DEFAULT_POCKET_AVATAR, personality: "", greeting: "", sourceLabel: "自定义角色" } }); }
  function editContact(contact: PocketContact) { setEditorError(""); setEditor({ id: contact.id, draft: { name: contact.name, avatar: contact.avatar, personality: contact.personality, greeting: contact.greeting, sourceLabel: contact.sourceLabel, sourceCharacterCardId: contact.sourceCharacterCardId } }); }
  function editGroup(group?: PocketGroup) {
    setEditorError(""); setEditor(null);
    setGroupEditor({ id: group?.id, name: group?.name || "", memberIds: group?.members.map(member => member.id) || [], members: group?.members || [] });
  }

  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => subscribePocketContextChanges(props.sessionId, (changes, warning) => {
    const previous = stateRef.current;
    const next = applyPocketContextChanges(previous, changes);
    if (next === previous) return;
    const pending = getPocketConversations(previous).find(conversation => conversation.id === pendingContactId);
    if (pending && getPocketConversations(next).find(conversation => conversation.id === pending.id) !== pending) {
      controllerRef.current?.abort();
    }
    stateRef.current = next;
    setState(next);
    setStorageWarning(warning);
  }), [props.sessionId, pendingContactId]);
  useEffect(() => {
    mountedRef.current = true;
    props.onSyncContext(props.sessionId, null, getPocketConversations(stateRef.current), nickname, stateRef.current.deletedContextMessages);
    try {
      const redState = normalizeRedState(JSON.parse(localStorage.getItem(redStorageKey(props.sessionId)) || "null"));
      props.onSyncContext(props.sessionId, null, [redContextConversation(redState)], nickname, redState.deletedContextMessages);
    } catch { /* Keep existing main context when local phone storage is unavailable. */ }
    return () => { mountedRef.current = false; controllerRef.current?.abort(); };
  }, []);
  useEffect(() => { const node = conversationRef.current; if (node) node.scrollTop = node.scrollHeight; }, [contactId, activeContact?.messages.length, pendingContactId, errors[contactId]]);
  useEffect(() => {
    const dialog = confirmation ? confirmationRef.current : editor || groupEditor ? editorRef.current : null;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]'));
    if (confirmation) focusables()[0]?.focus();
    const trapFocus = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key === "Escape") { event.preventDefault(); if (confirmation) setConfirmation(null); else { setEditor(null); setGroupEditor(null); } }
      if (event.key !== "Tab") return;
      const elements = focusables();
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener("keydown", trapFocus);
    return () => { dialog.removeEventListener("keydown", trapFocus); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [!!editor, !!groupEditor, !!confirmation]);

  function importCharacter(value: string) {
    if (!editor || !value) return;
    const card = props.characterCards.find(item => `card:${item.id}` === value);
    const persona = props.personas.find(item => `persona:${item.id}` === value);
    const draft = card ? {
      name: card.nickname || card.name, avatar: safePocketAvatar(card.avatarDataUrl), sourceLabel: "来自角色卡", sourceCharacterCardId: card.id,
      personality: [card.description, card.personality, card.scenario && `场景：${card.scenario}`, card.systemPrompt, card.messageExample && `对话示例：${card.messageExample}`, card.postHistoryInstructions].filter(Boolean).join("\n\n"),
      greeting: card.firstMessage,
    } : persona ? {
      name: persona.name, avatar: safePocketAvatar(persona.avatarImage), sourceLabel: "来自人格", sourceCharacterCardId: undefined,
      personality: [persona.description, ...persona.entryTypes.flatMap(type => type.entries.filter(entry => entry.enabled).map(entry => `${type.name} · ${entry.key}：${entry.value}`))].filter(Boolean).join("\n"), greeting: "",
    } : null;
    if (draft) setEditor({ ...editor, draft });
  }

  function saveContact(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    try {
      const validated = makePocketContact(editor.draft);
      if (editor.id) {
        const previous = stateRef.current.contacts.find(contact => contact.id === editor.id);
        const roleChanged = previous && (previous.name !== validated.name || previous.personality !== validated.personality || previous.sourceCharacterCardId !== validated.sourceCharacterCardId);
        const pending = getPocketConversations(stateRef.current).find(contact => contact.id === pendingContactId);
        // A reply already in flight carries the old role, including group rounds.
        if (roleChanged && pending && (pending.id === editor.id || isPocketGroup(pending) && pending.members.some(member => member.id === editor.id))) controllerRef.current?.abort();
        updateContact(editor.id, contact => ({ ...contact, ...editor.draft, name: validated.name, personality: validated.personality, avatar: validated.avatar, greeting: validated.greeting }));
      }
      else {
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
      try { return await requestPocketReply(selection.provider, selection.modelId, props.onBuildConversation(props.sessionId, conversation, { nickname, bio: props.userProfile.bio }, mode, speaker, excludedIds), controller.signal); }
      finally { clearTimeout(timeout); }
    };
    try {
      if (isPocketGroup(contact)) {
        const replies: PocketMessage[] = [];
        for (const member of contact.members) {
          setPendingSpeaker(member);
          const reply = await request({ ...contact, messages: [...contact.messages, ...replies] }, member);
          if (controller.signal.aborted) return;
          replies.push(...parsePocketGroupReply(reply, member, replyContextMessageId));
        }
        updateGroup(contact.id, previous => ({ ...previous, messages: [...previous.messages, ...replies], replyContextMessageId }));
        if (!replies.length) setErrors(previous => ({ ...previous, [contact.id]: "本轮暂无新消息。" }));
      } else {
        const reply = await request(contact);
        if (controller.signal.aborted) return;
        appendMessages(contact.id, [{ id: pocketId(), role: "assistant", content: reply, createdAt: new Date().toISOString(), replyContextMessageId }]);
      }
    } catch (error) {
      if (mountedRef.current && (!controller.signal.aborted || controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError")) setErrors(previous => ({ ...previous, [contact.id]: error instanceof Error ? error.message : "暂时没有连接上，请重试。" }));
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; if (mountedRef.current) { setPendingContactId(""); setPendingSpeaker(null); } }
    }
  }

  const searchedContacts = conversations.filter(contact => contact.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const listedContacts = [...searchedContacts].sort((a, b) => tab === "contacts" ? a.name.localeCompare(b.name, "zh-CN") : (b.messages.at(-1)?.createdAt || b.createdAt).localeCompare(a.messages.at(-1)?.createdAt || a.createdAt));
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
      <span><strong>口袋手机</strong><small>把可爱和想念，随身收藏</small></span>
      <button type="button" onClick={props.onClose} aria-label="关闭手机模块"><X size={17} /></button>
    </header>
    <div className="pocket-stage">
      <div className={`pocket-device theme-${state.settings.theme}${state.settings.largeText ? " large-text" : ""}`} style={{ "--pocket-swatch": currentTheme.color } as CSSProperties}>
        <div className="pocket-side-button" aria-hidden="true" />
        <div className={`pocket-screen app-${app}`}>
          <div className="pocket-status"><span>{formatTime(now.toISOString())}</span><div className="pocket-island" aria-hidden="true"><i /></div><span aria-label="信号良好，电量充足"><Signal size={12} /><Wifi size={12} /><BatteryFull size={17} /></span></div>
          {storageWarning && <div className="pocket-storage-warning" role="alert">{storageWarning}</div>}
          <div className="pocket-content" key={app} inert={editor || groupEditor || confirmation ? true : undefined}>
            {app === "home" ? <div className="pocket-home">
              <div className="pocket-home-date"><span>{now.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</span><strong>{formatTime(now.toISOString())}</strong></div>
              <div className="pocket-app-grid">
                <button className="pocket-app-icon" type="button" onClick={() => openWechat()} aria-label="打开微信"><span className="pocket-icon-wechat"><MessageCircle size={33} strokeWidth={2.3} fill="white" /><MessageCircle className="pocket-chat-icon-small" size={23} fill="#d8f4dc" /></span><strong>微信</strong></button>
                <button className="pocket-app-icon" type="button" onClick={() => setApp("xiaohongshu")} aria-label="打开小红书"><span className="pocket-icon-xiaohongshu"><b>小红书</b></span><strong>小红书</strong></button>
                <button className="pocket-app-icon" type="button" onClick={() => setApp("settings")} aria-label="打开手机设置"><span className="pocket-icon-settings"><Settings size={34} strokeWidth={1.7} /></span><strong>设置</strong></button>
              </div>
            </div> : app === "xiaohongshu" ? <PocketXiaohongshu sessionId={props.sessionId} nickname={nickname} bio={props.userProfile.bio} avatar={props.userProfile.avatarImage} roles={getRedRoles(state.contacts, props.personas, props.characterCards)} provider={selection.provider} modelId={selection.modelId} onBuildConversation={props.onBuildConversation} onSyncContext={props.onSyncContext} onSettings={() => setApp("settings")} onExit={() => setApp("home")} /> : app === "settings" ? <div className="pocket-settings pocket-scroll">
              <div className="pocket-app-heading"><button type="button" onClick={() => setApp("home")} aria-label="返回手机桌面"><ArrowLeft size={19} /></button><h2>设置</h2></div>
              <div className="pocket-profile-card"><Avatar avatar={props.userProfile.avatarImage || DEFAULT_POCKET_USER_AVATAR} name={nickname} self /><span><strong>{nickname}</strong></span><Sparkles size={19} /></div>
              <label className="pocket-settings-label" htmlFor="pocket-nickname">我的昵称</label><input id="pocket-nickname" className="pocket-input" maxLength={24} placeholder={props.userProfile.nickname || "小小的我"} value={state.settings.nickname} onChange={event => updateSettings({ nickname: event.target.value })} />
              <div className="pocket-settings-label">手机主题</div><div className="pocket-theme-options">{POCKET_THEMES.map(theme => <button type="button" key={theme.id} className={state.settings.theme === theme.id ? "is-selected" : ""} onClick={() => updateSettings({ theme: theme.id })} aria-pressed={state.settings.theme === theme.id}><span style={{ background: theme.color }}>{state.settings.theme === theme.id && <Check size={16} />}</span><small>{theme.name}</small></button>)}</div>
              <div className="pocket-settings-label">角色聊天</div><div className="pocket-settings-group">
                <label htmlFor="pocket-provider">模型渠道</label><select id="pocket-provider" value={state.settings.providerId} onChange={event => updateSettings({ providerId: event.target.value, modelId: "" })}><option value="">跟随应用当前渠道</option>{props.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}{state.settings.providerId && !selection.provider && <option value={state.settings.providerId}>渠道已移除，请重新选择</option>}</select>
                <label htmlFor="pocket-model">聊天模型</label><select id="pocket-model" disabled={!state.settings.providerId || !selection.provider} value={selection.modelId} onChange={event => updateSettings({ modelId: event.target.value })}>{Array.from(new Set([selection.modelId, selection.provider?.modelId, ...selection.provider?.models || []].filter((value): value is string => !!value))).map(model => <option key={model} value={model}>{model}</option>)}{!selection.modelId && <option value="">暂无可用模型</option>}</select>
                {!canChat && <p>请先在应用的模型渠道中配置接口和模型。</p>}
              </div>
              <button className="pocket-setting-toggle" type="button" role="switch" aria-checked={state.settings.largeText} onClick={() => updateSettings({ largeText: !state.settings.largeText })}><span><strong>大一点的聊天文字</strong></span><i className={state.settings.largeText ? "is-on" : ""} /></button>
            </div> : <div className="pocket-wechat">
              <header className="pocket-wechat-header"><button type="button" onClick={() => activeContact ? setContactId("") : setApp("home")} aria-label={activeContact ? "返回微信列表" : "返回手机桌面"}><ArrowLeft size={19} /></button><span><strong>{activeContact?.name || (tab === "contacts" ? "通讯录" : "微信")}{activeContact && isPocketGroup(activeContact) && <em> ({activeContact.members.length + 1})</em>}</strong>{activeContact && pendingContactId === activeContact.id && <small>{pendingSpeaker ? `${pendingSpeaker.name}正在输入…` : "对方正在输入…"}</small>}</span>{!activeContact && <button type="button" onClick={() => editGroup()} aria-label="发起群聊" title="发起群聊"><Users size={20} /></button>}<button type="button" onClick={() => activeContact ? isPocketGroup(activeContact) ? editGroup(activeContact) : editContact(activeContact) : addContact()} aria-label={activeContact ? isPocketGroup(activeContact) ? "群聊设置" : "编辑联系人" : "添加联系人"}>{activeContact ? <MoreHorizontal size={22} /> : <Plus size={22} />}</button></header>
              {activeContact ? <>
                <div className="pocket-conversation pocket-scroll" ref={conversationRef} role="log" aria-label={`${activeContact.name}的聊天记录`} aria-live="polite">
                  {activeContact.messages.map((message, index) => <div key={message.id} className="pocket-message-group" data-message-id={message.id}>
                    {(index === 0 || new Date(message.createdAt).getTime() - new Date(activeContact.messages[index - 1].createdAt).getTime() > 300000) && <time className="pocket-message-time">{new Date(message.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} {formatTime(message.createdAt)}</time>}
                    {getPocketMessageBubbles(message).map((content, segmentIndex) => <div key={segmentIndex} className={`pocket-message ${message.role}`}><Avatar avatar={message.role === "user" ? props.userProfile.avatarImage || DEFAULT_POCKET_USER_AVATAR : isPocketGroup(activeContact) ? message.speaker?.avatar || DEFAULT_POCKET_AVATAR : activeContact.avatar} name={message.role === "user" ? nickname : message.speaker?.name || activeContact.name} self={message.role === "user"} /><div className="pocket-message-body">{isPocketGroup(activeContact) && message.role === "assistant" && <button className="pocket-speaker-name" type="button" title={`@${message.speaker?.name}`} onClick={() => setDrafts(previous => ({ ...previous, [activeContact.id]: `${previous[activeContact.id] || ""}@${message.speaker?.name} ` }))}>{message.speaker?.name}</button>}<div className="pocket-message-bubble">{content}</div></div></div>)}
                  </div>)}
                  {pendingContactId === activeContact.id && <div className="pocket-message assistant"><Avatar avatar={isPocketGroup(activeContact) ? pendingSpeaker?.avatar || DEFAULT_POCKET_AVATAR : activeContact.avatar} name={pendingSpeaker?.name || activeContact.name} /><div className="pocket-typing" aria-label="对方正在输入"><i /><i /><i /></div></div>}
                  {errors[activeContact.id] && <div className="pocket-chat-error" role="alert"><span>{errors[activeContact.id]}</span><div>{canChat && <button type="button" disabled={!!pendingContactId} onClick={() => void generateReply()}>重试回复</button>}<button type="button" onClick={() => setApp("settings")}>手机设置</button></div></div>}
                  {!canChat && !errors[activeContact.id] && <button className="pocket-model-hint" type="button" onClick={() => setApp("settings")}>选一个聊天模型，收到 TA 的回复 <ChevronRight size={14} /></button>}
                </div>
                <form className="pocket-composer" onSubmit={event => { event.preventDefault(); void sendMessage(); }}><textarea rows={1} aria-label={`给${activeContact.name}发消息`} placeholder="分享一点今天的小事…" value={draft} onChange={event => setDrafts(previous => ({ ...previous, [activeContact.id]: event.target.value }))} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); } }} />{pendingContactId === activeContact.id && !draft.trim() ? <button type="button" aria-label="停止回复" onClick={event => { event.preventDefault(); controllerRef.current?.abort(); setErrors(previous => ({ ...previous, [activeContact.id]: "已停止等待，可以重试回复。" })); }}><Square size={15} fill="currentColor" /></button> : <button className="pocket-send" type="submit" aria-label="发送消息" title={draft.trim() ? "发送消息" : getPocketGenerationMode(activeContact) === "reply" ? "生成回复" : "让对方主动发消息"} disabled={!draft.trim() && !!pendingContactId}><Send size={17} /></button>}</form>
              </> : <>
                <div className="pocket-list-body pocket-scroll">
                  <label className="pocket-search"><Search size={15} /><input aria-label="搜索联系人" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)} /></label>
                  {tab === "contacts" && <button className="pocket-new-friend" type="button" onClick={addContact}><span><Plus size={21} /></span><strong>新的朋友</strong><small>添加</small><ChevronRight size={15} /></button>}
                  {!!listedContacts.length && <div className="pocket-list-label">{tab === "contacts" ? `我的朋友 · ${listedContacts.length}` : "最近的聊天"}</div>}
                  {listedContacts.map(contact => <button className="pocket-contact-row" type="button" key={contact.id} onClick={() => openContact(contact)}><ConversationAvatar conversation={contact} /><span><strong>{contact.name}</strong><small>{pendingContactId === contact.id ? "对方正在输入…" : tab === "contacts" ? isPocketGroup(contact) ? `${contact.members.length + 1} 位群成员` : contact.sourceLabel || "自定义角色" : contact.messages.at(-1) ? `${isPocketGroup(contact) && contact.messages.at(-1)?.speaker ? `${contact.messages.at(-1)!.speaker!.name}：` : ""}${contact.messages.at(-1)!.content}` : "轻轻打个招呼吧 ♡"}</small></span><time>{tab === "contacts" ? <ChevronRight size={14} /> : formatTime(contact.messages.at(-1)?.createdAt || "")}</time></button>)}
                  {!listedContacts.length && <div className="pocket-empty">{query ? <span>还没有找到这位朋友</span> : <button className="pocket-primary" type="button" onClick={addContact}><Plus size={16} /> 添加第一位朋友</button>}</div>}
                </div>
                <nav className="pocket-wechat-tabs" aria-label="微信导航">{([{ id: "chats", label: "微信", icon: MessageCircle }, { id: "contacts", label: "通讯录", icon: Users }] as const).map(item => <button type="button" key={item.id} className={tab === item.id ? "is-active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); setQuery(""); }}><item.icon size={21} /><span>{item.label}</span></button>)}</nav>
              </>}
            </div>}
          </div>
          <button type="button" className="pocket-home-indicator" inert={editor || groupEditor || confirmation ? true : undefined} onClick={() => setApp("home")} aria-label="回到手机桌面"><span /></button>
          {editor && <div className="pocket-sheet-backdrop"><form ref={editorRef} className="pocket-sheet pocket-scroll" inert={confirmation ? true : undefined} role="dialog" aria-modal="true" aria-labelledby="pocket-editor-title" onSubmit={saveContact}><header><div><small>A NEW LITTLE STORY</small><h3 id="pocket-editor-title">{editor.id ? "朋友的小档案" : "认识一位新朋友"}</h3></div><button type="button" aria-label="关闭联系人编辑" onClick={() => setEditor(null)}><X size={18} /></button></header>
            {!editor.id && <label className="pocket-field">从已有角色导入<select defaultValue="" onChange={event => importCharacter(event.target.value)}><option value="">自己创建一个角色</option><optgroup label="角色卡">{props.characterCards.map(card => <option key={card.id} value={`card:${card.id}`}>{card.name}</option>)}</optgroup><optgroup label="人格">{props.personas.map(persona => <option key={persona.id} value={`persona:${persona.id}`}>{persona.name}</option>)}</optgroup></select></label>}
            <div className="pocket-editor-avatar"><Avatar avatar={editor.draft.avatar} name={editor.draft.name} /><span>选一枚可爱的头像</span></div><div className="pocket-avatar-picker">{POCKET_AVATARS.map((avatar, index) => <button type="button" key={avatar} aria-label={`选择头像${index + 1}`} aria-pressed={editor.draft.avatar === avatar} className={editor.draft.avatar === avatar ? "is-selected" : ""} onClick={() => patchDraft({ avatar })}><img src={avatar} alt="" loading="lazy" decoding="async" /></button>)}</div>
            <label className="pocket-field">朋友的名字<input autoFocus required maxLength={30} placeholder="比如：奶糖、月岛、你的专属角色" value={editor.draft.name} onChange={event => patchDraft({ name: event.target.value })} /></label>
            <label className="pocket-field">角色设定 <span>性格、身份，以及你们的关系</span><textarea required rows={4} placeholder="TA 是谁？说话是什么语气？和你有什么关系？越具体，聊天就越有角色的感觉。" value={editor.draft.personality} onChange={event => patchDraft({ personality: event.target.value })} /></label>
            <label className="pocket-field">第一句招呼 <span>可选</span><textarea rows={2} placeholder="嗨，今天有没有想我呀？" value={editor.draft.greeting} onChange={event => patchDraft({ greeting: event.target.value })} /></label>{editorError && <p className="pocket-editor-error" role="alert">{editorError}</p>}
            <button type="submit" className="pocket-primary"><Heart size={16} />{editor.id ? "保存小档案" : "添加到通讯录"}</button>
            {editor.id && <div className="pocket-contact-actions"><button type="button" disabled={pendingContactId === editor.id} onClick={() => { const id = editor.id!; setConfirmation({ title: "清空这段聊天？", description: "联系人会保留，微信及当前会话中的对应记录将清空，无法恢复。", action: () => { updateContact(id, contact => resetPocketContactChat(contact, nickname)); setErrors(previous => ({ ...previous, [id]: "" })); setEditor(null); } }); }}>清空聊天</button><button type="button" disabled={pendingContactId === editor.id} onClick={() => { const id = editor.id!; setConfirmation({ title: "删除这位联系人？", description: "这位朋友和你们的聊天记录将从手机及当前会话中删除。", action: () => { updateState(previous => ({ ...previous, contacts: previous.contacts.filter(contact => contact.id !== id) })); setContactId(""); setEditor(null); } }); }}>删除联系人</button></div>}
          </form></div>}
          {groupEditor && <div className="pocket-sheet-backdrop"><form ref={editorRef} className="pocket-sheet pocket-scroll" inert={confirmation ? true : undefined} role="dialog" aria-modal="true" aria-labelledby="pocket-group-title" onSubmit={saveGroup}>
            <header><h3 id="pocket-group-title">{groupEditor.id ? "群聊设置" : "发起群聊"}</h3><button type="button" aria-label="关闭群聊设置" onClick={() => setGroupEditor(null)}><X size={18} /></button></header>
            <label className="pocket-field">群名称<input autoFocus maxLength={30} placeholder="群名称" value={groupEditor.name} onChange={event => setGroupEditor(previous => previous ? { ...previous, name: event.target.value } : null)} /></label>
            <div className="pocket-group-label">群成员 ({groupEditor.memberIds.length + 1})</div>
            <div className="pocket-member-self"><input type="checkbox" checked disabled aria-label={nickname} /><Avatar avatar={props.userProfile.avatarImage || DEFAULT_POCKET_USER_AVATAR} name={nickname} self /><strong>{nickname}</strong><span>我</span></div>
            <div className="pocket-group-picker">{groupChoices.map(member => <label key={member.id} className="pocket-member-choice"><input type="checkbox" checked={groupEditor.memberIds.includes(member.id)} onChange={event => { const checked = event.target.checked; setGroupEditor(previous => previous ? { ...previous, memberIds: checked ? [...previous.memberIds, member.id] : previous.memberIds.filter(id => id !== member.id) } : null); }} /><Avatar avatar={member.avatar} name={member.name} /><strong>{member.name}</strong></label>)}</div>
            {!groupChoices.length && <button type="button" className="pocket-new-friend" onClick={() => { setGroupEditor(null); addContact(); }}><Plus size={17} /> 添加联系人</button>}
            {editorError && <p className="pocket-editor-error" role="alert">{editorError}</p>}
            <button type="submit" className="pocket-primary" disabled={!!groupEditor.id && pendingContactId === groupEditor.id}><Users size={16} />{groupEditor.id ? "保存群聊" : "创建群聊"}</button>
            {groupEditor.id && <div className="pocket-contact-actions"><button type="button" disabled={pendingContactId === groupEditor.id} onClick={() => { const id = groupEditor.id!; setConfirmation({ title: "清空群聊记录？", description: "群成员会保留，群聊及当前会话中的对应记录将清空，无法恢复。", action: () => { updateGroup(id, group => ({ ...group, messages: [], replyContextMessageId: undefined })); setErrors(previous => ({ ...previous, [id]: "" })); setGroupEditor(null); } }); }}>清空聊天</button><button type="button" disabled={pendingContactId === groupEditor.id} onClick={() => { const id = groupEditor.id!; setConfirmation({ title: "解散这个群聊？", description: "群聊和对应记录将从手机及当前会话中删除。", action: () => { updateState(previous => ({ ...previous, groups: previous.groups.filter(group => group.id !== id) })); setContactId(""); setGroupEditor(null); } }); }}>解散群聊</button></div>}
          </form></div>}
          {confirmation && <div className="pocket-confirm-backdrop"><div ref={confirmationRef} className="pocket-confirm" role="alertdialog" aria-modal="true" aria-labelledby="pocket-confirm-title"><Heart size={25} /><h3 id="pocket-confirm-title">{confirmation.title}</h3><p>{confirmation.description}</p><div><button type="button" onClick={() => setConfirmation(null)}>再想想</button><button type="button" onClick={() => { confirmation.action(); setConfirmation(null); }}>确认</button></div></div></div>}
        </div>
      </div>
    </div>
    <footer className="pocket-panel-footer"><Heart size={10} /><span>小小的屏幕，装下大大的喜欢</span><Heart size={10} /></footer>
  </section>;
}
