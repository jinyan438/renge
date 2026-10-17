import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

const root=await mkdtemp(join(tmpdir(),"renge-stream-history-"));
let server,browser,upstream,response;
try {
  upstream=createServer(async(request,out)=>{
    for await(const _chunk of request){}
    out.writeHead(200,{"Content-Type":"text/event-stream","Access-Control-Allow-Origin":"*"});
    out.flushHeaders();response=out;
  });
  await new Promise(resolve=>upstream.listen(0,"127.0.0.1",resolve));
  const now=new Date().toISOString();
  const history="HISTORY_TOOL_PERF: original source\n"+"export const value = 'history';\n".repeat(5000);
  const messages=[{id:"seed",role:"user",content:"流式历史性能",createdAt:now}];
  for(let index=0;index<40;index++)messages.push({id:"tool-"+index,role:"assistant",content:"",createdAt:now,
    toolVisualization:{name:"read",toolCallId:"tool-"+index,args:{path:`history-${index}.txt`},status:"done",startedAt:now,endedAt:now,
      result:{content:[{type:"text",text:history}]}}});
  messages.push({id:"answer",role:"assistant",content:"历史任务已完成。",createdAt:now});
  const data={version:1,chatMode:"ai",chatMultiBubbleEnabled:false,chatChoiceToolsEnabled:false,
    providers:[{id:"fixture",name:"Fixture",apiBaseUrl:"http://127.0.0.1/v1",apiKey:"fixture",apiType:"chat-completions",modelId:"fixture-model",models:["fixture-model"],updatedAt:now}],activeProviderId:"fixture",
    llmContextSettings:{skills:false,mcpTools:false,workspaceTools:false},
    chatSessions:[{id:"history",title:"流式历史性能",mode:"ai",workspaceKey:"default",workspaceName:"默认工作区",messages,createdAt:now,updatedAt:now}]};
  const dataDir=join(root,"data");await mkdir(dataDir);await writeFile(join(dataDir,"app-data.json"),JSON.stringify(data));
  server=await startRengeServer({host:"127.0.0.1",port:0,dataDir});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.__historyNormalizationCalls=0;
    const replace=String.prototype.replace;
    String.prototype.replace=function(...args){
      if(String(this).startsWith("HISTORY_TOOL_PERF:"))window.__historyNormalizationCalls++;
      return Reflect.apply(replace,this,args);
    };
  });
  await page.route("**/api/pi/chat",route=>route.continue({url:`http://127.0.0.1:${upstream.address().port}/chat`}));
  await page.goto(server.url);
  await page.getByRole("button",{name:"打开Agent Chat",exact:true}).click();
  await page.getByRole("button",{name:"开始对话",exact:true}).last().click();
  await page.locator(".chat-session-item").filter({hasText:"流式历史性能"}).click();
  const tools=page.locator(".pi-tool-visualization");await tools.first().waitFor({state:"attached"});
  assert.equal(await tools.count(),40);
  assert.equal(await page.locator(".pi-tool-visualization-body").count(),0,"Collapsed historical bodies are lazy");
  assert.equal(await page.evaluate(()=>window.__historyNormalizationCalls),0,"Hidden history is not normalized");
  await tools.first().evaluate(node=>{
    for(let parent=node;parent;parent=parent.parentElement)if(parent.tagName==="DETAILS")parent.open=true;
  });
  await tools.first().locator(".pi-tool-code-preview").waitFor();
  assert.match(await tools.first().locator("pre").textContent(),/HISTORY_TOOL_PERF: original source/);
  await tools.first().locator(".pi-tool-visualization-body").evaluate(node=>{window.__historyBody=node;});
  const input=page.getByPlaceholder("输入消息，可粘贴图片");
  await input.fill("开始流式输出");await page.getByRole("button",{name:"发送",exact:true}).click();
  for(let attempt=0;attempt<500&&!response;attempt++)await delay(20);assert.ok(response);
  const push=text=>response.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:null}]})}\n\n`);
  push("fragment-0 ");
  await page.locator(".chat-message.assistant").filter({hasText:"fragment-0"}).waitFor();
  await page.evaluate(()=>{window.__historyNormalizationCalls=0;});
  for(let index=1;index<=20;index++){push(`fragment-${index} `);await delay(30);}
  await input.fill("流式期间输入的草稿");
  await page.locator(".chat-message.assistant").filter({hasText:"fragment-20"}).waitFor();
  assert.equal(await page.evaluate(()=>window.__historyNormalizationCalls),0,"Streaming does not re-normalize opened or folded historical results");
  assert.equal(await tools.first().locator(".pi-tool-visualization-body").evaluate(node=>node===window.__historyBody),true,"Opened tool DOM and selection are retained");
  response.end("data: [DONE]\n\n");
  await page.getByRole("button",{name:"发送",exact:true}).waitFor();
  const expected=Array.from({length:21},(_v,index)=>`fragment-${index} `).join("").trim();
  assert.equal((await page.locator(".chat-message.assistant").filter({hasText:"fragment-20"}).locator(".mes_text").textContent()).trim(),expected);
  assert.equal(await input.inputValue(),"流式期间输入的草稿");
  assert.deepEqual(errors,[]);
  console.log("PASS: lazy tool history, preserved expansion/DOM, no historical normalization during text streaming, responsive drafts and complete ordered output");
}finally{
  response?.end();await browser?.close();server?.server.closeAllConnections();upstream?.closeAllConnections();
  if(server)await new Promise(resolve=>server.server.close(resolve));if(upstream)await new Promise(resolve=>upstream.close(resolve));await rm(root,{recursive:true,force:true});
}
