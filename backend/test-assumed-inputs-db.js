// B10: the importer no longer invents consciousness / oxygen / SpO2-scale
// values, and the backfill marks the old invented ones. Real PostgreSQL, in a
// throw-away schema (acl_assume) that is dropped at the end.
//
//   set PRE_ER_TEST_ENV_FILE=path\to\your\test.env   (TEST database only)
//   node test-assumed-inputs-db.js

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { Client } = require("pg");

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

const MIGRATION = fs.readFileSync(path.join(__dirname, "../migrations/20261116_002_observation_spo2_scale_assumed.sql"), "utf8");
const MIGRATION_DOWN = fs.readFileSync(path.join(__dirname, "../migrations/20261116_002_observation_spo2_scale_assumed.down.sql"), "utf8");

const HEADER = "subject_id,stay_id,timestamp,temperature,heart_rate,respiratory_rate,spo2,systolic_bp,data_source";
const ROWS = [
  "1001,5001,2147-01-01 10:00:00,98.6,80,18,99,138,TEST",
  "1001,5001,2147-01-01 11:00:00,98.6,82,18,99,140,TEST",
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "assume-test-"));
const fixture = (name, lines) => { const p = path.join(tmp, name); fs.writeFileSync(p, [HEADER, ...lines].join("\n") + "\n"); return p; };

