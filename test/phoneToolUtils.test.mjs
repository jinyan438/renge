import assert from "node:assert/strict";
import test from "node:test";

import {
  executePhoneToolOnSession,
  isPhoneToolName,
  phoneToolDefinitions,
} from "../src/phoneToolUtils.ts";
import { createEmptyWechatSessionStore } from "../src/wechatSidebarUtils.ts";

function createRuntime() {
  let id = 0;
  let tick = 0;
  return {
    createId: () => `generated-${++id}`,
    now: () => `2026-08-11T08:00:${String(tick++).padStart(2, "0")}.000Z`,
    validPersonaIds: new Set(["persona-a", "persona-b", "persona-c"]),
    availablePersonas: [
      {
        id: "persona-a",
        name: "人格 A",
        description: "A 的人设",
        avatarImage: "data:image/png;base64,avatar",
      },
    ],
  };
}

function run(toolName, args, session, runtime) {
  return executePhoneToolOnSession(toolName, args, session, runtime);
}

test("exposes the complete phone tool suite", () => {
  assert.deepEqual(
    phoneToolDefinitions.map((tool) => tool.function.name),
    [
      "phone_get_state",
      "phone_create_contact",
      "phone_update_contact",
      "phone_delete_contact",
      "phone_create_group",
      "phone_update_group",
      "phone_delete_group",
      "phone_send_private_messages",
      "phone_send_group_messages",
    ],
  );
  assert.equal(isPhoneToolName("phone_send_group_messages"), true);
  assert.equal(isPhoneToolName("local_read_file"), false);
});

test("creates contacts from an empty phone and blocks normalized duplicates", () => {
  const runtime = createRuntime();
  let session = createEmptyWechatSessionStore();
  const created = run(
    "phone_create_contact",
    {
      name: " 王爱青 ",
      nickname: "小王",
      profile: "说话直接",
      persona_id: "persona-a",
    },
    session,
    runtime,
  );
  session = created.session;

  assert.equal(created.result.created, true);
  assert.equal(created.result.message_sent, false);
  assert.match(created.result.next_action, /必须立即调用 phone_send_private_messages/);
  assert.equal(session.contacts.length, 1);
  assert.equal(session.activeContactId, session.contacts[0].id);
  const state = run("phone_get_state", { include_messages: false }, session, runtime);
  assert.deepEqual(state.result.available_personas, [
    {
      id: "persona-a",
      name: "人格 A",
      description: "A 的人设",
      avatar_image: "[已保存 data URL]",
      has_avatar: true,
    },
  ]);

  const sameNickname = run(
    "phone_create_contact",
    { name: "另一姓名", nickname: "  小王  " },
    session,
    runtime,
  );
  assert.equal(sameNickname.result.duplicate, true);
  assert.equal(sameNickname.session, session);

  const samePersona = run(
    "phone_create_contact",
    { name: "完全不同", persona_id: "persona-a" },
    session,
    runtime,
  );
  assert.equal(samePersona.result.duplicate, true);
  assert.equal(samePersona.session.contacts.length, 1);
});

test("creates or reuses a contact and sends private messages atomically", () => {
  const runtime = createRuntime();
  const emptySession = createEmptyWechatSessionStore();
  const createdAndSent = run(
    "phone_create_contact",
    {
      name: "林小栀",
      nickname: "小栀",
      messages: ["到了没？", "我在门口等你"],
    },
    emptySession,
    runtime,
  );

  assert.equal(createdAndSent.result.created, true);
  assert.equal(createdAndSent.result.message_sent, true);
  assert.equal(createdAndSent.result.sent_count, 2);
  assert.equal(createdAndSent.session.contacts.length, 1);
  assert.deepEqual(
    createdAndSent.session.messages.map((message) => message.content),
    ["到了没？", "我在门口等你"],
  );

  const reusedAndSent = run(
    "phone_create_contact",
    {
      name: "另一个姓名",
      nickname: "小栀",
      messages: ["明天见"],
    },
    createdAndSent.session,
    runtime,
  );
  assert.equal(reusedAndSent.result.created, false);
  assert.equal(reusedAndSent.result.duplicate, true);
  assert.equal(reusedAndSent.result.message_sent, true);
  assert.equal(reusedAndSent.session.contacts.length, 1);
  assert.equal(reusedAndSent.session.messages.at(-1).contactId, createdAndSent.session.contacts[0].id);
  assert.equal(reusedAndSent.session.messages.at(-1).content, "明天见");
});

