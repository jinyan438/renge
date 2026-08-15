import assert from "node:assert/strict";
import test from "node:test";

import { HTML_PREVIEW_STSCRIPT_COMPAT_SOURCE } from "../src/htmlPreviewStscript.ts";

function createBridge() {
  const state = { input: "", variables: {} };
  const calls = [];
  const window = {};
  const getInput = () => state.input;
  const setInput = async (value) => {
    state.input = String(value ?? "");
    calls.push(["setInput", state.input]);
    return state.input;
  };
  const sendMessage = async (value) => {
    calls.push(["sendMessage", String(value ?? "")]);
    return true;
  };
  const triggerSlash = async (command) => {
    calls.push(["triggerSlash", command]);
    return "slash-result";
  };
  const getAllVariables = () => ({ ...state.variables });
  const insertOrAssignVariables = async (values) => {
    Object.assign(state.variables, values);
    calls.push(["setVariables", { ...values }]);
    return { ...state.variables };
  };

  const stScript = Function(
    "window",
    "getInput",
    "setInput",
    "sendMessage",
    "triggerSlash",
    "getAllVariables",
    "insertOrAssignVariables",
    `${HTML_PREVIEW_STSCRIPT_COMPAT_SOURCE}; return window.STscript;`,
  )(window, getInput, setInput, sendMessage, triggerSlash, getAllVariables, insertOrAssignVariables);

  return { calls, state, stScript };
}

test("bridges character-card send and trigger STscript commands", async () => {
  const bridge = createBridge();

  await bridge.stScript("/send 1. 轻轻捏捏她的狐耳 | /trigger");

  assert.deepEqual(bridge.calls, [
    ["setInput", "1. 轻轻捏捏她的狐耳"],
    ["sendMessage", "1. 轻轻捏捏她的狐耳"],
  ]);
});

test("bridges getvar and setvar while preserving other slash commands", async () => {
  const bridge = createBridge();

  await bridge.stScript("/setvar key=xuejian_theme dark");
  assert.equal(await bridge.stScript("/getvar xuejian_theme"), "dark");
  assert.equal(await bridge.stScript("/echo title=提示 hello"), "slash-result");
  assert.deepEqual(bridge.calls.at(-1), ["triggerSlash", "/echo title=提示 hello"]);
});
