import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/jsonSerialization.ts", import.meta.url), "utf8");
const script = ts.transpileModule(source.replace("import.meta.url", '"http://fixture.test/assets/app.js"'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(overrides = {}) {
  const context = vm.createContext({ exports: {}, URL, DOMException, ...overrides });
  vm.runInContext(script, context);
  return context.exports.sendJsonOffThread;
}

test("checkpoint serialization and HTTP sending stay in the worker and return only a small acknowledgement", async () => {
  let worker;
  class Worker {
    constructor() { worker = this; }
    postMessage(request) { this.request = request; }
    terminate() { this.terminated = true; }
  }
  const forbidden = () => { throw new Error("large JSON must not return to the UI thread"); };
  const send = fixture({ Worker, fetch: forbidden, JSON: { stringify: forbidden } });
  const value = { data: { image: "x".repeat(2_800_000) } };
  const pending = send("/api/app-data", "PATCH", value);
  assert.equal(worker.request.value, value);
  assert.equal(worker.request.url, "/api/app-data");
  assert.equal(worker.request.method, "PATCH");
  const response = { ok: true, status: 200, payload: { sessionVersions: { a: "version" } } };
  worker.onmessage({ data: { id: worker.request.id, response } });
  assert.equal(await pending, response);
  assert.equal(worker.terminated, undefined, "subsequent checkpoints reuse the existing worker");
});

test("an unacknowledged checkpoint is never replayed after a worker network failure", async () => {
  for (const failure of ["error", "message"]) {
    let worker, fetches = 0;
    class Worker {
      constructor() { worker = this; }
      postMessage(request) { this.request = request; }
      terminate() { this.terminated = true; }
    }
    const send = fixture({ Worker, fetch: () => { fetches++; } });
    const pending = send("/api/app-data", "PATCH", {});
    if (failure === "error") worker.onerror({ preventDefault() {}, message: "connection lost" });
    else worker.onmessage({ data: { id: worker.request.id, error: "connection lost" } });
    await assert.rejects(pending, /connection lost/);
    assert.equal(fetches, 0, "a versioned write may already have committed");
    assert.equal(worker.terminated, failure === "error" ? true : undefined);
  }
});

test("concurrent saves share one worker and acknowledge the correct checkpoint", async () => {
  let worker, creations = 0;
  class Worker {
    constructor() { creations++; worker = this; this.requests = []; }
    postMessage(request) { this.requests.push(request); }
  }
  const send = fixture({ Worker });
  const first = send("/api/app-data", "PATCH", { first: true });
  const second = send("/api/app-data", "PATCH", { second: true });
  assert.equal(creations, 1, "tool checkpoints do not create repeated worker threads");
  worker.onmessage({ data: { id: worker.requests[1].id, response: { ok: false, status: 409, payload: {} } } });
  worker.onmessage({ data: { id: worker.requests[0].id, response: { ok: true, status: 200, payload: {} } } });
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 409);
});

test("legacy environments fall back only before a request can reach the server", async () => {
  class UnavailableWorker { constructor() { throw new Error("unsupported"); } }
  class UncloneableWorker {
    postMessage() { throw new DOMException("uncloneable", "DataCloneError"); }
    terminate() {}
  }
  for (const Worker of [undefined, UnavailableWorker, UncloneableWorker]) {
    const calls = [];
    const send = fixture({ Worker, fetch: async (...args) => {
      calls.push(args);
      return { ok: false, status: 409, json: async () => ({ error: "conflict" }) };
    } });
    const result = await send("/api/app-data", "PATCH", { data: { nickname: "saved", omitted: () => {} } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].body, '{"data":{"nickname":"saved"}}');
    assert.equal(result.status, 409);
    assert.equal(result.payload.error, "conflict");
  }
});
