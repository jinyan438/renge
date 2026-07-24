import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStatusBarContextPrompt,
  buildStatusBarReducerPayload,
  buildStatusBarReducerSystemPrompt,
  buildStatusBarResponseFormat,
  createDefaultStatusBarState,
  createStatusBarItem,
  getStatusBarItemValue,
  mergeStatusBarPatch,
  normalizeStatusBarState,
  parseStatusBarPatch,
} from "../src/statusBarUtils.ts";

function createTestState(overrides = {}) {
  return normalizeStatusBarState({
    enabled: true,
    title: "角色状态",
    accentColor: "#123abc",
    updatedAt: "2026-07-23T00:00:00.000Z",
    items: [
      {
        id: "mood",
        variableName: "情绪",
        description: "仅在角色明确表现出情绪变化时更新，使用简短情绪词。",
        label: "情绪",
        icon: "🎭",
        type: "banner",
        width: "long",
        size: "medium",
        initialValue: "平静",
      },
      {
        id: "progress",
        variableName: "任务进度",
        label: "任务进度",
        icon: "📊",
        type: "progress",
        width: "long",
        size: "medium",
        initialValue: 10,
      },
      {
        id: "hp",
        variableName: "HP",
        label: "HP",
        icon: "💧",
        type: "grid",
        width: "medium",
        size: "medium",
        initialValue: 100,
      },
      {
        id: "divider",
        variableName: "不应保留",
        label: "详情",
        icon: "",
        type: "divider",
        width: "long",
        size: "small",
        initialValue: "",
      },
    ],
    values: {
      mood: "平静",
      progress: 40,
      hp: 90,
      divider: "忽略",
      unknown: "忽略",
    },
    ...overrides,
  });
}

