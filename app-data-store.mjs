import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
const appDataBackupCount = 3;
const completeBackupManagedRoots = [".pi", "extensions", "generated-images", "session-images", "skills", "tavern-files", "tavern-script-assets"];
const appDataWriteQueues = new Map();
const validatedAppDataFiles = new Map();
const primarySnapshots = new Map();
const serializedValues = new WeakMap();
function isMissingFileError(error) { return error?.code === "ENOENT"; }

function parseAppDataContent(content) {
  if (!content.trim()) throw new Error("应用数据文件为空");
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("应用数据必须是 JSON 对象");
  }
  return parsed;
}

function getAppDataBackupPath(dataFilePath, index) {
  return join(dirname(dataFilePath), `app-data.backup-${index}.json`);
}

async function readAppDataFile(dataFilePath) {
  const signature = await getAppDataFileSignature(dataFilePath);
  const cached = primarySnapshots.get(dataFilePath);
  if (cached?.signature === signature) return cached.data;
  const parsed = parseAppDataContent(await readFile(dataFilePath, "utf8"));
  validatedAppDataFiles.set(dataFilePath, signature);
  if (dataFilePath.endsWith("app-data.json")) primarySnapshots.set(dataFilePath, { signature, data: parsed });
  return parsed;
}

async function getAppDataFileSignature(dataFilePath) {
  const fileStat = await stat(dataFilePath);
  return `${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}`;
}

async function ensureAppDataFileValidated(dataFilePath) {
  const signature = await getAppDataFileSignature(dataFilePath);
  if (validatedAppDataFiles.get(dataFilePath) === signature) return signature;
  await readAppDataFile(dataFilePath);
  return validatedAppDataFiles.get(dataFilePath);
}

function validateAppData(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("应用数据必须是 JSON 对象");
  }
}

function encodeValue(value) {
  if (value && typeof value === "object") {
    const cached = serializedValues.get(value);
    if (cached) return cached;
    const bytes = Buffer.from(JSON.stringify(value) ?? "null");
    serializedValues.set(value, bytes);
    return bytes;
  }
  return Buffer.from(JSON.stringify(value) ?? "null");
}

// Reuse immutable message buffers and let disk backpressure bound allocations.
// Rebuilding one enormous JSON string on every checkpoint causes large GCs even
// in a worker and competes with the compositor for CPU and memory bandwidth.
function* serializeAppDataChunks(payload) {
  yield Buffer.from("{");
  let field = 0;
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    yield Buffer.from(`${field++ ? "," : ""}${JSON.stringify(key)}:`);
    if (key !== "chatSessions" || !Array.isArray(value)) { yield encodeValue(value); continue; }
    yield Buffer.from("[");
    for (let index = 0; index < value.length; index++) {
      if (index) yield Buffer.from(",");
      const session = value[index];
      if (!session || typeof session !== "object" || Array.isArray(session)) { yield encodeValue(session); continue; }
      yield Buffer.from("{");
      let sessionField = 0;
      for (const [name, content] of Object.entries(session)) {
        if (content === undefined) continue;
        yield Buffer.from(`${sessionField++ ? "," : ""}${JSON.stringify(name)}:`);
        if (name !== "messages" || !Array.isArray(content)) { yield encodeValue(content); continue; }
        yield Buffer.from("[");
        for (let message = 0; message < content.length; message++) {
          if (message) yield Buffer.from(",");
          yield encodeValue(content[message]);
        }
        yield Buffer.from("]");
      }
      yield Buffer.from("}");
    }
    yield Buffer.from("]");
  }
  yield Buffer.from("}");
}

