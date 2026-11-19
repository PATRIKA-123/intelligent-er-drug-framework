"use strict";
// B01: deterministic authorization matrix; no database credentials or live data.
// Run from repository root: node --test backend/test-b01-access-matrix.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const originalLoad = Module._load;
let queries = [];
let grant = false;
const db = {
  async query(sql, params) {
    queries.push({ sql: String(sql), params });
    return { rows: grant ? [{ exists: 1 }] : [], rowCount: grant ? 1 : 0 };
  },
};
const policyPath = require.resolve("./services/accessPolicy");
let policy;
try {
  Module._load = function (request, parent, ...rest) {
    if (parent && path.resolve(parent.filename) === policyPath) {
      if (request === "../db") return db;
      if (request === "./schemaCapabilities") return { hasColumn: async () => true };
    }
    return originalLoad.call(this, request, parent, ...rest);
  };
  delete require.cache[policyPath];
  policy = require(policyPath);
} finally {
  Module._load = originalLoad;
  delete require.cache[policyPath];
}
const user = (role, id) => ({ role, user_id: id });
function reset(allowed) { grant = allowed; queries = []; }

for (const [role, id] of [["PATIENT", 11], ["PARAMEDIC", 12], ["ER_STAFF", 13], ["DOCTOR", 14]]) {
  test(`${role}: unrelated stay denied, related stay allowed, scoped SQL`, async () => {
    reset(false);
    assert.equal(await policy.canAccessStay(user(role,id), 57), false);
    assert.ok(queries.length > 0, "must check database relationship");
    assert.ok(queries.every(q => q.params.some(p => p === id || (Array.isArray(p) && p.length > 0))), "parameters must include current user or scoped status");
    if (role !== "ER_STAFF") {
      assert.ok(queries.some(q => q.params.includes(id)), "user identity must be in relationship check");
    }
    reset(true);
    assert.equal(await policy.canAccessStay(user(role,id), 57), true);
  });
}

test("PATIENT cannot read Pre-ER case details", async () => {
  reset(true);
  assert.equal(await policy.canAccessCase(user("PATIENT", 11), 97), false);
});

test("PARAMEDIC case access requires creator relationship", async () => {
  reset(false);
  assert.equal(await policy.canAccessCase(user("PARAMEDIC", 12), 97), false);
  assert.ok(queries[0].sql.includes("created_by"));
  assert.ok(queries[0].params.includes(12));
  reset(true);
  assert.equal(await policy.canAccessCase(user("PARAMEDIC", 12), 97), true);
});

test("DOCTOR case access requires active stay assignment", async () => {
  reset(false);
  assert.equal(await policy.canAccessCase(user("DOCTOR", 14), 97), false);
  assert.ok(queries.some(q => /stay_doctor_assignments/.test(q.sql)));
  assert.ok(queries.some(q => q.params.includes(14)));
  reset(true);
  assert.equal(await policy.canAccessCase(user("DOCTOR", 14), 97), true);
});

test("ER_STAFF case access includes only live statuses by default", async () => {
  reset(false);
  await policy.canAccessCase(user("ER_STAFF", 13), 97);
  assert.deepEqual(queries[0].params[1], ["ARRIVED_ER", "ACTIVE_ER"]);
});

test("unsupported roles and invalid identifiers fail closed", async () => {
  reset(true);
  for (const role of ["UNKNOWN", "", undefined]) {
    assert.equal(await policy.canAccessStay(user(role, 1), 57), false);
    assert.equal(await policy.canAccessCase(user(role, 1), 97), false);
  }
  for (const id of [0, -1, "abc", null]) {
    assert.equal(await policy.canAccessStay(user("ADMIN", 1), id), false);
    assert.equal(await policy.canAccessCase(user("ADMIN", 1), id), false);
  }
});

test("list filters remain scoped for every non-admin role", async () => {
  for (const role of ["PATIENT", "PARAMEDIC", "DOCTOR", "ER_STAFF"]) {
    reset(false);
    const filter = await policy.stayListFilter(user(role, 77));
    assert.ok(filter.clause && filter.clause !== "TRUE");
    assert.ok(Array.isArray(filter.params) && filter.params.length > 0);
  }
  assert.equal((await policy.stayListFilter(user("UNKNOWN",77))).clause, "FALSE");
});

test("access middleware rejects unauthorized stay before controller", async () => {
  reset(false);
  let nextCalled = false;
  let status = null;
  const req = { user: user("PATIENT",11), params: { stay_id: "57" }, method: "GET", originalUrl: "/api/stays/57" };
  const res = { status(n) { status=n; return this; }, json() { return this; } };
  const oldWarn = console.warn;
  try {
    console.warn = () => {};
    await policy.requireStayAccess()(req, res, () => { nextCalled = true; });
  } finally { console.warn = oldWarn; }
  assert.equal(status, 403);
  assert.equal(nextCalled, false);
});
