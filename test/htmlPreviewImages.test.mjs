import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createHtmlPreviewImageHandler, detectHtmlPreviewImageType, validateHtmlPreviewImageUrl } from "../src/htmlPreviewImageProxy.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1kAAAAASUVORK5CYII=", "base64");
const publicHost = async () => [{ address: "93.184.216.34" }];

test("identifies image bytes independently of extension and upstream MIME", () => {
  assert.equal(detectHtmlPreviewImageType(png), "image/png");
  assert.equal(detectHtmlPreviewImageType(Buffer.from("<html>not an image</html>")), "");
  assert.equal(detectHtmlPreviewImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), "image/svg+xml");
  assert.equal(detectHtmlPreviewImageType(Buffer.alloc(3)), "");
  assert.equal(detectHtmlPreviewImageType(Buffer.from("GIF89a" + "\0".repeat(8))), "image/gif");
  assert.equal(detectHtmlPreviewImageType(Buffer.from("RIFF1234WEBP")), "image/webp");
});

test("rejects local services, credentials and non-HTTP resources including DNS and redirects", async () => {
  for (const url of ["file:///x.png", "data:image/png;base64,abcd", "http://localhost/x", "http://127.1/x",
    "http://[::1]/x", "http://[::ffff:127.0.0.1]/x", "http://10.0.0.1/x", "http://172.16.0.1/x",
    "http://192.168.0.1/x", "http://100.64.0.1/x", "http://198.18.1.2/x", "http://user:password@example.com/x", "http://example.com:5190/x"]) {
    await assert.rejects(validateHtmlPreviewImageUrl(url, publicHost));
  }
  await assert.rejects(validateHtmlPreviewImageUrl("https://private.example/x", async () => [{address:"127.0.0.1"}]));
  assert.equal(await validateHtmlPreviewImageUrl("https://images.example/i/123#preview", publicHost), "https://images.example/i/123");
  assert.equal(await validateHtmlPreviewImageUrl("https://images.example/i/123", async () => [{address:"198.18.1.2"}]), "https://images.example/i/123");
});

test("serves image-only bytes with corrected MIME, caches duplicate requests and retries failures", async () => {
  let requests = 0;
  let fail = true;
  const handler = createHtmlPreviewImageHandler({ resolveHost: publicHost, fetchImage: async url => {
    requests++;
    if (url.endsWith("/redirect")) return new Response(null, {status:302,headers:{location:"http://127.0.0.1/private"}});
    if (url.endsWith("/oversized")) return new Response(png, {headers:{"content-length":String(21*1024*1024)}});
    if (url.endsWith("/html")) return new Response("<html>error page</html>", {headers:{"content-type":"image/png"}});
    if (url.endsWith("/retry") && fail) throw new Error("temporary outage");
    return new Response(png, {headers:{"content-type":"application/octet-stream","x-content-type-options":"nosniff"}});
  } });
  const server = createServer((req,res) => handler(req,res,new URL(req.url,"http://localhost")));
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const base = `http://127.0.0.1:${server.address().port}/html-preview-image?url=`;
  try {
    const source = "https://images.example/i/asset";
    const responses = await Promise.all([fetch(base+encodeURIComponent(source)),fetch(base+encodeURIComponent(source))]);
    for (const r of responses) {
      assert.equal(r.status,200);
      assert.equal(r.headers.get("content-type"),"image/png");
      assert.equal(r.headers.get("x-content-type-options"),"nosniff");
      assert.match(r.headers.get("content-security-policy"), /^sandbox; default-src 'none'/);
      assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);
    }
    assert.equal(requests,1);
    assert.equal((await fetch(base+encodeURIComponent(source))).status,200);
    assert.equal(requests,1);
    for(const path of ["html","oversized","redirect","retry"]) {
      assert.equal((await fetch(base+encodeURIComponent("https://images.example/"+path))).status,502);
    }
    assert.equal(requests,5,"a redirect to a private service is rejected before fetching it");
    fail=false;
    assert.equal((await fetch(base+encodeURIComponent("https://images.example/retry"))).status,200);
    assert.equal((await fetch(base+encodeURIComponent(source),{method:"POST"})).status,405);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});
