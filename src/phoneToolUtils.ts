import {
  splitWechatReply,
  type WechatContact,
  type WechatGroup,
  type WechatSessionStore,
  type WechatStoredMessage,
} from "./wechatSidebarUtils.ts";

export const PHONE_TOOL_SYSTEM_PROMPT = [
  "你可以选择使用手机工具，也可以完全不使用。只有在当前情境下自然、合适时才操作手机，不要为了展示能力而强行发消息。",
  "手机工具在后台执行。成功后不要向用户解释工具、权限、参数或后台过程；正常继续主会话即可，也不要在主会话重复抄写刚发出的微信消息。",
  "手机微信消息的格式优先于主会话写作格式：每个 messages 数组元素只填写一个真实发送的气泡正文，禁止姓名前缀、冒号、旁白、动作、心理、环境、Markdown、状态栏或输出模板。",
  "发送私聊前先通过 phone_get_state 确认联系人；发送群聊前确认群聊和成员身份。群消息 sender_contact_id 必须是该群现有联系人成员，不能冒充用户。",
  "如果没有联系人或群聊，或者缺少适合当前情境的对象，可以自行创建。创建对象必须使用真实且彼此可区分的资料；运行时会按姓名、网名、人格 ID、群名和成员组合阻止重复创建。",
  "当当前目标包含发微信消息且联系人或群聊尚不存在时，必须把消息放进 phone_create_contact 或 phone_create_group 的 messages 参数，让创建或复用与发送在同一次调用中完成。禁止只创建对象后在主会话正文里模拟微信消息；只有目标明确只是管理通讯录时才省略 messages。",
  "一次可发送一条或多条消息，也可以让不同群成员连续发言；消息数量和发言人由当前情境决定。",
].join("\n");

export type PhoneToolName =
  | "phone_get_state"
  | "phone_create_contact"
  | "phone_update_contact"
  | "phone_delete_contact"
  | "phone_create_group"
  | "phone_update_group"
  | "phone_delete_group"
  | "phone_send_private_messages"
  | "phone_send_group_messages";

export type PhoneToolDefinition = {
  type: "function";
  function: {
    name: PhoneToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const CONTACT_PROPERTIES = {
  name: { type: "string", description: "朋友的姓名。" },
  nickname: { type: "string", description: "朋友的微信网名，可留空。" },
  profile: { type: "string", description: "朋友的人设与说话习惯，可留空。" },
  avatar_image: {
    type: "string",
    description: "头像 URL 或 data URL，可留空。",
  },
  persona_id: {
    type: "string",
    description: "关联的人格 Agent ID，可留空。",
  },
} as const;

const GROUP_PROPERTIES = {
  name: { type: "string", description: "群聊名称。" },
  avatar_image: {
    type: "string",
    description: "群头像 URL 或 data URL，可留空。",
  },
  member_contact_ids: {
    type: "array",
    items: { type: "string" },
    description: "群内联系人 ID，不能包含不存在的联系人。",
  },
  includes_user: {
    type: "boolean",
    description: "用户本人是否在群中。",
  },
} as const;

const PRIVATE_MESSAGES_PROPERTY = {
  type: "array",
  minItems: 1,
  items: { type: "string" },
  description: "按发送顺序排列的微信气泡正文。创建联系人是为了发消息时必须填写。",
} as const;

const GROUP_MESSAGES_PROPERTY = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    properties: {
      sender_contact_id: {
        type: "string",
        description: "发言联系人 ID，必须是该群成员。",
      },
      content: { type: "string", description: "一条微信气泡正文。" },
    },
    required: ["sender_contact_id", "content"],
    additionalProperties: false,
  },
  description: "按发送顺序排列的群聊气泡。创建群聊是为了发消息时必须填写。",
} as const;

