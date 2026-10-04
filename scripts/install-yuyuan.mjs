import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export function defaultRengeDataDir() {
  if (process.env.RENGE_DATA_DIR) return resolve(process.env.RENGE_DATA_DIR);
  return process.env.APPDATA
    ? join(process.env.APPDATA, "Renge Agent Lab")
    : join(homedir(), ".renge-agent-lab");
}

export async function installYuyuan({ sourceDir, dataDir = defaultRengeDataDir() }) {
  const sourceRoot = await realpath(resolve(sourceDir));
  const source = await readFile(join(sourceRoot, "yuyuan.readable.js"));
  const names = (await readFile(join(sourceRoot, "assets-list.txt"), "utf8"))
    .replace(/^\uFEFF/, "").split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  if (!names.length || names.some(name => !/^\d{3}_[A-Za-z0-9_.-]+\.(?:webp|png|jpe?g)$/.test(name)) || new Set(names).size !== names.length) {
    throw new Error("Invalid or empty Yuyuan asset list");
  }
  // Validate the complete source package before replacing installed files.
  const files = [["yuyuan.readable.js", source]];
  for (const name of names) files.push([join("yuyuan-assets", name), await readFile(join(sourceRoot, "yuyuan-assets", name))]);
  const targetRoot = join(resolve(dataDir), "tavern-script-assets", "yuyuan");
  for (const [name, bytes] of files) {
    const target = join(targetRoot, name);
    await mkdir(dirname(target), { recursive: true });
    const temporary = target + ".tmp-" + randomUUID();
    await writeFile(temporary, bytes);
    await rename(temporary, target);
    if (hash(await readFile(target)) !== hash(bytes)) throw new Error(`Installation verification failed: ${name}`);
  }
  const content = [
    '// 芋圆机：从持久化应用数据目录加载，兼容 about:srcdoc iframe。',
    'const yuyuanCoreUrl = new URL("/tavern-script-assets/yuyuan/yuyuan.readable.js", document.baseURI);',
    `yuyuanCoreUrl.searchParams.set("v", "${hash(source).slice(0, 16)}");`,
    'yuyuanCoreUrl.searchParams.set("run", String(Date.now()));',
    'window.__YUYUAN_CORE_URL__ = yuyuanCoreUrl.href;',
    'await import(yuyuanCoreUrl.href);'
  ].join("\n");
  const script = {
    type: "script", enabled: false, name: "芋圆机",
    id: "9f701e20-229c-4b46-a6d5-b1e363d90292", content,
    info: "本地可读版；源码和资源安装在 Renge 应用数据目录，重新构建无需重新安装。导入后启用。",
    button: { enabled: true, buttons: [{ name: "芋圆机按钮", visible: true }] },
    data: {}, export_with: { data: true, button: true }
  };
  const importFile = join(targetRoot, "yuyuan.renge.script.json");
  await writeFile(importFile, JSON.stringify(script, null, 2) + "\n");
  return { targetRoot, importFile, assets: names.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceDir = process.argv[2];
  if (!sourceDir) throw new Error("Usage: node scripts/install-yuyuan.mjs <Yuyuan source directory> [Renge data directory]");
  const result = await installYuyuan({ sourceDir, dataDir: process.argv[3] || defaultRengeDataDir() });
  console.log(`Installed readable source and ${result.assets} verified assets to ${result.targetRoot}`);
  console.log(`Import: ${result.importFile}`);
}