async function writeAppDataFileAtomically(dataFilePath, payload) {
  validateAppData(payload);
  await mkdir(dirname(dataFilePath), { recursive: true });
  const temporaryPath = `${dataFilePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await pipeline(Readable.from(serializeAppDataChunks(payload), { objectMode: false }), createWriteStream(temporaryPath));
    await rename(temporaryPath, dataFilePath);
    const signature = await getAppDataFileSignature(dataFilePath);
    validatedAppDataFiles.set(dataFilePath, signature);
    primarySnapshots.set(dataFilePath, { signature, data: payload });
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function copyAppDataFileAtomically(sourcePath, destinationPath) {
  await mkdir(dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await copyFile(sourcePath, temporaryPath);
    await rm(destinationPath, { force: true });
    await rename(temporaryPath, destinationPath);
    validatedAppDataFiles.set(
      destinationPath,
      await getAppDataFileSignature(destinationPath),
    );
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function rotateAppDataBackups(dataFilePath) {
  try {
    await ensureAppDataFileValidated(dataFilePath);
  } catch {
    return;
  }
  for (let index = appDataBackupCount; index >= 2; index -= 1) {
    const sourcePath = getAppDataBackupPath(dataFilePath, index - 1);
    const destinationPath = getAppDataBackupPath(dataFilePath, index);
    try {
      await ensureAppDataFileValidated(sourcePath);
      await rm(destinationPath, { force: true });
      await rename(sourcePath, destinationPath);
      validatedAppDataFiles.delete(sourcePath);
      validatedAppDataFiles.set(
        destinationPath,
        await getAppDataFileSignature(destinationPath),
      );
    } catch (error) {
      validatedAppDataFiles.delete(sourcePath);
      if (!isMissingFileError(error)) {
        // Invalid backups cannot replace an older valid recovery generation.
      }
    }
  }
  try {
    await copyAppDataFileAtomically(dataFilePath, getAppDataBackupPath(dataFilePath, 1));
  } catch (error) {
    if (!isMissingFileError(error)) {
      // A failed backup must not prevent the new primary snapshot from being saved.
    }
  }
}

export async function readAppData(dataFilePath) {
  let primaryError = null;
  try {
    return await readAppDataFile(dataFilePath);
  } catch (error) {
    primaryError = error;
  }

  for (let index = 1; index <= appDataBackupCount; index += 1) {
    try {
      const backup = await readAppDataFile(getAppDataBackupPath(dataFilePath, index));
      await writeAppDataFileAtomically(dataFilePath, backup).catch(() => undefined);
      return backup;
    } catch {
      // Try the next backup generation.
    }
  }

  if (isMissingFileError(primaryError)) return {};
  throw primaryError;
}

export async function writeAppData(dataFilePath, payloadOrUpdater) {
  const previousWrite = appDataWriteQueues.get(dataFilePath) ?? Promise.resolve();
  const operation = previousWrite
    .catch(() => undefined)
    .then(async () => {
      const payload = typeof payloadOrUpdater === "function"
        ? await payloadOrUpdater(await readAppData(dataFilePath))
        : payloadOrUpdater;
      validateAppData(payload);
      await rotateAppDataBackups(dataFilePath);
      await writeAppDataFileAtomically(dataFilePath, payload);
    });
  appDataWriteQueues.set(dataFilePath, operation);
  try {
    await operation;
  } finally {
    if (appDataWriteQueues.get(dataFilePath) === operation) {
      appDataWriteQueues.delete(dataFilePath);
    }
  }
}

export async function clearAppData(dataFilePath) {
  const previousWrite = appDataWriteQueues.get(dataFilePath) ?? Promise.resolve();
  const operation = previousWrite
    .catch(() => undefined)
    .then(async () => {
      const dataDirectory = dirname(dataFilePath);
      const ownedFiles = [
        dataFilePath,
        ...Array.from({ length: appDataBackupCount }, (_, index) =>
          getAppDataBackupPath(dataFilePath, index + 1),
        ),
        join(dataDirectory, "app-data.previous.json"),
        join(dataDirectory, "app-data.previous.json.bak"),
        `${dataFilePath}.bak`,
        join(dataDirectory, "desktop-project-positions.json"),
      ];
      const dataDirectoryEntries = await readdir(dataDirectory).catch(() => []);
      dataDirectoryEntries
        .filter((name) => name.startsWith("app-data") && name.includes(".tmp-"))
        .forEach((name) => ownedFiles.push(join(dataDirectory, name)));
      await Promise.all(
        ownedFiles.map((filePath) => rm(filePath, { force: true })),
      );
      ownedFiles.forEach((filePath) => validatedAppDataFiles.delete(filePath));
      primarySnapshots.delete(dataFilePath);
      await Promise.all(
        ["app-data-assets", "roleplay-memory", ...completeBackupManagedRoots].map((name) =>
          rm(join(dataDirectory, name), { recursive: true, force: true }),
        ),
      );
    });
  appDataWriteQueues.set(dataFilePath, operation);
  try {
    await operation;
  } finally {
    if (appDataWriteQueues.get(dataFilePath) === operation) {
      appDataWriteQueues.delete(dataFilePath);
    }
  }
}
