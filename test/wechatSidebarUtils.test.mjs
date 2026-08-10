import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWechatRequestMessages,
  splitWechatReply,
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

