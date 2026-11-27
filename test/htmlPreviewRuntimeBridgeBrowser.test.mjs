import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Neutral compiled frontends reproduce a card-owned host API, a large script,
// private regexes and an installed library. Never use personal card data here.
const root = await mkdtemp(join(tmpdir(), "renge-preview-runtime-"));
let server, browser;
try {
  await mkdir(".runtime", { recursive: true });
  const now = new Date().toISOString();
  const unused = "UNUSED_LIBRARY_BLOB_" + "x".repeat(256 * 1024);
  const hostScript = `
    parent.FixtureCard = {
      engine: 'fixture-v1',
      view: floor => ({floor, name: getVariables({type:'message',message_id:floor}).name || 'Traveller'}),
      latestFrame: () => null,
      async opening(data) {
        await updateVariablesWith(value => ({...value,name:data.name}), {type:'message',message_id:0});
        setInput('Continue as '+data.name);
        return {saved:data.name};
      },
    };
    parent.__fixtureRuntimeReady = true;
    /* UNUSED_ACTIVE_SCRIPT_BLOB_${"x".repeat(1024 * 1024)} */
  `;
  const module = `
    let owner = window, runtime;
    for(let i=0;i<5;i++) { try { if(owner.FixtureCard) {runtime=owner.FixtureCard;break;} if(owner.parent===owner)break;owner=owner.parent; } catch {break;} }
    if(!runtime) throw Error('Card-owned runtime unavailable');
    const floor = getCurrentMessageId(), current = runtime.view(floor);
    const preset = getPreset('in_use');
    if(getCharData().name !== 'Runtime fixture') throw Error('Current character data not hydrated');
    const entries = await getWorldbook('Fixture World');
    document.getElementById('app').innerHTML = '<form><h2>Opening form</h2><label>Name<input></label><button>Save opening</button><output></output></form><button id="details">Load details</button><output id="raw"></output>';
    document.querySelector('input').value=current.name;
    document.querySelector('form').onsubmit=async event=>{event.preventDefault();const name=document.querySelector('input').value;await runtime.opening({name});document.querySelector('form output').textContent=runtime.view(floor).name;};
    document.getElementById('details').onclick=async()=>{const card=await getCharacter('Library 1');document.getElementById('raw').textContent=String(card.extensions.unused.length);};
    document.body.dataset.ready=String(entries.length)+':'+String(Array.isArray(preset.prompts));
    /* AUTHOR_FRONTEND_${"compiled frontend ".repeat(40_000)} */
  `;
  const html = `<html><body><div id="app"></div><script type="module" src="data:text/javascript;base64,${Buffer.from(module).toString('base64')}"></script></body></html>`;
  const card = { id: "card", name: "Runtime fixture", firstMessage: "Opening prose.\n\n<FixtureOpening/>", createdAt: now, updatedAt: now,
    characterBook: { id: "book", name: "Fixture World", entries: Array.from({length:41}, (_,i)=>({uid:String(i),keys:[`entry-${i}`],content:`Entry ${i}`})) },
    tavernScripts: [{ id: "runtime", name: "Card runtime", enabled: true, content: hostScript }],
    regexScripts: [{ id: "opening", scriptName: "Opening", findRegex: "<FixtureOpening/>", replaceString: `\`\`\`html\n${html}\n\`\`\``, placement: [2], markdownOnly: true },
      ...Array.from({length:4}, (_,i)=>({id:`unused-${i}`,scriptName:`Unused ${i}`,findRegex:"never-matches",replaceString:unused,placement:[2],disabled:true}))],
  };
  const seed = { version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true, chatMultiBubbleEnabled: false,
    activeCharacterCardId: card.id, characterCards: [card, ...Array.from({length:48}, (_,i)=>({
      id:`library-${i}`,name:`Library ${i}`,firstMessage:"Unused opening",extensions:{unused},createdAt:now,updatedAt:now,
    }))], chatSessions: [{ id: "runtime-chat", title: "Runtime bridge", mode: "roleplay", roleplayCharacterCardId: card.id,
      messages: [{id:"greeting",role:"assistant",source:"roleplay-greeting",content:card.firstMessage,createdAt:now}],createdAt:now,updatedAt:now }],
  };
  server = await startRengeServer({host:"127.0.0.1",port:0,dataDir:join(root,"data")});
  assert.ok((await fetch(`${server.url}/api/app-data`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:seed})})).ok);
  const bundles = await Promise.all(["zod","yaml"].map(async name => {
    const result=await build({stdin:{contents:`export * from '${name}';`,resolveDir:process.cwd()},bundle:true,format:"esm",write:false});
    return [name,result.outputFiles[0].text];
  }));
  const libraries = Object.fromEntries(await Promise.all([
    ["jquery", "jquery/dist/jquery.min.js"], ["lodash", "lodash/lodash.min.js"], ["vue", "vue/dist/vue.global.prod.js"],
  ].map(async ([name,path])=>[name,await readFile(join("node_modules",path),"utf8")])));
  Object.assign(libraries,Object.fromEntries(bundles));
  browser = await chromium.launch({headless:true});
  for (const opaque of [false,true]) {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.setDefaultTimeout(25_000);
    const errors=[];
    page.on("pageerror",error=>{errors.push(error.message);console.error("PAGE ERROR",opaque,error.message);});
    page.on("console",message=>{if(message.type()==="error"){errors.push(message.text());console.error("CONSOLE ERROR",opaque,message.text().slice(0,500));}});
    await page.route("**/*",async route=>{
      const url=new URL(route.request().url());
      if(url.hostname==="fixture.renge.test") {
        const response=await route.fetch({url:server.url+url.pathname+url.search});
        return route.fulfill({response});
      }
      const name=Object.keys(libraries).find(name=>url.pathname.includes(`/npm/${name}@`));
      if(name)return route.fulfill({contentType:"text/javascript",headers:{"Access-Control-Allow-Origin":"*"},body:libraries[name]});
      if(!["127.0.0.1","preview.localhost"].includes(url.hostname)&&url.protocol.startsWith("http"))return route.abort();
      return route.continue();
    });
    await page.goto(opaque?"https://fixture.renge.test":server.url);
    await page.getByRole("button",{name:"打开Agent Chat",exact:true}).click();
    await page.waitForFunction(()=>window.__fixtureRuntimeReady);
    const message=page.locator("#chat .mes").first();
    await message.locator(".chat-html-preview-placeholder button").evaluateAll(buttons=>buttons.forEach(button=>button.click()));
    const iframe=message.locator("iframe.chat-html-frame");
    const frame=await(await iframe.elementHandle()).contentFrame();
    await frame.waitForFunction(()=>document.body.dataset.ready==="41:true",null,{polling:100}).catch(async error=>{
      console.error("FRAME STATE",opaque,await frame.evaluate(()=>({text:document.body.innerText.slice(0,500),globals:{api:typeof FixtureCard,preset:typeof getPreset,worldbook:typeof getWorldbook},ready:document.body.dataset.ready})));
      throw error;
    });
    await frame.getByRole("heading",{name:"Opening form",exact:true}).waitFor({state:"visible"});
    assert.equal(await frame.evaluate(()=>{try {void parent.document;return false;} catch {return true;}}),true,
      "the custom API bridge must preserve isolation from the React host document");
    await frame.getByRole("textbox",{name:"Name",exact:true}).fill(opaque?"Casey":"Alex");
    await frame.getByRole("button",{name:"Save opening",exact:true}).click();
    const expected=opaque?"Casey":"Alex";
    await frame.locator("form output").getByText(expected,{exact:true}).waitFor();
    assert.equal(await page.getByPlaceholder("输入消息，可粘贴图片").inputValue(),"Continue as "+expected);
    await frame.waitForFunction(name=>getVariables({type:"message",message_id:0}).name===name,expected,{polling:100}).catch(async error=>{
      console.error('VARIABLE SYNC',opaque,await page.evaluate(()=>({host:getVariables({type:'message',message_id:0}),message:getChatMessages(0)[0].data})),await frame.evaluate(()=>({frame:getVariables({type:'message',message_id:0}),exported:FixtureCard.view(0),source:window.__rengeGetHtmlPreviewContext().messages[0]})));
      throw error;
    });
    const script=await frame.locator("[data-renge-html-preview-variables]").textContent();
    assert.ok(script.length<150_000,`inline snapshot must remain small: ${script.length}`);
    assert.ok(!script.includes("UNUSED_LIBRARY_BLOB_")&&!script.includes("UNUSED_ACTIVE_SCRIPT_BLOB_")&&!script.includes("AUTHOR_FRONTEND_"));
    await frame.getByRole("button",{name:"Load details",exact:true}).click();
    await frame.locator("#raw").getByText(String(unused.length),{exact:true}).waitFor();
    await page.evaluate(async description=>{
      await TavernHelper.updateCharacterWith('current',character=>({...character,description}));
    },"Updated for "+expected);
    await frame.waitForFunction(description=>getCharData().description===description,"Updated for "+expected,{polling:100});
    assert.equal(await page.getByText("界面加载失败",{exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    if(!opaque)await page.screenshot({path:".runtime/html-preview-runtime-bridge.png"});
    await page.close();
  }
  console.log("PASS: compiled large-card forms render and save through script-owned APIs, heavy data loads on demand, inline scripts stay bounded, isolated and opaque frames retain API data without console errors");
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  if(server)await new Promise(resolve=>server.server.close(resolve));
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
