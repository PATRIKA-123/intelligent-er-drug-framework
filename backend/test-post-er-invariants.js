"use strict";
const assert = require("assert");
const path = require("path");
const Module = require("module");

const state = { script: [], log: [] };
function reply(sql) {
  const text = sql.replace(/\s+/g, " ");
  state.log.push(text);
  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(text.trim())) return { rows: [], rowCount: 0 };
  for (const rule of state.script) {
    if (rule.match.test(text)) return { rows: rule.rows, rowCount: rule.rows.length };
  }
  return { rows: [], rowCount: 0 };
}
const fakeClient = { query: async (sql) => reply(sql), release() {} };
const fakePool = { query: async (sql) => reply(sql), connect: async () => fakeClient };

const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  const from = parent && parent.filename ? path.basename(parent.filename) : "";
  if (request === "../db" && /^(postErService|prescriptionService)\.js$/.test(from)) return fakePool;
  return origLoad.call(this, request, parent, ...rest);
};
const { createDischarge } = require("./services/postErService");
const { createPrescription, reviewPrescription } = require("./services/prescriptionService");
Module._load = origLoad;

const STAY = /FROM ed_stays/i;
const ASSIGNED = /FROM stay_doctor_assignments/i;
const DISCHARGE_EXISTS = /FROM discharges/i;
const RX_SELECT = /FROM prescriptions/i;

function setup(rules) { state.script = rules; state.log = []; }
const rolledBack = () => state.log.some((q) => /^ROLLBACK/i.test(q));
const committed = () => state.log.some((q) => /^COMMIT/i.test(q));
async function expectStatus(promise, code) {
  try { await promise; } catch (e) { assert.strictEqual(e.statusCode, code, `expected ${code}, got ${e.statusCode}: ${e.message}`); return; }
  assert.fail(`expected status ${code} but the call succeeded`);
}

let n = 0;
async function test(name, fn) { await fn(); n++; console.log("PASS  " + name); }

(async () => {
  const stayRow = [{ stay_id: 1, patient_id: 9 }];
  const assigned = [{ assignment_id: 5 }];

  await test("discharge: a doctor who is not actively assigned gets 403 and nothing is saved", async () => {
    setup([{ match: STAY, rows: stayRow }, { match: ASSIGNED, rows: [] }]);
    await expectStatus(createDischarge(1, { authorized_by: 2, discharge_status: "HOME" }), 403);
    assert.ok(rolledBack() && !committed());
    assert.ok(!state.log.some((q) => /INSERT INTO discharges/i.test(q)));
  });

  await test("discharge: a second discharge for the same stay gets 409", async () => {
    setup([{ match: STAY, rows: stayRow }, { match: ASSIGNED, rows: assigned }, { match: DISCHARGE_EXISTS, rows: [{ discharge_id: 3 }] }]);
    await expectStatus(createDischarge(1, { authorized_by: 2, discharge_status: "HOME" }), 409);
    assert.ok(rolledBack() && !committed());
  });

  await test("discharge: unknown stay gets 404", async () => {
    setup([]);
    await expectStatus(createDischarge(1, { authorized_by: 2, discharge_status: "HOME" }), 404);
  });

  await test("discharge: the assigned doctor succeeds and the stay row is locked first", async () => {
    setup([{ match: STAY, rows: stayRow }, { match: ASSIGNED, rows: assigned }, { match: /INSERT INTO discharges/i, rows: [{ discharge_id: 7 }] }]);
    const out = await createDischarge(1, { authorized_by: 2, discharge_status: "HOME" });
    assert.strictEqual(out.discharge_id, 7);
    assert.ok(committed());
    assert.ok(/FOR UPDATE/i.test(state.log.find((q) => STAY.test(q))), "stay is locked");
  });

  await test("prescribing: a doctor who is not actively assigned gets 403", async () => {
    setup([{ match: STAY, rows: stayRow }, { match: ASSIGNED, rows: [] }]);
    await expectStatus(createPrescription(1, { medication_name: "Aspirin" }, 2), 403);
    assert.ok(rolledBack() && !committed());
  });

  await test("prescribing: new prescriptions are always saved as PENDING_REVIEW, never authorized", async () => {
    const src = require("fs").readFileSync(path.join(__dirname, "services", "prescriptionService.js"), "utf8");
    const insert = src.slice(src.indexOf("INSERT INTO prescriptions"), src.indexOf("RETURNING *", src.indexOf("INSERT INTO prescriptions")));
    assert.ok(/'PENDING_REVIEW'/.test(insert));
    assert.ok(!/'AUTHORIZED'/.test(insert));
  });

  const review = (status) => reviewPrescription(1, 11, { status }, 2);
  const pending = (screening) => [{ prescription_id: 11, status: "PENDING_REVIEW", screening_result: screening }];

  await test("review: a doctor who is not actively assigned gets 403", async () => {
    setup([{ match: STAY, rows: [{ stay_id: 1 }] }, { match: ASSIGNED, rows: [] }]);
    await expectStatus(review("AUTHORIZED"), 403);
  });

  await test("review: a prescription that is already reviewed gets 409 (no second decision)", async () => {
    setup([{ match: STAY, rows: [{ stay_id: 1 }] }, { match: ASSIGNED, rows: assigned },
      { match: RX_SELECT, rows: [{ prescription_id: 11, status: "AUTHORIZED", screening_result: { screening_status: "SCREENED" } }] }]);
    await expectStatus(review("REJECTED"), 409);
    assert.ok(!state.log.some((q) => /UPDATE prescriptions/i.test(q)));
  });

  await test("review: cannot authorize when screening is incomplete (409), nothing updated", async () => {
    setup([{ match: STAY, rows: [{ stay_id: 1 }] }, { match: ASSIGNED, rows: assigned },
      { match: RX_SELECT, rows: pending({ screening_status: "INCOMPLETE" }) }]);
    await expectStatus(review("AUTHORIZED"), 409);
    assert.ok(!state.log.some((q) => /UPDATE prescriptions/i.test(q)));
    assert.ok(rolledBack());
  });

  await test("review: cannot authorize when there is no screening result at all (409)", async () => {
    setup([{ match: STAY, rows: [{ stay_id: 1 }] }, { match: ASSIGNED, rows: assigned },
      { match: RX_SELECT, rows: pending(null) }]);
    await expectStatus(review("AUTHORIZED"), 409);
  });

  await test("review: a fully screened prescription can be authorized", async () => {
    setup([{ match: STAY, rows: [{ stay_id: 1 }] }, { match: ASSIGNED, rows: assigned },
      { match: RX_SELECT, rows: pending({ screening_status: "SCREENED" }) },
      { match: /UPDATE prescriptions/i, rows: [{ prescription_id: 11, status: "AUTHORIZED" }] }]);
    const out = await review("AUTHORIZED");
    assert.strictEqual(out.status, "AUTHORIZED");
    assert.ok(committed());
  });

  await test("review: a prescription can be rejected even if screening is incomplete", async () => {
    setup([{ match: STAY, rows: [{ stay_id: 1 }] }, { match: ASSIGNED, rows: assigned },
      { match: RX_SELECT, rows: pending({ screening_status: "INCOMPLETE" }) },
      { match: /UPDATE prescriptions/i, rows: [{ prescription_id: 11, status: "REJECTED" }] }]);
    assert.strictEqual((await review("REJECTED")).status, "REJECTED");
  });

  console.log(`Post-ER invariant tests passed (${n})`);
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
