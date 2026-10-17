import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const moduleHosts = ["testingcf.jsdelivr.net", "cdn.jsdelivr.net", "fastly.jsdelivr.net", "gcore.jsdelivr.net"];
const maxSourceBytes = 8 * 1024 * 1024;

export function getTavernModuleCandidates(remoteUrl) {
  const parsed = new URL(remoteUrl);
  if (parsed.protocol !== "https:" || !moduleHosts.includes(parsed.hostname.toLowerCase()) || parsed.port || parsed.username || parsed.password) {
    throw new Error("仅支持 jsDelivr 角色卡模块。");
  }
  const candidates = [parsed.href];
  if (parsed.hostname.toLowerCase() !== "cdn.jsdelivr.net") {
    parsed.hostname = "cdn.jsdelivr.net";
    candidates.push(parsed.href);
  }
  return candidates;
}

function freshnessMs(remoteUrl, cacheControl, age) {
  if (/\b(?:no-store|no-cache|private)\b/i.test(cacheControl)) return 0;
  const pinned = /\/(?:npm\/(?:@[^/]+\/)?[^/]+|gh\/[^/]+\/[^/]+)@(?:v?\d+\.\d+\.\d+(?:-[\w.-]+)?|[a-f\d]{40})(?:\/|$)/i.test(new URL(remoteUrl).pathname);
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(cacheControl)?.[1];
  const seconds = maxAge === undefined ? (pinned ? 86400 : 0) : Number(maxAge);
  return Math.max(0, Math.min(seconds - (Number(age) || 0), pinned ? 86400 * 365 : 300)) * 1000;
}

