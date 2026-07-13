import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = resolve(new URL("..", import.meta.url).pathname.slice(1));
const electronPackageDir = join(rootDir, "node_modules", "electron");
const distDir = join(electronPackageDir, "dist");
const zipCandidates = [
  join(rootDir, "electron-v42.4.1-win32-x64.zip"),
  join(rootDir, "electron-v42.4.1-win32-x64.zip.zip"),
];

const zipPath = zipCandidates.find((candidate) => existsSync(candidate));

if (!zipPath) {
  throw new Error("根目录未找到 electron-v42.4.1-win32-x64.zip");
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await execFileAsync("powershell", [
  "-NoProfile",
  "-Command",
  `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${distDir.replace(/'/g, "''")}' -Force`,
]);

if (!existsSync(join(distDir, "electron.exe"))) {
  await rm(distDir, { recursive: true, force: true });
  throw new Error(
    `压缩包不是 Electron 运行时包，未找到 electron.exe：${zipPath}\n请下载 electron-v42.4.1-win32-x64.zip，不要下载 symbols 包。`,
  );
}

await writeFile(join(electronPackageDir, "path.txt"), "electron.exe");
console.log(`Electron runtime installed from ${zipPath}`);
