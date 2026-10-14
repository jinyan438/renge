import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// A neutral regex-only card reproduces ORB blocking octet-stream images in an
// isolated preview and marker leakage without an enabled Tavern script.
const root = await mkdtemp(join(tmpdir(), "renge-preview-images-"));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1kAAAAASUVORK5CYII=", "base64");
const source = "https://example.com/renge-fixtures/avatar";
const originalFetch = globalThis.fetch;
let upstreamRequests = 0;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith("https://example.com/renge-fixtures/")) {
    upstreamRequests++;
    if(String(url).endsWith('/vector'))return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="pink"/></svg>',{headers:{'content-type':'application/octet-stream'}});
    return new Response(png,{headers:{"content-type":"application/octet-stream","x-content-type-options":"nosniff"}});
  }
  return originalFetch(url, options);
};
const document = `<!doctype html><html><head><style id="fixture-styles">
body{margin:0}.portrait,.styled{width:80px;height:100px;background-size:cover}
.styled{background-image:url('${source}')}
@font-face{font-family:fixture;src:url('https://example.com/renge-fixtures/font.woff2')}
</style></head><body><h2>通用角色状态面板</h2><div id="characters"></div>
<div class="styled"></div><img id="static-image" src="${source}" srcset="${source} 1x, ${source} 2x">
<picture><source srcset="${source} 1x, ${source} 2x"><img src="${source}"></picture>
<img id="vector" src="${source}/vector"><img id="inline-image" src="data:image/png;base64,${png.toString('base64')}">
<audio><source src="https://example.com/renge-fixtures/audio.ogg"></audio>
<script>
document.getElementById('characters').innerHTML='<div class="portrait" style="background-image:url(\\'${source}\\')"></div><img id="dynamic-image" src="${source}">';
setTimeout(()=>{document.querySelector('.portrait').style.backgroundImage='url("${source}?updated=1")';},50);
</script></body></html>`;
let server, browser, page;
try {
  // Use a real resolvable public hostname for the proxy's DNS validation.
  server = await startRengeServer({host:"127.0.0.1",port:0,dataDir:join(root,"data")});
  const now = new Date().toISOString();
  const content = "正文保留。\n<StatusPanel>角色状态</StatusPanel>\n<StatusPlaceHolderImpl/>\n<OtherStatusImpl/>\n`<StatusPlaceHolderImpl/>`\n\n```text\n<StatusPlaceHolderImpl/>\n```";
  const card = {id:"image-card",name:"通用状态卡",firstMessage:content,createdAt:now,updatedAt:now,
    extensions:{regex_scripts:[{id:"panel",scriptName:"状态面板",findRegex:"/<StatusPanel>([\\s\\S]*?)<\\/StatusPanel>/s",
      replaceString:"```html\n"+document+"\n```",placement:[2],markdownOnly:true,disabled:false}]}};
  await fetch(server.url+"/api/app-data",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:{
    version:1,chatMode:"roleplay",chatHtmlRenderEnabled:true,chatMultiBubbleEnabled:false,activeCharacterCardId:card.id,characterCards:[card],
    chatSessions:[{id:"image-chat",title:"图片兼容测试",mode:"roleplay",roleplayCharacterCardId:card.id,
      messages:[{id:"greeting",role:"assistant",content,createdAt:now}],createdAt:now,updatedAt:now}]}})});
  browser=await chromium.launch({headless:true});
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(20000);
  page.on('pageerror',error=>console.log('Preview error:',error.message));
  await page.route("https://example.com/renge-fixtures/**",r=>r.fulfill({body:png,contentType:"application/octet-stream",headers:{"X-Content-Type-Options":"nosniff"}}));
  await page.goto(server.url);
  const open = async () => {
    await page.getByRole("button",{name:"打开Agent Chat",exact:true}).click();
    await page.getByRole("button",{name:"开始对话",exact:true}).last().click();
  };
  await open();
  const message=page.locator('#chat .mes[mesid="0"]');
  const check = async () => {
    const frame=await (await message.locator("iframe.chat-html-frame").elementHandle()).contentFrame();
    await frame.getByRole("heading",{name:"通用角色状态面板"}).waitFor();
    await frame.waitForFunction(async()=>{
      try { await Promise.all([...document.querySelectorAll('img')].map(img=>img.decode())); return true; }
      catch { return false; }
    });
    assert.ok(await frame.locator('#static-image').getAttribute('srcset').then(value=>value.includes('/html-preview-image?url=')));
    assert.equal(await frame.locator('audio source').getAttribute('src'),'https://example.com/renge-fixtures/audio.ogg');
    assert.match(await frame.locator('#inline-image').getAttribute('src'),/^data:image/);
    assert.match(await frame.locator('#fixture-styles').textContent(),/src:url\('https:\/\/example.com\/renge-fixtures\/font.woff2'\)/);
    const urls=await frame.locator('.portrait,.styled').evaluateAll(elements=>elements.map(e=>getComputedStyle(e).backgroundImage.match(/url\("(.*?)"\)/)?.[1]));
    assert.equal(urls.length,2);
    for(const url of urls){
      assert.ok(url.includes('/html-preview-image?url='));
      assert.equal(await frame.evaluate(url=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth);image.onerror=()=>resolve(0);image.src=url;}),url),1);
    }
    assert.equal(await message.locator('[data-tavern-placeholder]').count(),2,"regex-only cards retain inert placeholder slots");
    assert.equal(await message.locator('code').first().textContent(),'<StatusPlaceHolderImpl/>');
    assert.equal((await message.locator('pre code').textContent()).trim(),'<StatusPlaceHolderImpl/>');
    assert.equal(await page.evaluate(()=>TavernHelper.getChatMessages(0)[0].message),content);
    return frame;
  };
  await message.locator("iframe.chat-html-frame").waitFor();
  let frame=await check();
  await frame.waitForFunction(()=>document.querySelector('.portrait').style.backgroundImage.includes('updated'));
  assert.equal(upstreamRequests,3,"repeated avatar and portrait URLs share cached image bytes");
  assert.equal(await frame.evaluate(async source=>{
    const response=await fetch(location.origin+'/html-preview-image?url='+encodeURIComponent(source));
    return response.headers.get('content-type');
  },source),'image/png',"the isolated origin serves only normalized image bytes");
  assert.equal(await frame.evaluate(async()=> (await fetch(location.origin+'/api/app-data')).status),404,"preview storage isolation remains enforced");
  await page.setViewportSize({width:390,height:844});
  await check();
  await page.reload();await open();
  await message.locator('iframe.chat-html-frame').waitFor();
  await check();
  assert.equal(upstreamRequests,3,"reload reuses the image cache");
  await page.getByLabel('渲染 HTML',{exact:true}).evaluate(input=>input.click());
  assert.equal(await message.locator('[data-tavern-placeholder]').count(),0);
  assert.match(await message.locator('.mes_text').textContent(),/<OtherStatusImpl\/>/);
  console.log('PASS: regex-only cards, extensionless octet-stream images, dynamic portraits, stylesheet backgrounds, cache, placeholders, literal code, raw message preservation, mobile and reload');
} catch(error) {
  for(const f of page?.frames().filter(frame=>frame.url().includes('preview.localhost')) ?? []) {
    console.log(await f.evaluate(()=>({url:location.href,images:[...document.querySelectorAll('img')].map(i=>({src:i.src,srcset:i.srcset,current:i.currentSrc,complete:i.complete,width:i.naturalWidth})),sources:[...document.querySelectorAll('source')].map(i=>({src:i.src,srcset:i.srcset})),imageRuntime:!!document.querySelector('[data-renge-html-preview-images]')})).catch(()=>null));
  }
  console.log({upstreamRequests});
  await page?.screenshot({path:'.runtime/html-images-failure.png'});
  throw error;
} finally {
  globalThis.fetch=originalFetch;
  await browser?.close();
  server?.server.closeAllConnections();
  if(server)await new Promise(resolve=>server.server.close(resolve));
  await rm(root,{recursive:true,force:true});
}
