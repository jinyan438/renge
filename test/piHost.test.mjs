import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startRengeServer } from "../server.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function sendChunk(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

test("Pi Host bridges a Renge-only tool result and continues the model loop", async () => {
  const upstreamRequests = [];
  const upstream = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    upstreamRequests.push(body);
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const base = {
      id: `chat-${upstreamRequests.length}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "test-model",
    };
    if (upstreamRequests.length === 1) {
      sendChunk(response, {
        ...base,
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [{
              index: 0,
              id: "call-browser",
              type: "function",
              function: { name: "browser_read_page", arguments: "{\"mode\":\"text\"}" },
            }],
          },
          finish_reason: null,
        }],
      });
      sendChunk(response, {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      });
    } else {
      sendChunk(response, {
        ...base,
        choices: [{ index: 0, delta: { role: "assistant", content: "Pi completed" }, finish_reason: null }],
      });
      sendChunk(response, {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });
    }
    response.end("data: [DONE]\n\n");
  });

  const dataDir = await mkdtemp(join(tmpdir(), "renge-pi-host-test-"));
  const upstreamPort = await listen(upstream);
  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
  try {
    const runId = "pi-host-test-run";
    const response = await fetch(`${renge.url}/api/pi/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        apiBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        apiKey: "test-key",
        apiType: "chat-completions",
        piCompaction: {
          enabled: true,
          reserveTokens: 8_192,
          keepRecentTokens: 12_000,
        },
        request: {
          model: "test-model",
          messages: [
            { role: "system", content: "Use tools when needed." },
            { role: "user", content: "Read the page" },
          ],
          tools: [toolDefinition("browser_read_page")],
          max_tokens: 4_096,
          stream: true,
        },
      }),
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let output = "";
    let bridged = false;
    let runStart;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split(/\r?\n/).find((entry) => entry.startsWith("data:"));
        const data = line?.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const payload = JSON.parse(data);
        if (payload.pi?.type === "run_start") runStart = payload.pi;
        if (payload.pi?.type === "tool_request") {
          bridged = true;
          const toolResponse = await fetch(`${renge.url}/api/pi/tool-result`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              runId: payload.pi.runId,
              toolCallId: payload.pi.toolCallId,
              result: { text: "visible page text" },
            }),
          });
          assert.equal(toolResponse.status, 200);
        }
        output += payload.choices?.[0]?.delta?.content ?? "";
      }
    }
    assert.equal(bridged, true);
    assert.equal(runStart?.kernelMode, "full");
    assert.deepEqual(runStart?.compaction, {
      engine: "pi",
      enabled: true,
      reserveTokens: 8_192,
      keepRecentTokens: 12_000,
    });
    assert.equal(output, "Pi completed");
    assert.equal(upstreamRequests.length, 2);
    for (const upstreamRequest of upstreamRequests) {
      assert.equal(upstreamRequest.max_tokens, undefined);
      assert.equal(upstreamRequest.max_completion_tokens, 4_096);
    }
    assert.equal(
      upstreamRequests[1].messages.some((message) => message.role === "tool"),
      true,
    );
  } finally {
    await close(renge.server);
    await close(upstream);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Pi Host executes Pi native read directly for an Electron workspace", async () => {
  const upstreamRequests = [];
  const upstream = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    upstreamRequests.push(body);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = {
      id: `native-${upstreamRequests.length}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "test-model",
    };
    if (upstreamRequests.length === 1) {
      sendChunk(response, {
        ...base,
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [{
              index: 0,
              id: "call-read",
              type: "function",
              function: { name: "read", arguments: "{\"path\":\"native.txt\"}" },
            }],
          },
          finish_reason: null,
        }],
      });
      sendChunk(response, {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      });
    } else {
      sendChunk(response, {
        ...base,
        choices: [{ index: 0, delta: { role: "assistant", content: "Native read completed" }, finish_reason: null }],
      });
      sendChunk(response, {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });
    }
    response.end("data: [DONE]\n\n");
  });

  const dataDir = await mkdtemp(join(tmpdir(), "renge-pi-native-test-"));
  await writeFile(join(dataDir, "native.txt"), "native fixture content", "utf8");
  const upstreamPort = await listen(upstream);
  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
  try {
    const response = await fetch(`${renge.url}/api/pi/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "pi-native-read-run",
        apiBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        apiKey: "test-key",
        apiType: "chat-completions",
        workspace: { kind: "electron", cwd: dataDir },
        request: {
          model: "test-model",
          messages: [{ role: "user", content: "Read native.txt" }],
          tools: [toolDefinition("local_read_file")],
          stream: true,
        },
      }),
    });
    const text = await response.text();
    assert.match(text, /Native read completed/);
    assert.match(text, /"toolName":"read"/);
    assert.equal(upstreamRequests.length, 2);
    for (const upstreamRequest of upstreamRequests) {
      assert.equal(upstreamRequest.max_tokens, undefined);
      assert.equal(upstreamRequest.max_completion_tokens, 65_536);
    }
    const toolMessage = upstreamRequests[1].messages.find((message) => message.role === "tool");
    assert.match(String(toolMessage?.content ?? ""), /native fixture content/);
    assert.equal(
      upstreamRequests[0].tools.some((entry) => entry.function?.name === "local_read_file"),
      false,
    );
    assert.equal(
      upstreamRequests[0].tools.some((entry) => entry.function?.name === "read"),
      true,
    );
  } finally {
    await close(renge.server);
    await close(upstream);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Pi Host exposes native Skill metadata and read without other tools", async () => {
  const upstreamRequests = [];
  const upstream = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    upstreamRequests.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    sendChunk(response, {
      id: "native-skill-1",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "test-model",
      choices: [{
        index: 0,
        delta: { role: "assistant", content: "Skill ready" },
        finish_reason: null,
      }],
    });
    sendChunk(response, {
      id: "native-skill-1",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "test-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    response.end("data: [DONE]\n\n");
  });

  const root = await mkdtemp(join(tmpdir(), "renge-pi-native-skill-test-"));
  const skillDir = join(root, "skills", "native-test");
  await mkdir(skillDir, { recursive: true });
  const skillPath = join(skillDir, "SKILL.md");
  await writeFile(skillPath, [
    "---",
    "name: native-test-skill",
    "description: Use this native Skill for the Pi host integration test.",
    "---",
    "",
    "# Native test",
  ].join("\n"), "utf8");
  const upstreamPort = await listen(upstream);
  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
  try {
    const response = await fetch(`${renge.url}/api/pi/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "native-skill-run",
        apiBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        apiKey: "test-key",
        apiType: "chat-completions",
        enableTools: false,
        piSkillPaths: [skillPath],
        request: {
          model: "test-model",
          messages: [{ role: "user", content: "Use the matching skill" }],
          stream: true,
        },
      }),
    });
    assert.equal(response.status, 200);
    const streamText = await response.text();
    assert.match(streamText, /Skill ready/);
    assert.equal(upstreamRequests.length, 1);
    const upstreamRequest = upstreamRequests[0];
    assert.deepEqual(
      upstreamRequest.tools.map((tool) => tool.function.name),
      ["read"],
    );
    const systemPrompt = upstreamRequest.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    assert.match(systemPrompt, /<available_skills>/);
    assert.match(systemPrompt, /native-test-skill/);
    assert.match(systemPrompt, /Use the read tool to load a skill/);
    assert.doesNotMatch(systemPrompt, /# Native test/);
  } finally {
    await close(renge.server);
    await close(upstream);
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi Host resumes the persisted Pi session for the next Renge turn", async () => {
  const upstreamRequests = [];
  const upstream = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    upstreamRequests.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = {
      id: `persist-${upstreamRequests.length}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "test-model",
    };
    sendChunk(response, {
      ...base,
      choices: [{
        index: 0,
        delta: { role: "assistant", content: `reply-${upstreamRequests.length}` },
        finish_reason: null,
      }],
    });
    sendChunk(response, {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    response.end("data: [DONE]\n\n");
  });

  const dataDir = await mkdtemp(join(tmpdir(), "renge-pi-persist-test-"));
  const upstreamPort = await listen(upstream);
  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
  try {
    const request = (content) => fetch(`${renge.url}/api/pi/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "persisted-session",
        apiBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        apiKey: "test-key",
        apiType: "chat-completions",
        request: { model: "test-model", messages: [{ role: "user", content }], stream: true },
      }),
    });
    assert.equal((await (await request("first turn")).text()).includes("reply-1"), true);
    assert.equal((await (await request("second turn")).text()).includes("reply-2"), true);
    assert.equal(upstreamRequests.length, 2);
    const resumedMessages = upstreamRequests[1].messages;
    assert.equal(resumedMessages.filter((message) => message.role === "user").length, 2);
    assert.match(JSON.stringify(resumedMessages), /first turn/);
    assert.match(JSON.stringify(resumedMessages), /second turn/);

    const resetResponse = await fetch(`${renge.url}/api/pi/session`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "persisted-session" }),
    });
    assert.equal(resetResponse.status, 200);
    assert.equal((await (await request("fresh turn")).text()).includes("reply-3"), true);
    assert.equal(upstreamRequests[2].messages.filter((message) => message.role === "user").length, 1);
    assert.doesNotMatch(JSON.stringify(upstreamRequests[2].messages), /first turn/);
  } finally {
    await close(renge.server);
    await close(upstream);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Pi Host exposes PiDeck-compatible manual compaction controls for an idle session", async () => {
  const upstreamRequests = [];
  const upstream = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    upstreamRequests.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = {
      id: `compact-${upstreamRequests.length}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "test-model",
    };
    sendChunk(response, {
      ...base,
      choices: [{ index: 0, delta: { role: "assistant", content: "ready" }, finish_reason: null }],
    });
    sendChunk(response, {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    response.end("data: [DONE]\n\n");
  });

  const dataDir = await mkdtemp(join(tmpdir(), "renge-pi-compact-test-"));
  const upstreamPort = await listen(upstream);
  const renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir });
  try {
    const chatResponse = await fetch(`${renge.url}/api/pi/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "manual-compact-session",
        apiBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        apiKey: "test-key",
        apiType: "chat-completions",
        contextWindow: 2_048,
        piCompaction: { enabled: false, reserveTokens: 256, keepRecentTokens: 512 },
        request: {
          model: "test-model",
          messages: [
            ...Array.from({ length: 8 }, (_, index) => [
              { role: "user", content: `old user ${index} ${"hello ".repeat(300)}` },
              { role: "assistant", content: `old assistant ${index} ${"reply ".repeat(300)}` },
            ]).flat(),
            { role: "user", content: "final question" },
          ],
          stream: true,
        },
      }),
    });
    assert.equal(chatResponse.status, 200);
    await chatResponse.text();

    const toggleResponse = await fetch(`${renge.url}/api/pi/set-auto-compaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "manual-compact-session", enabled: false }),
    });
    assert.equal(toggleResponse.status, 200);
    assert.deepEqual(await toggleResponse.json(), { ok: true, enabled: false });

    const compactResponse = await fetch(`${renge.url}/api/pi/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "manual-compact-session",
        contextWindow: 2_048,
        piCompaction: { enabled: true, reserveTokens: 256, keepRecentTokens: 512 },
      }),
    });
    const compactPayload = await compactResponse.json();
    assert.equal(compactResponse.status, 200);
    assert.equal(compactPayload.ok, true);
    assert.equal(typeof compactPayload.contextUsage?.contextWindow, "number");
    assert.equal(upstreamRequests.length >= 2, true);
  } finally {
    await close(renge.server);
    await close(upstream);
    await rm(dataDir, { recursive: true, force: true });
  }
});

function toolDefinition(name) {
  return {
    type: "function",
    function: {
      name,
      description: "Read the current browser page",
      parameters: {
        type: "object",
        properties: { mode: { type: "string" } },
      },
    },
  };
}
