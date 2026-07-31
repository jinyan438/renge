import { copyFile, mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, parse, relative, resolve } from "node:path";

const DEFAULT_LIST_LIMIT = 2000;
const DEFAULT_TEXT_PREVIEW_BYTES = 512 * 1024;
const DEFAULT_BINARY_PREVIEW_BYTES = 24 * 1024 * 1024;

function isOutsideRoot(relativePath) {
  return relativePath === ".." || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

export function resolveSidebarFilePath(rootPath, inputPath = "") {
  const root = resolve(String(rootPath ?? ""));
  const normalizedInput = String(inputPath ?? "").trim().replace(/^[\\/]+/, "");
  const target = normalizedInput ? resolve(root, normalizedInput) : root;
  if (isOutsideRoot(relative(root, target))) {
    throw new Error("路径超出文件浏览范围");
  }
  return target;
}

function resolveSidebarChildPath(rootPath, inputPath) {
  const root = resolve(String(rootPath ?? ""));
  const target = resolveSidebarFilePath(root, inputPath);
  if (target === root) throw new Error("path 不能为空");
  return target;
}

function toRelativeFilePath(rootPath, absolutePath) {
  return relative(rootPath, absolutePath).replace(/\\/g, "/");
}

async function describeEntry(rootPath, absolutePath, dirent) {
  const entryStat = await stat(absolutePath);
  return {
    name: dirent.name,
    path: toRelativeFilePath(rootPath, absolutePath),
    kind: dirent.isDirectory() ? "directory" : "file",
    size: dirent.isDirectory() ? undefined : entryStat.size,
    modifiedAt: entryStat.mtime.toISOString(),
    absolutePath,
  };
}

export async function listSidebarFiles(
  rootPath,
  inputPath = "",
  { recursive = false, limit = DEFAULT_LIST_LIMIT } = {},
) {
  const root = resolve(String(rootPath ?? ""));
  const startPath = resolveSidebarFilePath(root, inputPath);
  const results = [];

  async function visit(directoryPath) {
    const dirents = await readdir(directoryPath, { withFileTypes: true });
    const sorted = dirents.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" });
    });
    for (const dirent of sorted) {
      if (results.length >= limit) return;
      const absolutePath = join(directoryPath, dirent.name);
      const entry = await describeEntry(root, absolutePath, dirent);
      results.push(entry);
      if (recursive && dirent.isDirectory() && !dirent.isSymbolicLink()) {
        await visit(absolutePath);
      }
    }
  }

  await visit(startPath);
  return { rootPath: root, path: toRelativeFilePath(root, startPath), entries: results };
}

async function readLimitedFile(targetPath, byteLimit) {
  const info = await stat(targetPath);
  if (!info.isFile()) throw new Error("只能预览文件");
  const bytesToRead = Math.min(info.size, byteLimit);
  const buffer = Buffer.alloc(bytesToRead);
  const handle = await open(targetPath, "r");
  try {
    if (bytesToRead > 0) await handle.read(buffer, 0, bytesToRead, 0);
  } finally {
    await handle.close();
  }
  return { buffer, info, truncated: info.size > bytesToRead };
}

export async function readSidebarTextFile(
  rootPath,
  inputPath,
  byteLimit = DEFAULT_TEXT_PREVIEW_BYTES,
) {
  const targetPath = resolveSidebarFilePath(rootPath, inputPath);
  const { buffer, info, truncated } = await readLimitedFile(targetPath, byteLimit);
  return {
    path: String(inputPath ?? ""),
    absolutePath: targetPath,
    size: info.size,
    content: buffer.toString("utf8"),
    truncated,
  };
}

export async function readSidebarBinaryFile(
  rootPath,
  inputPath,
  byteLimit = DEFAULT_BINARY_PREVIEW_BYTES,
) {
  const targetPath = resolveSidebarFilePath(rootPath, inputPath);
  const info = await stat(targetPath);
  if (info.size > byteLimit) {
    throw new Error(`文件过大，侧栏最多预览 ${Math.round(byteLimit / (1024 * 1024))} MB`);
  }
  const { buffer } = await readLimitedFile(targetPath, byteLimit);
  return {
    path: String(inputPath ?? ""),
    absolutePath: targetPath,
    size: info.size,
    base64: buffer.toString("base64"),
  };
}

