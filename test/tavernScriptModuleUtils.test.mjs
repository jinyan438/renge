import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  getTavernStaticModuleImports,
  requiresTavernChatDom,
  scopeTavernClassicScript,
  usesTavernModuleSyntax,
} from "../src/tavernScriptModuleUtils.ts";

test("preloads static imports and re-exports without evaluating lazy imports or serialized helpers", () => {
  const urls = getTavernStaticModuleImports(`
    import'https://cdn.jsdelivr.net/gh/example/core@1.0.0/a.js';
    import { x as y } /* comment */ from "https://cdn.jsdelivr.net/gh/example/schema/b.js";
    export { x } from './helper.js';
    export * from './other.js';
    import'https://cdn.jsdelivr.net/gh/example/core@1.0.0/a.js';
    const lazy = () => import('https://cdn.jsdelivr.net/optional.js');
    const example = "import'https://cdn.jsdelivr.net/serialized.js'";
    // import 'https://cdn.jsdelivr.net/comment.js';
    obj.import('not-a-module');
  `);
  assert.deepEqual(urls, [
    'https://cdn.jsdelivr.net/gh/example/core@1.0.0/a.js',
    'https://cdn.jsdelivr.net/gh/example/schema/b.js', './helper.js', './other.js',
  ]);
});

test("chat DOM dependencies exclude serialized helpers, comments and ordinary data", () => {
  assert.equal(requiresTavernChatDom("observer.observe(parent.document.getElementById('chat'), {childList:true})"), true);
  assert.equal(requiresTavernChatDom('host.document.querySelector ( /* host */ "#chat .mes").append(node)'), true);
  assert.equal(requiresTavernChatDom('observer.observe(document.querySelector("#chat"))'), true);
  for (const source of [
    `script.textContent = ${JSON.stringify("function later(){document.querySelector('#chat .mes')} ")}; parent.ready = true;`,
    "const text = `document.getElementById('chat')`; parent.ready = true;",
    "/* document.getElementById('chat') */ parent.ready = true;",
    "// document.querySelector('#chat')\nparent.ready = true;",
    "document.querySelector('#chat-settings')",
    "document.getElementById('chat-settings')",
    "const paint=()=>{const box=document.querySelector('#chat .mes'); if(!box)return;}; parent.ready=true;",
    "document.getElementById('chat')?.append(node)",
  ]) assert.equal(requiresTavernChatDom(source), false, source);
});

test("detects compact side-effect imports used by bundled character cards", () => {
  assert.equal(
    usesTavernModuleSyntax("import'https://cdn.example.test/framework.js';"),
    true,
  );
});

test("detects compact named imports and exports", () => {
  assert.equal(
    usesTavernModuleSyntax(
      "import{registerSchema as r}from'https://cdn.example.test/schema.js';r({});",
    ),
    true,
  );
  assert.equal(usesTavernModuleSyntax("const ready=true;export{ready};"), true);
});

test("keeps classic scripts with dynamic imports or nested await unchanged", () => {
  assert.equal(usesTavernModuleSyntax("const load=url=>import(url);"), false);
  assert.equal(
    usesTavernModuleSyntax("async function load(){return await Promise.resolve(true)}"),
    false,
  );
});

test("ignores module keywords in strings and comments", () => {
  assert.equal(
    usesTavernModuleSyntax(
      "const example=\"import'x'\";/* export{example} */ console.log(example);",
    ),
    false,
  );
});

test("isolates bundled classic names from compatibility globals", () => {
  const context = vm.createContext({
    _: { get: (value, key) => value[key] },
    result: null,
  });
  context.window = context;
  new vm.Script(scopeTavernClassicScript("const _={id:'card-ui'};")).runInContext(
    context,
  );
  new vm.Script("result=_.get({ready:true},'ready');").runInContext(context);

  assert.equal(context.result, true);
});
