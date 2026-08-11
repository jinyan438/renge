import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWechatGroupRequestMessages,
  buildWechatGroupSpeakerSelectionMessages,
  buildWechatRequestMessages,
  createEmptyWechatStore,
  getWechatSessionStore,
  normalizeWechatStore,
  resolveWechatGroupSpeakerSelection,
  shouldGenerateWechatProactively,
  splitWechatReply,
  syncWechatSessionMessages,
  updateWechatSessionStore,
} from "../src/wechatSidebarUtils.ts";

const contact = {
  id: "friend-1",
  name: "沈知予",
  nickname: "小知",
  avatarImage: "",
  profile: "说话克制，熟悉用户的近况。",
  personaId: "persona-1",
  createdAt: "2026-08-10T08:00:00.000Z",
  updatedAt: "2026-08-10T08:00:00.000Z",
};

const persona = {
  id: "persona-1",
  name: "沈知予",
  avatarImage: "",
  description: "城市规划研究员。",
  modelProfile: {
    provider: "OpenAI Compatible",
    model: "gpt-4.1",
    temperature: 0.72,
    responseStyle: "自然",
  },
  entryTypes: [
    {
      id: "type-1",
      name: "性格",
      influence: "HIGH",
      entries: [
        {
          id: "entry-1",
          key: "表达",
          value: "短句",
          enabled: true,
          updatedAt: "2026-08-10T08:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-10T08:00:00.000Z",
    },
  ],
  createdAt: "2026-08-10T08:00:00.000Z",
  updatedAt: "2026-08-10T08:00:00.000Z",
};

const secondContact = {
  ...contact,
  id: "friend-2",
  name: "林夏",
  nickname: "夏夏",
  personaId: undefined,
};

const group = {
  id: "group-1",
  name: "周末出游",
  avatarImage: "",
  memberContactIds: [contact.id, secondContact.id],
  includesUser: false,
  createdAt: "2026-08-10T08:00:00.000Z",
  updatedAt: "2026-08-10T08:00:00.000Z",
};

test("wechat prompt keeps character card, world book, status bar and persona context", () => {
  const messages = buildWechatRequestMessages({
    contact,
    persona,
    user: { nickname: "用户", bio: "正在准备旅行。" },
    sharedMessages: [
      {
        role: "user",
        content: "主会话里的计划",
        createdAt: "2026-08-10T08:00:00.000Z",
      },
      {
        role: "assistant",
        content: "微信里的回复",
        source: "wechat",
        contactId: "friend-1",
        contactName: "沈知予",
        createdAt: "2026-08-10T08:01:00.000Z",
      },
    ],
    characterCardPrompt: "CHARACTER_CARD_CONTEXT",
    worldBookPrompt: "WORLD_BOOK_CONTEXT",
    statusBarPrompt: "STATUS_BAR_CONTEXT",
  });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /CHARACTER_CARD_CONTEXT/);
  assert.match(messages[0].content, /WORLD_BOOK_CONTEXT/);
  assert.match(messages[0].content, /STATUS_BAR_CONTEXT/);
  assert.match(messages[0].content, /城市规划研究员/);
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /【主会话 · 主会话用户】/);
  assert.equal(messages[2].role, "assistant");
  assert.equal(messages[2].content, "微信里的回复");
});

test("wechat prompt builder has no slots for tavern presets or tool capability prompts", () => {
  const messages = buildWechatRequestMessages({
    contact,
    user: { nickname: "用户", bio: "" },
    sharedMessages: [],
  });
  const prompt = messages[0].content;

  assert.doesNotMatch(prompt, /MCP|终端工具|浏览器工具|workspace tool/i);
  assert.doesNotMatch(prompt, /酒馆预设|tool_choice|chat_present_options/i);
});

test("wechat proactive generation asks the contact to initiate a message", () => {
  const messages = buildWechatRequestMessages({
    contact,
    user: { nickname: "用户", bio: "" },
    sharedMessages: [],
    proactive: true,
  });

  assert.match(messages[0].content, /没有新的用户微信消息/);
  assert.match(messages[0].content, /主动发起一条自然/);
  assert.equal(messages.length, 1);
});

