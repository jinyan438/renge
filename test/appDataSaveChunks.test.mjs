import assert from "node:assert/strict";
import test from "node:test";
import { splitAppDataSave, applyAppDataSavePart } from "../src/appDataSaveChunks.ts";

test("bounded save parts retain complete sessions, sparse arrays, Unicode and own __proto__ data", () => {
  const text = '完整内容🙂'.repeat(100000);
  const messages = new Array(4); messages[0] = { text, missing:undefined };
  const data = { data:JSON.parse('{"__proto__":{"preserved":true}}'), sessionPatch:{upserts:[{session:{id:'chat',messages},expectedVersion:'v1'}],deletes:[{id:'removed',expectedVersion:'v2'}]} };
  const parts = [...splitAppDataSave(data)];
  let restored;
  for(const part of parts) {
    if(typeof part.value === 'string') assert.ok(part.value.length <= 256*1024);
    restored = applyAppDataSavePart(restored, structuredClone(part));
  }
  assert.equal(JSON.stringify(restored), JSON.stringify(data));
  assert.equal(Object.getPrototypeOf(restored.data), Object.prototype);
  assert.equal(Object.prototype.preserved, undefined);
  assert.equal(restored.sessionPatch.upserts[0].session.messages.length, 4);
});

test("shared values and Date retain JSON behavior; cycles and custom root toJSON use the fallback", () => {
  const shared = {text:'x'.repeat(300000)};
  const input = {a:shared,b:shared,date:new Date('2026-10-17T00:00:00Z')};
  let restored;
  for(const part of splitAppDataSave(input))restored=applyAppDataSavePart(restored,structuredClone(part));
  assert.equal(JSON.stringify(restored),JSON.stringify(input));
  const cyclic = {text:'x'.repeat(300000)};cyclic.self=cyclic;
  assert.throws(()=>[...splitAppDataSave(cyclic)], /循环/);
  assert.throws(()=>[...splitAppDataSave({toJSON(){return 'custom';}})], /兼容/);
});
