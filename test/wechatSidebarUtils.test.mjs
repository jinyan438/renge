import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWechatRequestMessages,
  createEmptyWechatStore,
  getWechatSessionStore,
  normalizeWechatStore,
  splitWechatReply,
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
  assert.match(messages[1].content, /【主会话 · 主会话用户】/);
  assert.match(messages[2].content, /【微信 · 沈知予】/);
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

test("wechat replies render as at most three clean bubbles", () => {
  assert.deepEqual(splitWechatReply("1. 第一条\n- 第二条\n第三条\n第四条"), [
    "第一条",
    "第二条",
    "第三条",
  ]);
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