test("wechat generation is proactive only when no user message is queued", () => {
  assert.equal(shouldGenerateWechatProactively([]), true);
  assert.equal(shouldGenerateWechatProactively([{ role: "assistant" }]), true);
  assert.equal(shouldGenerateWechatProactively([{ role: "user" }]), false);
  assert.equal(
    shouldGenerateWechatProactively([{ role: "user" }, { role: "assistant" }]),
    true,
  );
  assert.equal(
    shouldGenerateWechatProactively([{ role: "assistant" }, { role: "user" }]),
    false,
  );
});

test("wechat prompt keeps main chat as background and isolates other contacts", () => {
  const messages = buildWechatRequestMessages({
    contact,
    user: { nickname: "用户", bio: "" },
    sharedMessages: [
      {
        role: "assistant",
        content: "她看向窗外，雨声落在玻璃上，然后低声说起很长的往事。",
        createdAt: "2026-08-10T08:00:00.000Z",
      },
      {
        role: "assistant",
        content: "另一个联系人的消息",
        source: "wechat",
        contactId: "friend-2",
        contactName: "林夏",
        createdAt: "2026-08-10T08:01:00.000Z",
      },
      {
        role: "user",
        content: "喜欢吃什么菜",
        source: "wechat",
        contactId: "friend-1",
        contactName: "沈知予",
        createdAt: "2026-08-10T08:02:00.000Z",
      },
    ],
  });

  assert.match(messages[0].content, /微信频道格式是最高优先级/);
  assert.match(messages[0].content, /禁止输出人物动作、神态、心理、环境/);
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /只用于理解事实/);
  assert.match(messages[1].content, /她看向窗外/);
  assert.doesNotMatch(messages[1].content, /另一个联系人的消息/);
  assert.equal(
    messages.some((message) => message.content.includes("另一个联系人的消息")),
    false,
  );
  assert.deepEqual(messages[2], { role: "user", content: "喜欢吃什么菜" });
  assert.equal(
    messages.some(
      (message) => message.role === "assistant" && message.content.includes("她看向窗外"),
    ),
    false,
  );
});

test("private chat excludes group messages even when the same contact spoke in the group", () => {
  const messages = buildWechatRequestMessages({
    contact,
    user: { nickname: "用户", bio: "" },
    sharedMessages: [
      {
        role: "assistant",
        content: "这是 A 在群里的发言",
        source: "wechat",
        groupId: group.id,
        groupName: group.name,
        contactId: contact.id,
        contactName: contact.name,
        createdAt: "2026-08-10T08:00:00.000Z",
      },
      {
        role: "assistant",
        content: "这是 A 的私聊",
        source: "wechat",
        contactId: contact.id,
        contactName: contact.name,
        createdAt: "2026-08-10T08:01:00.000Z",
      },
    ],
  });

  assert.equal(messages.some((message) => message.content.includes("A 在群里的发言")), false);
  assert.equal(messages.at(-1).content, "这是 A 的私聊");
});

test("group chat keeps its own messages and excludes all private and other-group messages", () => {
  const messages = buildWechatGroupRequestMessages({
    group,
    members: [
      { contact, persona },
      { contact: secondContact },
    ],
    responder: secondContact,
    user: { nickname: "用户", bio: "不应注入未入群用户资料" },
    sharedMessages: [
      {
        role: "assistant",
        content: "主会话共享事件",
        createdAt: "2026-08-10T08:00:00.000Z",
      },
      {
        role: "user",
        content: "用户和 C 的私聊",
        source: "wechat",
        contactId: "friend-3",
        contactName: "C",
        createdAt: "2026-08-10T08:01:00.000Z",
      },
      {
        role: "assistant",
        content: "其他群里的消息",
        source: "wechat",
        groupId: "group-2",
        groupName: "其他群",
        contactId: "friend-3",
        contactName: "C",
        createdAt: "2026-08-10T08:02:00.000Z",
      },
      {
        role: "assistant",
        content: "A 在当前群里的消息",
        source: "wechat",
        groupId: group.id,
        groupName: group.name,
        contactId: contact.id,
        contactName: contact.name,
        createdAt: "2026-08-10T08:03:00.000Z",
      },
    ],
  });

  const promptText = messages.map((message) => message.content).join("\n");
  assert.match(promptText, /主会话共享事件/);
  assert.match(promptText, /A 在当前群里的消息/);
  assert.doesNotMatch(promptText, /用户和 C 的私聊/);
  assert.doesNotMatch(promptText, /其他群里的消息/);
  assert.doesNotMatch(promptText, /不应注入未入群用户资料/);
  assert.match(messages[0].content, /用户不在本群中/);
  assert.match(messages[0].content, /本轮只由群成员“林夏”/);
});

