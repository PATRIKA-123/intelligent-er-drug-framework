// B09: real-database test of the migration, the view, the backfill script and
// the importer. Everything happens in a throw-away schema (acl_temp) that is
// dropped at the end. Your real tables are never used.
//
//   set PRE_ER_TEST_ENV_FILE=path\to\your\test.env   (TEST database only)
//   node test-temperature-units-db.js

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { Client } = require("pg");
const { classifyTemperature } = require("../scripts/temperatureUnits");

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

const MIGRATION = fs.readFileSync(path.join(__dirname, "../migrations/20261116_001_observation_temperature_units.sql"), "utf8");
const MIGRATION_DOWN = fs.readFileSync(path.join(__dirname, "../migrations/20261116_001_observation_temperature_units.down.sql"), "utf8");

const LEGACY_VIEW = `
CREATE VIEW observations_clean AS
 SELECT DISTINCT ON (stay_id, observation_time) observation_id, stay_id, observation_time, temperature,
    heart_rate, respiratory_rate, spo2, systolic_bp, data_source, consciousness, oxygen_support, spo2_scale,
        CASE WHEN (temperature > (50)::numeric) THEN round((((temperature - (32)::numeric) * 5.0) / 9.0), 1)
             ELSE temperature END AS temperature_celsius
   FROM observations
  ORDER BY stay_id, observation_time, observation_id`;

const HEADER = "subject_id,stay_id,timestamp,temperature,heart_rate,respiratory_rate,spo2,systolic_bp,data_source";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "temp-test-"));
const fixture = (name, lines) => { const p = path.join(tmp, name); fs.writeFileSync(p, [HEADER, ...lines].join("\n") + "\n"); return p; };

