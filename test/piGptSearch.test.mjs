import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { startRengeServer } from "../server.mjs";

// Optional real-package contract test: uses the installed package with a mocked
// search transport and dummy auth, never the user's account or a live search.
const plugin = process.env.PI_GPT_SEARCH_PACKAGE || join(process.env.APPDATA || tmpdir(), "Renge Agent Lab", ".pi", "agent", "npm", "node_modules", "pi-gpt-search");
test("installed pi-gpt-search: three tools, research actions, direct command and auth failures", {
  skip: !existsSync(join(plugin, "package.json")), timeout: 30_000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renge-real-gpt-search-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [resolve(plugin)] }));
  const realFetch = globalThis.fetch;
  const oldToken = process.env.CODEX_ACCESS_TOKEN;
  const oldAccount = process.env.CODEX_ACCOUNT_ID;
  process.env.CODEX_ACCESS_TOKEN = "fixture-token";
  process.env.CODEX_ACCOUNT_ID = "fixture-account";
  const searches = [];
  let authFailure = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://chatgpt.com/backend-api/codex/alpha/search")) {
      assert.equal(options.headers.Authorization, "Bearer fixture-token");
      searches.push(JSON.parse(options.body));
      return authFailure ? new Response("Expired", { status: 401 }) : Response.json({
        output: "Official documentation [turn0search0]",
        results: [{ title: "Renge documentation", url: "https://example.com/docs", ref_id: "turn0search0", snippet: "Compatibility verified" }],
      });
    }
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:/, "no external network traffic is allowed in this test");
    return realFetch(url, options);
  };
  let plannedTools = [];
  const modelRequests = [];
  const upstream = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    modelRequests.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const calls = plannedTools; plannedTools = [];
    const delta = calls.length ? { tool_calls: calls.map(([name, args], index) => ({ index, id: `search-${index}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) } : { content: "Search completed" };
    for (const choice of [{ delta: { role: "assistant", ...delta }, finish_reason: null }, { delta: {}, finish_reason: calls.length ? "tool_calls" : "stop" }]) {
      response.write(`data: ${JSON.stringify({ id: "actual-search", object: "chat.completion.chunk", model: "fixture-model", choices: [{ index: 0, ...choice }] })}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  let renge;
  t.after(async () => {
    globalThis.fetch = realFetch;
    if (oldToken === undefined) delete process.env.CODEX_ACCESS_TOKEN; else process.env.CODEX_ACCESS_TOKEN = oldToken;
    if (oldAccount === undefined) delete process.env.CODEX_ACCOUNT_ID; else process.env.CODEX_ACCOUNT_ID = oldAccount;
    upstream.closeAllConnections(); renge?.server.closeAllConnections();
    await Promise.all([new Promise((resolve) => upstream.close(resolve)), renge ? new Promise((resolve) => renge.server.close(resolve)) : Promise.resolve()]);
    await rm(root, { recursive: true, force: true });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  renge = await startRengeServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data"), piAgentDir: agentDir });
  let index = 0;
  const chat = async (content) => {
    const response = await fetch(`${renge.url}/api/pi/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      runId: `real-search-${++index}`, sessionId: "real-search", enableTools: true,
      apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture-key", apiType: "chat-completions",
      piCompaction: { enabled: false }, request: { model: "fixture-model", messages: [{ role: "user", content }], stream: true },
    }) });
    assert.equal(response.status, 200);
    return (await response.text()).split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
  };
  const direct = await chat("/gpt-search Renge docs");
  assert.equal(modelRequests.length, 0);
  assert.ok(direct.some((event) => event.pi?.type === "extension_entry" && event.pi.entry.customType === "gpt-search-output"));
  assert.ok(direct.some((event) => event.pi?.method === "setStatus" && /Searching/.test(event.pi.statusText)));
  assert.ok(direct.some((event) => event.pi?.method === "notify" && event.pi.notifyType === "info"));
  const empty = await chat("/gpt-search");
  assert.ok(empty.some((event) => event.pi?.notifyType === "warning"));
  const research = { search_query: [{ q: "Renge", domains: ["example.com"], recency: 7 }], open: [{ ref_id: "turn0search0" }], find: [{ ref_id: "turn0search0", pattern: "Compatibility" }], click: [{ ref_id: "turn0search0", id: 1 }] };
  plannedTools = [["codex-search", { query: "Renge", recency: 7, domains: ["example.com"] }], ["codex-research", research], ["web", { search_query: [{ q: "Renge legacy" }] }]];
  const tools = await chat("Use the three search tools");
  const exposed = modelRequests[0].tools.map((tool) => tool.function.name);
  for (const name of ["codex-search", "codex-research", "web"]) {
    assert.ok(exposed.includes(name));
    assert.ok(tools.some((event) => event.pi?.type === "tool_update" && event.pi.toolName === name));
    assert.ok(tools.some((event) => event.pi?.type === "tool_end" && event.pi.toolName === name && !event.pi.isError));
  }
  const toolEnds = tools.filter((event) => event.pi?.type === "tool_end");
  assert.doesNotMatch(JSON.stringify(toolEnds), /\\u001b/);
  assert.ok(toolEnds.some((event) => event.pi.result.content[0].text.includes("](https://example.com/docs)")));
  assert.ok(toolEnds.every((event) => event.pi.result.details.results.length === 1));
  const allSearches = JSON.stringify(searches);
  for (const action of ["search_query", "open", "find", "click"]) assert.ok(allSearches.includes(action));
  assert.equal(searches.length, 4);
  authFailure = true;
  const failedCommand = await chat("/gpt-search failing auth");
  assert.ok(failedCommand.some((event) => event.pi?.notifyType === "error"));
  plannedTools = [["codex-search", { query: "auth failure" }]];
  const failedTool = await chat("Search with expired authentication");
  assert.ok(failedTool.some((event) => event.pi?.type === "tool_end" && event.pi.isError === true));
  const metadata = JSON.parse(await readFile(join(plugin, "package.json"), "utf8"));
  console.log(`Real pi-gpt-search v${metadata.version} passed with mocked search transport.`);
});
