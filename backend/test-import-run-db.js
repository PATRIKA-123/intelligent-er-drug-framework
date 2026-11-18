// B08: runs the REAL importer (scripts/importData.js) as a separate process
// against a throw-away schema (acl_imp), with small fixture files.
// Your real tables are never used; the schema is dropped at the end.
//
//   set PRE_ER_TEST_ENV_FILE=path\to\your\test.env   (TEST database only)
//   node test-import-run-db.js

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

const HEADER = "subject_id,stay_id,timestamp,temperature,heart_rate,respiratory_rate,spo2,systolic_bp,data_source";
const GOOD1 = "1001,5001,2147-01-01 10:00:00,97.3,80.0,18.0,99.0,138.0,TEST";
const GOOD2 = "1001,5001,2147-01-01 11:00:00,98.5,82,18,100,142,TEST";
const GOOD3 = "1002,5002,2147-01-02 09:00:00,36.8,70,16,97,120,TEST";
const BAD_NAN = "1001,5001,2147-01-01 12:00:00,NaN,80,18,99,138,TEST";
const BAD_NEG = "1001,5001,2147-01-01 13:00:00,98.5,-5,18,99,138,TEST";
const BAD_SPO2 = "1001,5001,2147-01-01 14:00:00,98.5,80,18,150,138,TEST";
const BAD_DEC = "1001,5001,2147-01-01 15:00:00,98.5,80,18,99,138.123,TEST";
const BAD_ABC = "1001,5001,2147-01-01 16:00:00,98.5,abc,18,99,138,TEST";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "import-test-"));
const fixture = (name, lines) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, [HEADER, ...lines].join("\n") + "\n");
  return p;
};

