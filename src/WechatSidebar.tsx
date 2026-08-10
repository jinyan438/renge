import {
  ArrowLeft,
  BatteryFull,
  ChevronRight,
  Compass,
  ContactRound,
  ImagePlus,
  MapPin,
  MessageCircle,
  Mic,
  Monitor,
  MoreHorizontal,
  Plus,
  ScanLine,
  Search,
  Send,
  Signal,
  Smile,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  WalletCards,
  Wifi,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgentPersona } from "./types";
import {
  getWechatSessionStore,
  normalizeWechatStore,
  splitWechatReply,
  syncWechatSessionMessages,
  type WechatContact,
  type WechatSendMessageInput,
  type WechatSendMessageResult,
  type WechatSessionStore,
  type WechatStore,
  type WechatStoredMessage,
  updateWechatSessionStore,
} from "./wechatSidebarUtils";
import "./wechat-sidebar.css";

const WECHAT_STORAGE_KEY = "renge.wechat.sidebar.v2";
const LEGACY_WECHAT_STORAGE_KEY = "renge.wechat.sidebar.v1";
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

type ContactDraft = {
  id: string;
  name: string;
  nickname: string;
  avatarImage: string;
  profile: string;
  personaId: string;
};

type WechatSidebarProps = {
  personas: AgentPersona[];
  userProfile: {
    nickname: string;
    bio: string;
    avatarImage: string;
  };
  sessionId: string;
  busy?: boolean;
  syncedMessages: WechatStoredMessage[];
  onBack: () => void;
  onClose: () => void;
  onSendMessage: (
    contact: WechatContact,
    message: WechatSendMessageInput,
  ) => Promise<WechatSendMessageResult>;
};

function loadWechatStore(sessionId: string): WechatStore {
  try {
    const raw = localStorage.getItem(WECHAT_STORAGE_KEY);
    if (raw) {
      const normalized = normalizeWechatStore(JSON.parse(raw), sessionId);
      if (Object.keys(normalized.sessions).length > 0) return normalized;
    }
    const legacyRaw = localStorage.getItem(LEGACY_WECHAT_STORAGE_KEY);
    return legacyRaw
      ? normalizeWechatStore(JSON.parse(legacyRaw), sessionId)
      : normalizeWechatStore(null);
  } catch {
    return normalizeWechatStore(null);
  }
}

function createContactDraft(contact?: WechatContact): ContactDraft {
  return {
    id: contact?.id ?? "",
    name: contact?.name ?? "",
    nickname: contact?.nickname ?? "",
    avatarImage: contact?.avatarImage ?? "",
    profile: contact?.profile ?? "",
    personaId: contact?.personaId ?? "",
  };
}

function formatListTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function resizeAvatarFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const maxSide = 384;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("头像处理失败。 ");
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/webp", 0.84));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("头像图片读取失败。 "));
    };
    image.src = objectUrl;
  });
}

