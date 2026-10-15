import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = process.argv[2];
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  appendFileSync(log, `${message.method}\n`);
  if (message.id === undefined) return;
  const reply = (result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
  if (message.method === "initialize") return reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: { name: "migration", version: "1.0.0" } });
  if (message.method === "tools/list") return reply({ tools: ["read-file", "read_file"].map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } })) });
  // A slow resources/list must never block tools becoming available in 1.2.
  if (message.method === "resources/list") return;
  if (message.method === "tools/call") return reply({ content: [{ type: "text", text: message.params.name }], structuredContent: message.params.name === "read-file" ? ["array", 1] : null });
  reply({});
});
