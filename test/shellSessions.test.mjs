import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Type } from "typebox";
import { createPermissionCheckedPiTools } from "../pi/permission-tools.mjs";
import { createShellSessionManager } from "../pi/shell-sessions.mjs";

const shellName = process.platform === "win32" ? "powershell" : "bash";
const quote = (value) => `'${value.replaceAll("'", process.platform === "win32" ? "''" : "'\\''")}'`;
const command = (path) => `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} ${quote(path)}`;
const text = (result) => result.content.map((block) => block.text).join("\n");

async function fixture(t, onBackgroundUpdate) {
  const cwd = await mkdtemp(join(tmpdir(), "renge-shell-sessions-"));
  const manager = createShellSessionManager({ onBackgroundUpdate });
  const approvals = [];
  const tools = createPermissionCheckedPiTools({ cwd, nativeTools: [shellName], shellSessions: manager, authorizeTool: async (request) => approvals.push(request) });
  t.after(async () => { await manager.dispose(); await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const execute = (name, args, signal, onUpdate) => tools.find((tool) => tool.name === name).execute(name, args, signal, onUpdate);
  return { cwd, manager, approvals, execute };
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 10_000;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, "condition completed within ten seconds");
    await delay(30);
  }
}

test("long native commands yield, stream output, resume once and preserve stdout/stderr", { timeout: 20_000 }, async (t) => {
  const updates = [];
  const f = await fixture(t, (event) => updates.push(event));
  const script = join(f.cwd, "command.mjs");
  await writeFile(script, `import { appendFileSync, existsSync } from 'node:fs';
appendFileSync('starts.txt', 'started\\n');
console.log('第一段输出');
const timer = setInterval(() => {
  if (!existsSync('release')) return;
  clearInterval(timer);
  console.error('stderr retained');
  console.log('final output');
}, 30);`);
  const first = await f.execute(shellName, { command: command(script), timeout: 15, yield_time_ms: 0 });
  assert.equal(first.details.shellSession.status, "running");
  const id = first.details.shellSession.id;
  await waitUntil(() => updates.some((event) => text(event.result).includes("第一段输出")));
  const running = await f.execute("shell_status", { session_id: id, yield_time_ms: 0 });
  assert.equal(running.details.shellSession.status, "running");
  assert.match(text(running), /第一段输出/);
  assert.match(text(running), /has NOT timed out/);
  await writeFile(join(f.cwd, "release"), "go");
  const final = await f.execute("shell_status", { session_id: id });
  assert.equal(final.details.shellSession.status, "completed");
  assert.match(text(final), /第一段输出/);
  assert.match(text(final), /stderr retained/);
  assert.match(text(final), /final output/);
  assert.equal(await readFile(join(f.cwd, "starts.txt"), "utf8"), "started\n");
  assert.equal(f.approvals.length, 1, "polling never reruns or reauthorizes a command");
  assert.equal(updates.at(-1).finished, true);
  assert.equal(updates.at(-1).result.details.shellSession.status, "completed");
  const repeated = await f.execute("shell_status", { session_id: id, yield_time_ms: 0 });
  assert.deepEqual(repeated, final, "completed results remain readable");
});

test("yielding and polling leave the original command timeout in force", { timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  const script = join(f.cwd, "timeout.mjs");
  await writeFile(script, "console.log('before timeout'); setInterval(() => {}, 1000);");
  const started = Date.now();
  const first = await f.execute(shellName, { command: command(script), timeout: 2, yield_time_ms: 0 });
  const args = { session_id: first.details.shellSession.id, yield_time_ms: 0 };
  for (let index = 0; index < 3; index++) {
    assert.equal((await f.execute("shell_status", args)).details.shellSession.status, "running");
    await delay(50);
  }
  await assert.rejects(f.execute("shell_status", { ...args, yield_time_ms: 10_000 }), /before timeout[\s\S]*Command timed out after 2 seconds/);
  assert.ok(Date.now() - started >= 1900, "yielding did not kill the process early");
  assert.ok(Date.now() - started < 10_000, "polling did not reset the timeout");
});

