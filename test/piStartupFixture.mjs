import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function seedColdPiSession(root, owner = "startup-stress", scopes = ["main-text"], cwd = resolve(".")) {
  const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 24);
  const directory = join(root, ".pi", "sessions", hash(owner));
  await mkdir(directory, { recursive: true });
  const header = { type: "session", version: 3, id: owner, timestamp: new Date().toISOString(), cwd };
  const text = "NATIVE_HISTORY " + "x".repeat(1_000_000);
  const entries = Array.from({ length: 48 }, (_, index) => ({ type: "message", id: `history-${index}`, parentId: index ? `history-${index - 1}` : null,
    timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() } }));
  const jsonl = [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  for (const scope of scopes) await writeFile(join(directory, `${hash(`${cwd}\0${owner}\0${scope}`)}.jsonl`), jsonl);
}