test("group speaker selection lets AI choose from isolated group context without turn order", () => {
  const messages = buildWechatGroupSpeakerSelectionMessages({
    group,
    members: [
      { contact, persona },
      { contact: secondContact },
    ],
    user: { nickname: "用户", bio: "用户不在群时不应作为候选人" },
    sharedMessages: [
      {
        role: "assistant",
        content: "主会话共享事件",
        createdAt: "2026-08-10T08:00:00.000Z",
      },
      {
        role: "user",
        content: "用户和 C 的私聊",
        source: "wechat",
        contactId: "friend-3",
        contactName: "C",
        createdAt: "2026-08-10T08:01:00.000Z",
      },
      {
        role: "assistant",
        content: "其他群里的消息",
        source: "wechat",
        groupId: "group-2",
        groupName: "其他群",
        contactId: "friend-3",
        contactName: "C",
        createdAt: "2026-08-10T08:02:00.000Z",
      },
      {
        role: "assistant",
        content: "A 刚刚在当前群说过话",
        source: "wechat",
        groupId: group.id,
        groupName: group.name,
        contactId: contact.id,
        contactName: contact.name,
        createdAt: "2026-08-10T08:03:00.000Z",
      },
    ],
    characterCardPrompt: "角色卡事实",
    worldBookPrompt: "世界书事实",
    statusBarPrompt: "状态栏事实",
    proactive: true,
  });

  const promptText = messages.map((message) => message.content).join("\n");
  assert.match(promptText, /主会话共享事件/);
  assert.match(promptText, /A 刚刚在当前群说过话/);
  assert.match(promptText, new RegExp(contact.id));
  assert.match(promptText, new RegExp(secondContact.id));
  assert.match(promptText, /城市规划研究员/);
  assert.match(promptText, /角色卡事实/);
  assert.match(promptText, /世界书事实/);
  assert.match(promptText, /状态栏事实/);
  assert.match(promptText, /允许同一个人在合理时连续发言/);
  assert.match(promptText, /只返回严格 JSON/);
  assert.doesNotMatch(promptText, /用户和 C 的私聊/);
  assert.doesNotMatch(promptText, /其他群里的消息/);
  assert.doesNotMatch(promptText, /用户不在群时不应作为候选人/);
});

test("group speaker selection resolves only a real unambiguous member", () => {
  assert.equal(
    resolveWechatGroupSpeakerSelection(
      `\`\`\`json\n{"contactId":"${secondContact.id}"}\n\`\`\``,
      [contact, secondContact],
    )?.id,
    secondContact.id,
  );
  assert.equal(
    resolveWechatGroupSpeakerSelection(contact.name, [contact, secondContact])?.id,
    contact.id,
  );
  assert.equal(
    resolveWechatGroupSpeakerSelection(
      `我选择这一位：{"contactId":"${contact.id}"}`,
      [contact, secondContact],
    )?.id,
    contact.id,
  );
  assert.equal(
    resolveWechatGroupSpeakerSelection("unknown-contact", [contact, secondContact]),
    null,
  );
  assert.equal(
    resolveWechatGroupSpeakerSelection("同名", [
      { ...contact, name: "同名" },
      { ...secondContact, name: "同名" },
    ]),
    null,
  );
});

test("wechat replies render as at most three clean bubbles", () => {
  assert.deepEqual(splitWechatReply("1. 第一条\n- 第二条\n第三条\n第四条"), [
    "第一条",
    "第二条",
    "第三条",
  ]);
});

test("wechat reply cleanup removes roleplay narration around quoted messages", () => {
  const mixedRoleplayReply = [
    "《喜欢吃什么菜啊……》我歪头想了想，回他：“我口味挺杂的，但偏爱清淡一点的，上海那边的菜我很喜欢，甜甜的。”",
    "又补了一句：“甜品也喜欢，上次吃了个焦糖布丁，记到现在。”",
    "打完字，我盯着屏幕犹豫了一下，还是没提奶奶做的雪菜炖豆腐。",
  ].join("\n");

  assert.deepEqual(splitWechatReply(mixedRoleplayReply), [
    "我口味挺杂的，但偏爱清淡一点的，上海那边的菜我很喜欢，甜甜的。",
    "甜品也喜欢，上次吃了个焦糖布丁，记到现在。",
  ]);
  assert.deepEqual(splitWechatReply("我想了想，还是更喜欢甜口。"), [
    "还是更喜欢甜口。",
  ]);
  assert.deepEqual(splitWechatReply("我盯着屏幕笑了笑。"), ["嗯。"]);
});

