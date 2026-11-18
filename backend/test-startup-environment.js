"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateStartupEnvironment } = require("./config/validateEnvironment");

const valid = () => ({
  DB_HOST: "localhost", DB_NAME: "parvah_test", DB_USER: "test_user",
  DB_PASSWORD: "test-only-not-a-real-password", JWT_SECRET: "A".repeat(48),
  PORT: "5000", DB_PORT: "5432", DB_SSL: "false",
});

test("B18 accepts complete local configuration", () => {
  assert.equal(validateStartupEnvironment(valid()), true);
});
test("B18 accepts hosting provider PORT", () => {
  assert.equal(validateStartupEnvironment({ ...valid(), PORT: "10000", DB_SSL: "true" }), true);
});
test("B18 rejects missing secrets without exposing their values", () => {
  const env = valid(); delete env.JWT_SECRET;
  assert.throws(() => validateStartupEnvironment(env), /JWT_SECRET is required/);
});
test("B18 rejects short secrets", () => {
  assert.throws(() => validateStartupEnvironment({ ...valid(), JWT_SECRET: "short" }), /at least 32/);
});
test("B18 rejects missing DB settings", () => {
  const env = valid(); delete env.DB_HOST; delete env.DB_PASSWORD;
  assert.throws(() => validateStartupEnvironment(env), /DB_HOST is required; DB_PASSWORD is required/);
});
test("B18 rejects placeholders", () => {
  const env = { ...valid(), DB_PASSWORD: "your_password", JWT_SECRET: "replace_with_real_secret_long_enough" };
  assert.throws(() => validateStartupEnvironment(env), /placeholder/);
});
test("B18 rejects invalid ports", () => {
  for (const port of ["0", "65536", "abc", "5000x", "-1", "123.4"]) {
    assert.throws(() => validateStartupEnvironment({ ...valid(), PORT: port }), /PORT/);
  }
});
test("B18 rejects invalid DB_SSL", () => {
  assert.throws(() => validateStartupEnvironment({ ...valid(), DB_SSL: "yes" }), /DB_SSL/);
});
test("B18 error messages must not contain secret contents", () => {
  const secret = "my-short-password";
  let message = "";
  try { validateStartupEnvironment({ ...valid(), DB_PASSWORD: secret, JWT_SECRET: "bad" }); }
  catch (e) { message = e.message; }
  assert.ok(message.includes("JWT_SECRET"));
  assert.ok(!message.includes(secret));
});
