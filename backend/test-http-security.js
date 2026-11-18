"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseAllowedOrigins, isOriginAllowed, applyApiSecurityHeaders,
  ALLOWED_HEADERS, ALLOWED_METHODS,
} = require("./config/httpSecurity");

test("B16: local development defaults to Vite origins", () => {
  const origins = parseAllowedOrigins({ NODE_ENV: "development" });
  assert.equal(origins.has("http://localhost:5173"), true);
  assert.equal(origins.has("http://127.0.0.1:5173"), true);
});
test("B16: production fails closed when origin list missing", () => {
  assert.throws(() => parseAllowedOrigins({ NODE_ENV: "production" }), /CORS_ORIGINS/);
});
test("B16: production allows exact HTTPS origins only", () => {
  const origins = parseAllowedOrigins({ NODE_ENV: "production", CORS_ORIGINS: "https://parvah.example, https://staging.parvah.example" });
  assert.equal(isOriginAllowed("https://parvah.example", origins), true);
  assert.equal(isOriginAllowed("https://sub.parvah.example", origins), false);
  assert.equal(isOriginAllowed("https://parvah.example.evil.test", origins), false);
});
test("B16: reject opaque browser origin", () => {
  assert.equal(isOriginAllowed("null", new Set(["https://parvah.example"])), false);
});
test("B16: direct clients without an Origin header remain supported", () => {
  assert.equal(isOriginAllowed(undefined, new Set()), true);
});
test("B16: reject wildcard and null configuration", () => {
  for (const origin of ["*", "null"]) {
    assert.throws(() => parseAllowedOrigins({ CORS_ORIGINS: origin }), /wildcard or null/);
  }
});
test("B16: reject origins with path, slash, query, user info, or invalid scheme", () => {
  for (const origin of ["https://parvah.example/", "https://parvah.example/login", "https://parvah.example?q=1", "https://u:p@parvah.example", "file:///tmp/x", "parvah.example"]) {
    assert.throws(() => parseAllowedOrigins({ CORS_ORIGINS: origin }));
  }
});
test("B16: require https for external production frontends", () => {
  assert.throws(() => parseAllowedOrigins({ NODE_ENV: "production", CORS_ORIGINS: "http://parvah.example" }), /HTTPS/);
});
test("B16: production may explicitly allow localhost for local testing", () => {
  assert.equal(parseAllowedOrigins({ NODE_ENV: "production", CORS_ORIGINS: "http://localhost:5173" }).size, 1);
});
test("B16: rejects non-canonical origins", () => {
  assert.throws(() => parseAllowedOrigins({ CORS_ORIGINS: "https://parvah.example:443" }), /exact http/);
});
test("B16: security headers include privacy, anti-sniff and anti-framing", () => {
  const headers = {};
  let called = false;
  applyApiSecurityHeaders({}, { setHeader: (key, value) => { headers[key] = value; } }, () => { called = true; });
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(called, true);
});
test("B16: preflight contract includes Authorization and JSON methods", () => {
  assert.equal(ALLOWED_HEADERS.includes("Authorization"), true);
  assert.equal(ALLOWED_HEADERS.includes("Content-Type"), true);
  for (const method of ["GET", "POST", "PATCH", "OPTIONS"]) assert.equal(ALLOWED_METHODS.includes(method), true);
});