test("legacy wechat data migrates into host chat session partitions", () => {
  const secondContact = {
    ...contact,
    id: "friend-2",
    name: "林夏",
    nickname: "夏夏",
  };
  const migrated = normalizeWechatStore(
    {
      contacts: [contact, secondContact],
      activeContactId: "friend-1",
      messages: [
        {
          id: "message-a",
          contactId: "friend-1",
          sessionId: "session-a",
          role: "user",
          content: "A 会话消息",
          createdAt: "2026-08-10T08:02:00.000Z",
        },
        {
          id: "message-b",
          contactId: "friend-2",
          sessionId: "session-b",
          role: "assistant",
          content: "B 会话消息",
          createdAt: "2026-08-10T08:03:00.000Z",
        },
        {
          id: "message-unscoped",
          contactId: "friend-1",
          role: "assistant",
          content: "旧版未分区消息",
          createdAt: "2026-08-10T08:04:00.000Z",
        },
      ],
    },
    "session-a",
  );

  assert.deepEqual(
    migrated.sessions["session-a"].messages.map((message) => message.id),
    ["message-a", "message-unscoped"],
  );
  assert.equal(migrated.sessions["session-a"].contacts.length, 2);
  assert.deepEqual(
    migrated.sessions["session-b"].contacts.map((item) => item.id),
    ["friend-2"],
  );
  assert.equal(migrated.sessions["session-b"].messages[0].sessionId, undefined);
});

test("wechat contacts, messages and active contact stay isolated per host chat session", () => {
  const sessionAContact = { ...contact, id: "friend-a", name: "会话 A 朋友" };
  const sessionBContact = { ...contact, id: "friend-b", name: "会话 B 朋友" };
  let store = createEmptyWechatStore();

  store = updateWechatSessionStore(store, "session-a", (current) => ({
    ...current,
    contacts: [sessionAContact],
    activeContactId: sessionAContact.id,
    messages: [
      {
        id: "message-a",
        contactId: sessionAContact.id,
        role: "user",
        content: "只属于 A",
        createdAt: "2026-08-10T08:05:00.000Z",
      },
    ],
  }));
  store = updateWechatSessionStore(store, "session-b", (current) => ({
    ...current,
    contacts: [sessionBContact],
    activeContactId: sessionBContact.id,
  }));

  assert.deepEqual(getWechatSessionStore(store, "session-a").contacts, [sessionAContact]);
  assert.equal(getWechatSessionStore(store, "session-a").messages[0].content, "只属于 A");
  assert.deepEqual(getWechatSessionStore(store, "session-b").contacts, [sessionBContact]);
  assert.deepEqual(getWechatSessionStore(store, "session-b").messages, []);
  assert.deepEqual(getWechatSessionStore(store, "missing-session").contacts, []);
});

test("wechat groups normalize per session and keep historical sender snapshots", () => {
  const normalized = normalizeWechatStore({
    version: 2,
    sessions: {
      "session-a": {
        contacts: [contact, secondContact],
        groups: [
          {
            ...group,
            memberContactIds: [contact.id, secondContact.id, contact.id, "missing-contact"],
          },
        ],
        messages: [
          {
            id: "group-message",
            groupId: group.id,
            contactId: "missing-contact",
            senderName: "已删除成员",
            senderAvatar: "data:image/png;base64,avatar",
            role: "assistant",
            content: "历史群消息",
            createdAt: "2026-08-10T08:05:00.000Z",
          },
          {
            id: "missing-group-message",
            groupId: "missing-group",
            role: "assistant",
            content: "无效群消息",
            createdAt: "2026-08-10T08:05:30.000Z",
          },
        ],
        activeContactId: "",
        activeGroupId: group.id,
      },
    },
  });

  const session = getWechatSessionStore(normalized, "session-a");
  assert.deepEqual(session.groups[0].memberContactIds, [contact.id, secondContact.id]);
  assert.equal(session.activeGroupId, group.id);
  assert.deepEqual(session.messages, [
    {
      id: "group-message",
      groupId: group.id,
      senderName: "已删除成员",
      senderAvatar: "data:image/png;base64,avatar",
      role: "assistant",
      content: "历史群消息",
      createdAt: "2026-08-10T08:05:00.000Z",
    },
  ]);
});

