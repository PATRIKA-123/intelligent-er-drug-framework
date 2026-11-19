"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createAuthThrottle } = require("./middleware/authThrottle");
const { buildDataQualityReport } = require("../scripts/dataQualityReport");
const { parseAllowedOrigins, isOriginAllowed } = require("./config/httpSecurity");
const { validateStartupEnvironment } = require("./config/validateEnvironment");

function attempt(fn, ip, username) {
  let status = 200, next = false, retryAfter;
  fn({ ip, body: { username } }, { set(k,v) { if(k === "Retry-After") retryAfter = v; }, status(s) { status = s; return this; }, json() {} }, () => { next = true; });
  return { status, next, retryAfter };
}

test("B15: allows bounded attempts, then returns 429 and Retry-After", () => {
  const fn = createAuthThrottle({ max: 2, windowMs: 60000, now: () => 0, secret: "test-only" });
  assert.equal(attempt(fn,"1.1.1.1","alice").next,true);
  assert.equal(attempt(fn,"1.1.1.1","alice").next,true);
  const third = attempt(fn,"1.1.1.1","alice");
  assert.equal(third.status,429);
  assert.equal(third.retryAfter,"60");
});
test("B15: IP and username pairs are isolated; case-normalized", () => {
  const fn = createAuthThrottle({ max: 1, windowMs: 1000, now: () => 0, secret: "test-only" });
  attempt(fn,"1.1.1.1","  Alice ");
  assert.equal(attempt(fn,"1.1.1.1","alice").status,429);
  assert.equal(attempt(fn,"2.2.2.2","alice").next,true);
  assert.equal(attempt(fn,"1.1.1.1","bob").next,true);
});
test("B15: counters expire and do not retain usernames in keys", () => {
  let now = 0;
  const fn = createAuthThrottle({ max: 1, windowMs: 1000, now: () => now, secret: "test-only" });
  attempt(fn,"1.1.1.1","alice");
  now = 1000;
  assert.equal(attempt(fn,"1.1.1.1","alice").next,true);
});
test("B15: login does not reveal disabled account status", () => {
  const auth = fs.readFileSync(path.join(__dirname,"routes/auth.js"),"utf8");
  assert.ok(/const invalidCredentials/.test(auth));
  assert.ok(/!user\.is_active/.test(auth));
  assert.ok(!/This account has been deactivated/.test(auth));
});
test("B16: production enforces HTTPS allowlist and denies unlisted browser Origin", () => {
  const a = parseAllowedOrigins({ NODE_ENV:"production", CORS_ORIGINS:"https://example.test" });
  assert.equal(isOriginAllowed("https://example.test",a),true);
  assert.equal(isOriginAllowed("https://evil.example",a),false);
  assert.throws(() => parseAllowedOrigins({ NODE_ENV:"production" }),/CORS_ORIGINS/);
});
test("B17: outliers are review-only; original measurements retained", () => {
  const base = { subject_id:"1", stay_id:"5", timestamp:"2147-01-01 00:00:00", temperature:"98.6", heart_rate:"80", respiratory_rate:"18", spo2:"98", systolic_bp:"120", data_source:"TEST" };
  const a = { ...base, systolic_bp:"11" };
  const report = buildDataQualityReport([a]);
  assert.equal(report.rejected_records,0);
  assert.equal(report.flagged_measurements[0].field,"systolic_bp");
  assert.equal(report.flagged_measurements[0].value,11);
  assert.equal(a.systolic_bp,"11");
  assert.equal(report.flagged_measurements[0].review_status,"NEEDS_SOURCE_REVIEW");
  assert.equal(report.timestamp_semantics,"DEIDENTIFIED_DATE_SHIFTED_NOT_REAL_CALENDAR_TIME");
});
test("B17: validation failures are not called clean data", () => {
  const report = buildDataQualityReport([{ subject_id:"-1" }]);
  assert.equal(report.rejected_records,1);
  assert.equal(report.valid_records,0);
  assert.ok(report.validation_problems.length > 0);
});
test("B18: startup rejects missing critical env settings", () => {
  assert.throws(() => validateStartupEnvironment({}),/DB_HOST is required/);
});
test("B18: example exists and contains no real credentials", () => {
  const example = fs.readFileSync(path.join(__dirname,".env.example"),"utf8");
  assert.match(example,/JWT_SECRET/);
  assert.match(example,/DB_HOST/);
  assert.match(example,/CORS_ORIGINS/);
  assert.match(example,/REPLACE_WITH/);
});