function ContactAvatar({ contact, size = "normal" }: { contact: WechatContact; size?: "normal" | "large" }) {
  const label = contact.name.trim() || contact.nickname.trim() || "朋友";
  return (
    <span className={`wechat-avatar ${size === "large" ? "is-large" : ""}`}>
      {contact.avatarImage ? (
        <img alt={`${label}头像`} src={contact.avatarImage} />
      ) : (
        <span aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

function UserAvatar({ image, nickname }: { image: string; nickname: string }) {
  return (
    <span className="wechat-avatar">
      {image ? (
        <img alt={`${nickname || "我"}头像`} src={image} />
      ) : (
        <span aria-hidden="true">{(nickname.trim() || "我").slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

export function WechatSidebar({
  personas,
  userProfile,
  sessionId,
  busy = false,
  syncedMessages,
  onBack,
  onClose,
  onSendMessage,
}: WechatSidebarProps) {
  const [store, setStore] = useState(() => loadWechatStore(sessionId));
  const [view, setView] = useState<"list" | "chat" | "contact">("list");
  const [activeTab, setActiveTab] = useState<"wechat" | "contacts" | "discover" | "me">("wechat");
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState<ContactDraft>(createContactDraft);
  const [draftError, setDraftError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [sendingContactId, setSendingContactId] = useState("");
  const [chatError, setChatError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(WECHAT_STORAGE_KEY, JSON.stringify(store));
      if (Object.keys(store.sessions).length > 0) {
        localStorage.removeItem(LEGACY_WECHAT_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("微信联系人数据保存失败", error);
    }
  }, [store]);

  useEffect(() => {
    if (sessionId) {
      setStore((current) => {
        if (current.sessions[sessionId]) return current;
        const restored = loadWechatStore(sessionId);
        return restored.sessions[sessionId] ? restored : current;
      });
    }
    setView("list");
    setActiveTab("wechat");
    setMenuOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
    setDraft(createContactDraft());
    setDraftError("");
    setChatInput("");
    setSendingContactId("");
    setChatError("");
    setEmojiOpen(false);
    setMoreOpen(false);
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const sessionStore = useMemo(
    () => getWechatSessionStore(store, sessionId),
    [sessionId, store],
  );
  const activeContact = useMemo(
    () =>
      sessionStore.contacts.find((contact) => contact.id === sessionStore.activeContactId) ??
      null,
    [sessionStore.activeContactId, sessionStore.contacts],
  );
  const activeMessages = useMemo(
    () => sessionStore.messages.filter((message) => message.contactId === activeContact?.id),
    [activeContact?.id, sessionStore.messages],
  );

  useEffect(() => {
    if (view === "chat" && !activeContact) setView("list");
  }, [activeContact, view]);

  const updateCurrentSession = (
    updater: (current: WechatSessionStore) => WechatSessionStore,
  ) => {
    setStore((current) => updateWechatSessionStore(current, sessionId, updater));
  };

  useEffect(() => {
    setStore((current) =>
      updateWechatSessionStore(current, sessionId, (currentSession) =>
        syncWechatSessionMessages(currentSession, syncedMessages),
      ),
    );
  }, [sessionId, syncedMessages]);

  useEffect(() => {
    if (view !== "chat") return;
    const frame = window.requestAnimationFrame(() => {
      const body = chatBodyRef.current;
      if (body) body.scrollTop = body.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeMessages.length, sendingContactId, view]);

  const contactsWithLastMessage = useMemo(
    () =>
      sessionStore.contacts
        .map((contact) => ({
          contact,
          lastMessage: [...sessionStore.messages]
            .reverse()
            .find((message) => message.contactId === contact.id),
        }))
        .filter(({ contact }) => {
          const query = searchQuery.trim().toLocaleLowerCase();
          return (
            !query ||
            contact.name.toLocaleLowerCase().includes(query) ||
            contact.nickname.toLocaleLowerCase().includes(query)
          );
        })
        .sort((left, right) => {
          const leftTime = Date.parse(left.lastMessage?.createdAt ?? left.contact.updatedAt);
          const rightTime = Date.parse(right.lastMessage?.createdAt ?? right.contact.updatedAt);
          return rightTime - leftTime;
        }),
    [searchQuery, sessionStore.contacts, sessionStore.messages],
  );

  const openContact = (contact: WechatContact) => {
    updateCurrentSession((current) => ({ ...current, activeContactId: contact.id }));
    setChatError("");
    setChatInput("");
    setView("chat");
  };

  const openAddContact = () => {
    setDraft(createContactDraft());
    setDraftError("");
    setMenuOpen(false);
    setChatInput("");
    setChatError("");
    setSendingContactId("");
    setEmojiOpen(false);
    setMoreOpen(false);
    setView("contact");
  };

  const openEditContact = () => {
    if (!activeContact) return;
    setDraft(createContactDraft(activeContact));
    setDraftError("");
    setMenuOpen(false);
    setView("contact");
  };

  const selectPersona = (personaId: string) => {
    const persona = personas.find((candidate) => candidate.id === personaId);
    setDraft((current) => ({
      ...current,
      personaId,
      ...(persona
        ? {
            name: persona.name,
            nickname: current.nickname || persona.name,
            avatarImage: persona.avatarImage || current.avatarImage,
            profile: persona.description || current.profile,
          }
        : {}),
    }));
  };

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setDraftError("请选择图片文件。 ");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setDraftError("头像文件不能超过 3 MB。 ");
      return;
    }
    try {
      const avatarImage = await resizeAvatarFile(file);
      setDraft((current) => ({ ...current, avatarImage }));
      setDraftError("");
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "头像处理失败。 ");
    }
  };

  const saveContact = () => {
    const name = draft.name.trim();
    if (!name) {
      setDraftError("请输入朋友姓名。 ");
      return;
    }
    const timestamp = new Date().toISOString();
    const existing = sessionStore.contacts.find((contact) => contact.id === draft.id);
    const nextContact: WechatContact = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      nickname: draft.nickname.trim(),
      avatarImage: draft.avatarImage,
      profile: draft.profile.trim(),
      ...(draft.personaId ? { personaId: draft.personaId } : {}),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    updateCurrentSession((current) => ({
      ...current,
      activeContactId: nextContact.id,
      contacts: existing
        ? current.contacts.map((contact) =>
            contact.id === nextContact.id ? nextContact : contact,
          )
        : [...current.contacts, nextContact],
    }));
    setDraftError("");
    setView(existing ? "chat" : "list");
  };

  const deleteActiveContact = () => {
    if (!activeContact) return;
    if (!window.confirm(`删除朋友“${activeContact.name}”及其本地聊天记录？`)) return;
    updateCurrentSession((current) => {
      const contacts = current.contacts.filter((contact) => contact.id !== activeContact.id);
      return {
        contacts,
        messages: current.messages.filter((message) => message.contactId !== activeContact.id),
        activeContactId: contacts[0]?.id ?? "",
      };
    });
    setDraft(createContactDraft());
    setDraftError("");
    setChatInput("");
    setChatError("");
    setSendingContactId("");
    setEmojiOpen(false);
    setMoreOpen(false);
    setMenuOpen(false);
    setView("list");
  };

  const sendMessage = async () => {
    const content = chatInput.trim();
    if (!activeContact || !content || sendingContactId || busy) return;
    const userMessage: WechatStoredMessage = {
      id: crypto.randomUUID(),
      contactId: activeContact.id,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    updateCurrentSession((current) => ({
      ...current,
      messages: [...current.messages, userMessage],
    }));
    setChatInput("");
    setChatError("");
    setEmojiOpen(false);
    setMoreOpen(false);
    setSendingContactId(activeContact.id);
    try {
      const reply = await onSendMessage(activeContact, {
        id: userMessage.id,
        content: userMessage.content,
        createdAt: userMessage.createdAt,
      });
      const assistantMessage: WechatStoredMessage = {
        id: reply.id,
        contactId: activeContact.id,
        role: "assistant",
        content: reply.content,
        createdAt: reply.createdAt,
      };
      updateCurrentSession((current) =>
        current.contacts.some((contact) => contact.id === activeContact.id)
          ? {
              ...current,
              messages: current.messages.some((message) => message.id === assistantMessage.id)
                ? current.messages.map((message) =>
                    message.id === assistantMessage.id ? assistantMessage : message,
                  )
                : [...current.messages, assistantMessage],
            }
          : current,
      );
    } catch (error) {
      updateCurrentSession((current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === userMessage.id ? { ...message, failed: true } : message,
        ),
      }));
      setChatError(error instanceof Error ? error.message : "消息发送失败。 ");
    } finally {
      setSendingContactId("");
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void sendMessage();
  };

  const renderContactRows = (contactsOnly = false) => (
    <div className="wechat-conversation-list">
      {contactsWithLastMessage.map(({ contact, lastMessage }) => (
        <button
          className="wechat-conversation-row"
          key={contact.id}
          onClick={() => openContact(contact)}
          type="button"
        >
          <ContactAvatar contact={contact} />
          <span className="wechat-conversation-copy">
            <strong>{contact.name}</strong>
            <small>
              {contactsOnly
                ? contact.nickname || "微信朋友"
                : lastMessage?.content || contact.nickname || "开始聊天"}
            </small>
          </span>
          {!contactsOnly && lastMessage ? (
            <time dateTime={lastMessage.createdAt}>{formatListTime(lastMessage.createdAt)}</time>
          ) : (
            <ChevronRight aria-hidden="true" size={17} />
          )}
        </button>
      ))}
      {contactsWithLastMessage.length === 0 ? (
        <div className="wechat-empty-state">
          <MessageCircle aria-hidden="true" size={38} />
          <strong>{searchQuery ? "没有找到联系人" : "暂无聊天"}</strong>
          {!searchQuery ? (
            <button onClick={openAddContact} type="button">
              <UserPlus size={16} />
              添加朋友
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const renderMainContent = () => {
    if (activeTab === "wechat") {
      return (
        <>
          <div className="wechat-desktop-login">
            <Monitor aria-hidden="true" size={18} />
            <span>电脑微信已登录</span>
          </div>
          {renderContactRows()}
        </>
      );
    }
    if (activeTab === "contacts") {
      return (
        <div className="wechat-contacts-view">
          <button className="wechat-contact-action" onClick={openAddContact} type="button">
            <span><UserPlus size={19} /></span>
            <strong>新的朋友</strong>
            <ChevronRight size={17} />
          </button>
          <div className="wechat-section-label">朋友</div>
          {renderContactRows(true)}
        </div>
      );
    }
    if (activeTab === "discover") {
      return (
        <div className="wechat-simple-page">
          <button type="button"><span><Compass size={20} /></span><strong>朋友圈</strong><ChevronRight size={17} /></button>
          <button type="button"><span><ScanLine size={20} /></span><strong>扫一扫</strong><ChevronRight size={17} /></button>
        </div>
      );
    }
    return (
      <div className="wechat-me-view">
        <div className="wechat-me-profile">
          <UserAvatar image={userProfile.avatarImage} nickname={userProfile.nickname} />
          <span>
            <strong>{userProfile.nickname || "我"}</strong>
            <small>微信号：renge_user</small>
          </span>
          <ChevronRight size={18} />
        </div>
        <div className="wechat-simple-page">
          <button type="button"><span><WalletCards size={20} /></span><strong>服务</strong><ChevronRight size={17} /></button>
        </div>
      </div>
    );
  };

  const listTitle =
    activeTab === "wechat"
      ? `微信${sessionStore.contacts.length ? ` (${sessionStore.contacts.length})` : ""}`
      : activeTab === "contacts"
        ? "通讯录"
        : activeTab === "discover"
          ? "发现"
          : "我";

  return (
    <section className="wechat-phone" aria-label="手机微信">
      <div className="wechat-status-strip" aria-hidden="true">
        <time>{now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
        <span><Signal size={14} /><Wifi size={14} /><BatteryFull size={18} /></span>
      </div>

      {view === "list" ? (
        <>
          <header className="wechat-main-header">
            <button aria-label="返回右侧工具" onClick={onBack} title="返回右侧工具" type="button">
              <ArrowLeft size={19} />
            </button>
            <strong>{listTitle}</strong>
            <span className="wechat-main-actions">
              <button
                aria-label="搜索"
                className={searchOpen ? "active" : undefined}
                onClick={() => setSearchOpen((current) => !current)}
                title="搜索"
                type="button"
              ><Search size={21} /></button>
              <button
                aria-expanded={menuOpen}
                aria-label="更多"
                onClick={() => setMenuOpen((current) => !current)}
                title="更多"
                type="button"
              ><Plus size={23} /></button>
              <button aria-label="关闭右侧栏" onClick={onClose} title="关闭右侧栏" type="button"><X size={18} /></button>
            </span>
            {menuOpen ? (
              <div className="wechat-plus-menu">
                <button type="button"><Users size={18} /><span>发起群聊</span></button>
                <button onClick={openAddContact} type="button"><UserPlus size={18} /><span>添加朋友</span></button>
                <button type="button"><ScanLine size={18} /><span>扫一扫</span></button>
                <button type="button"><WalletCards size={18} /><span>收付款</span></button>
              </div>
            ) : null}
          </header>
          {searchOpen ? (
            <div className="wechat-search-bar">
              <Search aria-hidden="true" size={15} />
              <input
                autoFocus
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索"
                value={searchQuery}
              />
              {searchQuery ? <button aria-label="清空搜索" onClick={() => setSearchQuery("")} type="button"><X size={14} /></button> : null}
            </div>
          ) : null}
          <main className="wechat-main-body">{renderMainContent()}</main>
          <nav className="wechat-tab-bar" aria-label="微信导航">
            <button className={activeTab === "wechat" ? "active" : undefined} onClick={() => setActiveTab("wechat")} type="button"><MessageCircle size={23} /><span>微信</span></button>
            <button className={activeTab === "contacts" ? "active" : undefined} onClick={() => setActiveTab("contacts")} type="button"><ContactRound size={23} /><span>通讯录</span></button>
            <button className={activeTab === "discover" ? "active" : undefined} onClick={() => setActiveTab("discover")} type="button"><Compass size={23} /><span>发现</span></button>
            <button className={activeTab === "me" ? "active" : undefined} onClick={() => setActiveTab("me")} type="button"><UserRound size={23} /><span>我</span></button>
          </nav>
        </>
      ) : view === "chat" && activeContact ? (
        <>
          <header className="wechat-chat-header">
            <button aria-label="返回微信" onClick={() => { setView("list"); setMenuOpen(false); }} title="返回微信" type="button"><ArrowLeft size={23} /></button>
            <strong>{activeContact.name}</strong>
            <button aria-expanded={menuOpen} aria-label="聊天设置" onClick={() => setMenuOpen((current) => !current)} title="聊天设置" type="button"><MoreHorizontal size={23} /></button>
            {menuOpen ? (
              <div className="wechat-chat-menu">
                <button onClick={openEditContact} type="button"><ContactRound size={17} />朋友资料</button>
                <button className="danger" onClick={deleteActiveContact} type="button"><Trash2 size={17} />删除朋友</button>
              </div>
            ) : null}
          </header>
          <div className="wechat-chat-body" ref={chatBodyRef}>
            {activeMessages.length > 0 ? (
              <time className="wechat-chat-date" dateTime={activeMessages[0].createdAt}>
                {new Date(activeMessages[0].createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </time>
            ) : null}
            {activeMessages.flatMap((message) => {
              const bubbles = message.role === "assistant" ? splitWechatReply(message.content) : [message.content];
              return bubbles.map((bubble, bubbleIndex) => (
                <div className={`wechat-message-row ${message.role === "user" ? "outgoing" : "incoming"}`} key={`${message.id}-${bubbleIndex}`}>
                  {message.role === "assistant" ? <ContactAvatar contact={activeContact} /> : null}
                  <div className="wechat-bubble-wrap">
                    <div className="wechat-message-bubble">{bubble}</div>
                    {message.failed ? <small>发送失败</small> : null}
                  </div>
                  {message.role === "user" ? <UserAvatar image={userProfile.avatarImage} nickname={userProfile.nickname} /> : null}
                </div>
              ));
            })}
            {sendingContactId === activeContact.id ? (
              <div className="wechat-message-row incoming">
                <ContactAvatar contact={activeContact} />
                <div className="wechat-message-bubble wechat-typing"><i /><i /><i /></div>
              </div>
            ) : null}
          </div>
          {chatError ? <div className="wechat-chat-error">{chatError}</div> : null}
          <footer className="wechat-composer">
            <div className="wechat-composer-row">
              <button aria-label="语音" title="语音" type="button"><Mic size={22} /></button>
              <textarea
                aria-label="微信消息"
                disabled={busy || Boolean(sendingContactId)}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                rows={1}
                value={chatInput}
              />
              <button aria-expanded={emojiOpen} aria-label="表情" onClick={() => { setEmojiOpen((current) => !current); setMoreOpen(false); }} title="表情" type="button"><Smile size={23} /></button>
              {chatInput.trim() ? (
                <button className="wechat-send-button" disabled={busy || Boolean(sendingContactId)} aria-label="发送" onClick={() => void sendMessage()} title="发送" type="button"><Send size={17} /></button>
              ) : (
                <button aria-expanded={moreOpen} aria-label="更多" onClick={() => { setMoreOpen((current) => !current); setEmojiOpen(false); }} title="更多" type="button"><Plus size={24} /></button>
              )}
            </div>
            {emojiOpen ? (
              <div className="wechat-emoji-tray">
                {["😊", "😂", "🥺", "😌", "😅", "🤔", "👍", "❤️"].map((emoji) => (
                  <button key={emoji} onClick={() => setChatInput((current) => `${current}${emoji}`)} type="button">{emoji}</button>
                ))}
              </div>
            ) : null}
            {moreOpen ? (
              <div className="wechat-more-tray">
                <button onClick={() => setChatInput((current) => `${current}${current ? " " : ""}[图片]`)} type="button"><ImagePlus size={20} /><span>照片</span></button>
                <button onClick={() => setChatInput((current) => `${current}${current ? " " : ""}[位置]`)} type="button"><MapPin size={20} /><span>位置</span></button>
              </div>
            ) : null}
          </footer>
        </>
      ) : view === "contact" ? (
        <>
          <header className="wechat-contact-header">
            <button onClick={() => setView(draft.id ? "chat" : "list")} type="button">取消</button>
            <strong>{draft.id ? "朋友资料" : "添加朋友"}</strong>
            <button className="primary" onClick={saveContact} type="button">完成</button>
          </header>
          <main className="wechat-contact-form">
            <div className="wechat-avatar-editor">
              <button onClick={() => avatarInputRef.current?.click()} title="上传头像" type="button">
                {draft.avatarImage ? <img alt="朋友头像预览" src={draft.avatarImage} /> : <ImagePlus size={24} />}
              </button>
              <input accept="image/*" hidden onChange={handleAvatarUpload} ref={avatarInputRef} type="file" />
            </div>
            <label><span>姓名</span><input autoFocus maxLength={40} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="朋友姓名" value={draft.name} /></label>
            <label><span>网名</span><input maxLength={40} onChange={(event) => setDraft((current) => ({ ...current, nickname: event.target.value }))} placeholder="微信昵称" value={draft.nickname} /></label>
            <label><span>人格 Agent</span><select onChange={(event) => selectPersona(event.target.value)} value={draft.personaId}><option value="">自定义人设</option>{personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}</select></label>
            <label className="wechat-profile-field"><span>人设</span><textarea onChange={(event) => setDraft((current) => ({ ...current, profile: event.target.value }))} placeholder="朋友的身份、性格、说话方式与关系设定" rows={7} value={draft.profile} /></label>
            {draftError ? <p className="wechat-form-error">{draftError}</p> : null}
          </main>
        </>
      ) : null}
    </section>
  );
}
