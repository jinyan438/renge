const packageManagerNames = new Set(["npm", "pnpm", "yarn"]);
const packageManagerOutputTokens = new Set([
  "err",
  "err!",
  "error",
  "http",
  "notice",
  "silly",
  "timing",
  "verbose",
  "warn",
  "warning",
]);

export function splitCommandLine(commandLine) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;

  while ((match = pattern.exec(String(commandLine ?? "")))) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }

  return tokens;
}

function unwrapCommandLine(value) {
  if (value.startsWith('\\"') && value.endsWith('\\"') && value.length >= 4) {
    return value.slice(2, -2).replace(/\\"/g, '"');
  }
  if (value.startsWith("\\'") && value.endsWith("\\'") && value.length >= 4) {
    return value.slice(2, -2).replace(/\\'/g, "'");
  }

  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote || value.length < 2) {
    return null;
  }

  if (quote === '"') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Fall back to removing one wrapper below.
    }
  }
  return value.slice(1, -1);
}

export function normalizeCommandLine(commandLine, whitelistedCommandNames = []) {
  const original = String(commandLine ?? "").trim();
  const allowedNames = new Set(
    Array.from(whitelistedCommandNames, (name) => String(name).trim().toLowerCase()),
  );
  let candidate = original;

  for (let depth = 0; depth < 3; depth += 1) {
    const inner = unwrapCommandLine(candidate);
    if (inner === null) break;
    candidate = inner.trim();
    const commandName = splitCommandLine(candidate)[0]?.toLowerCase() ?? "";
    if (allowedNames.has(commandName)) return candidate;
  }

  return original;
}

export function looksLikePackageManagerOutput(command, args = []) {
  const commandName = String(command ?? "").trim().toLowerCase();
  if (!packageManagerNames.has(commandName)) return false;
  const firstArg = String(args[0] ?? "")
    .trim()
    .toLowerCase()
    .replace(/[:：]+$/, "");
  return packageManagerOutputTokens.has(firstArg);
}

export function createCommandApprovalSessionStore() {
  const approvedSessionIds = new Set();
  const normalizeSessionId = (sessionId) => String(sessionId ?? "").trim();

  return {
    approve(sessionId) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) return false;
      approvedSessionIds.add(normalizedSessionId);
      return true;
    },
    has(sessionId) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      return Boolean(normalizedSessionId) && approvedSessionIds.has(normalizedSessionId);
    },
  };
}