(async () => {
  const db = new Client(dbConfig());
  await db.connect();
  await db.query("DROP SCHEMA IF EXISTS acl_temp CASCADE");
  await db.query("CREATE SCHEMA acl_temp");
  await db.query("SET search_path TO acl_temp");
  await db.query(`
    CREATE TABLE patients (subject_id BIGINT PRIMARY KEY, data_source VARCHAR(50) NOT NULL, patient_id SERIAL);
    CREATE TABLE ed_stays (stay_id BIGINT PRIMARY KEY, subject_id BIGINT NOT NULL, intime TIMESTAMP,
      outtime TIMESTAMP, gender TEXT, disposition TEXT, chiefcomplaint TEXT, acuity INT);
    CREATE TABLE observations (observation_id SERIAL, stay_id BIGINT NOT NULL,
      observation_time TIMESTAMP NOT NULL, temperature NUMERIC(5,2) NOT NULL, heart_rate NUMERIC(5,2) NOT NULL,
      respiratory_rate NUMERIC(5,2) NOT NULL, spo2 NUMERIC(5,2) NOT NULL, systolic_bp NUMERIC(5,2) NOT NULL,
      data_source VARCHAR(50) NOT NULL, consciousness VARCHAR(10), oxygen_support BOOLEAN, spo2_scale SMALLINT,
      consciousness_assumed BOOLEAN, oxygen_support_assumed BOOLEAN, UNIQUE (stay_id, observation_time));
  ` + LEGACY_VIEW);

  const childEnv = { ...process.env, PGOPTIONS: "-c search_path=acl_temp" };
  const probe = new Client({ ...dbConfig(), options: "-c search_path=acl_temp" });
  await probe.connect();
  const cs = (await probe.query("SELECT current_schema() AS s")).rows[0].s;
  await probe.end();
  if (cs !== "acl_temp") {
    console.error(`ABORTED: connections are using schema "${cs}", not acl_temp. Nothing was run. Use a direct (non-pooled) connection string for this test.`);
    await db.query("DROP SCHEMA IF EXISTS acl_temp CASCADE"); await db.end(); process.exit(2);
  }

  const node = (script, args = [], env = {}) => {
    const r = spawnSync(process.execPath, [path.join(__dirname, "../scripts", script), ...args],
      { env: { ...childEnv, ...env }, encoding: "utf8", cwd: __dirname });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  const viewTemps = async () =>
    (await db.query("SELECT temperature_celsius::text AS c FROM observations_clean ORDER BY observation_time")).rows.map((r) => r.c);
  const rawTemps = async () =>
    (await db.query("SELECT temperature::text AS t FROM observations ORDER BY observation_time")).rows.map((r) => r.t);
  const insert = (stay, hour, temp) => db.query(
    `INSERT INTO observations (stay_id, observation_time, temperature, heart_rate, respiratory_rate, spo2, systolic_bp, data_source)
     VALUES ($1, $2, $3, 80, 18, 99, 120, 'T')`, [stay, `2147-01-01 ${String(hour).padStart(2, "0")}:00`, temp]);

  try {
    console.log("--- before the migration: the old behaviour ---");
    for (const [h, t] of [[1, 98.6], [2, 36.8], [3, 60], [4, 48], [5, 200]]) await insert(1, h, t);
    const legacy = await viewTemps();
    check("old view: 98.6->37.0, 36.8 kept, and implausible 60/48/200 silently 'converted'", legacy, ["37.0", "36.80", "15.6", "48.00", "93.3"]);

    console.log("--- migration ---");
    await db.query(MIGRATION);
    await db.query(MIGRATION); // safe to run twice
    check("migration is re-runnable", true, true);
    check("view values unchanged before any row is classified", await viewTemps(), legacy);
    const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='acl_temp' AND table_name='observations_clean' ORDER BY ordinal_position")).rows.map((r) => r.column_name);
    check("view keeps its old columns in order and adds temperature_unit_status last",
      [cols.slice(0, 13).join(","), cols[13]],
      ["observation_id,stay_id,observation_time,temperature,heart_rate,respiratory_rate,spo2,systolic_bp,data_source,consciousness,oxygen_support,spo2_scale,temperature_celsius", "temperature_unit_status"]);
    let rejected = false;
    try { await db.query("UPDATE observations SET temperature_unit_status = 'GUESS' WHERE observation_id = 1"); } catch (_) { rejected = true; }
    check("database refuses an unknown unit status value", rejected, true);

    console.log("--- backfill: dry run, then apply ---");
    let r = node("backfillTemperatureUnits.js");
    check("dry run exits 0 and reports counts", [r.code, /CONVERTED_FROM_F: 1/.test(r.out), /UNVERIFIED_CELSIUS: 1/.test(r.out), /IMPLAUSIBLE: 3/.test(r.out)], [0, true, true, true]);
    check("dry run changed nothing", (await db.query("SELECT count(*)::int n FROM observations WHERE temperature_unit_status IS NOT NULL")).rows[0].n, 0);
    r = node("backfillTemperatureUnits.js", ["--bogus"]);
    check("unknown option is refused", r.code, 1);
    r = node("backfillTemperatureUnits.js", ["--apply"]);
    check("--apply exits 0 and updates 5 rows", [r.code, /Updated 5 observations/.test(r.out)], [0, true]);
    check("statuses stored",
      (await db.query("SELECT temperature_unit_status s FROM observations ORDER BY observation_time")).rows.map((x) => x.s),
      ["CONVERTED_FROM_F", "UNVERIFIED_CELSIUS", "IMPLAUSIBLE", "IMPLAUSIBLE", "IMPLAUSIBLE"]);
    check("canonical Celsius only where the unit is verified (others NULL)", await viewTemps(), ["37.0", null, null, null, null]);
    check("raw temperature values untouched", await rawTemps(), ["98.60", "36.80", "60.00", "48.00", "200.00"]);
    r = node("backfillTemperatureUnits.js", ["--apply"]);
    check("second --apply has nothing to do", [r.code, /Nothing to update/.test(r.out)], [0, true]);

    console.log("--- conversion matches the database formula for every 0.01 F from 77 to 113 ---");
    const sqlRows = (await db.query(`SELECT g, round(((g/100.0 - 32) * 5.0) / 9.0, 1)::text AS c FROM generate_series(7700, 11300) g`)).rows;
    const mismatches = sqlRows.filter((x) => String(classifyTemperature(x.g / 100).celsius.toFixed(1)) !== x.c);
    check("3601 Fahrenheit values: 0 differences from the old SQL calculation", mismatches.length, 0);

    console.log("--- operator accepts inferred Celsius ---");
    await insert(2, 1, 36.8); await insert(2, 2, 98.6);
    r = node("backfillTemperatureUnits.js", ["--apply", "--accept-inferred-celsius"]);
    check("backfill with --accept-inferred-celsius updates only the 2 new rows", [r.code, /Updated 2 observations/.test(r.out)], [0, true]);
    check("36.8 stored as INFERRED_CELSIUS with 36.80",
      (await db.query("SELECT temperature_unit_status s, temperature_celsius_verified::text c FROM observations WHERE stay_id = 2 ORDER BY observation_time")).rows,
      [{ s: "INFERRED_CELSIUS", c: "36.80" }, { s: "CONVERTED_FROM_F", c: "37.0" }]);
    check("earlier UNVERIFIED row stays unverified", (await db.query("SELECT temperature_unit_status s FROM observations WHERE stay_id = 1 AND temperature = 36.8")).rows[0].s, "UNVERIFIED_CELSIUS");

    console.log("--- importer stores the status ---");
    await db.query("TRUNCATE observations, ed_stays, patients");
    const rows = ["1001,5001,2147-01-01 10:00:00,98.6,80,18,99,138,TEST", "1001,5001,2147-01-01 11:00:00,36.8,80,18,99,138,TEST", "1001,5001,2147-01-01 12:00:00,60,80,18,99,138,TEST"];
    r = node("importData.js", ["--file", fixture("t.csv", rows)]);
    check("import succeeds and prints the status counts", [r.code, /CONVERTED_FROM_F: 1/.test(r.out), /UNVERIFIED_CELSIUS: 1/.test(r.out), /IMPLAUSIBLE: 1/.test(r.out)], [0, true, true, true]);
    check("importer stored source unit, status and canonical Celsius",
      (await db.query("SELECT temperature_source_unit u, temperature_unit_status s, temperature_celsius_verified::text c FROM observations ORDER BY observation_time")).rows,
      [{ u: "F", s: "CONVERTED_FROM_F", c: "37.0" }, { u: "C", s: "UNVERIFIED_CELSIUS", c: null }, { u: null, s: "IMPLAUSIBLE", c: null }]);
    await db.query("TRUNCATE observations, ed_stays, patients");
    r = node("importData.js", ["--file", fixture("t2.csv", rows), "--accept-inferred-celsius"]);
    check("--accept-inferred-celsius stores INFERRED_CELSIUS", (await db.query("SELECT temperature_unit_status s FROM observations ORDER BY observation_time")).rows.map((x) => x.s), ["CONVERTED_FROM_F", "INFERRED_CELSIUS", "IMPLAUSIBLE"]);
    r = node("importData.js", ["--dry-run"], { DB_HOST: "127.0.0.1", DB_PORT: "1" });
    check("real project CSV dry run: 520 Fahrenheit, 34 unverified Celsius, no database needed",
      [r.code, /CONVERTED_FROM_F: 520/.test(r.out), /UNVERIFIED_CELSIUS: 34/.test(r.out)], [0, true, true]);

    console.log("--- rollback and a database without the migration ---");
    await db.query(MIGRATION_DOWN);
    const colsAfter = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='acl_temp' AND table_name='observations' AND column_name LIKE 'temperature_%'")).rows;
    check("down migration removes the three columns", colsAfter.length, 0);
    check("view is back to the old shape", (await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='acl_temp' AND table_name='observations_clean'")).rows[0].n, 13);
    await db.query("TRUNCATE observations, ed_stays, patients");
    r = node("importData.js", ["--file", fixture("t3.csv", rows)]);
    check("importer still works without the columns and says so", [r.code, /unit columns not found/.test(r.out), (await db.query("SELECT count(*)::int n FROM observations")).rows[0].n], [0, true, 3]);
    r = node("backfillTemperatureUnits.js", ["--apply"]);
    check("backfill refuses to run without the columns", [r.code, /Apply migrations/.test(r.out)], [1, true]);
  } catch (err) {
    failed++; console.error("TEST ERROR:", err.message);
  } finally {
    try { await db.query("SET search_path TO public"); await db.query("DROP SCHEMA IF EXISTS acl_temp CASCADE"); } catch (_) {}
    await db.end();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${failed} FAILED / ${total} CHECKS`);
    process.exit(failed ? 1 : 0);
  }
})();