export const phoneToolDefinitions: PhoneToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "phone_get_state",
      description: "读取当前主会话绑定的全部手机联系人、群聊及可选微信消息。创建或发送前用它查重并取得 ID。",
      parameters: {
        type: "object",
        properties: {
          include_messages: {
            type: "boolean",
            description: "是否返回微信消息，默认 true。只查对象 ID 时可设为 false。",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_create_contact",
      description: "创建或复用手机联系人，并可在同一次调用中立即发送私聊。若目标包含发消息，必须填写 messages。重复联系人不会再次创建。",
      parameters: {
        type: "object",
        properties: {
          ...CONTACT_PROPERTIES,
          messages: PRIVATE_MESSAGES_PROPERTY,
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_update_contact",
      description: "修改现有手机联系人的姓名、网名、头像、人设或关联人格。",
      parameters: {
        type: "object",
        properties: {
          contact_id: { type: "string", description: "联系人 ID。" },
          ...CONTACT_PROPERTIES,
        },
        required: ["contact_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_delete_contact",
      description: "删除联系人及其私聊记录，并把该联系人从所有群聊成员中移除。历史群消息保留。",
      parameters: {
        type: "object",
        properties: {
          contact_id: { type: "string", description: "联系人 ID。" },
        },
        required: ["contact_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_create_group",
      description: "用现有联系人创建或复用群聊，并可在同一次调用中立即发送群消息。若目标包含发消息，必须填写 messages。重复群聊不会再次创建。",
      parameters: {
        type: "object",
        properties: {
          ...GROUP_PROPERTIES,
          messages: GROUP_MESSAGES_PROPERTY,
        },
        required: ["name", "member_contact_ids", "includes_user"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_update_group",
      description: "修改现有群聊的名称、头像、联系人成员或用户入群状态。",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "string", description: "群聊 ID。" },
          ...GROUP_PROPERTIES,
        },
        required: ["group_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_delete_group",
      description: "删除群聊及该群全部聊天记录。",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "string", description: "群聊 ID。" },
        },
        required: ["group_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_send_private_messages",
      description: "以指定联系人身份给用户发送一条或多条微信私聊气泡。每个数组元素是一条独立气泡。",
      parameters: {
        type: "object",
        properties: {
          contact_id: { type: "string", description: "发消息的联系人 ID。" },
          messages: PRIVATE_MESSAGES_PROPERTY,
        },
        required: ["contact_id", "messages"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_send_group_messages",
      description: "在指定群聊中由一个或多个联系人成员发送任意条微信消息，数组顺序就是显示顺序。",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "string", description: "群聊 ID。" },
          messages: GROUP_MESSAGES_PROPERTY,
        },
        required: ["group_id", "messages"],
        additionalProperties: false,
      },
    },
  },
];

const PHONE_TOOL_NAME_SET = new Set<PhoneToolName>(
  phoneToolDefinitions.map((tool) => tool.function.name),
);

export function isPhoneToolName(value: string): value is PhoneToolName {
  return PHONE_TOOL_NAME_SET.has(value as PhoneToolName);
}

export type PhoneToolExecutionOptions = {
  createId?: () => string;
  now?: () => string;
  validPersonaIds?: ReadonlySet<string>;
  availablePersonas?: Array<{
    id: string;
    name: string;
    description: string;
    avatarImage: string;
  }>;
};

export type PhoneToolExecution = {
  session: WechatSessionStore;
  result: Record<string, unknown>;
  sentMessages?: WechatStoredMessage[];
  updatedContact?: WechatContact;
  updatedGroup?: WechatGroup;
  deletedContactId?: string;
  deletedGroupId?: string;
};

function normalizeIdentityValue(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function requireString(args: Record<string, unknown>, key: string, label: string) {
  const value = typeof args[key] === "string" ? args[key].trim() : "";
  if (!value) throw new Error(`${label}不能为空。`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(args, key)) return undefined;
  if (args[key] === null) return "";
  if (typeof args[key] !== "string") throw new Error(`${key} 必须是字符串。`);
  return args[key].trim();
}

function optionalBoolean(args: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(args, key)) return undefined;
  if (typeof args[key] !== "boolean") throw new Error(`${key} 必须是布尔值。`);
  return args[key];
}

function redactAvatar(value: string) {
  return value.startsWith("data:") ? "[已保存 data URL]" : value;
}

function serializeContact(contact: WechatContact) {
  return {
    id: contact.id,
    name: contact.name,
    nickname: contact.nickname,
    avatar_image: redactAvatar(contact.avatarImage),
    has_avatar: Boolean(contact.avatarImage),
    profile: contact.profile,
    persona_id: contact.personaId ?? "",
    created_at: contact.createdAt,
    updated_at: contact.updatedAt,
  };
}

function serializeGroup(group: WechatGroup) {
  return {
    id: group.id,
    name: group.name,
    avatar_image: redactAvatar(group.avatarImage),
    has_avatar: Boolean(group.avatarImage),
    member_contact_ids: group.memberContactIds,
    includes_user: group.includesUser,
    created_at: group.createdAt,
    updated_at: group.updatedAt,
  };
}

function findDuplicateContact(
  contacts: WechatContact[],
  candidate: Pick<WechatContact, "name" | "nickname" | "personaId">,
  excludedId = "",
) {
  const candidateNames = new Set(
    [candidate.name, candidate.nickname]
      .map(normalizeIdentityValue)
      .filter(Boolean),
  );
  return contacts.find((contact) => {
    if (contact.id === excludedId) return false;
    if (candidate.personaId && contact.personaId === candidate.personaId) return true;
    return [contact.name, contact.nickname]
      .map(normalizeIdentityValue)
      .filter(Boolean)
      .some((value) => candidateNames.has(value));
  });
}

function normalizeMemberIds(value: unknown, contacts: WechatContact[]) {
  if (!Array.isArray(value)) throw new Error("member_contact_ids 必须是数组。");
  const ids = Array.from(
    new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)),
  );
  const knownIds = new Set(contacts.map((contact) => contact.id));
  const missingIds = ids.filter((id) => !knownIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(`群成员不存在：${missingIds.join("、")}`);
  }
  return ids;
}

function validateGroupParticipants(memberContactIds: string[], includesUser: boolean) {
  const participantCount = memberContactIds.length + (includesUser ? 1 : 0);
  if (participantCount < 2) {
    throw new Error(
      includesUser
        ? "用户在群中时至少需要一位联系人。"
        : "用户不在群中时至少需要两位联系人。",
    );
  }
}

function sameMembers(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

function findDuplicateGroup(
  groups: WechatGroup[],
  candidate: Pick<WechatGroup, "name" | "memberContactIds" | "includesUser">,
  excludedId = "",
) {
  const normalizedName = normalizeIdentityValue(candidate.name);
  return groups.find(
    (group) =>
      group.id !== excludedId &&
      (normalizeIdentityValue(group.name) === normalizedName ||
        (group.includesUser === candidate.includesUser &&
          sameMembers(group.memberContactIds, candidate.memberContactIds))),
  );
}

function validatePersonaId(
  personaId: string | undefined,
  validPersonaIds: ReadonlySet<string> | undefined,
) {
  if (personaId && validPersonaIds && !validPersonaIds.has(personaId)) {
    throw new Error(`人格 Agent 不存在：${personaId}`);
  }
}

function normalizeBubbleContents(value: unknown) {
  if (!Array.isArray(value)) throw new Error("messages 必须是数组。");
  const messages = value.flatMap((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error("每条微信消息都必须是非空字符串。");
    }
    return splitWechatReply(item);
  });
  if (messages.length === 0) throw new Error("至少需要一条微信消息。");
  return messages;
}

function requireContact(session: WechatSessionStore, contactId: string) {
  const contact = session.contacts.find((candidate) => candidate.id === contactId);
  if (!contact) throw new Error(`联系人不存在：${contactId}`);
  return contact;
}

function requireGroup(session: WechatSessionStore, groupId: string) {
  const group = session.groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`群聊不存在：${groupId}`);
  return group;
}

function buildPrivateMessages(
  contact: WechatContact,
  value: unknown,
  createId: () => string,
  now: () => string,
) {
  return normalizeBubbleContents(value).map(
    (content): WechatStoredMessage => ({
      id: createId(),
      contactId: contact.id,
      role: "assistant",
      content,
      createdAt: now(),
    }),
  );
}

function buildGroupMessages(
  group: WechatGroup,
  session: WechatSessionStore,
  value: unknown,
  createId: () => string,
  now: () => string,
) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("至少需要一条群聊消息。");
  }
  const memberIds = new Set(group.memberContactIds);
  return value.flatMap((rawItem): WechatStoredMessage[] => {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw new Error("每条群聊消息都必须包含 sender_contact_id 和 content。");
    }
    const item = rawItem as Record<string, unknown>;
    const contactId = requireString(item, "sender_contact_id", "群聊发言人 ID");
    if (!memberIds.has(contactId)) {
      throw new Error(`联系人 ${contactId} 不是群聊“${group.name}”的成员。`);
    }
    const contact = requireContact(session, contactId);
    return normalizeBubbleContents([item.content]).map((content) => ({
      id: createId(),
      groupId: group.id,
      contactId: contact.id,
      senderName: contact.name,
      senderAvatar: contact.avatarImage,
      role: "assistant" as const,
      content,
      createdAt: now(),
    }));
  });
}

