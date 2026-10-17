import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

const root=await mkdtemp(join(tmpdir(),"renge-save-responsive-"));
let server,browser,release;
try {
  const now=new Date().toISOString(), text="synthetic history ".repeat(65536);
  const html='```html\n<h2>保存时仍可操作</h2><button onclick="this.textContent=\'交互正常\'">测试交互</button>\n```';
  const card={id:"card",name:"响应测试",firstMessage:html,createdAt:now,updatedAt:now};
  const session=(id,content,cardId)=>({id,title:id,mode:"roleplay",roleplayCharacterCardId:cardId,
    messages:[{id:"msg-"+id,role:"assistant",content,createdAt:now}],createdAt:now,updatedAt:now});
  const data={version:1,chatMode:"roleplay",chatHtmlRenderEnabled:true,chatMultiBubbleEnabled:false,
    activeCharacterCardId:card.id,characterCards:[card],
    tavernScripts:[{id:"api",name:"API fixture",content:"parent.__saveFixtureReady=true;",enabled:true,autoRun:true,runOn:"startup"}],
    chatSessions:[session("active",html,card.id),...Array.from({length:40},(_v,i)=>session("history-"+i,text,"other"))]};
  const dataDir=join(root,"data");await mkdir(dataDir);
  await writeFile(join(dataDir,"app-data.json"),JSON.stringify(data));
  server=await startRengeServer({host:"127.0.0.1",port:0,dataDir});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(20000);
  const errors=[],workers=[];
  page.on("pageerror",error=>errors.push(error.message));page.on("worker",worker=>workers.push(worker.url()));
  await page.addInitScript(()=>{
    window.__largeMainSerializations=0;
    const stringify=JSON.stringify;
    JSON.stringify=function(...args){const result=Reflect.apply(stringify,JSON,args);if(result?.length>8*1024*1024)window.__largeMainSerializations++;return result;};
  });
  let signalHeld;
  const held=new Promise(resolve=>{signalHeld=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  let requestBytes=0,first=true;
  await page.route("**/api/app-data",async route=>{
    const request=route.request();
    if(first&&request.method()==="PATCH"&&(request.postDataBuffer()?.length??0)>8*1024*1024){
      first=false;requestBytes=request.postDataBuffer().length;signalHeld();await gate;
    }
    await route.continue();
  });
  await page.goto(server.url);
  await page.getByRole("button",{name:"打开Agent Chat",exact:true}).click();
  await page.getByRole("button",{name:"开始对话",exact:true}).last().click();
  await page.frameLocator("iframe.chat-html-frame").getByRole("heading",{name:"保存时仍可操作",exact:true}).waitFor();
  let timeout;
  await Promise.race([held,new Promise((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error("Large background save did not start")),20000);})]);clearTimeout(timeout);
  await page.frameLocator("iframe.chat-html-frame").getByRole("button",{name:"测试交互",exact:true}).click();
  await page.frameLocator("iframe.chat-html-frame").getByRole("button",{name:"交互正常",exact:true}).waitFor();
  await page.getByPlaceholder("输入消息，可粘贴图片").fill("保存期间输入仍可响应");
  assert.ok(workers.some(url=>url.includes("appDataSave.worker-")),"Large saves use the packaged worker");
  assert.equal(await page.evaluate(()=>window.__largeMainSerializations),0,"Large JSON never runs on the UI thread");
  const completed=page.waitForResponse(response=>response.url().endsWith("/api/app-data")&&response.request().method()==="PATCH"&&response.request().postDataBuffer()?.length===requestBytes);
  release();assert.equal((await completed).status(),200);
  const saved=JSON.parse(await readFile(join(dataDir,"app-data.json"),"utf8"));
  assert.equal(saved.chatSessions.length,41);
  assert.equal(saved.chatSessions.find(s=>s.id==="history-39").messages[0].content,text);
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${Math.round(requestBytes/1024/1024)} MB save stays interactive, uses bounded worker transfer, retains complete history and waits for server confirmation`);
}finally{
  release?.();await browser?.close();server?.server.closeAllConnections();
  if(server)await new Promise(resolve=>server.server.close(resolve));await rm(root,{recursive:true,force:true});
}