(async () => {
  const db = new Client(dbConfig());
  await db.connect();
  await db.query("DROP SCHEMA IF EXISTS acl_imp CASCADE");
  await db.query("CREATE SCHEMA acl_imp");
  await db.query("SET search_path TO acl_imp");
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

  // The importer is a separate process: confirm its connections would land in acl_imp.
  const childEnvBase = { ...process.env, PGOPTIONS: "-c search_path=acl_imp" };
  const probe = new Client({ ...dbConfig(), options: "-c search_path=acl_imp" });
  await probe.connect();
  const cs = (await probe.query("SELECT current_schema() AS s")).rows[0].s;
  await probe.end();
  if (cs !== "acl_imp") {
    console.error(`ABORTED: connections are using schema "${cs}", not acl_imp. Nothing was run. ` +
      "Use a direct (non-pooled) connection string for this test.");
    await db.query("DROP SCHEMA IF EXISTS acl_imp CASCADE");
    await db.end(); process.exit(2);
  }

  const importer = path.join(__dirname, "../scripts/importData.js");
  const run = (args, envOverride = {}) => {
    const r = spawnSync(process.execPath, [importer, ...args], {
      env: { ...childEnvBase, ...envOverride }, encoding: "utf8", cwd: __dirname,
    });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  const counts = async () =>
    (await db.query(`SELECT (SELECT count(*) FROM patients)::int AS p,
                            (SELECT count(*) FROM ed_stays)::int AS s,
                            (SELECT count(*) FROM observations)::int AS o`)).rows[0];
  const reset = () => db.query("TRUNCATE observations, ed_stays, patients");

  try {
    console.log("--- valid file ---");
    await reset();
    let r = run(["--file", fixture("valid.csv", [GOOD1, GOOD2, GOOD3])]);
    check("valid file exits 0", r.code, 0);
    check("valid file imports 2 patients, 2 stays, 3 observations", await counts(), { p: 2, s: 2, o: 3 });
    const stored = (await db.query("SELECT temperature::text t, heart_rate::text h FROM observations ORDER BY observation_time LIMIT 1")).rows[0];
    check("values are stored exactly (97.3 / 80)", stored, { t: "97.30", h: "80.00" });

    console.log("--- invalid values: nothing is imported, problems are named ---");
    await reset();
    r = run(["--file", fixture("silent.csv", [BAD_NAN, BAD_NEG, BAD_SPO2, BAD_DEC])]);
    check("NaN / negative / SpO2 150 / 3-decimals file exits 1", r.code, 1);
    check("database is untouched", await counts(), { p: 0, s: 0, o: 0 });
    check("report names the CSV line and field of the NaN", /CSV line 2, field "temperature", value "NaN"/.test(r.out), true);
    check("report names the negative heart rate", /CSV line 3, field "heart_rate", value "-5"/.test(r.out), true);
    check("report names the SpO2 above 100", /CSV line 4, field "spo2", value "150"/.test(r.out), true);
    check("report names the 3-decimal value", /CSV line 5, field "systolic_bp", value "138.123"/.test(r.out), true);

    await reset();
    r = run(["--file", fixture("garbage.csv", [GOOD1, BAD_ABC])]);
    check("non-numeric value exits 1 with line and field", [r.code, /CSV line 3, field "heart_rate", value "abc"/.test(r.out)], [1, true]);
    check("database is untouched (garbage file)", await counts(), { p: 0, s: 0, o: 0 });

    console.log("--- mixed file ---");
    const mixed = fixture("mixed.csv", [GOOD1, BAD_NAN, GOOD2, BAD_NEG]);
    await reset();
    r = run(["--file", mixed]);
    check("mixed file without a flag exits 1", r.code, 1);
    check("mixed file without a flag imports nothing", await counts(), { p: 0, s: 0, o: 0 });
    r = run(["--file", mixed, "--skip-invalid"]);
    check("--skip-invalid exits 0", r.code, 0);
    check("--skip-invalid imports only the 2 valid rows", await counts(), { p: 1, s: 1, o: 2 });
    check("--skip-invalid still reports the 2 rejected rows", /Rejected rows: 2/.test(r.out), true);
    await reset();
    r = run(["--file", fixture("allbad.csv", [BAD_NAN, BAD_NEG]), "--skip-invalid"]);
    check("--skip-invalid with no valid rows exits 1", [r.code, (await counts()).o], [1, 0]);

    console.log("--- dry run ---");
    await reset();
    r = run(["--file", fixture("valid2.csv", [GOOD1, GOOD2]), "--dry-run"], { DB_HOST: "127.0.0.1", DB_PORT: "1" });
    check("--dry-run on a valid file exits 0 even with an unreachable database", r.code, 0);
    check("--dry-run says it made no connection", /no database connection/i.test(r.out), true);
    check("--dry-run wrote nothing", await counts(), { p: 0, s: 0, o: 0 });
    r = run(["--file", mixed, "--dry-run"], { DB_HOST: "127.0.0.1", DB_PORT: "1" });
    check("--dry-run on an invalid file exits 1", r.code, 1);

    console.log("--- safety ---");
    r = run(["--file", mixed, "--dryrun"]);
    check("a mistyped option is refused (never runs a real import)", [r.code, (await counts()).o], [1, 0]);
    r = run(["--file", path.join(tmp, "does-not-exist.csv")]);
    check("missing file exits 1", r.code, 1);

    console.log("--- the real project CSV ---");
    r = run(["--dry-run"], { DB_HOST: "127.0.0.1", DB_PORT: "1" });
    check("data/cleaned_vitals.csv: dry run passes, 554 valid rows",
      [r.code, /Valid rows: 554/.test(r.out), /Rejected rows: 0/.test(r.out)], [0, true, true]);
  } catch (err) {
    failed++; console.error("TEST ERROR:", err.message);
  } finally {
    try { await db.query("SET search_path TO public"); await db.query("DROP SCHEMA IF EXISTS acl_imp CASCADE"); } catch (_) {}
    await db.end();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${failed} FAILED / ${total} CHECKS`);
    process.exit(failed ? 1 : 0);
  }
})();
