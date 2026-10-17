import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTavernModuleLoader } from "../src/tavernModuleLoader.mjs";

const url = "https://testingcf.jsdelivr.net/gh/example/card@v1.2.3/main.js";
const response = (source = "export const ready = true;", headers = {}) => new Response(source, { headers: { "content-type": "text/javascript", "cache-control": "max-age=3600", ...headers } });

test("deduplicates in-flight requests and reuses original bytes after a loader restart", async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), "renge-module-cache-"));
  t.after(() => rm(cacheDir, { recursive:true, force:true }));
  let requests = 0;
  const load = createTavernModuleLoader({ cacheDir, fetchModule: async () => { requests++; await new Promise(r => setTimeout(r, 20)); return response("import './child.js';"); } });
  const [a, b] = await Promise.all([load(url), load(url)]);
  assert.equal(requests, 1);
  assert.equal(a, b);
  const restarted = createTavernModuleLoader({ cacheDir, fetchModule: () => { throw new Error("offline"); } });
  assert.equal((await restarted(url)).source, "import './child.js';");
  assert.equal((await restarted(url)).resolvedUrl, url);
});

test("revalidates expired sources with upstream validators and accepts updated content", async () => {
  let time = 1000, count = 0;
  const load = createTavernModuleLoader({ now: () => time, fetchModule: async (_url, options) => {
    count++;
    if (count === 1) return response("version one", { "cache-control":"max-age=1", etag:'"v1"' });
    assert.equal(options.headers["If-None-Match"], '"v1"');
    if (count === 2) return new Response(null, { status:304, headers:{ "cache-control":"max-age=2" } });
    return response("version two");
  } });
  await load(url);
  time += 1500;
  assert.equal((await load(url)).source, "version one");
  time += 500;
  await load(url);
  assert.equal(count, 2);
  time += 2000;
  assert.equal((await load(url)).source, "version two");
});

test("mutable URLs refresh within five minutes and no-cache/no-store directives are respected", async () => {
  for (const control of ["max-age=31536000", "no-cache, max-age=3600", "no-store"]) {
    let time = 0, count = 0;
    const load = createTavernModuleLoader({ now: () => time, fetchModule: async () => { count++; return response(String(count), { "cache-control":control }); } });
    const mutableUrl = "https://cdn.jsdelivr.net/gh/example/card/main.js";
    await load(mutableUrl);
    if (control.startsWith("max-age")) {
      time = 299000;
      assert.equal((await load(mutableUrl)).source, "1");
      time = 301000;
    }
    assert.equal((await load(mutableUrl)).source, "2");
  }
});

test("a slow mirror starts the CDN fallback before its timeout and cancels the loser", async () => {
  let slowSignal;
  const load = createTavernModuleLoader({ fallbackDelayMs:10, fetchModule: async (candidate, { signal }) => {
    if (candidate.startsWith("https://cdn.")) return response("fallback");
    slowSignal = signal;
    return await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once:true }));
  } });
  const result = await load(url);
  assert.equal(result.source, "fallback");
  assert.equal(new URL(result.resolvedUrl).host, "cdn.jsdelivr.net");
  assert.equal(slowSignal.aborted, true);
});

test("immediate failures fall back immediately and failed loads can be retried", async () => {
  let fail = true;
  const load = createTavernModuleLoader({ fallbackDelayMs:30000, fetchModule: async candidate => {
    if (fail || candidate.includes("testingcf")) throw new Error("offline");
    return response("recovered");
  } });
  await assert.rejects(load(url), /offline/);
  fail = false;
  assert.equal((await load(url)).source, "recovered");
});

test("ignores damaged disk cache and cache-write failures without blocking startup", async t => {
  const root = await mkdtemp(join(tmpdir(), "renge-module-cache-broken-"));
  t.after(() => rm(root, { recursive:true, force:true }));
  await writeFile(join(root, createHash("sha256").update(url).digest("hex") + ".json"), "invalid JSON");
  assert.equal((await createTavernModuleLoader({ cacheDir:root, fetchModule:async () => response() })(url)).source, "export const ready = true;");
  const file = join(root, "not-a-directory");
  await writeFile(file, "file");
  assert.equal((await createTavernModuleLoader({ cacheDir:file, fetchModule:async () => response() })(url)).source, "export const ready = true;");
});

test("rejects unsupported origins and credential/port variations before fetching", async () => {
  const load = createTavernModuleLoader({ fetchModule: () => { throw new Error("must not fetch"); } });
  for (const candidate of ["https://example.test/x.js", "http://cdn.jsdelivr.net/x.js", "https://user:pass@cdn.jsdelivr.net/x.js", "https://cdn.jsdelivr.net:444/x.js"]) {
    await assert.rejects(load(candidate), /jsDelivr/);
  }
});

test("expired caches never conceal an upstream failure and upstream Age reduces freshness", async () => {
  let time = 0, fail = false, requests = 0;
  const load = createTavernModuleLoader({ now: () => time, fetchModule:async () => {
    requests++;
    if (fail) throw new Error("unavailable");
    return response("fresh", { "cache-control":"max-age=60", age:"59" });
  } });
  const cdnUrl = url.replace("testingcf.", "cdn.");
  await load(cdnUrl);
  time = 500;
  await load(cdnUrl);
  assert.equal(requests, 1);
  time = 1500; fail = true;
  await assert.rejects(load(cdnUrl), /unavailable/);
  fail = false;
  assert.equal((await load(cdnUrl)).source, "fresh");
});

test("background graph warming is bounded, ignores cycles, and cannot block the root module", async () => {
  const urls = [];
  const load = createTavernModuleLoader({
    fetchModule:async candidate => { urls.push(candidate); return response(candidate); },
    getDependencies:entry => [entry.url, ...Array.from({length:50}, (_v,i) => `https://cdn.jsdelivr.net/gh/fixture/deps@1.0.0/${i}.js`)],
  });
  await load(url);
  for(let i=0;i<50 && urls.length<32;i++) await new Promise(r=>setTimeout(r,5));
  assert.equal(urls.length,32);
  assert.equal(new Set(urls).size,32);
  const brokenPrefetch = createTavernModuleLoader({
    fetchModule:async () => response("valid module"),
    getDependencies:() => { throw new Error("prefetch parse failed"); },
  });
  assert.equal((await brokenPrefetch(url)).source, "valid module");
});
