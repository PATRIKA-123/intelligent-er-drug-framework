// B11: the ER-arrival endpoint (POST /api/emergency-cases/:id/er-arrival).
// Runs the REAL route against a throw-away schema (acl_arrival) in a real
// PostgreSQL; dropped at the end. Only the clinical calculation is stubbed.
//
//   set PRE_ER_TEST_ENV_FILE=path\to\your\test.env   (TEST database only)
//   node test-er-arrival-db.js

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-real";
const path = require("path");
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

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

let stubShouldFail = false;

(async () => {
  const db = new Client(dbConfig());
  await db.connect();
  await db.query("DROP SCHEMA IF EXISTS acl_arrival CASCADE");
  await db.query("CREATE SCHEMA acl_arrival");
  await db.query("SET search_path TO acl_arrival");
  await db.query(`
    CREATE TABLE users (user_id INT PRIMARY KEY, username TEXT, role TEXT, is_active BOOLEAN DEFAULT TRUE, patient_id INT);
    CREATE TABLE patients (patient_id INT PRIMARY KEY, subject_id BIGINT, data_source TEXT);
    CREATE TABLE ed_stays (stay_id BIGINT PRIMARY KEY, subject_id BIGINT);
    CREATE TABLE emergency_cases (
      case_id INT PRIMARY KEY, patient_id INT, stay_id BIGINT UNIQUE,
      temporary_case_code VARCHAR(30) NOT NULL UNIQUE,
      case_status VARCHAR(20) NOT NULL DEFAULT 'PRE_ER'
        CHECK (case_status IN ('PRE_ER','ARRIVED_ER','ACTIVE_ER','CLOSED')),
      source VARCHAR(30) NOT NULL DEFAULT 'APPLICATION', created_by INT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE ambulance_transports (transport_id SERIAL PRIMARY KEY, case_id INT, transport_status TEXT,
      arrival_time TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE clinical_alerts (alert_id SERIAL PRIMARY KEY, patient_id INT, stay_id BIGINT,
      alert_type TEXT, alert_source TEXT, medication_id_a INT, medication_id_b INT,
      safety_result_id INT, severity TEXT, priority TEXT, alert_title TEXT, alert_message TEXT,
      status TEXT, engine_run_id TEXT, engine_version TEXT);
    CREATE TABLE drug_safety_results (stay_id BIGINT, medication_id_a INT, medication_id_b INT,
      component_a TEXT, component_b TEXT, safety_result_id INT, interaction_level TEXT);
    CREATE TABLE test_flags (name TEXT PRIMARY KEY);

    INSERT INTO users VALUES (20,'para','PARAMEDIC',TRUE,NULL),(30,'er','ER_STAFF',TRUE,NULL),(50,'adm','ADMIN',TRUE,NULL);
    INSERT INTO patients VALUES (1,1000,'T'),(2,2000,'T'),(3,3000,'T'),(4,4000,'T');
    INSERT INTO ed_stays VALUES (100,1000),(200,2000),(300,3000),(400,4000);
    INSERT INTO emergency_cases (case_id, patient_id, temporary_case_code, created_by) VALUES
      (1,1,'C1',20),(2,1,'C2',20),(3,2,'C3',20),(4,2,'C4',20),(5,3,'C5',20),(6,4,'C6',20);
    INSERT INTO ambulance_transports (case_id, transport_status) SELECT g, 'EN_ROUTE' FROM generate_series(1,6) g;

    -- test hooks: slow the stay link of stay 200 so two requests overlap; fail case 5 on demand
    CREATE FUNCTION arrival_hooks() RETURNS trigger AS $$
    BEGIN
      IF NEW.stay_id IS DISTINCT FROM OLD.stay_id AND NEW.stay_id = 200 THEN PERFORM pg_sleep(0.7); END IF;
      IF NEW.case_id = 5 AND EXISTS (SELECT 1 FROM test_flags WHERE name = 'fail_case5') THEN
        RAISE EXCEPTION 'injected failure while linking case 5';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER arrival_hooks BEFORE UPDATE ON emergency_cases FOR EACH ROW EXECUTE FUNCTION arrival_hooks();
  `);

  process.env.PGOPTIONS = "-c search_path=acl_arrival";
  const pool = require("./db");
  const schemaNow = (await pool.query("SELECT current_schema() AS s")).rows[0].s;
  if (schemaNow !== "acl_arrival") {
    console.error(`ABORTED: connections are using schema "${schemaNow}", not acl_arrival. No app code was run. Use a direct (non-pooled) connection string for this test.`);
    await db.query("DROP SCHEMA IF EXISTS acl_arrival CASCADE"); await db.end(); await pool.end(); process.exit(2);
  }

  const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
  stub("./services/clinicalContextService", {
    getClinicalContext: async (stayId) => ({ stay: { stay_id: stayId }, latest_news2: { total_news2_score: 3 }, latest_trend: null, medications: [] }),
  });
  stub("./services/decisionSupportService", {
    computeAndPersistDecisionSupport: async () => {
      if (stubShouldFail) throw new Error("forced processing failure");
      return { decision: { patient_id: 1, overall_risk: "LOW", decision_priority: "LOW", decision_summary: "stub", evidence_source: "stub", trend_classification: "STABLE" }, drug_safety: {} };
    },
  });

  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use("/api/emergency-cases", require("./routes/preEr"));
  const token = (id, role) => jwt.sign({ user_id: id, role }, process.env.JWT_SECRET);
  const realLog = console.log, realWarn = console.warn, realErr = console.error;
  console.log = (m) => { try { JSON.parse(m); } catch (_) { realLog(m); } }; console.warn = () => {}; console.error = () => {};

  const server = app.listen(0, async () => {
    const base = `http://localhost:${server.address().port}/api/emergency-cases`;
    const arrive = async (caseId, stayId, who = token(30, "ER_STAFF")) => {
      const r = await fetch(`${base}/${caseId}/er-arrival`, { method: "POST", signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${who}`, "Content-Type": "application/json" }, body: JSON.stringify({ stay_id: stayId }) });
      let body = null; try { body = await r.json(); } catch (_) {}
      return { status: r.status, body };
    };
    const caseRow = async (id) => (await db.query("SELECT case_status s, stay_id::text st, patient_id p FROM emergency_cases WHERE case_id=$1", [id])).rows[0];
    const alertStats = async (stay) => (await db.query("SELECT count(*)::int n, count(DISTINCT engine_run_id)::int runs FROM clinical_alerts WHERE stay_id=$1", [stay])).rows[0];

    try {
      console.log("--- normal arrival, then a retry of the same request ---");
      let r = await arrive(1, 100);
      check("first arrival -> 200, linked and processing COMPLETED", [r.status, r.body.case_linked, r.body.processing.status], [200, true, "COMPLETED"]);
      check("case is ARRIVED_ER and linked to stay 100 with the stay's patient", await caseRow(1), { s: "ARRIVED_ER", st: "100", p: 1 });
      check("transport marked arrived", (await db.query("SELECT transport_status s FROM ambulance_transports WHERE case_id = 1")).rows[0].s, "ARRIVED_AT_DESTINATION");
      const afterFirst = await alertStats(100);
      r = await arrive(1, 100);
      check("retry of the same request -> 200 (same stable result)", [r.status, r.body.case_linked, r.body.case.case_status, String(r.body.case.stay_id)], [200, true, "ARRIVED_ER", "100"]);
      const afterRetry = await alertStats(100);
      check("retry does not duplicate alerts (one current run, same alert count)", [afterRetry.runs, afterRetry.n], [1, afterFirst.n]);
      check("still exactly one case linked to stay 100", (await db.query("SELECT count(*)::int n FROM emergency_cases WHERE stay_id = 100")).rows[0].n, 1);

      console.log("--- conflicting links are refused with 409 and change nothing ---");
      r = await arrive(2, 100);
      check("another case -> same stay: 409", r.status, 409);
      check("that other case is unchanged", await caseRow(2), { s: "PRE_ER", st: null, p: 1 });
      r = await arrive(1, 200);
      check("same case -> a different stay: 409", r.status, 409);
      check("case 1 still linked to stay 100", (await caseRow(1)).st, "100");

      console.log("--- two requests race to link two cases to the same stay ---");
      const [a, b] = await Promise.all([arrive(3, 200), arrive(4, 200)]);
      check("exactly one 200 and one 409 (never a 500)", [a.status, b.status].sort(), [200, 409]);
      check("exactly one case ended up linked to stay 200", (await db.query("SELECT count(*)::int n FROM emergency_cases WHERE stay_id = 200")).rows[0].n, 1);
      const loser = a.status === 409 ? 3 : 4;
      check("the losing case is still PRE_ER and unlinked", await caseRow(loser), { s: "PRE_ER", st: null, p: 2 });

      console.log("--- a failure while linking leaves nothing half-done ---");
      await db.query("INSERT INTO test_flags VALUES ('fail_case5')");
      r = await arrive(5, 300);
      check("failure during the link -> 500 with a plain error", [r.status, r.body.error], [500, "Failed to link ER arrival"]);
      check("case 5 unchanged (rolled back)", await caseRow(5), { s: "PRE_ER", st: null, p: 3 });
      check("its transport unchanged (rolled back)", (await db.query("SELECT transport_status s FROM ambulance_transports WHERE case_id = 5")).rows[0].s, "EN_ROUTE");
      await db.query("DELETE FROM test_flags");
      r = await arrive(5, 300);
      check("the same request works once the fault is gone", [r.status, r.body.processing.status], [200, "COMPLETED"]);

      console.log("--- linked, but processing fails: the response says so and a retry is safe ---");
      stubShouldFail = true;
      r = await arrive(6, 400);
      check("processing failure after the link -> 500 body says case_linked and retry_safe",
        [r.status, r.body.case_linked, r.body.processing.status, r.body.retry_safe], [500, true, "FAILED", true]);
      check("the link itself persisted", await caseRow(6), { s: "ARRIVED_ER", st: "400", p: 4 });
      stubShouldFail = false;
      r = await arrive(6, 400);
      check("retry completes processing without a second link", [r.status, r.body.processing.status], [200, "COMPLETED"]);
      check("still exactly one case linked to stay 400 and one alert run", [(await db.query("SELECT count(*)::int n FROM emergency_cases WHERE stay_id = 400")).rows[0].n, (await alertStats(400)).runs], [1, 1]);

      console.log("--- linked, but another processing run holds the stay ---");
      const holder = new Client(dbConfig());
      await holder.connect();
      await holder.query("SET search_path TO acl_arrival");
      await holder.query("SELECT pg_advisory_lock(hashtextextended('decision_support:400', 0))");
      r = await arrive(6, 400);
      check("busy -> 409 with processing IN_PROGRESS, case_linked true, retry_safe",
        [r.status, r.body.case_linked, r.body.processing.status, r.body.retry_safe], [409, true, "IN_PROGRESS", true]);
      await holder.query("SELECT pg_advisory_unlock(hashtextextended('decision_support:400', 0))");
      await holder.end();
      r = await arrive(6, 400);
      check("once the other run finished, the same request completes", [r.status, r.body.processing.status], [200, "COMPLETED"]);

      console.log("--- access rules still apply ---");
      r = await arrive(2, 100, token(20, "PARAMEDIC"));
      check("a paramedic who created the case is still checked by the stay rules (not a bypass)", [403, 409].includes(r.status), true);
    } catch (err) {
      failed++; realErr("TEST ERROR:", err.message);
    } finally {
      console.log = realLog; console.warn = realWarn; console.error = realErr;
      server.close();
      try { await pool.query("DROP SCHEMA IF EXISTS acl_arrival CASCADE"); } catch (_) {}
      try { await db.query("DROP SCHEMA IF EXISTS acl_arrival CASCADE"); } catch (_) {}
      await db.end(); await pool.end();
      console.log(`\n${failed} FAILED / ${total} CHECKS`);
      process.exit(failed ? 1 : 0);
    }
  });
})();
