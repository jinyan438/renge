import assert from "node:assert/strict";
import test from "node:test";
import { resizeChatComposerInput } from "../src/chatComposerInputUtils.ts";

test("native composer sizing uses its own window and never forces a geometry read", () => {
  const properties = new Map();
  const input = new Proxy({
    ownerDocument: { defaultView: { CSS: { supports: () => true } } },
    style: { setProperty: (key, value) => properties.set(key, value) },
  }, {
    get(target, key) {
      if (["scrollHeight", "scrollTop", "clientHeight", "offsetHeight", "getBoundingClientRect"].includes(key)) throw new Error("synchronous layout is forbidden on the native sizing path");
      return target[key];
    },
  });
  resizeChatComposerInput(input);
  assert.equal(properties.get("field-sizing"), "content");
  assert.equal(input.style.height, "auto", "fixed CSS heights must not prevent multiline input from growing");
});
