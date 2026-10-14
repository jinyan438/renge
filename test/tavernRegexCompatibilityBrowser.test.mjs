import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startRengeServer } from "../server.mjs";

// Run against a production build with isolated storage and neutral rules.
const root = await mkdtemp(join(tmpdir(), "renge-regex-compat-"));
let server, browser;
try {
  server = await startRengeServer({host:"127.0.0.1",port:0,dataDir:join(root,"data")});
  const now = new Date().toISOString();
  const originalRules = ['a','b','c'].map((kind,index)=>({id:`native-${kind}`,scriptName:`Board ${kind}`,
    findRegex:`<board_${kind}>`,replaceString:`<div data-active-board="${kind}">Board ${kind} UI</div>`,
    placement:[2],disabled:index!==0,markdownOnly:true,promptOnly:false}));
  const marker = '<div data-regex-switch="yes">Switch loading</div>';
  const script = `
    const host=parent;
    function mount(){
    const box=host.document.querySelector('[data-regex-switch]');
    if(!box||box.dataset.mounted)return;box.dataset.mounted='yes';
    const output=host.document.createElement('output'); output.id='regex-result';
    for(const kind of ['a','b','c','none']) {
      const button=host.document.createElement('button'); button.textContent='Select '+kind;
      button.onclick=async()=>{try{
        await updateVariablesWith(vars=>({...vars,game:kind}),{type:'chat'});
        const rows=getTavernRegexes({type:'character'});
        if(rows.length!==3||['a','b','c'].some(k=>rows.filter(r=>r.id==='native-'+k).length!==1)) throw Error('Missing native IDs');
        const updated=await updateTavernRegexesWith(async list=>list.map(r=>({...r,enabled:r.id==='native-'+kind})),{type:'character',scope:'all'});
        if(updated.some(r=>r.enabled!==(r.id==='native-'+kind)||r.enabled===r.disabled)) throw Error('Switch readback mismatch');
        await updateWorldbookWith(getCharWorldbookNames('current').primary,list=>list.map(entry=>({...entry,enabled:entry.name===kind})));
        output.textContent='Selected '+kind;
      }catch(error){output.textContent='Error: '+error.message;}};
      box.append(button);
    }
    box.append(output); host.__regexFixtureReady=true;
    }
    new MutationObserver(mount).observe(host.document.body,{childList:true,subtree:true});mount();
  `;
  const seed = {version:1,chatMode:'roleplay',chatHtmlRenderEnabled:true,activeCharacterCardId:'card',
    chatPresetEnabled:true,activeChatPresetId:'preset',chatPresets:[{id:'preset',name:'Preset',regexScripts:[{...originalRules[0],replaceString:'PRESET'}]}],
    regexScripts:[{...originalRules[0],replaceString:'GLOBAL',disabled:true}],
    tavernScripts:[{id:'fixture',name:'Regex switch fixture',enabled:true,content:script}],
    characterCards:[{id:'card',name:'Regex fixture',firstMessage:marker,
      // Simulate cards imported by versions which rewrote regex IDs.
      regexScripts:originalRules.map((rule,index)=>({...rule,id:`character-regex-old-${index}`})),
      extensions:{regex_scripts:originalRules},
      characterBook:{id:'book',name:'Protocols',entries:['a','b','c'].map(kind=>({uid:kind,comment:kind,content:`Protocol ${kind}`,constant:true,enabled:kind==='a'}))},createdAt:now,updatedAt:now}],
    chatSessions:[{id:'chat',title:'Regex switching',mode:'roleplay',roleplayCharacterCardId:'card',
      messages:[{id:'greeting',role:'assistant',content:marker,createdAt:now}],createdAt:now,updatedAt:now}]};
  assert.equal((await fetch(`${server.url}/api/app-data`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:seed})})).ok,true);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(20_000);
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error:',error.message);});
  const open=async()=>{
    await page.getByRole('button',{name:'打开Agent Chat',exact:true}).click();
    await page.getByRole('button',{name:'开始对话',exact:true}).last().click();
    await page.waitForFunction(()=>window.__regexFixtureReady);
  };
  await page.goto(server.url);await open();
  assert.deepEqual(await page.evaluate(()=>TavernHelper.getTavernRegexes({type:'character'}).map(rule=>rule.id)),['native-a','native-b','native-c']);
  assert.equal(await page.evaluate(()=>TavernHelper.getTavernRegexes({type:'global'}).length),1);
  assert.equal(await page.evaluate(()=>TavernHelper.getTavernRegexes({type:'preset'}).length),1);
  for(const kind of ['b','c','none','a','b']) {
    await page.getByRole('button',{name:'Select '+kind,exact:true}).click();
    await page.locator('#regex-result').getByText('Selected '+kind,{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>TavernHelper.getTavernRegexes({type:'character'}).filter(rule=>rule.enabled).map(rule=>rule.id)),kind==='none'?[]:[`native-${kind}`]);
    assert.deepEqual(await page.evaluate(()=>TavernHelper.getWorldbook('Protocols').filter(entry=>entry.enabled).map(entry=>entry.name)),kind==='none'?[]:[kind]);
  }
  // Neither a matching ID in another scope nor a stale disabled alias may win.
  assert.deepEqual(await page.evaluate(()=>['global','preset'].map(type=>TavernHelper.getTavernRegexes({type})[0].replace_string)),['GLOBAL','PRESET']);
  assert.equal(await page.evaluate(()=>TavernHelper.getTavernRegexes({type:'global'})[0].enabled),false);
  assert.equal(await page.evaluate(()=>TavernHelper.getTavernRegexes({type:'preset'})[0].enabled),true);
  await page.evaluate(async()=>TavernHelper.createChatMessages([{role:'assistant',message:'<board_b>'}]));
  await page.locator('#chat [data-active-board="b"]').waitFor();
  const saved=JSON.parse(await readFile(join(root,'data','app-data.json'),'utf8'));
  assert.deepEqual(saved.characterCards[0].regexScripts.filter(rule=>!rule.disabled).map(rule=>rule.id),['native-b']);
  await page.reload();await open();
  assert.equal(await page.evaluate(()=>TavernHelper.getVariables({type:'chat'}).game),'b');
  assert.deepEqual(await page.evaluate(()=>TavernHelper.getTavernRegexes({type:'character'}).filter(rule=>rule.enabled).map(rule=>rule.id)),['native-b']);
  assert.equal(await page.evaluate(()=>TavernHelper.getTavernRegexes({scope:'character',enable_state:'disabled'}).length),2);

  // Modern type-only writes must honor snake-case fields and native masks.
  await page.evaluate(async()=>TavernHelper.updateTavernRegexesWith(list=>list.map(rule=>({...rule,enabled:false,
    find_regex:'fixture',replace_string:'REPLACED',source:{user_input:true,ai_output:false,slash_command:false,world_info:false,reasoning:true},
    destination:{display:false,prompt:false}})),{type:'preset'}));
  const preset=await page.evaluate(()=>TavernHelper.getTavernRegexes({type:'preset'})[0]);
  assert.equal(preset.enabled,false);assert.equal(preset.disabled,true);
  assert.equal(preset.find_regex,'fixture');assert.equal(preset.replace_string,'REPLACED');
  assert.deepEqual(preset.placement,[1,6]);assert.equal(preset.markdownOnly,false);assert.equal(preset.promptOnly,false);
  await page.evaluate(async()=>TavernHelper.replaceTavernRegexes(TavernHelper.getTavernRegexes({type:'preset'}).map(rule=>({...rule,enabled:true})),{type:'preset'}));
  assert.equal(await page.evaluate(()=>TavernHelper.formatAsTavernRegexedString('fixture','user_input','prompt')),'REPLACED');
  await page.evaluate(async()=>TavernHelper.updateTavernRegexesWith(list=>list.map(rule=>({...rule,source:{user_input:false,ai_output:false,slash_command:false,world_info:false,reasoning:false}})),{type:'preset'}));
  assert.deepEqual(await page.evaluate(()=>TavernHelper.getTavernRegexes({type:'preset'})[0].placement),[]);
  assert.deepEqual(errors,[]);
  console.log('PASS: native regex IDs, old-import recovery, repeated game switching, scoped enabled writes, protocol synchronization, actual rendering, reload and modern field roundtrips');
} finally {
  await browser?.close();server?.server.closeAllConnections();
  if(server)await new Promise(resolve=>server.server.close(resolve));
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
