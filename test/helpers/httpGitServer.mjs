// Minimal Git smart-HTTP server for tests.
//
// The Renge extension installer only accepts https:, http: or git:// repository
// URLs (see normalizeExtensionGitUrl in server.mjs), so a local directory path
// or a file:// URL can never exercise the Git install/update path. This helper
// exposes a bare repository over real HTTP by forwarding requests to
// `git http-backend`, which is the standard way Git serves repositories over
// HTTP without any extra daemon.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";

const CONTENT_TYPES = {
  "text/plain": "text/plain",
};

function runGitHttpBackend({ projectRoot, pathname, query, method, headers, body }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", ["http-backend"], {
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: projectRoot,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: pathname,
        QUERY_STRING: query ?? "",
        REQUEST_METHOD: method ?? "GET",
        CONTENT_TYPE: headers["content-type"] ?? "",
        CONTENT_LENGTH: String(body?.length ?? 0),
        REMOTE_USER: "",
        GIT_HTTP_MAX_REQUEST_BUFFER: "100M",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => rejectPromise(new Error(`无法启动 git http-backend：${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(
          new Error(Buffer.concat(stderrChunks).toString("utf8").trim() || `git http-backend 退出码 ${code}`),
        );
        return;
      }
      resolvePromise(Buffer.concat(stdoutChunks));
    });

    if (body?.length) child.stdin.end(body);
    else child.stdin.end();
  });
}

// git http-backend writes a CGI response: headers, a blank line, then the body.
function parseCgiResponse(buffer) {
  const separator = buffer.indexOf("\r\n\r\n");
  const separatorLength = separator === -1 ? 0 : 4;
  const headerEnd = separator === -1 ? buffer.indexOf("\n\n") : separator;
  const headerEndLength = separator === -1 ? 2 : separatorLength;
  if (headerEnd === -1) return { status: 200, headers: {}, body: buffer };

  const rawHeaders = buffer.subarray(0, headerEnd).toString("utf8");
  const body = buffer.subarray(headerEnd + headerEndLength);
  const headers = {};
  let status = 200;
  for (const line of rawHeaders.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    const name = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (name === "status") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) status = parsed;
      continue;
    }
    headers[name] = value;
  }
  return { status, headers, body };
}

/**
 * Serve `projectRoot` over HTTP so `<url>/<owner>/<repo>` resolves to the bare
 * repository at `<projectRoot>/<owner>/<repo>`.
 */
export async function createHttpGitServer(projectRoot) {
  const root = resolve(projectRoot);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw = await runGitHttpBackend({
        projectRoot: root,
        pathname: decodeURIComponent(url.pathname),
        query: url.search.replace(/^\?/, ""),
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      const { status, headers, body } = parseCgiResponse(raw);
      const outgoing = {};
      for (const [name, value] of Object.entries(headers)) {
        if (name === "status") continue;
        outgoing[name] = CONTENT_TYPES[value] ?? value;
      }
      // Node's http server must not be told about chunked bodies itself here.
      delete outgoing["transfer-encoding"];
      response.writeHead(status, outgoing);
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(error instanceof Error ? error.message : "git http-backend 失败");
    }
  });

  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP Git 测试服务器启动失败。");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolvePromise, rejectPromise) =>
        server.close((error) => (error ? rejectPromise(error) : resolvePromise())),
      ),
  };
}
