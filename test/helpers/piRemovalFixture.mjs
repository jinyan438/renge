import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function createPiRemovalFixture(root) {
  const dataDir = join(root, "data");
  const agentDir = join(dataDir, ".pi", "agent");
  const npmRoot = join(agentDir, "npm");
  const npmPath = join(npmRoot, "node_modules", "pi-gpt-search");
  const gitPath = join(agentDir, "git", "github.com", "SpadeLushen", "pi-gpt-with-taste");
  const localPath = join(root, "local-package");
  const npmSource = "npm:pi-gpt-search";
  const gitSource = "https://github.com/SpadeLushen/pi-gpt-with-taste";
  const targets = [
    { id: "pi-search-fixture", packageName: "pi-gpt-search", sourceUrl: npmSource, piPackageSource: npmSource },
    // Older records may only carry sourceUrl. Both API and UI must still uninstall them.
    { id: "pi-taste-fixture", packageName: "pi-gpt-with-taste", sourceUrl: gitSource },
  ].map((extension) => ({ ...extension, displayName: extension.packageName, version: "1.0.0",
    compatibility: "pi", enabled: false, status: "installed", loadingOrder: 50 }));
  const kept = { id: "keep-fixture", packageName: "keep-fixture", displayName: "Keep fixture",
    sourceUrl: localPath, piPackageSource: localPath, compatibility: "pi", enabled: false };
  const disabled = (source) => ({ source, extensions: [], skills: [], prompts: [], themes: [] });
  const settings = { packages: [disabled(npmSource), disabled(gitSource), disabled(localPath)] };
  await Promise.all([
    mkdir(npmPath, { recursive: true }),
    mkdir(join(gitPath, ".git"), { recursive: true }),
    mkdir(localPath, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(npmPath, "package.json"), JSON.stringify({ name: "pi-gpt-search", version: "1.0.0" })),
    writeFile(join(gitPath, "package.json"), JSON.stringify({ name: "pi-gpt-with-taste", version: "1.0.0" })),
    writeFile(join(gitPath, ".git", "HEAD"), "ref: refs/heads/main\n"),
    writeFile(join(localPath, "keep.txt"), "keep local source"),
    writeFile(join(npmRoot, "package.json"), JSON.stringify({ name: "removal-fixture", private: true,
      dependencies: { "pi-gpt-search": "1.0.0" } })),
    writeFile(join(agentDir, "settings.json"), JSON.stringify(settings)),
    writeFile(join(dataDir, "app-data.json"), JSON.stringify({ version: 1, extensions: [...targets, kept],
      userProfile: { nickname: "保留的用户资料" } })),
  ]);
  return { dataDir, agentDir, npmPath, gitPath, localPath, npmSource, gitSource, targets, kept };
}
