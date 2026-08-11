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
  Sparkles,
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
  loadWechatStoreFromStorage,
  saveWechatStoreToStorage,
  shouldGenerateWechatProactively,
  splitWechatReply,
  syncWechatSessionMessages,
  type WechatContact,
  type WechatGroup,
  type WechatGroupSendMessageResult,
  type WechatSendMessageInput,
  type WechatSendMessageResult,
  type WechatSessionStore,
  type WechatStore,
  type WechatStoredMessage,
  updateWechatSessionStore,
  WECHAT_STORAGE_KEY,
  WECHAT_STORE_CHANGED_EVENT,
} from "./wechatSidebarUtils";
import "./wechat-sidebar.css";

const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

type ContactDraft = {
  id: string;
  name: string;
  nickname: string;
  avatarImage: string;
  profile: string;
  personaId: string;
};

type GroupDraft = {
  id: string;
  name: string;
  avatarImage: string;
  memberContactIds: string[];
  includesUser: boolean;
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
  onQueueMessage: (
    contact: WechatContact,
    message: WechatSendMessageInput,
  ) => void;
  onGenerateReply: (
    contact: WechatContact,
    proactive: boolean,
  ) => Promise<WechatSendMessageResult>;
  onQueueGroupMessage: (
    group: WechatGroup,
    message: WechatSendMessageInput,
  ) => void;
  onGenerateGroupReply: (
    group: WechatGroup,
    members: WechatContact[],
    proactive: boolean,
    onResponderSelected: (responder: WechatContact) => void,
  ) => Promise<WechatGroupSendMessageResult>;
};

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

