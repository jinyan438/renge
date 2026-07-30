import assert from "node:assert/strict";
import test from "node:test";
import {
  copyMissingPersistentCookies,
  createPersistentCookieSetDetails,
} from "../electron/sidebar-browser-session.mjs";

test("builds persistent cookie details without extending expired or session cookies", () => {
  assert.equal(createPersistentCookieSetDetails({ domain: ".example.com", name: "session", session: true }), null);
  assert.equal(
    createPersistentCookieSetDetails({
      domain: ".example.com",
      expirationDate: 90,
      name: "expired",
      session: false,
    }, 100),
    null,
  );
  assert.deepEqual(
    createPersistentCookieSetDetails({
      domain: ".example.com",
      expirationDate: 200,
      hostOnly: false,
      httpOnly: true,
      name: "auth",
      path: "/account",
      sameSite: "lax",
      secure: true,
      session: false,
      value: "token",
    }, 100),
    {
      domain: ".example.com",
      expirationDate: 200,
      httpOnly: true,
      name: "auth",
      path: "/account",
      sameSite: "lax",
      secure: true,
      url: "https://example.com/account",
      value: "token",
    },
  );
});

test("copies only missing persistent cookies into the global browser store", async () => {
  const written = [];
  const targetCookies = {
    get: async () => [{ domain: ".example.com", name: "existing", path: "/" }],
    set: async (details) => written.push(details),
  };
  const sourceCookies = {
    get: async () => [
      {
        domain: ".example.com",
        expirationDate: 200,
        hostOnly: false,
        name: "existing",
        path: "/",
        sameSite: "lax",
        session: false,
        value: "old",
      },
      {
        domain: ".example.com",
        expirationDate: 200,
        hostOnly: false,
        name: "login",
        path: "/",
        sameSite: "no_restriction",
        secure: true,
        session: false,
        value: "persisted",
      },
    ],
  };

  assert.deepEqual(
    await copyMissingPersistentCookies(sourceCookies, targetCookies, 100),
    { copied: 1, eligible: 2, failed: 0 },
  );
  assert.equal(written.length, 1);
  assert.equal(written[0].name, "login");
});
