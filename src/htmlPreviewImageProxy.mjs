import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

export function detectHtmlPreviewImageType(bytes) {
  if (bytes.length < 12) return "";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.toString("ascii", 4, 8) === "ftyp" && /^(?:avif|avis)$/.test(bytes.toString("ascii", 8, 12))) return "image/avif";
  if (bytes[0] === 66 && bytes[1] === 77) return "image/bmp";
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "image/x-icon";
  const text = bytes.toString("utf8", 0, Math.min(bytes.length, 4096));
  if (/^\s*(?:<\?xml[^>]*>\s*|<!--[\s\S]*?-->\s*)*<svg\b/i.test(text)) return "image/svg+xml";
  return "";
}

function isPublicAddress(address, namedHost = false) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19) && !namedHost));
  }
  // Require global unicast IPv6; mapped IPv4 and local/link-local addresses
  // must not turn this image-only route into access to local services.
  return isIP(address) === 6 && /^[23][\da-f]{3}:/i.test(address);
}

export function createHtmlPreviewImageDispatcher() {
  // Recheck the addresses used by the socket, rather than relying solely on
  // an earlier DNS lookup which could change before the connection is opened.
  return new Agent({ connect: { lookup(hostname, options, callback) {
    lookup(hostname, { all: true, family: options.family }).then(addresses => {
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address, !isIP(hostname)))) {
        callback(Object.assign(new Error("图片地址不能指向本地网络。"), { code: "RENGE_IMAGE_PRIVATE_ADDRESS" }));
      } else if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    }, callback);
  } } });
}

export async function validateHtmlPreviewImageUrl(source, resolveHost = lookup) {
  const url = new URL(source);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
      (url.port && url.port !== "80" && url.port !== "443") ||
      hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("仅支持公网 HTTP(S) 图片。");
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolveHost(hostname, { all: true });
  // TUN proxy DNS can map public names into the benchmark range 198.18/15.
  // Permit these virtual addresses for named hosts, never literal targets.
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address, !isIP(hostname)))) {
    throw new Error("图片地址不能指向本地网络。");
  }
  url.hash = "";
  return url.href;
}

export function createHtmlPreviewImageHandler({ fetchImage = fetch, resolveHost = lookup } = {}) {
  const cache = new Map();
  const pending = new Map();
  let cacheBytes = 0;
  const load = async source => {
    const cached = cache.get(source);
    if (cached && Date.now() - cached.time < 60 * 60 * 1000) {
      cache.delete(source);
      cache.set(source, cached);
      return cached;
    }
    if (cached) { cache.delete(source); cacheBytes -= cached.bytes.length; }
    if (pending.has(source)) return pending.get(source);
    const promise = (async () => {
      let nextUrl = source;
      for (let redirects = 0; redirects <= 4; redirects += 1) {
        nextUrl = await validateHtmlPreviewImageUrl(nextUrl, resolveHost);
        const upstream = await fetchImage(nextUrl, {
          redirect: "manual", signal: AbortSignal.timeout(20_000),
          headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
        });
        if ([301, 302, 303, 307, 308].includes(upstream.status)) {
          await upstream.body?.cancel();
          nextUrl = new URL(upstream.headers.get("location"), nextUrl).href;
          continue;
        }
        if (!upstream.ok || Number(upstream.headers.get("content-length")) > MAX_IMAGE_BYTES) {
          await upstream.body?.cancel();
          throw new Error("远程图片不可用或超过 20MB。");
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of upstream.body ?? []) {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES) throw new Error("远程图片超过 20MB。");
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        const contentType = detectHtmlPreviewImageType(bytes);
        if (!contentType) throw new Error("远程资源不是可显示的图片。");
        const result = { bytes, contentType, time: Date.now() };
        cache.set(source, result);
        cacheBytes += bytes.length;
        while (cacheBytes > MAX_CACHE_BYTES || cache.size > 128) {
          const oldest = cache.keys().next().value;
          cacheBytes -= cache.get(oldest).bytes.length;
          cache.delete(oldest);
        }
        return result;
      }
      throw new Error("远程图片重定向过多。");
    })();
    pending.set(source, promise);
    try { return await promise; } finally { pending.delete(source); }
  };
  return async (request, response, url) => {
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }); response.end(); return;
    }
    try {
      const source = await validateHtmlPreviewImageUrl(url.searchParams.get("url"), resolveHost);
      const image = await load(source);
      response.writeHead(200, {
        "Content-Type": image.contentType, "Content-Length": image.bytes.length,
        "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "cross-origin", "Access-Control-Allow-Origin": "*",
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      });
      response.end(image.bytes);
    } catch {
      response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("图片加载失败");
    }
  };
}