function createGroupDraft(group?: WechatGroup): GroupDraft {
  return {
    id: group?.id ?? "",
    name: group?.name ?? "",
    avatarImage: group?.avatarImage ?? "",
    memberContactIds: group?.memberContactIds ?? [],
    includesUser: group?.includesUser ?? true,
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

function GroupAvatar({ group }: { group: WechatGroup }) {
  const label = group.name.trim() || "群";
  return (
    <span className="wechat-avatar wechat-group-avatar">
      {group.avatarImage ? (
        <img alt={`${label}群头像`} src={group.avatarImage} />
      ) : (
        <Users aria-hidden="true" size={22} />
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
  onQueueMessage,
  onGenerateReply,
  onQueueGroupMessage,
  onGenerateGroupReply,
}: WechatSidebarProps) {
  const [store, setStore] = useState(() => loadWechatStoreFromStorage(sessionId));
  const [view, setView] = useState<"list" | "chat" | "contact" | "group">("list");
  const [activeTab, setActiveTab] = useState<"wechat" | "contacts" | "discover" | "me">("wechat");
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState<ContactDraft>(createContactDraft);
  const [groupDraft, setGroupDraft] = useState<GroupDraft>(createGroupDraft);
  const [draftError, setDraftError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [generatingContactId, setGeneratingContactId] = useState("");
  const [generatingResponderId, setGeneratingResponderId] = useState("");
  const [chatError, setChatError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      saveWechatStoreToStorage(store, localStorage, false);
    } catch (error) {
      console.warn("微信联系人数据保存失败", error);
    }
  }, [store]);

  useEffect(() => {
    const reloadStore = () => setStore(loadWechatStoreFromStorage(sessionId));
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === WECHAT_STORAGE_KEY) reloadStore();
    };
    window.addEventListener(WECHAT_STORE_CHANGED_EVENT, reloadStore);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(WECHAT_STORE_CHANGED_EVENT, reloadStore);
      window.removeEventListener("storage", handleStorage);
    };
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) {
      setStore((current) => {
        if (current.sessions[sessionId]) return current;
        const restored = loadWechatStoreFromStorage(sessionId);
        return restored.sessions[sessionId] ? restored : current;
      });
    }
    setView("list");
    setActiveTab("wechat");
    setMenuOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
    setDraft(createContactDraft());
    setGroupDraft(createGroupDraft());
    setDraftError("");
    setChatInput("");
    setGeneratingContactId("");
    setGeneratingResponderId("");
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
  const activeGroup = useMemo(
    () =>
      sessionStore.groups.find((group) => group.id === sessionStore.activeGroupId) ?? null,
    [sessionStore.activeGroupId, sessionStore.groups],
  );
  const activeMessages = useMemo(
    () =>
      sessionStore.messages.filter((message) =>
        activeGroup
          ? message.groupId === activeGroup.id
          : Boolean(
              activeContact &&
                !message.groupId &&
                message.contactId === activeContact.id,
            ),
      ),
    [activeContact, activeGroup, sessionStore.messages],
  );

  useEffect(() => {
    if (view === "chat" && !activeContact && !activeGroup) setView("list");
  }, [activeContact, activeGroup, view]);

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
  }, [activeMessages.length, generatingContactId, view]);

  const contactsWithLastMessage = useMemo(
    () =>
      sessionStore.contacts
        .map((contact) => ({
          contact,
          lastMessage: [...sessionStore.messages]
            .reverse()
            .find((message) => !message.groupId && message.contactId === contact.id),
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
  const groupsWithLastMessage = useMemo(
    () =>
      sessionStore.groups
        .map((group) => ({
          group,
          lastMessage: [...sessionStore.messages]
            .reverse()
            .find((message) => message.groupId === group.id),
        }))
        .filter(({ group }) => {
          const query = searchQuery.trim().toLocaleLowerCase();
          return !query || group.name.toLocaleLowerCase().includes(query);
        })
        .sort((left, right) => {
          const leftTime = Date.parse(left.lastMessage?.createdAt ?? left.group.updatedAt);
          const rightTime = Date.parse(right.lastMessage?.createdAt ?? right.group.updatedAt);
          return rightTime - leftTime;
        }),
    [searchQuery, sessionStore.groups, sessionStore.messages],
  );

  const openContact = (contact: WechatContact) => {
    updateCurrentSession((current) => ({
      ...current,
      activeContactId: contact.id,
      activeGroupId: "",
    }));
    setChatError("");
    setChatInput("");
    setView("chat");
  };

  const openGroup = (group: WechatGroup) => {
    updateCurrentSession((current) => ({
      ...current,
      activeContactId: "",
      activeGroupId: group.id,
    }));
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
    setGeneratingContactId("");
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

  const openAddGroup = () => {
    setGroupDraft(createGroupDraft());
    setDraftError("");
    setMenuOpen(false);
    setChatInput("");
    setChatError("");
    setGeneratingContactId("");
    setGeneratingResponderId("");
    setEmojiOpen(false);
    setMoreOpen(false);
    setView("group");
  };

  const openEditGroup = () => {
    if (!activeGroup) return;
    setGroupDraft(createGroupDraft(activeGroup));
    setDraftError("");
    setMenuOpen(false);
    setView("group");
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

  const handleGroupAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setDraftError("请选择图片文件。 ");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setDraftError("群头像文件不能超过 3 MB。 ");
      return;
    }
    try {
      const avatarImage = await resizeAvatarFile(file);
      setGroupDraft((current) => ({ ...current, avatarImage }));
      setDraftError("");
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "群头像处理失败。 ");
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
      activeGroupId: "",
      contacts: existing
        ? current.contacts.map((contact) =>
            contact.id === nextContact.id ? nextContact : contact,
          )
        : [...current.contacts, nextContact],
    }));
    setDraftError("");
    setView(existing ? "chat" : "list");
  };

  const saveGroup = () => {
    const name = groupDraft.name.trim();
    if (!name) {
      setDraftError("请输入群聊名称。 ");
      return;
    }
    const memberContactIds = groupDraft.memberContactIds.filter((contactId) =>
      sessionStore.contacts.some((contact) => contact.id === contactId),
    );
    if (memberContactIds.length + (groupDraft.includesUser ? 1 : 0) < 2) {
      setDraftError(
        groupDraft.includesUser
          ? "请至少选择一位联系人。 "
          : "不加入用户时，请至少选择两位联系人。 ",
      );
      return;
    }
    const timestamp = new Date().toISOString();
    const existing = sessionStore.groups.find((group) => group.id === groupDraft.id);
    const nextGroup: WechatGroup = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      avatarImage: groupDraft.avatarImage,
      memberContactIds,
      includesUser: groupDraft.includesUser,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    updateCurrentSession((current) => ({
      ...current,
      activeContactId: "",
      activeGroupId: nextGroup.id,
      groups: existing
        ? current.groups.map((group) => (group.id === nextGroup.id ? nextGroup : group))
        : [...current.groups, nextGroup],
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
        ...current,
        contacts,
        messages: current.messages.filter(
          (message) => Boolean(message.groupId) || message.contactId !== activeContact.id,
        ),
        groups: current.groups.map((group) => ({
          ...group,
          memberContactIds: group.memberContactIds.filter(
            (contactId) => contactId !== activeContact.id,
          ),
        })),
        activeContactId: contacts[0]?.id ?? "",
      };
    });
    setDraft(createContactDraft());
    setDraftError("");
    setChatInput("");
    setChatError("");
    setGeneratingContactId("");
    setEmojiOpen(false);
    setMoreOpen(false);
    setMenuOpen(false);
    setView("list");
  };

  const deleteActiveGroup = () => {
    if (!activeGroup) return;
    if (!window.confirm(`删除群聊“${activeGroup.name}”及其本地聊天记录？`)) return;
    updateCurrentSession((current) => ({
      ...current,
      groups: current.groups.filter((group) => group.id !== activeGroup.id),
      messages: current.messages.filter((message) => message.groupId !== activeGroup.id),
      activeGroupId: "",
      activeContactId: current.contacts[0]?.id ?? "",
    }));
    setGroupDraft(createGroupDraft());
    setDraftError("");
    setChatInput("");
    setChatError("");
    setGeneratingContactId("");
    setGeneratingResponderId("");
    setEmojiOpen(false);
    setMoreOpen(false);
    setMenuOpen(false);
    setView("list");
  };

  const sendMessage = () => {
    const content = chatInput.trim();
    if (
      (!activeContact && !activeGroup) ||
      (activeGroup && !activeGroup.includesUser) ||
      !content ||
      generatingContactId
    ) return;
    const userMessage: WechatStoredMessage = {
      id: crypto.randomUUID(),
      ...(activeGroup
        ? { groupId: activeGroup.id }
        : activeContact
          ? { contactId: activeContact.id }
          : {}),
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
    try {
      const outgoingMessage = {
        id: userMessage.id,
        content: userMessage.content,
        createdAt: userMessage.createdAt,
      };
      if (activeGroup) onQueueGroupMessage(activeGroup, outgoingMessage);
      else if (activeContact) onQueueMessage(activeContact, outgoingMessage);
    } catch (error) {
      updateCurrentSession((current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === userMessage.id ? { ...message, failed: true } : message,
        ),
      }));
      setChatError(error instanceof Error ? error.message : "消息发送失败。 ");
    }
  };

  const generateReply = async () => {
    if ((!activeContact && !activeGroup) || generatingContactId || busy) return;
    const proactive = shouldGenerateWechatProactively(activeMessages);
    const groupMembers = activeGroup
      ? activeGroup.memberContactIds
          .map((contactId) =>
            sessionStore.contacts.find((contact) => contact.id === contactId),
          )
          .filter((contact): contact is WechatContact => Boolean(contact))
      : [];
    if (activeGroup && groupMembers.length === 0) {
      setChatError("群聊中没有可生成回复的联系人。 ");
      return;
    }
    setChatError("");
    setEmojiOpen(false);
    setMoreOpen(false);
    setGeneratingContactId(activeGroup?.id ?? activeContact?.id ?? "");
    setGeneratingResponderId(activeContact?.id ?? "");
    try {
      const groupReply = activeGroup
        ? await onGenerateGroupReply(
            activeGroup,
            groupMembers,
            proactive,
            (responder) => setGeneratingResponderId(responder.id),
          )
        : null;
      const reply =
        groupReply ??
        (await onGenerateReply(activeContact as WechatContact, proactive));
      const assistantMessage: WechatStoredMessage = {
        id: reply.id,
        ...(activeGroup && groupReply
          ? {
              groupId: activeGroup.id,
              contactId: groupReply.responder.id,
              senderName: groupReply.responder.name,
              senderAvatar: groupReply.responder.avatarImage,
            }
          : activeContact
            ? { contactId: activeContact.id }
            : {}),
        role: "assistant",
        content: reply.content,
        createdAt: reply.createdAt,
      };
      updateCurrentSession((current) =>
        (activeGroup
          ? current.groups.some((group) => group.id === activeGroup.id)
          : current.contacts.some((contact) => contact.id === activeContact?.id))
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
      setChatError(error instanceof Error ? error.message : "微信回复生成失败。 ");
    } finally {
      setGeneratingContactId("");
      setGeneratingResponderId("");
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    sendMessage();
  };

  const renderContactRows = (contactsOnly = false) => (
    <div className="wechat-conversation-list">
      {!contactsOnly
        ? groupsWithLastMessage.map(({ group, lastMessage }) => (
            <button
              className="wechat-conversation-row"
              key={group.id}
              onClick={() => openGroup(group)}
              type="button"
            >
              <GroupAvatar group={group} />
              <span className="wechat-conversation-copy">
                <strong>{group.name}</strong>
                <small>{lastMessage?.content || `${group.memberContactIds.length} 位联系人`}</small>
              </span>
              {lastMessage ? (
                <time dateTime={lastMessage.createdAt}>{formatListTime(lastMessage.createdAt)}</time>
              ) : (
                <ChevronRight aria-hidden="true" size={17} />
              )}
            </button>
          ))
        : null}
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
      {contactsWithLastMessage.length + (contactsOnly ? 0 : groupsWithLastMessage.length) === 0 ? (
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
      ? `微信${sessionStore.contacts.length + sessionStore.groups.length ? ` (${sessionStore.contacts.length + sessionStore.groups.length})` : ""}`
      : activeTab === "contacts"
        ? "通讯录"
        : activeTab === "discover"
          ? "发现"
          : "我";
  const userCanSendInActiveChat = !activeGroup || activeGroup.includesUser;
  const generatingResponder = sessionStore.contacts.find(
    (contact) => contact.id === generatingResponderId,
  );

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
                <button onClick={openAddGroup} type="button"><Users size={18} /><span>发起群聊</span></button>
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
      ) : view === "chat" && (activeContact || activeGroup) ? (
        <>
          <header className="wechat-chat-header">
            <button aria-label="返回微信" onClick={() => { setView("list"); setMenuOpen(false); }} title="返回微信" type="button"><ArrowLeft size={23} /></button>
            <strong>{activeGroup?.name ?? activeContact?.name}</strong>
            <button aria-expanded={menuOpen} aria-label="聊天设置" onClick={() => setMenuOpen((current) => !current)} title="聊天设置" type="button"><MoreHorizontal size={23} /></button>
            {menuOpen ? (
              <div className="wechat-chat-menu">
                {activeGroup ? (
                  <>
                    <button onClick={openEditGroup} type="button"><Users size={17} />群聊信息</button>
                    <button className="danger" onClick={deleteActiveGroup} type="button"><Trash2 size={17} />删除群聊</button>
                  </>
                ) : (
                  <>
                    <button onClick={openEditContact} type="button"><ContactRound size={17} />朋友资料</button>
                    <button className="danger" onClick={deleteActiveContact} type="button"><Trash2 size={17} />删除朋友</button>
                  </>
                )}
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
              const senderContact = message.contactId
                ? sessionStore.contacts.find((contact) => contact.id === message.contactId)
                : null;
              const senderName = senderContact?.name || message.senderName || "群成员";
              return bubbles.map((bubble, bubbleIndex) => (
                <div className={`wechat-message-row ${message.role === "user" ? "outgoing" : "incoming"}`} key={`${message.id}-${bubbleIndex}`}>
                  {message.role === "assistant" ? (
                    senderContact ? (
                      <ContactAvatar contact={senderContact} />
                    ) : activeContact ? (
                      <ContactAvatar contact={activeContact} />
                    ) : (
                      <span className="wechat-avatar"><span aria-hidden="true">{senderName.slice(0, 1)}</span></span>
                    )
                  ) : null}
                  <div className="wechat-bubble-wrap">
                    {activeGroup && message.role === "assistant" ? <small className="wechat-group-sender">{senderName}</small> : null}
                    <div className="wechat-message-bubble">{bubble}</div>
                    {message.failed ? <small>发送失败</small> : null}
                  </div>
                  {message.role === "user" ? <UserAvatar image={userProfile.avatarImage} nickname={userProfile.nickname} /> : null}
                </div>
              ));
            })}
            {generatingContactId === (activeGroup?.id ?? activeContact?.id) ? (
              <div className="wechat-message-row incoming">
                {generatingResponder ? (
                  <ContactAvatar contact={generatingResponder} />
                ) : activeGroup ? (
                  <GroupAvatar group={activeGroup} />
                ) : null}
                <div className="wechat-bubble-wrap">
                  {activeGroup && generatingResponder ? <small className="wechat-group-sender">{generatingResponder.name}</small> : null}
                  <div className="wechat-message-bubble wechat-typing"><i /><i /><i /></div>
                </div>
              </div>
            ) : null}
          </div>
          {chatError ? <div className="wechat-chat-error">{chatError}</div> : null}
          <footer className="wechat-composer">
            <div className="wechat-composer-row">
              <button aria-label="生成回复" disabled={busy || Boolean(generatingContactId)} onClick={() => void generateReply()} title="生成回复" type="button"><Sparkles size={21} /></button>
              <div className="wechat-input-shell">
                <textarea
                  aria-label="微信消息"
                  disabled={Boolean(generatingContactId) || !userCanSendInActiveChat}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={!userCanSendInActiveChat ? "你未加入此群聊" : undefined}
                  rows={1}
                  value={chatInput}
                />
                <button aria-label="语音" disabled={!userCanSendInActiveChat} title="语音" type="button"><Mic size={21} /></button>
              </div>
              <button aria-expanded={emojiOpen} aria-label="表情" disabled={!userCanSendInActiveChat} onClick={() => { setEmojiOpen((current) => !current); setMoreOpen(false); }} title="表情" type="button"><Smile size={23} /></button>
              {chatInput.trim() && userCanSendInActiveChat ? (
                <button className="wechat-send-button" disabled={Boolean(generatingContactId)} aria-label="发送" onClick={sendMessage} title="发送" type="button"><Send size={17} /></button>
              ) : (
                <button aria-expanded={moreOpen} aria-label="更多" disabled={!userCanSendInActiveChat} onClick={() => { setMoreOpen((current) => !current); setEmojiOpen(false); }} title="更多" type="button"><Plus size={24} /></button>
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
      ) : view === "group" ? (
        <>
          <header className="wechat-contact-header">
            <button onClick={() => setView(groupDraft.id ? "chat" : "list")} type="button">取消</button>
            <strong>{groupDraft.id ? "群聊信息" : "发起群聊"}</strong>
            <button className="primary" onClick={saveGroup} type="button">完成</button>
          </header>
          <main className="wechat-contact-form wechat-group-form">
            <div className="wechat-avatar-editor">
              <button onClick={() => groupAvatarInputRef.current?.click()} title="上传群头像" type="button">
                {groupDraft.avatarImage ? <img alt="群头像预览" src={groupDraft.avatarImage} /> : <Users size={26} />}
              </button>
              <input accept="image/*" hidden onChange={handleGroupAvatarUpload} ref={groupAvatarInputRef} type="file" />
            </div>
            <label><span>群聊名称</span><input autoFocus maxLength={40} onChange={(event) => setGroupDraft((current) => ({ ...current, name: event.target.value }))} placeholder="填写群名" value={groupDraft.name} /></label>
            <label className="wechat-group-user-option">
              <span>把我加入群聊</span>
              <input checked={groupDraft.includesUser} onChange={(event) => setGroupDraft((current) => ({ ...current, includesUser: event.target.checked }))} type="checkbox" />
            </label>
            <div className="wechat-group-member-heading">选择联系人</div>
            <div className="wechat-group-member-list">
              {sessionStore.contacts.map((contact) => {
                const selected = groupDraft.memberContactIds.includes(contact.id);
                return (
                  <label key={contact.id}>
                    <ContactAvatar contact={contact} />
                    <span><strong>{contact.name}</strong><small>{contact.nickname || "微信朋友"}</small></span>
                    <input
                      checked={selected}
                      onChange={() => setGroupDraft((current) => ({
                        ...current,
                        memberContactIds: selected
                          ? current.memberContactIds.filter((contactId) => contactId !== contact.id)
                          : [...current.memberContactIds, contact.id],
                      }))}
                      type="checkbox"
                    />
                  </label>
                );
              })}
              {sessionStore.contacts.length === 0 ? <p>请先添加联系人。</p> : null}
            </div>
            {draftError ? <p className="wechat-form-error">{draftError}</p> : null}
          </main>
        </>
      ) : null}
    </section>
  );
}