test("main chat edits and deletions synchronize into phone messages", () => {
  const sessionStore = {
    contacts: [contact],
    activeContactId: contact.id,
    messages: [
      {
        id: "legacy-phone-user-id",
        contactId: contact.id,
        role: "user",
        content: "修改前",
        createdAt: "2026-08-10T08:06:00.000Z",
      },
      {
        id: "legacy-phone-assistant-id",
        contactId: contact.id,
        role: "assistant",
        content: "旧回复",
        createdAt: "2026-08-10T08:07:00.000Z",
      },
    ],
  };
  const edited = syncWechatSessionMessages(sessionStore, [
    {
      id: "main-user-id",
      contactId: contact.id,
      role: "user",
      content: "左侧修改后的消息",
      createdAt: "2026-08-10T08:06:00.000Z",
    },
    {
      id: "main-assistant-id",
      contactId: contact.id,
      role: "assistant",
      content: "她笑着回他：“同步后的回复。”",
      createdAt: "2026-08-10T08:07:00.000Z",
    },
    {
      id: "deleted-contact-message",
      contactId: "missing-contact",
      role: "assistant",
      content: "不应恢复已删除联系人的消息",
      createdAt: "2026-08-10T08:08:00.000Z",
    },
  ]);

  assert.deepEqual(
    edited.messages.map((message) => ({ id: message.id, content: message.content })),
    [
      { id: "main-user-id", content: "左侧修改后的消息" },
      { id: "main-assistant-id", content: "同步后的回复。" },
    ],
  );

  const afterDelete = syncWechatSessionMessages(edited, [
    {
      id: "main-assistant-id",
      contactId: contact.id,
      role: "assistant",
      content: "同步后的回复。",
      createdAt: "2026-08-10T08:07:00.000Z",
    },
  ]);
  assert.deepEqual(afterDelete.messages.map((message) => message.id), ["main-assistant-id"]);
  assert.deepEqual(syncWechatSessionMessages(afterDelete, []).messages, []);
});

test("main chat edits and deletions synchronize group messages without restoring removed members", () => {
  const sessionStore = {
    contacts: [contact, secondContact],
    groups: [group],
    activeContactId: "",
    activeGroupId: group.id,
    messages: [],
  };
  const initial = syncWechatSessionMessages(sessionStore, [
    {
      id: "group-user",
      groupId: group.id,
      role: "user",
      content: "群里的用户消息",
      createdAt: "2026-08-10T08:06:00.000Z",
    },
    {
      id: "group-assistant",
      groupId: group.id,
      contactId: contact.id,
      senderName: contact.name,
      senderAvatar: contact.avatarImage,
      role: "assistant",
      content: "修改前的群回复",
      createdAt: "2026-08-10T08:07:00.000Z",
    },
    {
      id: "other-group",
      groupId: "missing-group",
      role: "assistant",
      content: "不应同步",
      createdAt: "2026-08-10T08:08:00.000Z",
    },
  ]);

  assert.deepEqual(initial.messages.map((message) => message.id), [
    "group-user",
    "group-assistant",
  ]);

  const edited = syncWechatSessionMessages(initial, [
    {
      id: "group-assistant",
      groupId: group.id,
      contactId: contact.id,
      senderName: contact.name,
      senderAvatar: contact.avatarImage,
      role: "assistant",
      content: "她笑着说：“修改后的群回复。”",
      createdAt: "2026-08-10T08:07:00.000Z",
    },
  ]);
  assert.equal(edited.messages[0].content, "修改后的群回复。");

  const withoutSender = syncWechatSessionMessages(
    { ...edited, contacts: [secondContact] },
    [
      {
        id: "group-assistant",
        groupId: group.id,
        contactId: contact.id,
        senderName: contact.name,
        senderAvatar: contact.avatarImage,
        role: "assistant",
        content: "修改后的群回复。",
        createdAt: "2026-08-10T08:07:00.000Z",
      },
    ],
  );
  assert.equal(withoutSender.messages[0].contactId, undefined);
  assert.equal(withoutSender.messages[0].senderName, contact.name);
  assert.deepEqual(syncWechatSessionMessages(withoutSender, []).messages, []);
});
