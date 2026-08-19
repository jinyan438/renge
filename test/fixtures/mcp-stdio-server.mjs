import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

lines.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    reply(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "renge-test-mcp", version: "1.0.0" },
    });
    return;
  }
  if (message.method === "tools/list") {
    reply(message.id, {
      tools: [{
        name: "echo",
        description: "Echo the supplied text",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      }],
    });
    return;
  }
  if (message.method === "tools/call") {
    reply(message.id, {
      content: [{ type: "text", text: String(message.params?.arguments?.text ?? "") }],
    });
    return;
  }
  reply(message.id, {});
});

