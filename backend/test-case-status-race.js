"use strict";
// B12 regression test: a status change must not overwrite a concurrent change.
// No database: the pool, auth and access checks are replaced with stubs.
// Run: node test-case-status-race.js
const assert = require("assert");
const path = require("path");

const calls = [];
let updateRowCount = 1;
const stubs = {
  "./db": { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/^\s*SELECT/i.test(sql)) return { rows: [{ case_id: 7, case_status: "ARRIVED_ER" }], rowCount: 1 };
    return { rows: updateRowCount ? [{ case_id: 7, case_status: params[0] }] : [], rowCount: updateRowCount };
  } },
};
const Module = require("module");
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.endsWith(path.join("routes", "emergencyCases.js"))) {
    if (request === "../db") return stubs["./db"];
    if (request === "../middleware/authMiddleware") { const f = (q, s, n) => n(); f.requireRole = () => (q, s, n) => n(); return f; }
    if (request === "../services/accessPolicy") return { requireCaseAccess: () => (q, s, n) => n() };
  }
  return origLoad.call(this, request, parent, ...rest);
};
const router = require("./routes/emergencyCases");
Module._load = origLoad;

const layer = router.stack.find((l) => l.route && l.route.path === "/:id/status" && l.route.methods.patch);
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

async function call(role) {
  let status = 200, body;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  await handler({ params: { id: "7" }, body: { case_status: "ACTIVE_ER" }, user: { role, user_id: 1 } }, res);
  return { status, body };
}

(async () => {
  updateRowCount = 1;
  let r = await call("ER_STAFF");
  assert.strictEqual(r.status, 200, "normal change succeeds");
  const upd = calls.filter((c) => /UPDATE/i.test(c.sql)).pop();
  assert.ok(/case_status\s*=\s*\$3/.test(upd.sql), "UPDATE is conditional on the status that was read");
  assert.strictEqual(upd.params[2], "ARRIVED_ER");

  updateRowCount = 0; // someone else changed it between the read and the update
  r = await call("ER_STAFF");
  assert.strictEqual(r.status, 409, "lost race returns 409");

  r = await call("PARAMEDIC");
  assert.strictEqual(r.status, 403, "role rule still enforced");
  console.log("Case status race tests passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
