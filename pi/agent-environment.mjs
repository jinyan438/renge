import { join, resolve } from "node:path";

// SDK helpers used inside third-party extensions read PI_CODING_AGENT_DIR,
// while embedded resource loaders also accept an explicit agentDir. Keep the
// application entry points consistent without changing the global Pi CLI data.
export function configurePiAgentEnvironment(dataDir) {
  const agentDir = resolve(process.env.PI_CODING_AGENT_DIR || join(dataDir, ".pi", "agent"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return agentDir;
}
