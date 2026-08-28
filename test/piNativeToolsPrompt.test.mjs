import assert from "node:assert/strict";
import test from "node:test";
import { buildPiNativeToolsSystemPromptText } from "../src/piNativeToolsPrompt.ts";

test("routes one-shot and interactive commands on Windows without falling back to WSL", () => {
  const prompt = buildPiNativeToolsSystemPromptText("demo", "windows");
  assert.match(prompt, /一次性、非交互.*Pi 原生 powershell/);
  assert.match(prompt, /长期进程持续运行并增量读取日志/);
  assert.match(prompt, /跨命令保留工作目录\/环境变量\/Shell 函数\/登录或 REPL 状态/);
  assert.match(prompt, /不要调用 bash 或 WSL/);
  assert.match(prompt, /不要为了选择工具而预先调用 terminal_list/);
});

test("uses the native bash tool on non-Windows platforms", () => {
  const prompt = buildPiNativeToolsSystemPromptText("demo", "unix");
  assert.match(prompt, /一次性、非交互.*Pi 原生 bash/);
  assert.match(prompt, /Pi 原生命令工具是 bash/);
  assert.doesNotMatch(prompt, /Pi 原生 powershell/);
  assert.doesNotMatch(prompt, /当前是 Windows 环境/);
});
