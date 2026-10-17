import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const compiled = (await build({entryPoints:[fileURLToPath(new URL('../src/appDataSaveClient.ts',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'browser',define:{'import.meta.url':JSON.stringify('http://app.test/assets/client.js')}})).outputFiles[0].text;
const large = {data:{text:'x'.repeat(600000)},sessionPatch:{upserts:[],deletes:[]}};

function fixture(mode='normal') {
  const requests=[],messages=[];
  class Worker {
    constructor() { if(mode==='constructor-failure')throw new Error('unsupported');queueMicrotask(()=>mode==='boot-failure'?this.onerror({preventDefault(){}}):this.onmessage({data:{ready:true}})); }
    terminate() {}
    postMessage(message) {
      messages.push(message);
      if(message.action==='part'&&mode==='clone-failure')throw new Error('DataCloneError');
      if(message.action!=='commit')return;
      queueMicrotask(()=>{
        if(mode==='crash')this.onerror({preventDefault(){}});
        else if(mode==='network-failure')this.onmessage({data:{id:message.id,error:'offline'}});
        else this.onmessage({data:{id:message.id,result:{ok:mode!=='conflict',status:mode==='conflict'?409:200,payload:mode==='conflict'?{error:'conflict'}:{sessionVersions:{chat:'v2'}}}}});
      });
    }
  }
  const module={exports:{}};
  const window={location:{href:'http://app.test/'},setTimeout,clearTimeout};
  vm.runInNewContext(compiled,{module,exports:module.exports,Worker,URL,Date,performance,setTimeout,clearTimeout,window,fetch:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({sessionVersions:{chat:'fallback'}}));}});
  return {save:module.exports.sendAppDataSave,requests,messages,window};
}

test('small saves stay direct; large saves use ordered bounded parts and commit once',async()=>{
  const f=fixture();assert.equal((await f.save('PATCH',{data:{small:true}})).ok,true);
  assert.equal(f.requests.length,1);assert.equal(f.messages.length,0);
  assert.equal((await f.save('PATCH',large)).payload.sessionVersions.chat,'v2');
  assert.equal(f.requests.length,1);
  assert.equal(f.messages[0].action,'begin');assert.equal(f.messages.at(-1).action,'commit');
  assert.equal(f.messages.filter(m=>m.action==='commit').length,1);
  assert.ok(f.messages.some(m=>m.part?.append));
});

test('worker construction/boot/clone failures retain the JSON fallback without duplicate writes',async()=>{
  for(const mode of ['constructor-failure','boot-failure','clone-failure']){
    const f=fixture(mode);assert.equal((await f.save('PATCH',large)).ok,true);
    assert.equal(f.requests.length,1,mode);assert.deepEqual(JSON.parse(f.requests[0].options.body),large);
    assert.equal(f.messages.filter(m=>m.action==='commit').length,0);
  }
});

test('in-flight worker failures are reported without retrying a possibly committed request',async()=>{
  for(const mode of ['crash','network-failure']){
    const f=fixture(mode);await assert.rejects(f.save('PATCH',large));
    assert.equal(f.requests.length,0);assert.equal(f.messages.filter(m=>m.action==='commit').length,1);
    if(mode==='crash'){await f.save('PATCH',large);assert.equal(f.requests.length,1);}
  }
});

test('conflict responses and session versions pass through the worker unchanged',async()=>{
  const result=await fixture('conflict').save('PATCH',large);
  assert.equal(result.ok,false);assert.equal(result.status,409);assert.equal(result.payload.error,'conflict');
});

test('script-owned host timer wrappers cannot capture or cancel a persistence yield',async()=>{
  const f=fixture();f.window.setTimeout=()=>{throw new Error('script-owned timer');};
  assert.equal((await f.save('PATCH',large)).ok,true);
  assert.equal(f.requests.length,0);
});