test("a nonzero exit between polls retains diagnostics and stays an error", { timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  const script = join(f.cwd, "failure.mjs");
  await writeFile(script, "console.error('diagnostic before exit'); process.exit(7);");
  const first = await f.execute(shellName, { command: command(script), yield_time_ms: 0 });
  await assert.rejects(f.execute("shell_status", { session_id: first.details.shellSession.id }), /diagnostic before exit[\s\S]*Command exited with code/);
  await assert.rejects(f.execute("shell_status", { session_id: first.details.shellSession.id, yield_time_ms: 0 }), /diagnostic before exit/);
});

test("stop cancels the command's process tree without stopping other sessions", { timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  const descendant = join(f.cwd, "descendant.mjs");
  const parent = join(f.cwd, "parent.mjs");
  await writeFile(descendant, "setInterval(() => {}, 1000);");
  await writeFile(parent, `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, [${JSON.stringify(descendant)}], { stdio: 'inherit', windowsHide: true });
writeFileSync('pids.json', JSON.stringify([process.pid, child.pid]));
setInterval(() => {}, 1000);`);
  const first = await f.execute(shellName, { command: command(parent), yield_time_ms: 0 });
  await waitUntil(async () => { try { return JSON.parse(await readFile(join(f.cwd, "pids.json"), "utf8")).length === 2; } catch { return false; } });
  const pids = JSON.parse(await readFile(join(f.cwd, "pids.json"), "utf8"));
  const other = await f.execute(shellName, { command: command(descendant), yield_time_ms: 0 });
  const stopped = await f.execute("shell_stop", { session_id: first.details.shellSession.id });
  assert.equal(stopped.details.shellSession.status, "stopped");
  await waitUntil(() => pids.every((pid) => { try { process.kill(pid, 0); return false; } catch { return true; } }));
  assert.equal((await f.execute("shell_status", { session_id: other.details.shellSession.id, yield_time_ms: 0 })).details.shellSession.status, "running");
  await f.execute("shell_stop", { session_id: other.details.shellSession.id });
});

test("run cancellation and disposal abort yielded commands and reject cross-run ids", { timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  const script = join(f.cwd, "alive.mjs");
  await writeFile(script, "import { appendFileSync } from 'node:fs'; appendFileSync('starts.txt', 'started\\n'); setInterval(() => {}, 1000);");
  const waitForStarts = (count) => waitUntil(async () => {
    try { return (await readFile(join(f.cwd, "starts.txt"), "utf8")).trim().split("\n").length === count; }
    catch { return false; }
  });
  const controller = new AbortController();
  const first = await f.execute(shellName, { command: command(script), yield_time_ms: 0 }, controller.signal);
  // Exercise cancellation of running children, independently of shell startup timing.
  await waitForStarts(1);
  controller.abort();
  const stopped = await f.execute("shell_status", { session_id: first.details.shellSession.id });
  assert.equal(stopped.details.shellSession.status, "stopped");
  const second = await f.execute(shellName, { command: command(script), yield_time_ms: 0 });
  await waitForStarts(2);
  const other = createShellSessionManager();
  t.after(() => other.dispose());
  await assert.rejects(other.tools[0].execute("status", { session_id: second.details.shellSession.id }), /Unknown shell session/);
  const pending = f.execute("shell_status", { session_id: second.details.shellSession.id });
  f.manager.dispose();
  assert.equal((await pending).details.shellSession.status, "stopped");
  await assert.rejects(f.execute("shell_status", { session_id: second.details.shellSession.id }), /Unknown shell session/);
});

test("invalid yields and denied/cancelled approval never start a shell process", async () => {
  let starts = 0;
  const manager = createShellSessionManager();
  const native = { name: "bash", description: "fixture", parameters: Type.Object({ command: Type.String() }), execute: async () => { starts++; return { content: [] }; } };
  const denied = manager.wrap(native, async () => { throw new Error("denied"); });
  await assert.rejects(denied.execute("test", { command: "never", yield_time_ms: -1 }), /yield_time_ms/);
  await assert.rejects(denied.execute("test", { command: "never" }), /denied/);
  const controller = new AbortController();
  const cancelled = manager.wrap(native, async () => controller.abort());
  await assert.rejects(cancelled.execute("test", { command: "never" }, controller.signal), /aborted/);
  assert.equal(starts, 0);
  manager.dispose();
});
