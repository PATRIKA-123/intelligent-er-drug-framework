"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { clinicalAudit, createAuditEvent, resourceType } = require("./middleware/clinicalAudit");

test("B26 redacts path, identifiers, tokens and sensitive inputs", () => {
  const fake = createAuditEvent({ method: "GET", pathname: "/api/stays/123?token=secret", statusCode: 403,
    user: { user_id: 77, role: "DOCTOR", token: "secret", password: "secret" } });
  assert.equal(fake.resource_type, "stay");
  assert.equal(fake.outcome, "DENIED");
  assert.equal(fake.actor_id, 77);
  for (const forbidden of ["secret", "123", "token", "password", "pathname", "path", "url"]) {
    assert.equal(JSON.stringify(fake).includes(`\"${forbidden}\"`), false);
  }
});
test("B26 excludes unrelated and fake-prefix paths", () => {
  assert.equal(resourceType("/api/stays-other/88"), null);
  assert.equal(resourceType("/api/auth/login"), null);
  assert.equal(resourceType("/api/post-er/4"), "post_er");
});
test("B26 middleware captures effective status and resolved user at response finish", () => {
  const req = { path: "/api/decision-support/123", method: "POST", user: undefined };
  const res = new EventEmitter(); res.statusCode = 403;
  const old = console.info; const records = [];
  console.info = x => records.push(JSON.parse(x));
  try {
    let called = false; clinicalAudit(req, res, () => { called = true; });
    assert.equal(called, true);
    req.user = { user_id: 4, role: "PATIENT" };
    res.emit("finish");
    assert.equal(records.length, 1);
    assert.equal(records[0].outcome, "DENIED");
    assert.equal(records[0].actor_role, "PATIENT");
    assert.equal(records[0].resource_type, "decision_support");
  } finally { console.info = old; }
});