(async () => {
  const db = new Client(dbConfig());
  await db.connect();
  await db.query("DROP SCHEMA IF EXISTS acl_assume CASCADE");
  await db.query("CREATE SCHEMA acl_assume");
  await db.query("SET search_path TO acl_assume");
  await db.query(`
    CREATE TABLE patients (subject_id BIGINT PRIMARY KEY, data_source VARCHAR(50) NOT NULL, patient_id SERIAL);
    CREATE TABLE ed_stays (stay_id BIGINT PRIMARY KEY, subject_id BIGINT NOT NULL, intime TIMESTAMP,
      outtime TIMESTAMP, gender TEXT, disposition TEXT, chiefcomplaint TEXT, acuity INT);
    CREATE TABLE observations (observation_id SERIAL, stay_id BIGINT NOT NULL,
      observation_time TIMESTAMP NOT NULL, temperature NUMERIC(5,2) NOT NULL, heart_rate NUMERIC(5,2) NOT NULL,
      respiratory_rate NUMERIC(5,2) NOT NULL, spo2 NUMERIC(5,2) NOT NULL, systolic_bp NUMERIC(5,2) NOT NULL,
      data_source VARCHAR(50) NOT NULL, consciousness VARCHAR(10), oxygen_support BOOLEAN, spo2_scale SMALLINT,
      consciousness_assumed BOOLEAN, oxygen_support_assumed BOOLEAN, UNIQUE (stay_id, observation_time));
  `);

  const childEnv = { ...process.env, PGOPTIONS: "-c search_path=acl_assume" };
  const probe = new Client({ ...dbConfig(), options: "-c search_path=acl_assume" });
  await probe.connect();
  const cs = (await probe.query("SELECT current_schema() AS s")).rows[0].s;
  await probe.end();
  if (cs !== "acl_assume") {
    console.error(`ABORTED: connections are using schema "${cs}", not acl_assume. Nothing was run. Use a direct (non-pooled) connection string for this test.`);
    await db.query("DROP SCHEMA IF EXISTS acl_assume CASCADE"); await db.end(); process.exit(2);
  }

  const node = (script, args = [], env = {}) => {
    const r = spawnSync(process.execPath, [path.join(__dirname, "../scripts", script), ...args],
      { env: { ...childEnv, ...env }, encoding: "utf8", cwd: __dirname });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  const reset = () => db.query("TRUNCATE observations, ed_stays, patients");
  const stored = async (extra = "") =>
    (await db.query(`SELECT consciousness c, oxygen_support o, spo2_scale s,
                            consciousness_assumed ca, oxygen_support_assumed oa ${extra}
                     FROM observations ORDER BY observation_time`)).rows;
  const addLegacy = (stay, hour, cons, oxy, scale, source) => db.query(
    `INSERT INTO observations (stay_id, observation_time, temperature, heart_rate, respiratory_rate, spo2, systolic_bp,
                               data_source, consciousness, oxygen_support, spo2_scale)
     VALUES ($1, $2, 98.6, 80, 18, 99, 120, $3, $4, $5, $6)`,
    [stay, `2147-01-01 ${String(hour).padStart(2, "0")}:00`, source, cons, oxy, scale]);

  try {
    console.log("--- default import: unknown stays unknown ---");
    let r = node("importData.js", ["--file", fixture("a.csv", ROWS)]);
    check("import exits 0 and says the inputs are stored as UNKNOWN", [r.code, /stored as UNKNOWN \(NULL\)/.test(r.out)], [0, true]);
    check("consciousness / oxygen / SpO2 scale are NULL, not invented",
      (await stored()).map((x) => [x.c, x.o, x.s]), [[null, null, null], [null, null, null]]);
    check("unknown is not flagged as 'assumed' (nothing was invented)",
      (await stored()).map((x) => [x.ca, x.oa]), [[false, false], [false, false]]);

    console.log("--- --demo-defaults refuses to invent values without the flag columns ---");
    await reset();
    r = node("importData.js", ["--file", fixture("b.csv", ROWS), "--demo-defaults"]);
    check("--demo-defaults without spo2_scale_assumed exits 1 and names the migration",
      [r.code, /20261116_002_observation_spo2_scale_assumed/.test(r.out)], [1, true]);
    check("nothing was imported (patients and stays rolled back too)",
      (await db.query("SELECT (SELECT count(*) FROM observations)::int o, (SELECT count(*) FROM patients)::int p, (SELECT count(*) FROM ed_stays)::int s")).rows[0],
      { o: 0, p: 0, s: 0 });

    console.log("--- backfill, older two-flag layout (no spo2_scale_assumed) ---");
    await addLegacy(1, 1, "Alert", false, 1, "MIMIC_IV_ED_DEMO_v2.2");
    await addLegacy(1, 2, "Alert", false, 1, "MIMIC_IV_ED_DEMO_v2.2");
    await addLegacy(1, 3, "Alert", false, 1, "MIMIC_IV_ED_DEMO_v2.2");
    await addLegacy(1, 4, "V", true, 1, "MIMIC_IV_ED_DEMO_v2.2");      // looks measured
    await addLegacy(1, 5, "Alert", false, 1, "SOME_OTHER_SOURCE");      // other source
    r = node("backfillAssumedInputs.js");
    check("dry run reports 3 rows to update, 2 unclassified, and the missing third column",
      [r.code, /needing at least one flag filled: 3/.test(r.out), /provenance unknown\): 2/.test(r.out), /spo2_scale_assumed column does not exist/.test(r.out), /Dry run/.test(r.out)],
      [0, true, true, true, true]);
    check("dry run changed nothing", (await db.query("SELECT count(*)::int n FROM observations WHERE consciousness_assumed IS NOT NULL")).rows[0].n, 0);
    r = node("backfillAssumedInputs.js", ["--nonsense"]);
    check("unknown option refused", r.code, 1);
    r = node("backfillAssumedInputs.js", ["--apply"]);
    check("--apply works on the two-flag layout and updates the 3 old-default rows", [r.code, /Updated 3 observations/.test(r.out)], [0, true]);
    check("two flags set on those rows; measured-looking and other-source rows untouched",
      (await db.query("SELECT consciousness_assumed ca, oxygen_support_assumed oa FROM observations ORDER BY observation_time")).rows.map((x) => [x.ca, x.oa]),
      [[true, true], [true, true], [true, true], [null, null], [null, null]]);
    r = node("backfillAssumedInputs.js", ["--apply"]);
    check("second --apply on the two-flag layout has nothing to do", [r.code, /Nothing to update/.test(r.out)], [0, true]);

    console.log("--- migration, then completing partly classified rows ---");
    await db.query(MIGRATION);
    await db.query(MIGRATION);
    check("migration is re-runnable", true, true);
    // rows 1-3 now have two flags TRUE and the new third flag NULL (the Neon situation)
    r = node("backfillAssumedInputs.js");
    check("dry run counts rows whose two flags are already TRUE and whose third is NULL",
      [r.code, /needing at least one flag filled: 3/.test(r.out), /spo2_scale_assumed to fill: 3/.test(r.out), /consciousness_assumed to fill: 0/.test(r.out), /oxygen_support_assumed to fill: 0/.test(r.out)],
      [0, true, true, true, true]);
    r = node("backfillAssumedInputs.js", ["--apply"]);
    check("--apply fills only the missing third flag", [r.code, /Updated 3 observations/.test(r.out)], [0, true]);
    const flags = (await db.query(`SELECT consciousness_assumed ca, oxygen_support_assumed oa, spo2_scale_assumed sa FROM observations ORDER BY observation_time`)).rows;
    check("all three flags TRUE on the 3 old-default rows; the other 2 rows still untouched",
      flags.map((x) => [x.ca, x.oa, x.sa]), [[true, true, true], [true, true, true], [true, true, true], [null, null, null], [null, null, null]]);
    check("the values themselves are unchanged", (await db.query("SELECT consciousness c, oxygen_support o, spo2_scale s FROM observations ORDER BY observation_time LIMIT 1")).rows[0], { c: "Alert", o: false, s: 1 });
    r = node("backfillAssumedInputs.js", ["--apply"]);
    check("second --apply has nothing to do", [r.code, /Nothing to update/.test(r.out)], [0, true]);

    console.log("--- existing TRUE / FALSE flags are never overwritten ---");
    await reset();
    const mk = (hour, source, cons, c, o, sc) => db.query(
      `INSERT INTO observations (stay_id, observation_time, temperature, heart_rate, respiratory_rate, spo2, systolic_bp, data_source,
                                 consciousness, oxygen_support, spo2_scale, consciousness_assumed, oxygen_support_assumed, spo2_scale_assumed)
       VALUES (1, $1, 98.6, 80, 18, 99, 120, $2, $3, false, 1, $4, $5, $6)`,
      [`2147-01-01 ${String(hour).padStart(2, "0")}:00`, source, cons, c, o, sc]);
    const DEMO = "MIMIC_IV_ED_DEMO_v2.2";
    await mk(1, DEMO, "Alert", true, true, null);      // two TRUE, third NULL        -> third becomes TRUE
    await mk(2, DEMO, "Alert", false, null, null);     // FALSE + two NULL            -> FALSE kept, two filled TRUE
    await mk(3, DEMO, "Alert", false, false, null);    // two FALSE, third NULL       -> FALSE kept, third TRUE
    await mk(4, DEMO, "Alert", true, false, false);    // complete (TRUE/FALSE/FALSE) -> not touched at all
    await mk(5, DEMO, "Alert", null, true, true);      // first NULL, others TRUE     -> first TRUE
    await mk(6, DEMO, "Alert", true, true, true);      // already complete            -> not touched
    await mk(7, "SOME_OTHER_SOURCE", "Alert", true, true, null); // other source, partly set -> NOT touched
    await mk(8, DEMO, "V", true, true, null);          // values not the old defaults  -> NOT touched
    r = node("backfillAssumedInputs.js");
    check("dry run: 4 rows need at least one flag; fills = 1 conscious., 1 oxygen, 3 scale... counted per flag",
      [r.code, /needing at least one flag filled: 4/.test(r.out), /consciousness_assumed to fill: 1/.test(r.out), /oxygen_support_assumed to fill: 1/.test(r.out), /spo2_scale_assumed to fill: 3/.test(r.out)],
      [0, true, true, true, true]);
    check("dry run reports rows with an explicit FALSE and the 2 unclassified (other source, other values)",
      [/explicit FALSE flag[^:]*: 3/.test(r.out), /provenance unknown\): 2/.test(r.out), /every flag already set \(left alone\): 2/.test(r.out)],
      [true, true, true]);
    r = node("backfillAssumedInputs.js", ["--apply"]);
    check("--apply updates exactly the 4 rows", [r.code, /Updated 4 observations/.test(r.out)], [0, true]);
    check("only NULL flags were filled; every existing TRUE/FALSE kept; other rows untouched",
      (await db.query("SELECT consciousness_assumed ca, oxygen_support_assumed oa, spo2_scale_assumed sa FROM observations ORDER BY observation_time")).rows.map((x) => [x.ca, x.oa, x.sa]),
      [[true, true, true], [false, true, true], [false, false, true], [true, false, false], [true, true, true], [true, true, true], [true, true, null], [true, true, null]]);
    r = node("backfillAssumedInputs.js", ["--apply"]);
    check("re-running changes nothing", [r.code, /Nothing to update/.test(r.out)], [0, true]);

    console.log("--- the Neon situation: 554 rows, two flags TRUE, third column added later ---");
    await reset();
    await db.query(MIGRATION_DOWN);                         // back to the two-flag layout
    await db.query(`INSERT INTO observations (stay_id, observation_time, temperature, heart_rate, respiratory_rate, spo2, systolic_bp, data_source,
                                              consciousness, oxygen_support, spo2_scale, consciousness_assumed, oxygen_support_assumed)
                    SELECT 1, TIMESTAMP '2147-01-01 00:00' + (g || ' minutes')::interval, 98.6, 80, 18, 99, 120, 'MIMIC_IV_ED_DEMO_v2.2',
                           'Alert', false, 1, TRUE, TRUE FROM generate_series(1, 554) g`);
    r = node("backfillAssumedInputs.js", ["--apply"]);
    check("two-flag layout: nothing to update (both flags already TRUE)", [r.code, /Nothing to update/.test(r.out)], [0, true]);
    await db.query(MIGRATION);                              // the third column now exists, all NULL
    r = node("backfillAssumedInputs.js");
    check("after the migration the dry run finds all 554 rows", [r.code, /needing at least one flag filled: 554/.test(r.out), /spo2_scale_assumed to fill: 554/.test(r.out)], [0, true, true]);
    r = node("backfillAssumedInputs.js", ["--apply"]);
    check("--apply updates all 554 rows", [r.code, /Updated 554 observations/.test(r.out)], [0, true]);
    check("all 554 rows now have all three flags TRUE",
      (await db.query("SELECT count(*)::int n FROM observations WHERE consciousness_assumed AND oxygen_support_assumed AND spo2_scale_assumed")).rows[0].n, 554);
    r = node("backfillAssumedInputs.js", ["--apply"]);
    check("a further run has nothing to do", [r.code, /Nothing to update/.test(r.out)], [0, true]);

    console.log("--- import after the migration ---");
    await reset();
    r = node("importData.js", ["--file", fixture("c.csv", ROWS), "--demo-defaults"]);
    check("--demo-defaults exits 0 and says the values are ASSUMED", [r.code, /marked as ASSUMED/.test(r.out)], [0, true]);
    check("demo defaults stored together with all three assumed flags",
      (await db.query("SELECT consciousness c, oxygen_support o, spo2_scale s, consciousness_assumed ca, oxygen_support_assumed oa, spo2_scale_assumed sa FROM observations")).rows,
      [{ c: "Alert", o: false, s: 1, ca: true, oa: true, sa: true }, { c: "Alert", o: false, s: 1, ca: true, oa: true, sa: true }]);
    await reset();
    r = node("importData.js", ["--file", fixture("d.csv", ROWS)]);
    check("default import: values NULL and all three flags false",
      (await db.query("SELECT consciousness c, oxygen_support o, spo2_scale s, consciousness_assumed ca, oxygen_support_assumed oa, spo2_scale_assumed sa FROM observations")).rows,
      [{ c: null, o: null, s: null, ca: false, oa: false, sa: false }, { c: null, o: null, s: null, ca: false, oa: false, sa: false }]);
    r = node("importData.js", ["--dry-run", "--demo-defaults"], { DB_HOST: "127.0.0.1", DB_PORT: "1" });
    check("real CSV dry run with --demo-defaults needs no database and states the choice", [r.code, /marked as ASSUMED/.test(r.out)], [0, true]);
    r = node("importData.js", ["--dry-run"], { DB_HOST: "127.0.0.1", DB_PORT: "1" });
    check("real CSV dry run default states UNKNOWN", [r.code, /stored as UNKNOWN/.test(r.out), /Valid rows: 554/.test(r.out)], [0, true, true]);

    console.log("--- rollback ---");
    await db.query(MIGRATION_DOWN);
    check("down migration removes spo2_scale_assumed",
      (await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='acl_assume' AND table_name='observations' AND column_name='spo2_scale_assumed'")).rows[0].n, 0);
  } catch (err) {
    failed++; console.error("TEST ERROR:", err.message);
  } finally {
    try { await db.query("SET search_path TO public"); await db.query("DROP SCHEMA IF EXISTS acl_assume CASCADE"); } catch (_) {}
    await db.end();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${failed} FAILED / ${total} CHECKS`);
    process.exit(failed ? 1 : 0);
  }
})();