export async function writeSidebarTextFile(rootPath, inputPath, content) {
  const targetPath = resolveSidebarChildPath(rootPath, inputPath);
  const serialized = String(content ?? "");
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, serialized, "utf8");
  return {
    ok: true,
    path: String(inputPath ?? ""),
    absolutePath: targetPath,
    operation: "write",
    bytes: Buffer.byteLength(serialized, "utf8"),
  };
}

export async function writeSidebarBinaryFile(rootPath, inputPath, base64) {
  const targetPath = resolveSidebarChildPath(rootPath, inputPath);
  const normalizedBase64 = String(base64 ?? "")
    .replace(/^data:[^,]*,/, "")
    .replace(/\s+/g, "");
  const content = Buffer.from(normalizedBase64, "base64");
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
  return {
    ok: true,
    path: String(inputPath ?? ""),
    absolutePath: targetPath,
    operation: "writeBinary",
    bytes: content.length,
  };
}

export async function createSidebarDirectory(rootPath, inputPath) {
  const targetPath = resolveSidebarChildPath(rootPath, inputPath);
  await mkdir(targetPath, { recursive: true });
  return {
    ok: true,
    path: String(inputPath ?? ""),
    absolutePath: targetPath,
    operation: "mkdir",
  };
}

export async function editSidebarTextFile(rootPath, inputPath, find, replacement) {
  const targetPath = resolveSidebarChildPath(rootPath, inputPath);
  const searchText = String(find ?? "");
  if (!searchText) throw new Error("find 不能为空");
  const originalContent = await readFile(targetPath, "utf8");
  if (!originalContent.includes(searchText)) throw new Error("没有找到要替换的文本");
  const nextContent = originalContent.split(searchText).join(String(replacement ?? ""));
  await writeFile(targetPath, nextContent, "utf8");
  return {
    ok: true,
    path: String(inputPath ?? ""),
    absolutePath: targetPath,
    operation: "edit",
    replacements: originalContent.split(searchText).length - 1,
    bytes: Buffer.byteLength(nextContent, "utf8"),
  };
}

export async function deleteSidebarPath(rootPath, inputPath, recursive = false) {
  const targetPath = resolveSidebarChildPath(rootPath, inputPath);
  const targetStat = await stat(targetPath);
  await rm(targetPath, {
    recursive: Boolean(recursive) && targetStat.isDirectory(),
    force: false,
  });
  return {
    ok: true,
    path: String(inputPath ?? ""),
    absolutePath: targetPath,
    operation: "delete",
  };
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function createAvailableImportPath(rootPath, requestedName) {
  const safeName = basename(String(requestedName ?? "")).trim() || "临时文件";
  const firstCandidate = join(rootPath, safeName);
  if (!(await pathExists(firstCandidate))) return firstCandidate;

  const parsedName = parse(safeName);
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = join(rootPath, `${parsedName.name} (${suffix})${parsedName.ext}`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("无法为临时文件生成可用名称");
}

export async function importTemporaryFiles(rootPath, sourcePaths) {
  const root = resolve(String(rootPath ?? ""));
  await mkdir(root, { recursive: true });
  const imported = [];
  for (const sourcePath of Array.isArray(sourcePaths) ? sourcePaths : []) {
    const source = resolve(String(sourcePath ?? ""));
    const sourceStat = await stat(source);
    if (!sourceStat.isFile()) continue;
    const target = await createAvailableImportPath(root, basename(source));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    imported.push({
      name: basename(target),
      path: toRelativeFilePath(root, target),
      absolutePath: target,
      size: sourceStat.size,
      extension: extname(target),
    });
  }
  return imported;
}
