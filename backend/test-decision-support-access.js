// B02 regression test: who may trigger POST /api/decision-support/:stay_id,
// that a denied request changes nothing, and that runs for one stay are
// serialized. Uses a real PostgreSQL in a temporary schema (acl_ds) that is
// dropped at the end. The clinical calculation itself is replaced by a small
// stub, so this test checks permissions, locking and rollback only - not
// clinical correctness.
//
//   set PRE_ER_TEST_ENV_FILE=path\to\your\test.env   (TEST database only)
//   node test-decision-support-access.js

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-real";
const path = require("path");
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

// Read the same DB settings db.js reads, without opening the shared pool yet.
require("dotenv").config({
  path: path.resolve(process.env.PRE_ER_TEST_ENV_FILE || path.join(__dirname, "../.env")),
  override: true,
});
const dbConfig = () => ({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

let failed = 0, total = 0;
function check(name, got, expected) {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : `   (got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)})`));
}

let stubDelayMs = 0;
let stubShouldFail = false;

(async () => {
  const admin = new Client(dbConfig());
  await admin.connect();
  await admin.query("DROP SCHEMA IF EXISTS acl_ds CASCADE");
  await admin.query("CREATE SCHEMA acl_ds");
  await admin.query("SET search_path TO acl_ds");
  await admin.query(`
    CREATE TABLE patients (patient_id INT PRIMARY KEY, subject_id BIGINT);
    CREATE TABLE users (user_id INT PRIMARY KEY, role TEXT, patient_id INT);
    CREATE TABLE ed_stays (stay_id BIGINT PRIMARY KEY, subject_id BIGINT);
    CREATE TABLE emergency_cases (case_id INT PRIMARY KEY, patient_id INT, stay_id BIGINT,
                                  case_status TEXT, created_by INT);
    CREATE TABLE stay_doctor_assignments (assignment_id SERIAL PRIMARY KEY, stay_id BIGINT,
                                  doctor_user_id INT, status TEXT);
    CREATE TABLE clinical_alerts (alert_id SERIAL PRIMARY KEY, patient_id INT, stay_id BIGINT,
      alert_type TEXT, alert_source TEXT, medication_id_a INT, medication_id_b INT,
      safety_result_id INT, severity TEXT, priority TEXT, alert_title TEXT, alert_message TEXT,
      status TEXT, engine_run_id TEXT, engine_version TEXT);
    CREATE TABLE drug_safety_results (stay_id BIGINT, medication_id_a INT, medication_id_b INT,
      component_a TEXT, component_b TEXT, safety_result_id INT, interaction_level TEXT);

    INSERT INTO patients VALUES (1, 1000), (2, 2000);
    INSERT INTO ed_stays VALUES (100, 1000), (200, 2000), (300, 1000);
    INSERT INTO users VALUES (10,'PATIENT',1),(20,'PARAMEDIC',NULL),(30,'ER_STAFF',NULL),
                             (40,'DOCTOR',NULL),(41,'DOCTOR',NULL),(50,'ADMIN',NULL);
    -- stay 100: live ER case; stay 200: still PRE_ER; stay 300: live case, no doctor
    INSERT INTO emergency_cases VALUES (1,1,100,'ARRIVED_ER',20),(2,2,200,'PRE_ER',20),(3,1,300,'ACTIVE_ER',20);
    INSERT INTO stay_doctor_assignments (stay_id, doctor_user_id, status) VALUES (100,40,'ACTIVE'),(300,40,'ACTIVE');
    INSERT INTO clinical_alerts (patient_id, stay_id, alert_type, severity, priority, alert_title,
      alert_message, status, engine_run_id, engine_version)
      VALUES (1,100,'SEED','LOW','LOW','seed','seed','ACTIVE','seed-run','seed');
    INSERT INTO clinical_alerts (patient_id, stay_id, alert_type, severity, priority, alert_title,
      alert_message, status, engine_run_id, engine_version)
      VALUES (2,200,'SEED','LOW','LOW','seed','seed','ACTIVE','seed-run','seed');
  `);

  // Every pool connection used by the app code now lands in schema acl_ds.
  process.env.PGOPTIONS = "-c search_path=acl_ds";
  const pool = require("./db");

  // Replace only the clinical calculation; keep the real route, policy and alertService.
  const stub = (rel, exports) => {
    const p = require.resolve(rel);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  };
  stub("./services/clinicalContextService", {
    getClinicalContext: async (stayId) => (String(stayId) === "999" ? null : { stay: { stay_id: stayId } }),
  });
  stub("./services/decisionSupportService", {
    computeAndPersistDecisionSupport: async (stayId) => {
      if (stubDelayMs) await new Promise((r) => setTimeout(r, stubDelayMs));
      if (stubShouldFail) throw new Error("forced failure");
      return {
        decision: { patient_id: 1, overall_risk: "LOW", decision_priority: "LOW",
          decision_summary: "stub", evidence_source: "stub", trend_classification: "STABLE" },
        drug_safety: {},
      };
    },
  });

  const express = require("express");
  const app = express();
  app.use("/api/decision-support", require("./routes/decisionSupport"));

  const tokenFor = (user_id, role) => jwt.sign({ user_id, role }, process.env.JWT_SECRET);
  const logs = [];
  const realLog = console.log, realWarn = console.warn, realErr = console.error;
  console.log = (m) => { try { logs.push(JSON.parse(m)); } catch (_) { realLog(m); } };
  console.warn = () => {}; console.error = () => {};

  const runIds = async (stay) =>
    (await pool.query("SELECT DISTINCT engine_run_id FROM clinical_alerts WHERE stay_id=$1 ORDER BY 1", [stay]))
      .rows.map((r) => r.engine_run_id);

  const server = app.listen(0, async () => {
    const base = `http://localhost:${server.address().port}/api/decision-support`;
    const post = async (stay, token) => {
      const r = await fetch(`${base}/${stay}`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      return r.status;
    };
    try {
      check("no token -> 401", await post(100, null), 401);

      // ---- denied callers: status AND no database change ----
      for (const [label, uid, role, stay] of [
        ["PATIENT (own stay)", 10, "PATIENT", 100],
        ["PARAMEDIC (own case)", 20, "PARAMEDIC", 100],
        ["unassigned DOCTOR", 41, "DOCTOR", 100],
        ["assigned DOCTOR on other stay (PRE_ER stay 200)", 40, "DOCTOR", 200],
        ["ER_STAFF on PRE_ER stay 200", 30, "ER_STAFF", 200],
      ]) {
        const status = await post(stay, tokenFor(uid, role));
        check(`${label} -> 403`, status, 403);
        check(`${label}: alerts untouched`, await runIds(stay), ["seed-run"]);
      }

      // ---- allowed callers ----
      check("assigned DOCTOR -> 200", await post(100, tokenFor(40, "DOCTOR")), 200);
      const afterDoctor = await runIds(100);
      check("assigned DOCTOR run replaced alerts", afterDoctor.length === 1 && afterDoctor[0] !== "seed-run", true);
      check("ER_STAFF live case -> 200", await post(100, tokenFor(30, "ER_STAFF")), 200);
      check("ADMIN -> 200", await post(100, tokenFor(50, "ADMIN")), 200);
      check("unknown stay -> 404 for ADMIN", await post(999, tokenFor(50, "ADMIN")), 404);
      check("bad stay id -> 400", await post("abc", tokenFor(50, "ADMIN")), 400);

      // ---- concurrency: one run per stay at a time ----
      stubDelayMs = 400;
      const [a, b] = await Promise.all([
        post(300, tokenFor(50, "ADMIN")),
        post(300, tokenFor(40, "DOCTOR")),
      ]);
      check("two simultaneous runs -> one 200 and one 409", [a, b].sort(), [200, 409]);
      check("only one run's alerts exist", (await runIds(300)).length, 1);
      stubDelayMs = 0;
      check("run after the first finished -> 200 (lock released)", await post(300, tokenFor(50, "ADMIN")), 200);

      // ---- failure rolls back and releases the lock ----
      const before = await runIds(100);
      stubShouldFail = true;
      check("failing run -> 500", await post(100, tokenFor(50, "ADMIN")), 500);
      check("failing run kept previous alerts", await runIds(100), before);
      stubShouldFail = false;
      check("run after failure -> 200 (lock released)", await post(100, tokenFor(50, "ADMIN")), 200);

      // ---- audit trail ----
      const ds = logs.filter((l) => l.event && l.event.startsWith("decision_support_"));
      const outcomes = ds.filter((l) => l.event === "decision_support_finished").map((l) => l.outcome);
      check("audit logs record COMPLETED / CONFLICT / FAILED / NOT_FOUND",
        ["COMPLETED", "CONFLICT", "FAILED", "NOT_FOUND"].every((o) => outcomes.includes(o)), true);
      check("audit log has initiator and stay",
        ds.every((l) => l.user_id !== undefined && l.stay_id !== undefined && l.role), true);
      check("audit logs contain no token", JSON.stringify(logs).includes("eyJ"), false);
    } catch (err) {
      failed++; realErr("TEST ERROR:", err.message);
    } finally {
      console.log = realLog; console.warn = realWarn; console.error = realErr;
      server.close();
      try { await pool.query("DROP SCHEMA IF EXISTS acl_ds CASCADE"); } catch (_) {}
      try { await admin.query("DROP SCHEMA IF EXISTS acl_ds CASCADE"); } catch (_) {}
      await admin.end(); await pool.end();
      console.log(`\n${failed} FAILED / ${total} CHECKS`);
      process.exit(failed ? 1 : 0);
    }
  });
})();
