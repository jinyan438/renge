function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value.trim()));
}

function csvRecords(content) {
  const rows = parseCsvRows(String(content ?? "").replace(/^\uFEFF/, ""));
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  return rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ""]),
  ));
}

function normalizeCredential(candidate) {
  const url = String(candidate?.url ?? candidate?.origin ?? candidate?.website ?? "").trim();
  const username = String(candidate?.username ?? candidate?.user ?? candidate?.login ?? "");
  const password = String(candidate?.password ?? candidate?.pass ?? "");
  if (!url || !password) return null;
  let parsed;
  try {
    parsed = new URL(url.includes("://") ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  return {
    name: String(candidate?.name ?? candidate?.title ?? parsed.hostname).trim() || parsed.hostname,
    origin: parsed.origin,
    url: parsed.href,
    username,
    password,
  };
}

function normalizeSameSite(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[-_ ]/g, "");
  if (normalized === "none" || normalized === "norestriction") return "no_restriction";
  if (normalized === "lax") return "lax";
  if (normalized === "strict") return "strict";
  return "unspecified";
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["1", "true", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function normalizeCookie(candidate) {
  const name = String(candidate?.name ?? "").trim();
  const value = String(candidate?.value ?? "");
  const domain = String(candidate?.domain ?? candidate?.host ?? "").trim();
  const explicitUrl = String(candidate?.url ?? "").trim();
  if (!name || (!domain && !explicitUrl)) return null;
  let url = explicitUrl;
  if (!url) {
    const host = domain.replace(/^\./, "");
    url = `${normalizeBoolean(candidate?.secure) ? "https" : "http"}://${host}${String(candidate?.path ?? "/") || "/"}`;
  }
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    url = parsed.href;
  } catch {
    return null;
  }
  const details = {
    url,
    name,
    value,
    path: String(candidate?.path ?? "/") || "/",
    secure: normalizeBoolean(candidate?.secure),
    httpOnly: normalizeBoolean(candidate?.httpOnly ?? candidate?.httponly),
    sameSite: normalizeSameSite(candidate?.sameSite ?? candidate?.samesite),
  };
  if (domain) details.domain = domain;
  const rawExpiration = candidate?.expirationDate ?? candidate?.expires ?? candidate?.expiration ?? 0;
  let expirationDate = Number(rawExpiration);
  if (!Number.isFinite(expirationDate) && rawExpiration) {
    expirationDate = Date.parse(String(rawExpiration)) / 1000;
  }
  if (Number.isFinite(expirationDate) && expirationDate > 0 && !normalizeBoolean(candidate?.session)) {
    details.expirationDate = expirationDate > 10_000_000_000
      ? expirationDate / 1000
      : expirationDate;
  }
  return details;
}

export function parseSidebarBrowserImport(fileName, content) {
  const lowerName = String(fileName ?? "").toLowerCase();
  let cookieCandidates = [];
  let credentialCandidates = [];

  if (lowerName.endsWith(".csv")) {
    const records = csvRecords(content);
    const isPasswordExport = records.some((record) =>
      Object.prototype.hasOwnProperty.call(record, "password")
      || Object.prototype.hasOwnProperty.call(record, "username"));
    if (isPasswordExport) credentialCandidates = records;
    else cookieCandidates = records;
  } else {
    const parsed = JSON.parse(String(content ?? "").replace(/^\uFEFF/, ""));
    if (Array.isArray(parsed)) {
      const looksLikePasswords = parsed.some((item) => item && typeof item === "object" && "password" in item);
      if (looksLikePasswords) credentialCandidates = parsed;
      else cookieCandidates = parsed;
    } else if (parsed && typeof parsed === "object") {
      cookieCandidates = Array.isArray(parsed.cookies) ? parsed.cookies : [];
      credentialCandidates = Array.isArray(parsed.passwords)
        ? parsed.passwords
        : Array.isArray(parsed.credentials) ? parsed.credentials : [];
    }
  }

  return {
    cookies: cookieCandidates.map(normalizeCookie).filter(Boolean),
    credentials: credentialCandidates.map(normalizeCredential).filter(Boolean),
  };
}

export function selectCredentialForUrl(credentials, rawUrl) {
  let origin;
  try {
    origin = new URL(rawUrl).origin;
  } catch {
    return null;
  }
  return credentials.find((credential) => credential?.origin === origin) ?? null;
}
