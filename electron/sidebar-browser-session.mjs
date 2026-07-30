function normalizeCookiePath(path) {
  const value = String(path ?? "").trim();
  return value.startsWith("/") ? value : "/";
}

function getCookieKey(cookie) {
  return [
    String(cookie?.domain ?? "").trim().toLowerCase(),
    normalizeCookiePath(cookie?.path),
    String(cookie?.name ?? ""),
  ].join("\u0000");
}

export function createPersistentCookieSetDetails(cookie, nowSeconds = Date.now() / 1000) {
  if (!cookie || typeof cookie !== "object" || cookie.session) return null;
  const domain = String(cookie.domain ?? "").trim();
  const host = domain.replace(/^\./, "");
  const name = String(cookie.name ?? "");
  const expirationDate = Number(cookie.expirationDate);
  if (!host || !name || !Number.isFinite(expirationDate) || expirationDate <= nowSeconds) {
    return null;
  }

  const path = normalizeCookiePath(cookie.path);
  const details = {
    expirationDate,
    httpOnly: Boolean(cookie.httpOnly),
    name,
    path,
    sameSite: cookie.sameSite,
    secure: Boolean(cookie.secure),
    url: `${cookie.secure ? "https" : "http"}://${host}${path}`,
    value: String(cookie.value ?? ""),
  };
  if (!cookie.hostOnly) details.domain = domain;
  return details;
}

export async function copyMissingPersistentCookies(
  sourceCookies,
  targetCookies,
  nowSeconds = Date.now() / 1000,
) {
  const [source, target] = await Promise.all([
    sourceCookies.get({}),
    targetCookies.get({}),
  ]);
  const targetKeys = new Set(target.map(getCookieKey));
  let copied = 0;
  let eligible = 0;
  let failed = 0;

  for (const cookie of source) {
    const details = createPersistentCookieSetDetails(cookie, nowSeconds);
    if (!details) continue;
    eligible += 1;
    const key = getCookieKey(cookie);
    if (targetKeys.has(key)) continue;
    try {
      await targetCookies.set(details);
      targetKeys.add(key);
      copied += 1;
    } catch {
      failed += 1;
    }
  }

  return { copied, eligible, failed };
}
