import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Deterministic remote graph: preloading can fetch it early but must never run
// schema code before the preceding startup script or bypass CHAT_CHANGED.
const root = await mkdtemp(join(tmpdir(), "renge-tavern-startup-"));
const originalFetch = globalThis.fetch;
const requests = [], stages = [];
const base = "https://cdn.jsdelivr.net/gh/renge-fixture/startup@1.0.0/";
const sources = {
  "first.js": "export const value = 'first';",
  "schema.js": "import {value} from './nested.js'; if(parent.__startupOrder?.join()!=='first') throw new Error('Preload executed a module'); parent.__startupOrder.push(value); export const label='ready';",
  "nested.js": "export const value = 'schema';",
};
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith(base)) return originalFetch(url, options);
  const file = String(url).slice(base.length);
  requests.push(file);
  stages.push({ file, time:performance.now() });
  await new Promise(resolve => setTimeout(resolve, file === "first.js" ? 600 : 150));
  assert.ok(sources[file], `Unexpected module ${file}`);
  return new Response(sources[file], { headers:{ "content-type":"text/javascript", "cache-control":"max-age=3600", etag:'"fixture-1"' } });
};
let server, browser;
try {
  const dataDir = join(root, "data");
  server = await startRengeServer({ host:"127.0.0.1", port:0, dataDir });
  const now = new Date().toISOString();
  const html = "```html\n<h2>同步完成</h2><script>if(getVariables({type:'chat'}).label!=='ready')throw new Error('HTML mounted before lifecycle settled');</script>\n```";
  const card = { id:"startup-card", name:"同步速度测试", firstMessage:html, createdAt:now, updatedAt:now };
  const scripts = [
    { id:"first", name:"先运行", content:`import {value} from '${base}first.js'; parent.__startupOrder=[value]; await new Promise(r=>setTimeout(r,300)); parent.__firstStartupFinished=performance.now();` },
    { id:"schema", name:"后运行", content:`import {label} from '${base}schema.js'; eventOn(tavern_events.CHAT_CHANGED,async()=>{await new Promise(r=>setTimeout(r,150)); await replaceVariables({label},{type:'chat'}); parent.__lifecycleFinished=true;});` },
  ].map(script => ({...script, enabled:true, autoRun:true, runOn:"startup"}));
  const data = { version:1, chatMode:"roleplay", chatHtmlRenderEnabled:true, chatMultiBubbleEnabled:false,
    activeCharacterCardId:card.id, characterCards:[card], tavernScripts:scripts,
    chatSessions:[{ id:"startup-chat", mode:"roleplay", roleplayCharacterCardId:card.id,
      messages:[{id:"greeting", role:"assistant", content:html, createdAt:now}], createdAt:now, updatedAt:now }] };
  assert.ok((await fetch(server.url+"/api/app-data", { method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({data}) })).ok);
  browser = await chromium.launch({headless:true});
  const run = async () => {
    // A new browser context also proves restart reuse is on disk, not HTTP cache.
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    const page = await context.newPage(), errors=[];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.url);
    await page.getByRole("button",{name:"打开Agent Chat",exact:true}).click();
    await page.getByRole("button",{name:"开始对话",exact:true}).last().click();
    await page.frameLocator("iframe.chat-html-frame").getByRole("heading",{name:"同步完成",exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.__startupOrder), ["first","schema"]);
    assert.equal(await page.evaluate(()=>window.__lifecycleFinished), true);
    assert.deepEqual(errors, []);
    await context.close();
  };
  await run();
  assert.equal(requests.length, 3, "Preload and execution share every module request");
  assert.ok(stages.find(s=>s.file==="schema.js").time < stages.find(s=>s.file==="first.js").time + 550, "Later imports download while the first script is pending");
  assert.ok(stages.find(s=>s.file==="nested.js").time < stages.find(s=>s.file==="first.js").time + 600, "Nested graph is warmed before the first startup finishes downloading");
  server.server.closeAllConnections();
  await new Promise(resolve=>server.server.close(resolve));
  server = await startRengeServer({host:"127.0.0.1",port:0,dataDir});
  await run();
  assert.equal(requests.length, 3, "App restart and a different local port reuse fresh module bytes");
  console.log("PASS: concurrent graph downloads, ordered evaluation, lifecycle barrier, deduplication and cache reuse after restart");
} finally {
  globalThis.fetch = originalFetch;
  await browser?.close();
  server?.server.closeAllConnections();
  if(server) await new Promise(resolve=>server.server.close(resolve));
  await rm(root,{recursive:true,force:true});
}