function serializePrivateMessages(messages: WechatStoredMessage[]) {
  return messages.map((message) => ({
    id: message.id,
    content: message.content,
    created_at: message.createdAt,
  }));
}

function serializeGroupMessages(messages: WechatStoredMessage[]) {
  return messages.map((message) => ({
    id: message.id,
    sender_contact_id: message.contactId,
    sender_name: message.senderName,
    content: message.content,
    created_at: message.createdAt,
  }));
}

export function executePhoneToolOnSession(
  toolName: PhoneToolName,
  args: Record<string, unknown>,
  session: WechatSessionStore,
  options: PhoneToolExecutionOptions = {},
): PhoneToolExecution {
  const createId = options.createId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());

  switch (toolName) {
    case "phone_get_state":
      return {
        session,
        result: {
          contacts: session.contacts.map(serializeContact),
          groups: session.groups.map(serializeGroup),
          available_personas: (options.availablePersonas ?? []).map((persona) => ({
            id: persona.id,
            name: persona.name,
            description: persona.description,
            avatar_image: redactAvatar(persona.avatarImage),
            has_avatar: Boolean(persona.avatarImage),
          })),
          ...(args.include_messages !== false
            ? {
                messages: session.messages.map((message) => ({
                  id: message.id,
                  contact_id: message.contactId ?? "",
                  group_id: message.groupId ?? "",
                  sender_name: message.senderName ?? "",
                  role: message.role,
                  content: message.content,
                  created_at: message.createdAt,
                })),
              }
            : {}),
        },
      };

    case "phone_create_contact": {
      const timestamp = now();
      const personaId = optionalString(args, "persona_id");
      validatePersonaId(personaId, options.validPersonaIds);
      const contact: WechatContact = {
        id: createId(),
        name: requireString(args, "name", "朋友姓名"),
        nickname: optionalString(args, "nickname") ?? "",
        avatarImage: optionalString(args, "avatar_image") ?? "",
        profile: optionalString(args, "profile") ?? "",
        ...(personaId ? { personaId } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const duplicate = findDuplicateContact(session.contacts, contact);
      const targetContact = duplicate ?? contact;
      const sentMessages = Object.prototype.hasOwnProperty.call(args, "messages")
        ? buildPrivateMessages(targetContact, args.messages, createId, now)
        : [];
      const nextSession = duplicate && sentMessages.length === 0
        ? session
        : {
            ...session,
            ...(duplicate
              ? {}
              : {
                  contacts: [...session.contacts, contact],
                  activeContactId: session.activeContactId || contact.id,
                }),
            ...(sentMessages.length > 0
              ? { messages: [...session.messages, ...sentMessages] }
              : {}),
          };
      return {
        session: nextSession,
        result: {
          ok: true,
          created: !duplicate,
          duplicate: Boolean(duplicate),
          contact: serializeContact(targetContact),
          message_sent: sentMessages.length > 0,
          sent_count: sentMessages.length,
          messages: serializePrivateMessages(sentMessages),
          ...(sentMessages.length === 0
            ? {
                next_action:
                  "本次只创建或复用了联系人，没有发送微信消息。如果当前目标包含发消息，必须立即调用 phone_send_private_messages，不能在主会话正文中代替发送。",
              }
            : {}),
        },
        ...(duplicate ? {} : { updatedContact: contact }),
        ...(sentMessages.length > 0 ? { sentMessages } : {}),
      };
    }

    case "phone_update_contact": {
      const contactId = requireString(args, "contact_id", "联系人 ID");
      const current = requireContact(session, contactId);
      const personaId = optionalString(args, "persona_id");
      validatePersonaId(personaId, options.validPersonaIds);
      const name = optionalString(args, "name");
      const nickname = optionalString(args, "nickname");
      const avatarImage = optionalString(args, "avatar_image");
      const profile = optionalString(args, "profile");
      if (name !== undefined && !name) throw new Error("朋友姓名不能为空。");
      const updated: WechatContact = {
        ...current,
        ...(name !== undefined ? { name } : {}),
        ...(nickname !== undefined ? { nickname } : {}),
        ...(avatarImage !== undefined ? { avatarImage } : {}),
        ...(profile !== undefined ? { profile } : {}),
        ...(personaId ? { personaId } : {}),
        updatedAt: now(),
      };
      if (personaId === "") delete updated.personaId;
      const duplicate = findDuplicateContact(session.contacts, updated, current.id);
      if (duplicate) {
        throw new Error(`联系人资料与“${duplicate.name}”重复，未修改。`);
      }
      return {
        session: {
          ...session,
          contacts: session.contacts.map((contact) =>
            contact.id === current.id ? updated : contact,
          ),
        },
        result: { ok: true, updated: true, contact: serializeContact(updated) },
        updatedContact: updated,
      };
    }

    case "phone_delete_contact": {
      const contactId = requireString(args, "contact_id", "联系人 ID");
      const current = requireContact(session, contactId);
      const contacts = session.contacts.filter((contact) => contact.id !== current.id);
      return {
        session: {
          ...session,
          contacts,
          groups: session.groups.map((group) => ({
            ...group,
            memberContactIds: group.memberContactIds.filter((id) => id !== current.id),
          })),
          messages: session.messages.filter(
            (message) => Boolean(message.groupId) || message.contactId !== current.id,
          ),
          activeContactId:
            session.activeContactId === current.id
              ? contacts[0]?.id ?? ""
              : session.activeContactId,
        },
        result: { ok: true, deleted: true, contact_id: current.id, name: current.name },
        deletedContactId: current.id,
      };
    }

    case "phone_create_group": {
      const memberContactIds = normalizeMemberIds(args.member_contact_ids, session.contacts);
      const includesUser = optionalBoolean(args, "includes_user") ?? true;
      validateGroupParticipants(memberContactIds, includesUser);
      const timestamp = now();
      const group: WechatGroup = {
        id: createId(),
        name: requireString(args, "name", "群聊名称"),
        avatarImage: optionalString(args, "avatar_image") ?? "",
        memberContactIds,
        includesUser,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const duplicate = findDuplicateGroup(session.groups, group);
      const targetGroup = duplicate ?? group;
      const sentMessages = Object.prototype.hasOwnProperty.call(args, "messages")
        ? buildGroupMessages(targetGroup, session, args.messages, createId, now)
        : [];
      const nextSession = duplicate && sentMessages.length === 0
        ? session
        : {
            ...session,
            ...(duplicate
              ? {}
              : {
                  groups: [...session.groups, group],
                  activeGroupId: session.activeGroupId || group.id,
                }),
            ...(sentMessages.length > 0
              ? { messages: [...session.messages, ...sentMessages] }
              : {}),
          };
      return {
        session: nextSession,
        result: {
          ok: true,
          created: !duplicate,
          duplicate: Boolean(duplicate),
          group: serializeGroup(targetGroup),
          message_sent: sentMessages.length > 0,
          sent_count: sentMessages.length,
          messages: serializeGroupMessages(sentMessages),
          ...(sentMessages.length === 0
            ? {
                next_action:
                  "本次只创建或复用了群聊，没有发送微信消息。如果当前目标包含发消息，必须立即调用 phone_send_group_messages，不能在主会话正文中代替发送。",
              }
            : {}),
        },
        ...(duplicate ? {} : { updatedGroup: group }),
        ...(sentMessages.length > 0 ? { sentMessages } : {}),
      };
    }

    case "phone_update_group": {
      const groupId = requireString(args, "group_id", "群聊 ID");
      const current = requireGroup(session, groupId);
      const name = optionalString(args, "name");
      if (name !== undefined && !name) throw new Error("群聊名称不能为空。");
      const memberContactIds = Object.prototype.hasOwnProperty.call(args, "member_contact_ids")
        ? normalizeMemberIds(args.member_contact_ids, session.contacts)
        : current.memberContactIds;
      const includesUser = optionalBoolean(args, "includes_user") ?? current.includesUser;
      validateGroupParticipants(memberContactIds, includesUser);
      const avatarImage = optionalString(args, "avatar_image");
      const updated: WechatGroup = {
        ...current,
        ...(name !== undefined ? { name } : {}),
        ...(avatarImage !== undefined ? { avatarImage } : {}),
        memberContactIds,
        includesUser,
        updatedAt: now(),
      };
      const duplicate = findDuplicateGroup(session.groups, updated, current.id);
      if (duplicate) {
        throw new Error(`群聊资料与“${duplicate.name}”重复，未修改。`);
      }
      return {
        session: {
          ...session,
          groups: session.groups.map((group) =>
            group.id === current.id ? updated : group,
          ),
        },
        result: { ok: true, updated: true, group: serializeGroup(updated) },
        updatedGroup: updated,
      };
    }

    case "phone_delete_group": {
      const groupId = requireString(args, "group_id", "群聊 ID");
      const current = requireGroup(session, groupId);
      return {
        session: {
          ...session,
          groups: session.groups.filter((group) => group.id !== current.id),
          messages: session.messages.filter((message) => message.groupId !== current.id),
          activeGroupId: session.activeGroupId === current.id ? "" : session.activeGroupId,
        },
        result: { ok: true, deleted: true, group_id: current.id, name: current.name },
        deletedGroupId: current.id,
      };
    }

    case "phone_send_private_messages": {
      const contactId = requireString(args, "contact_id", "联系人 ID");
      const contact = requireContact(session, contactId);
      const sentMessages = buildPrivateMessages(contact, args.messages, createId, now);
      return {
        session: { ...session, messages: [...session.messages, ...sentMessages] },
        result: {
          ok: true,
          contact: serializeContact(contact),
          sent_count: sentMessages.length,
          messages: serializePrivateMessages(sentMessages),
        },
        sentMessages,
      };
    }

    case "phone_send_group_messages": {
      const groupId = requireString(args, "group_id", "群聊 ID");
      const group = requireGroup(session, groupId);
      const sentMessages = buildGroupMessages(group, session, args.messages, createId, now);
      return {
        session: { ...session, messages: [...session.messages, ...sentMessages] },
        result: {
          ok: true,
          group: serializeGroup(group),
          sent_count: sentMessages.length,
          messages: serializeGroupMessages(sentMessages),
        },
        sentMessages,
      };
    }
  }
}
