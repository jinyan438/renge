import { isAbsolute, relative, resolve, sep } from "node:path";

export function isPathInsideWorkspace(workspaceRoot, targetPath) {
  if (!workspaceRoot) return false;

  const normalizedRoot = resolve(String(workspaceRoot));
  const normalizedTarget = resolve(String(targetPath));
  const relativePath = relative(normalizedRoot, normalizedTarget);

  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

export function resolveSystemPath(workspaceRoot, inputPath = "") {
  const rawInput = String(inputPath ?? "").trim();
  if (!rawInput) {
    if (!workspaceRoot) throw new Error("尚未选择工作区；读取系统文件时请提供绝对路径");
    return resolve(String(workspaceRoot));
  }

  if (isAbsolute(rawInput)) return resolve(rawInput);
  if (!workspaceRoot) throw new Error("尚未选择工作区；请提供绝对路径");
  return resolve(String(workspaceRoot), rawInput);
}

export function formatSystemPathResult(workspaceRoot, targetPath) {
  const normalizedTarget = resolve(String(targetPath));
  if (!isPathInsideWorkspace(workspaceRoot, normalizedTarget)) return normalizedTarget;

  return relative(resolve(String(workspaceRoot)), normalizedTarget).replace(/\\/g, "/");
}
