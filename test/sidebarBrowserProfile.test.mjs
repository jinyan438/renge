import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSidebarBrowserImport,
  selectCredentialForUrl,
} from "../electron/sidebar-browser-profile.mjs";

test("parses Chromium cookie JSON into Electron cookie details", () => {
  const result = parseSidebarBrowserImport("cookies.json", JSON.stringify([
    {
      domain: ".example.com",
      expirationDate: 1_900_000_000,
      httpOnly: true,
      name: "session",
      path: "/account",
      sameSite: "no_restriction",
      secure: true,
      value: "abc",
    },
  ]));

  assert.equal(result.credentials.length, 0);
  assert.deepEqual(result.cookies, [{
    domain: ".example.com",
    expirationDate: 1_900_000_000,
    httpOnly: true,
    name: "session",
    path: "/account",
    sameSite: "no_restriction",
    secure: true,
    url: "https://example.com/account",
    value: "abc",
  }]);
});

test("parses quoted Chromium password CSV exports", () => {
  const result = parseSidebarBrowserImport(
    "passwords.csv",
    'name,url,username,password,note\n"Example, Inc",https://example.com/login,user@example.com,"p,a"\n',
  );

  assert.equal(result.cookies.length, 0);
  assert.deepEqual(result.credentials, [{
    name: "Example, Inc",
    origin: "https://example.com",
    password: "p,a",
    url: "https://example.com/login",
    username: "user@example.com",
  }]);
});

test("normalizes cookie booleans and ISO expiration values from CSV", () => {
  const result = parseSidebarBrowserImport(
    "cookies.csv",
    "name,value,domain,path,secure,httpOnly,expires\nsid,abc,example.com,/,FALSE,TRUE,2030-01-01T00:00:00.000Z\n",
  );
  assert.equal(result.cookies[0].secure, false);
  assert.equal(result.cookies[0].httpOnly, true);
  assert.equal(result.cookies[0].url, "http://example.com/");
  assert.equal(result.cookies[0].expirationDate, 1_893_456_000);
});

test("selects imported credentials only for the matching origin", () => {
  const credentials = [
    { origin: "https://example.com", username: "one" },
    { origin: "https://other.example", username: "two" },
  ];
  assert.equal(selectCredentialForUrl(credentials, "https://example.com/login")?.username, "one");
  assert.equal(selectCredentialForUrl(credentials, "http://example.com/login"), null);
  assert.equal(selectCredentialForUrl(credentials, "not a url"), null);
});