// Store original module bytes, not origin-specific rewritten imports. This
// survives app restarts/port changes without persisting references to old hosts.
export function createTavernModuleLoader({ cacheDir, fetchModule = fetch, now = Date.now, fallbackDelayMs = 800, getDependencies = () => [] } = {}) {
  const memory = new Map(), pending = new Map();
  const warmed = new Map(), warmQueue = [];
  let warmActive = 0;
  const pumpWarmQueue = () => {
    while (warmActive < 4 && warmQueue.length) {
      const task = warmQueue.shift();
      warmActive++;
      void task().catch(() => {}).finally(() => { warmActive--; pumpWarmQueue(); });
    }
  };
  const warmDependencies = entry => {
    if (warmed.get(entry.url) === entry) return;
    warmed.set(entry.url, entry);
    while (warmed.size > 64) warmed.delete(warmed.keys().next().value);
    const seen = new Set([entry.url]);
    const visit = (module, depth) => {
      if (depth >= 4) return;
      for (const dependency of getDependencies(module)) {
        if (seen.size >= 32 || warmQueue.length >= 64) break;
        if (seen.has(dependency)) continue;
        try { getTavernModuleCandidates(dependency); } catch { continue; }
        seen.add(dependency);
        warmQueue.push(async () => visit(await loadSource(dependency), depth + 1));
      }
      pumpWarmQueue();
    };
    visit(entry, 0);
  };
  const cachePath = remoteUrl => join(cacheDir, createHash("sha256").update(remoteUrl).digest("hex") + ".json");
  const remember = (key, entry) => {
    memory.delete(key);
    memory.set(key, entry);
    while (memory.size > 64) memory.delete(memory.keys().next().value);
  };
  const readCached = async remoteUrl => {
    if (memory.has(remoteUrl)) return memory.get(remoteUrl);
    if (!cacheDir) return null;
    try {
      const path = cachePath(remoteUrl);
      if ((await stat(path)).size > maxSourceBytes) return null;
      const entry = JSON.parse(await readFile(path, "utf8"));
      if (entry.url !== remoteUrl || typeof entry.source !== "string" || !Number.isFinite(entry.expiresAt) || !getTavernModuleCandidates(remoteUrl).includes(entry.resolvedUrl)) return null;
      remember(remoteUrl, entry);
      return entry;
    } catch { return null; }
  };
  const pruneCache = async () => {
    const names = (await readdir(cacheDir)).filter(name => /^[a-f\d]{64}\.json$/.test(name));
    if (names.length <= 128) return;
    const files = await Promise.all(names.map(async name => ({ path: join(cacheDir, name), time: (await stat(join(cacheDir, name))).mtimeMs })));
    await Promise.all(files.sort((a, b) => b.time - a.time).slice(128).map(file => rm(file.path, { force: true })));
  };
  const saveCached = async (remoteUrl, entry) => {
    if (/\b(?:no-store|private)\b/i.test(entry.cacheControl) || Buffer.byteLength(entry.source) > maxSourceBytes / 2) {
      memory.delete(remoteUrl);
      if (cacheDir) await rm(cachePath(remoteUrl), { force: true }).catch(() => {});
      return;
    }
    remember(remoteUrl, entry);
    if (!cacheDir) return;
    const temporaryPath = cachePath(remoteUrl) + "." + randomUUID() + ".tmp";
    try {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(temporaryPath, JSON.stringify(entry), "utf8");
      await rename(temporaryPath, cachePath(remoteUrl));
      void pruneCache().catch(() => {});
    } catch {
      // A read-only/full disk must never prevent a card from loading.
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
  };
  const download = async (remoteUrl, previous) => {
    const candidates = getTavernModuleCandidates(remoteUrl);
    const controllers = candidates.map(() => new AbortController());
    let timer, startFallback;
    const fetchCandidate = async (candidate, index) => {
      const headers = { Accept: "text/javascript, application/javascript, */*;q=0.8" };
      if (previous?.etag) headers["If-None-Match"] = previous.etag;
      if (previous?.lastModified) headers["If-Modified-Since"] = previous.lastModified;
      const response = await fetchModule(candidate, { headers, signal: AbortSignal.any([controllers[index].signal, AbortSignal.timeout(30_000)]) });
      if (!response.ok && !(response.status === 304 && previous)) throw new Error(`远程模块返回 ${response.status}`);
      const cacheControl = response.headers.get("cache-control") ?? (response.status === 304 ? previous.cacheControl : "");
      const source = response.status === 304 ? previous.source : await response.text();
      return {
        url: remoteUrl, resolvedUrl: candidate, source,
        contentType: response.headers.get("content-type") ?? (response.status === 304 ? previous.contentType : ""),
        cacheControl, expiresAt: now() + freshnessMs(remoteUrl, cacheControl, response.headers.get("age")),
        etag: response.headers.get("etag") ?? (response.status === 304 ? previous.etag : ""),
        lastModified: response.headers.get("last-modified") ?? (response.status === 304 ? previous.lastModified : ""),
      };
    };
    try {
      const attempts = [fetchCandidate(candidates[0], 0).catch(error => { startFallback?.(); throw error; })];
      if (candidates.length > 1) {
        attempts.push(new Promise(resolve => {
          startFallback = resolve;
          timer = setTimeout(resolve, fallbackDelayMs);
        }).then(() => fetchCandidate(candidates[1], 1)));
      }
      return await Promise.any(attempts);
    } catch (error) {
      throw error.errors?.at(-1) ?? error;
    } finally {
      clearTimeout(timer);
      controllers.forEach(controller => controller.abort());
    }
  };
  const loadSource = async remoteUrl => {
    getTavernModuleCandidates(remoteUrl);
    if (!pending.has(remoteUrl)) {
      const task = (async () => {
        const previous = await readCached(remoteUrl);
        if (previous && previous.expiresAt > now()) return previous;
        const entry = await download(remoteUrl, previous);
        await saveCached(remoteUrl, entry);
        return entry;
      })();
      pending.set(remoteUrl, task);
    }
    const task = pending.get(remoteUrl);
    try { return await task; }
    finally { if (pending.get(remoteUrl) === task) pending.delete(remoteUrl); }
  };
  return async remoteUrl => {
    const entry = await loadSource(remoteUrl);
    // Opportunistic parsing/prefetch must not turn a valid module into a 502.
    try { warmDependencies(entry); } catch { /* Actual imports still load normally. */ }
    return entry;
  };
}
