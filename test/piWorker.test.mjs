import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRengePiWorkerHost } from "../pi/host-worker-client.mjs";

test("isolated Pi host manages local packages and closes idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "renge-worker-package-"));
  const agentDir = join(root, "agent"), packageRoot = join(root, "package");
  const host = createRengePiWorkerHost({ defaultCwd: root, dataDir: root, agentDir });
  const settings = async () => JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
  try {
    await mkdir(packageRoot);
    const manifest = { name: "@renge-test/worker-fixture", version: "1.0.0", pi: { extensions: ["./index.mjs"] } };
    await writeFile(join(packageRoot, "package.json"), JSON.stringify(manifest));
    await writeFile(join(packageRoot, "index.mjs"), "export default function (pi) {}\n");
    const extension = await host.installPiPackage(`pi:${packageRoot}`);
    assert.equal(extension.packageName, manifest.name);
    assert.equal(extension.version, "1.0.0");
    const source = extension.piPackageSource;
    await host.setPiPackageEnabled(source, false);
    assert.deepEqual((await settings()).packages[0].extensions, []);
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ ...manifest, version: "1.0.1" }));
    assert.equal((await host.updatePiPackage(source)).version, "1.0.1");
    assert.deepEqual((await settings()).packages[0].extensions, []);
    await host.setPiPackageEnabled(source, true);
    assert.equal((await settings()).packages[0], packageRoot);
    await host.removePiPackage(source);
    assert.deepEqual((await settings()).packages, []);
    const disposal = host.dispose();
    assert.equal(host.dispose(), disposal);
    await disposal;
    await assert.rejects(host.handleSessionActivity({ sessionId: "closed" }), /已关闭/);
  } finally {
    await host.dispose();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