test("creates unique groups, validates members, and sends mixed-member messages", () => {
  const runtime = createRuntime();
  let session = createEmptyWechatSessionStore();
  for (const [name, personaId] of [
    ["A", "persona-a"],
    ["B", "persona-b"],
    ["C", "persona-c"],
  ]) {
    session = run(
      "phone_create_contact",
      { name, persona_id: personaId },
      session,
      runtime,
    ).session;
  }
  const [contactA, contactB, contactC] = session.contacts;
  const created = run(
    "phone_create_group",
    {
      name: "周末群",
      member_contact_ids: [contactA.id, contactB.id],
      includes_user: false,
      messages: [
        { sender_contact_id: contactB.id, content: "群建好了" },
        { sender_contact_id: contactA.id, content: "收到" },
      ],
    },
    session,
    runtime,
  );
  session = created.session;
  const group = session.groups[0];
  assert.equal(created.result.created, true);
  assert.equal(created.result.message_sent, true);
  assert.deepEqual(
    created.sentMessages.map((message) => [message.contactId, message.content]),
    [
      [contactB.id, "群建好了"],
      [contactA.id, "收到"],
    ],
  );

  const duplicateMembers = run(
    "phone_create_group",
    {
      name: "另一个名字",
      member_contact_ids: [contactB.id, contactA.id],
      includes_user: false,
    },
    session,
    runtime,
  );
  assert.equal(duplicateMembers.result.duplicate, true);
  assert.equal(duplicateMembers.session.groups.length, 1);

  const sent = run(
    "phone_send_group_messages",
    {
      group_id: group.id,
      messages: [
        { sender_contact_id: contactB.id, content: "B笑着说：“先走吗？”" },
        { sender_contact_id: contactA.id, content: "可以\n我马上到" },
      ],
    },
    session,
    runtime,
  );
  assert.deepEqual(
    sent.sentMessages.map((message) => [message.contactId, message.content]),
    [
      [contactB.id, "先走吗？"],
      [contactA.id, "可以"],
      [contactA.id, "我马上到"],
    ],
  );
  assert.throws(
    () =>
      run(
        "phone_send_group_messages",
        {
          group_id: group.id,
          messages: [{ sender_contact_id: contactC.id, content: "我也来" }],
        },
        sent.session,
        runtime,
      ),
    /不是群聊.*的成员/,
  );
});

test("sends private batches and keeps phone sessions isolated by caller", () => {
  const runtimeA = createRuntime();
  const runtimeB = createRuntime();
  let sessionA = createEmptyWechatSessionStore();
  let sessionB = createEmptyWechatSessionStore();
  sessionA = run("phone_create_contact", { name: "会话 A" }, sessionA, runtimeA).session;
  sessionB = run("phone_create_contact", { name: "会话 B" }, sessionB, runtimeB).session;

  const sentA = run(
    "phone_send_private_messages",
    { contact_id: sessionA.contacts[0].id, messages: ["第一条", "第二条"] },
    sessionA,
    runtimeA,
  );
  assert.deepEqual(sentA.sentMessages.map((message) => message.content), ["第一条", "第二条"]);
  assert.equal(sentA.session.messages.length, 2);
  assert.equal(sessionB.messages.length, 0);
  assert.equal(sessionB.contacts[0].name, "会话 B");
});

test("deleting contacts and groups removes only their owned conversations", () => {
  const runtime = createRuntime();
  let session = createEmptyWechatSessionStore();
  session = run("phone_create_contact", { name: "A" }, session, runtime).session;
  session = run("phone_create_contact", { name: "B" }, session, runtime).session;
  const [contactA, contactB] = session.contacts;
  session = run(
    "phone_create_group",
    {
      name: "AB 群",
      member_contact_ids: [contactA.id, contactB.id],
      includes_user: true,
    },
    session,
    runtime,
  ).session;
  const group = session.groups[0];
  session = run(
    "phone_send_private_messages",
    { contact_id: contactA.id, messages: ["私聊"] },
    session,
    runtime,
  ).session;
  session = run(
    "phone_send_group_messages",
    {
      group_id: group.id,
      messages: [{ sender_contact_id: contactA.id, content: "群消息" }],
    },
    session,
    runtime,
  ).session;

  const deletedContact = run(
    "phone_delete_contact",
    { contact_id: contactA.id },
    session,
    runtime,
  );
  assert.equal(deletedContact.session.messages.length, 1);
  assert.equal(deletedContact.session.messages[0].groupId, group.id);
  assert.deepEqual(deletedContact.session.groups[0].memberContactIds, [contactB.id]);

  const deletedGroup = run(
    "phone_delete_group",
    { group_id: group.id },
    deletedContact.session,
    runtime,
  );
  assert.deepEqual(deletedGroup.session.groups, []);
  assert.deepEqual(deletedGroup.session.messages, []);
});
