import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
        request: {
          model: "test-model",
          messages: [
            { role: "system", content: "Use tools when needed." },
            { role: "user", content: "Read the page" },
          ],
          tools: [toolDefinition("browser_read_page")],
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
    assert.equal(output, "Pi completed");
    assert.equal(upstreamRequests.length, 2);
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
