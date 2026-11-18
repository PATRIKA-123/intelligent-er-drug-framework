// B10: the API tells callers which consciousness / oxygen / SpO2-scale values
// were assumed. Runs the REAL stays routes and getClinicalContext against a
// throw-away schema (acl_api) in a real PostgreSQL; dropped at the end.
//
//   set PRE_ER_TEST_ENV_FILE=path\to\your\test.env   (TEST database only)
//   node test-assumed-inputs-api-db.js

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

(async () => {
  const db = new Client(dbConfig());
  await db.connect();
  await db.query("DROP SCHEMA IF EXISTS acl_api CASCADE");
  await db.query("CREATE SCHEMA acl_api");
  await db.query("SET search_path TO acl_api");
  await db.query(`
    CREATE TABLE users (user_id INT PRIMARY KEY, username TEXT, role TEXT, is_active BOOLEAN DEFAULT TRUE, patient_id INT);
    CREATE TABLE patients (patient_id SERIAL PRIMARY KEY, subject_id BIGINT, data_source TEXT);
    CREATE TABLE ed_stays (stay_id BIGINT PRIMARY KEY, subject_id BIGINT, intime TIMESTAMP, outtime TIMESTAMP,
      gender TEXT, disposition TEXT, chiefcomplaint TEXT, acuity INT);
    CREATE TABLE observations (observation_id SERIAL PRIMARY KEY, stay_id BIGINT NOT NULL, observation_time TIMESTAMP NOT NULL,
      temperature NUMERIC(5,2), heart_rate NUMERIC(5,2), respiratory_rate NUMERIC(5,2), spo2 NUMERIC(5,2), systolic_bp NUMERIC(5,2),
      data_source TEXT, consciousness VARCHAR(10), oxygen_support BOOLEAN, spo2_scale SMALLINT,
      consciousness_assumed BOOLEAN, oxygen_support_assumed BOOLEAN, spo2_scale_assumed BOOLEAN,
      UNIQUE (stay_id, observation_time));
    CREATE VIEW observations_clean AS
      SELECT DISTINCT ON (stay_id, observation_time) observation_id, stay_id, observation_time, temperature,
        heart_rate, respiratory_rate, spo2, systolic_bp, data_source, consciousness, oxygen_support, spo2_scale,
        CASE WHEN temperature > 50 THEN round((temperature - 32) * 5.0 / 9.0, 1) ELSE temperature END AS temperature_celsius
      FROM observations ORDER BY stay_id, observation_time, observation_id;
    CREATE TABLE news2_results_real (observation_id INT, stay_id BIGINT, observation_time TIMESTAMP, total_news2_score INT,
      risk_level TEXT, respiratory_score INT, spo2_score INT, oxygen_score INT, systolic_bp_score INT,
      heart_rate_score INT, temperature_score INT, consciousness_score INT);
    CREATE TABLE diagnoses (stay_id BIGINT, seq_num INT, icd_code TEXT, icd_version INT, icd_title TEXT, diagnosis_id SERIAL);
    CREATE TABLE allergies (allergy_id SERIAL, patient_id INT, allergen TEXT, reaction TEXT, severity TEXT, status TEXT, source TEXT, recorded_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE medical_history (history_id SERIAL, patient_id INT, condition TEXT, description TEXT, diagnosis_date DATE, status TEXT, source TEXT, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE medications (stay_id BIGINT, medication_name TEXT, normalized_name TEXT, charttime TIMESTAMP);
    CREATE TABLE trend_results (stay_id BIGINT, observation_time TIMESTAMP, minutes_since_prev NUMERIC, delta_spo2 NUMERIC,
      delta_heart_rate NUMERIC, delta_systolic_bp NUMERIC, delta_respiratory_rate NUMERIC, spo2_rate_per_hour NUMERIC,
      hr_rate_per_hour NUMERIC, sbp_rate_per_hour NUMERIC, rr_rate_per_hour NUMERIC, trend_classification TEXT);

    INSERT INTO users VALUES (1,'adm','ADMIN',TRUE,NULL);
    INSERT INTO patients (subject_id, data_source) VALUES (1000,'T'), (2000,'T');
    INSERT INTO ed_stays (stay_id, subject_id) VALUES (100,1000), (200,2000);
    -- stay 100: assumed, measured, unknown provenance, and one with unknown (NULL) inputs
    INSERT INTO observations (stay_id, observation_time, temperature, heart_rate, respiratory_rate, spo2, systolic_bp, data_source,
        consciousness, oxygen_support, spo2_scale, consciousness_assumed, oxygen_support_assumed, spo2_scale_assumed) VALUES
      (100,'2147-01-01 01:00',98.6,80,18,99,120,'T','Alert',false,1,TRUE,TRUE,TRUE),
      (100,'2147-01-01 02:00',98.6,80,18,99,120,'T','Alert',false,1,FALSE,FALSE,FALSE),
      (100,'2147-01-01 03:00',98.6,80,18,99,120,'T','Alert',false,1,NULL,NULL,NULL),
      (100,'2147-01-01 04:00',98.6,80,18,99,120,'T',NULL,NULL,NULL,FALSE,FALSE,FALSE),
      (200,'2147-01-01 01:00',98.6,80,18,99,120,'T','Alert',false,1,TRUE,TRUE,TRUE);
    INSERT INTO news2_results_real (observation_id, stay_id, observation_time, total_news2_score, risk_level) VALUES
      (1,100,'2147-01-01 01:00',0,'Low Risk'), (2,100,'2147-01-01 02:00',0,'Low Risk'),
      (3,100,'2147-01-01 03:00',0,'Low Risk'), (5,200,'2147-01-01 01:00',0,'Low Risk');
  `);

  process.env.PGOPTIONS = "-c search_path=acl_api";
  const pool = require("./db");
  const probeSchema = (await pool.query("SELECT current_schema() AS s")).rows[0].s;
  if (probeSchema !== "acl_api") {
    console.error(`ABORTED: connections are using schema "${probeSchema}", not acl_api. No app code was run. Use a direct (non-pooled) connection string for this test.`);
    await db.query("DROP SCHEMA IF EXISTS acl_api CASCADE"); await db.end(); await pool.end(); process.exit(2);
  }

  const { clearSchemaCache } = require("./services/schemaCapabilities");
  const { getClinicalContext } = require("./services/clinicalContextService");
  const express = require("express");
  const app = express();
  app.use("/api/stays", require("./routes/stays"));
  const token = jwt.sign({ user_id: 1, role: "ADMIN" }, process.env.JWT_SECRET);
  const realErr = console.error; console.error = () => {};

  const server = app.listen(0, async () => {
    const base = `http://localhost:${server.address().port}/api/stays`;
    const get = async (p) => { const r = await fetch(base + p, { signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json() }; };
    try {
      console.log("--- every stay sub-route answers (a missing () on the access guard makes a route hang forever) ---");
      for (const sub of ["", "/observations", "/news2", "/trends", "/diagnoses"]) {
        check(`GET /api/stays/100${sub} answers 200`, (await get("/100" + sub)).status, 200);
      }

      console.log("--- GET /api/stays/:id/observations ---");
      let r = await get("/100/observations");
      check("status 200 and existing fields still present", [r.status, r.body.count, "consciousness" in r.body.observations[0], "temperature_celsius" in r.body.observations[0]], [200, 4, true, true]);
      check("each row carries the three assumed flags",
        r.body.observations.map((o) => [o.consciousness_assumed, o.oxygen_support_assumed, o.spo2_scale_assumed]),
        [[true, true, true], [false, false, false], [null, null, null], [false, false, false]]);
      check("unknown inputs come back as null, not as a normal-looking value", [r.body.observations[3].consciousness, r.body.observations[3].oxygen_support, r.body.observations[3].spo2_scale], [null, null, null]);

      console.log("--- GET /api/stays/:id/news2 ---");
      r = await get("/100/news2");
      check("NEWS2 rows say whether their inputs were assumed (true / false / null)", r.body.news2_results.map((n) => n.based_on_assumed_inputs), [true, false, null]);
      check("existing NEWS2 fields unchanged", [r.body.news2_results[0].total_news2_score, r.body.news2_results[0].risk_level], [0, "Low Risk"]);

      console.log("--- clinical context ---");
      let ctx = await getClinicalContext(100);
      check("latest_observation has the flags (latest row has unknown inputs)", [ctx.latest_observation.consciousness, ctx.latest_observation.consciousness_assumed], [null, false]);
      check("latest_news2 is based on an observation with unknown provenance -> null", ctx.latest_news2.based_on_assumed_inputs, null);
      ctx = await getClinicalContext(200);
      check("a stay whose only score used assumed inputs -> true", [ctx.latest_news2.based_on_assumed_inputs, ctx.latest_observation.spo2_scale_assumed], [true, true]);

      console.log("--- database without spo2_scale_assumed (older layout) ---");
      await db.query("DROP VIEW observations_clean");
      await db.query("ALTER TABLE observations DROP COLUMN spo2_scale_assumed");
      await db.query(`CREATE VIEW observations_clean AS SELECT DISTINCT ON (stay_id, observation_time) observation_id, stay_id, observation_time, temperature,
        heart_rate, respiratory_rate, spo2, systolic_bp, data_source, consciousness, oxygen_support, spo2_scale,
        CASE WHEN temperature > 50 THEN round((temperature - 32) * 5.0 / 9.0, 1) ELSE temperature END AS temperature_celsius
        FROM observations ORDER BY stay_id, observation_time, observation_id`);
      clearSchemaCache();
      r = await get("/100/observations");
      check("observations route still works with two flags", [r.status, "spo2_scale_assumed" in r.body.observations[0], r.body.observations[0].consciousness_assumed], [200, false, true]);
      r = await get("/100/news2");
      check("NEWS2 route still works and uses the two flags", [r.status, r.body.news2_results.map((n) => n.based_on_assumed_inputs)], [200, [true, false, null]]);
      check("clinical context still works", (await getClinicalContext(200)).latest_news2.based_on_assumed_inputs, true);
    } catch (err) {
      failed++; realErr("TEST ERROR:", err.message);
    } finally {
      console.error = realErr;
      server.close();
      try { await pool.query("DROP SCHEMA IF EXISTS acl_api CASCADE"); } catch (_) {}
      try { await db.query("DROP SCHEMA IF EXISTS acl_api CASCADE"); } catch (_) {}
      await db.end(); await pool.end();
      console.log(`\n${failed} FAILED / ${total} CHECKS`);
      process.exit(failed ? 1 : 0);
    }
  });
})();
