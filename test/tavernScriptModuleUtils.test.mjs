import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  scopeTavernClassicScript,
  usesTavernModuleSyntax,
} from "../src/tavernScriptModuleUtils.ts";

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
