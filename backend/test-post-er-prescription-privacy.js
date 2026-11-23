"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function loadWithMocks(relative, mocks) {
  const filename = path.join(__dirname, relative);
  const code = fs.readFileSync(filename, "utf8");
  const module = { exports: {} };
  const fakeRequire = (id) => {
    if (!(id in mocks)) throw new Error(`Unexpected dependency in test: ${id}`);
    return mocks[id];
  };
  vm.runInThisContext(`(function(require,module,exports){\n${code}\n})`, { filename })(fakeRequire, module, module.exports);
  return module.exports;
}

function createPostErHarness() {
  const callRoles = [];
  const observed = [];
  const fakeDb = { query: async (sql) => {
    observed.push(sql);
    if (sql.includes("FROM discharges")) return { rows: [] };
    // The production service also reads departure state from ed_stays.
    if (/SELECT\s+departed_at\s+FROM\s+ed_stays/i.test(sql)) return { rows: [{ departed_at: null }] };
    if (sql.includes("FROM follow_ups")) return { rows: [] };
    if (sql.includes("FROM stay_doctor_assignments")) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  const svc = loadWithMocks("services/postErService.js", {
    "../db": fakeDb,
    "./clinicalSummaryService": { getClinicalSummary: async () => ({ stay_id: 57 }) },
    "./prescriptionService": { getPrescriptions: async (_id, options) => {
      callRoles.push(options?.role);
      return options?.role === "PATIENT" ? [{ prescription_id: 1 }] : [{ prescription_id: 1, screening_result: { internal: true } }];
    } },
    "./schemaCapabilities": { getColumns: async () => new Set(["assigned_at"]) },
  });
  return { svc, callRoles, observed };
}

test("Post-ER passes PATIENT role through to prescription visibility filtering", async () => {
  const { svc, callRoles, observed } = createPostErHarness();
  const data = await svc.getPostErData(57, { role: "PATIENT" });
  assert.deepEqual(callRoles, ["PATIENT"]);
  assert.equal(Object.hasOwn(data.prescriptions[0], "screening_result"), false);
  assert.ok(observed.some(sql => /SELECT\s+departed_at\s+FROM\s+ed_stays/i.test(sql)), "departure status must be read");
});

test("Post-ER passes DOCTOR role without weakening staff visibility", async () => {
  const { svc, callRoles } = createPostErHarness();
  const data = await svc.getPostErData(57, { role: "DOCTOR" });
  assert.deepEqual(callRoles, ["DOCTOR"]);
  assert.equal(data.prescriptions[0].screening_result.internal, true);
});

test("Post-ER rejects missing or invalid caller role instead of defaulting to DOCTOR", async () => {
  const { svc, callRoles } = createPostErHarness();
  await assert.rejects(svc.getPostErData(57), { statusCode: 403 });
  await assert.rejects(svc.getPostErData(57, { role: "UNTRUSTED" }), { statusCode: 403 });
  assert.equal(callRoles.length, 0);
});

test("Actual getPrescriptions PATIENT query only returns authorized safe columns", async () => {
  let sql = "";
  const svc = loadWithMocks("services/prescriptionService.js", {
    "../db": { query: async (query) => { sql = query; return { rows: [] }; } },
    "./medicationNormalizationService": { getNormalizedMedications: async () => ({}) },
    "./ddinterService": { findDrugInteractions: async () => ({}) },
    "./schemaCapabilities": { getColumns: async () => new Set([
      "prescription_id", "stay_id", "medication_name", "created_at", "status", "screening_result", "review_notes",
    ]) },
  });
  await svc.getPrescriptions(57, { role: "PATIENT" });
  assert.match(sql, /status = 'AUTHORIZED'/);
  assert.doesNotMatch(sql, /screening_result|review_notes/);
});

test("Actual getPrescriptions PATIENT fails closed if status column unavailable", async () => {
  let called = false;
  const svc = loadWithMocks("services/prescriptionService.js", {
    "../db": { query: async () => { called = true; return { rows: [] }; } },
    "./medicationNormalizationService": {},
    "./ddinterService": {},
    "./schemaCapabilities": { getColumns: async () => new Set(["prescription_id"]) },
  });
  assert.deepEqual(await svc.getPrescriptions(57, { role: "PATIENT" }), []);
  assert.equal(called, false);
});