test("creates the default status bar and progress item defaults", () => {
  const state = createDefaultStatusBarState();
  const progress = createStatusBarItem("progress", { id: "custom-progress" });

  assert.equal(state.enabled, false);
  assert.equal(state.title, "状态监测终端");
  assert.equal(state.accentColor, "#ff758c");
  assert.equal(state.items.length, 7);
  assert.deepEqual(state.values, {});
  assert.match(state.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(progress, {
    id: "custom-progress",
    variableName: "进度",
    description: "",
    label: "进度",
    icon: "📊",
    type: "progress",
    width: "long",
    size: "medium",
    initialValue: 0,
  });
});

test("normalizes duplicate variable names, progress entries, and stored values", () => {
  const state = normalizeStatusBarState({
    enabled: true,
    title: "  测试状态  ",
    accentColor: "not-a-color",
    updatedAt: "fixed-revision",
    items: [
      {
        id: "first",
        variableName: "进度",
        label: "第一项",
        type: "grid",
        width: "short",
        size: "large",
        initialValue: 1,
      },
      {
        id: "second",
        variableName: "进度",
        label: "",
        type: "progress",
        width: "invalid",
        size: "invalid",
        initialValue: 25,
      },
      {
        id: "separator",
        variableName: "不会成为变量",
        label: "分隔",
        type: "divider",
        initialValue: "ignored",
      },
    ],
    values: {
      first: true,
      second: 75,
      separator: "drop-me",
      unknown: "drop-me-too",
    },
  });

  assert.equal(state.title, "测试状态");
  assert.equal(state.accentColor, "#ff758c");
  assert.equal(state.items[0].variableName, "进度");
  assert.equal(state.items[0].description, "");
  assert.equal(state.items[1].variableName, "进度_2");
  assert.equal(state.items[1].label, "进度_2");
  assert.equal(state.items[1].type, "progress");
  assert.equal(state.items[1].width, "long");
  assert.equal(state.items[1].size, "medium");
  assert.equal(state.items[2].variableName, "");
  assert.deepEqual(state.values, { first: true, second: 75 });
  assert.equal(getStatusBarItemValue(state, state.items[1]), 75);
});

test("builds read-only context, reducer payload, and response schema", () => {
  const state = createTestState();
  const context = buildStatusBarContextPrompt(state);
  const reducerPayload = JSON.parse(
    buildStatusBarReducerPayload(state, "我抵达了终点", "任务已经完成。", {
      personaContext: "谨慎而可靠的向导",
      worldBookContext: "终点位于北境山谷",
    }),
  );
  const responseFormat = buildStatusBarResponseFormat(state);

  assert.match(context, /当前会话状态（只读上下文）/);
  assert.match(context, /正常回复中不要输出/);
  assert.match(context, /"id": "progress"/);
  assert.match(context, /仅在角色明确表现出情绪变化时更新/);
  assert.match(context, /"minimum": 0/);
  assert.doesNotMatch(context, /"id": "divider"/);
  assert.equal(buildStatusBarContextPrompt({ ...state, enabled: false }), "");

  assert.equal(reducerPayload.version, 1);
  assert.equal(reducerPayload.schemaRevision, state.updatedAt);
  assert.equal(reducerPayload.latestUser, "我抵达了终点");
  assert.equal(reducerPayload.finalAssistant, "任务已经完成。");
  assert.equal(reducerPayload.personaContext, "谨慎而可靠的向导");
  assert.equal(reducerPayload.worldBookContext, "终点位于北境山谷");
  assert.deepEqual(
    reducerPayload.entries.map((entry) => entry.id),
    ["mood", "progress", "hp"],
  );
  assert.equal(
    reducerPayload.entries[0].description,
    "仅在角色明确表现出情绪变化时更新，使用简短情绪词。",
  );
  assert.deepEqual(reducerPayload.entries[1].constraints, {
    minimum: 0,
    maximum: 100,
  });
  const reducerSystemPrompt = buildStatusBarReducerSystemPrompt();
  assert.match(reducerSystemPrompt, /updates 只包含变化项/);
  assert.match(reducerSystemPrompt, /entries\[\]\.id/);
  assert.match(reducerSystemPrompt, /entries\[\]\.description/);
  assert.match(reducerSystemPrompt, /\{"version":1,"updates":\[\]\}/);
  assert.match(
    reducerSystemPrompt,
    /value 只能是字符串、有限数字、布尔值或 null/,
  );
  assert.deepEqual(
    responseFormat.json_schema.schema.properties.updates.items.properties.id.enum,
    ["mood", "progress", "hp"],
  );
  assert.equal(
    responseFormat.json_schema.schema.properties.updates.maxItems,
    3,
  );
});

test("parses a pure JSON status patch", () => {
  const state = createTestState();
  const result = parseStatusBarPatch(
    JSON.stringify({
      version: 1,
      updates: [
        { id: "mood", value: "兴奋" },
        { id: "hp", value: 80 },
      ],
    }),
    state,
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.patch, {
    version: 1,
    updates: [
      { id: "mood", value: "兴奋" },
      { id: "hp", value: 80 },
    ],
  });
});

test("parses JSON enclosed by an exact Markdown fence", () => {
  const state = createTestState();
  const result = parseStatusBarPatch(
    '```json\n{"version":1,"updates":[{"id":"mood","value":"紧张"}]}\n```',
    state,
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.patch.updates, [{ id: "mood", value: "紧张" }]);
});

test("extracts the final valid patch when a model wraps JSON with extra text", () => {
  const state = createTestState();
  const result = parseStatusBarPatch(
    '<think>先分析状态变化。</think>\n结果如下：\n```json\n{"version":1,"updates":[{"id":"mood","value":"期待"}]}\n```',
    state,
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.patch.updates, [{ id: "mood", value: "期待" }]);
});

test("prefers the last valid status patch in a response", () => {
  const state = createTestState();
  const result = parseStatusBarPatch(
    '示例：{"version":1,"updates":[]}\n最终：{"version":1,"updates":[{"id":"hp","value":80}]}',
    state,
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.patch.updates, [{ id: "hp", value: 80 }]);
});

test("accepts common loose JSON shapes and variable names", () => {
  const state = createTestState();

  assert.deepEqual(
    parseStatusBarPatch(
      "结果：[{ variableName: '情绪', value: '开心', }, { name: '任务进度', newValue: '75' }]",
      state,
    ).patch.updates,
    [
      { id: "mood", value: "开心" },
      { id: "progress", value: 75 },
    ],
  );
  assert.deepEqual(
    parseStatusBarPatch('{"情绪":"放松","HP":85}', state).patch.updates,
    [
      { id: "mood", value: "放松" },
      { id: "hp", value: 85 },
    ],
  );
  assert.deepEqual(
    parseStatusBarPatch('{"updates":{"情绪":"安心","HP":88}}', state).patch.updates,
    [
      { id: "mood", value: "安心" },
      { id: "hp", value: 88 },
    ],
  );
});

test("accepts a simple line or Markdown table update protocol", () => {
  const state = createTestState();
  const result = parseStatusBarPatch(
    "状态更新：\n- 情绪：专注\n任务进度\t90\n| HP | 70 |",
    state,
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.patch.updates, [
    { id: "mood", value: "专注" },
    { id: "progress", value: 90 },
    { id: "hp", value: 70 },
  ]);
  assert.deepEqual(parseStatusBarPatch("情绪：无变化", state).patch.updates, []);
});

test("rejects model analysis text masquerading as a status value", () => {
  const state = createTestState();
  const result = parseStatusBarPatch(
    "情绪：当前值为平静，我们需要根据人格设定和最终助手回复判断是否更新，所以可能应该填入兴奋，但也可能保持原值。",
    state,
  );

  assert.match(result.error, /分析说明/);
  assert.deepEqual(result.patch.updates, []);
});

test("filters unknown IDs, unchanged values, and keeps the last duplicate update", () => {
  const state = createTestState();

  assert.deepEqual(
    parseStatusBarPatch(
      JSON.stringify({
        version: 1,
        updates: [
          { id: "unknown", value: "污染" },
          { id: "mood", value: "激动" },
        ],
      }),
      state,
    ).patch.updates,
    [{ id: "mood", value: "激动" }],
  );
  assert.deepEqual(
    parseStatusBarPatch(
      JSON.stringify({
        version: 1,
        updates: [
          { id: "mood", value: "平静" },
          { id: "hp", value: 90 },
        ],
      }),
      state,
    ).patch.updates,
    [],
  );
  assert.deepEqual(
    parseStatusBarPatch(
      JSON.stringify({
        version: 1,
        updates: [
          { id: "mood", value: "紧张" },
          { id: "mood", value: "兴奋" },
        ],
      }),
      state,
    ).patch.updates,
    [{ id: "mood", value: "兴奋" }],
  );
  assert.deepEqual(
    parseStatusBarPatch(
      JSON.stringify({
        version: 1,
        updates: [
          { id: "unknown-1", value: "污染" },
          { id: "unknown-2", value: "污染" },
          { id: "unknown-3", value: "污染" },
          { id: "mood", value: "仍应采用" },
        ],
      }),
      state,
    ).patch.updates,
    [{ id: "mood", value: "仍应采用" }],
  );
  assert.deepEqual(
    parseStatusBarPatch(
      JSON.stringify({
        version: 1,
        updates: [
          { id: "mood", value: "兴奋" },
          { id: "mood", value: "平静" },
        ],
      }),
      state,
    ).patch.updates,
    [],
  );
});

test("clamps progress updates and accepts numeric strings", () => {
  const state = createTestState();

  assert.deepEqual(
    parseStatusBarPatch(
      '{"version":1,"updates":[{"id":"progress","value":125}]}',
      state,
    ).patch.updates,
    [{ id: "progress", value: 100 }],
  );
  assert.deepEqual(
    parseStatusBarPatch(
      '{"version":1,"updates":[{"id":"progress","value":-25}]}',
      state,
    ).patch.updates,
    [{ id: "progress", value: 0 }],
  );
  assert.deepEqual(
    parseStatusBarPatch(
      '{"version":1,"updates":[{"id":"progress","value":"75"}]}',
      state,
    ).patch.updates,
    [{ id: "progress", value: 75 }],
  );
  assert.deepEqual(
    parseStatusBarPatch("任务进度：80%", state).patch.updates,
    [{ id: "progress", value: 80 }],
  );
});

test("returns an empty patch and an error for malformed or invalid responses", () => {
  const state = createTestState();
  const malformed = parseStatusBarPatch("not json", state);
  const invalidShape = parseStatusBarPatch('{"version":2,"updates":[]}', state);
  const tooLong = parseStatusBarPatch("x".repeat(64 * 1024 + 1), state);

  for (const result of [malformed, invalidShape, tooLong]) {
    assert.deepEqual(result.patch, { version: 1, updates: [] });
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.length > 0);
  }
});

test("merges allowed updates while preserving existing values", () => {
  const state = createTestState();
  const merged = mergeStatusBarPatch(state, {
    version: 1,
    updates: [
      { id: "mood", value: "振奋" },
      { id: "progress", value: 85 },
      { id: "unknown", value: "忽略" },
    ],
  });

  assert.notEqual(merged, state);
  assert.deepEqual(merged.values, {
    mood: "振奋",
    progress: 85,
    hp: 90,
  });
  assert.equal(merged.updatedAt === state.updatedAt, false);
  assert.equal(
    mergeStatusBarPatch(state, { version: 1, updates: [] }),
    state,
  );
});
