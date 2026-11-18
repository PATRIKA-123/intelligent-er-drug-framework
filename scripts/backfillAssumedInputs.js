// B10: mark EXISTING observations whose consciousness / oxygen support /
// SpO2 scale are the importer's old invented defaults.
//
// Before B10 the importer wrote consciousness = 'Alert', oxygen_support = false
// and spo2_scale = 1 for every row because the CSV has none of these fields.
// Those rows look like measured results. This script sets the three *_assumed
// flags to true on exactly those rows so the API can say so.
//
// Safe by default: dry run unless you pass --apply. It never changes the
// values themselves, only rows whose flags are still unset, and can be re-run.
//
//   cd backend
//   npm run backfill:assumed-inputs                    (dry run)
//   npm run backfill:assumed-inputs -- --apply
//   npm run backfill:assumed-inputs -- --data-source MY_SOURCE
//
// Needs migrations/20261116_002_observation_spo2_scale_assumed.sql for --apply.
// Run on a TEST database first.

const path = require("path");
const backendRequire = require("module").createRequire(
  path.join(__dirname, "../backend/package.json")
);
backendRequire("dotenv").config({
  path: process.env.PRE_ER_TEST_ENV_FILE || path.join(__dirname, "../backend/.env"),
  override: true,
});
const { Client } = backendRequire("pg");

const args = process.argv.slice(2);
const sourceIndex = args.indexOf("--data-source");
const unknown = args.filter(
  (a, i) => a.startsWith("--") && !["--apply", "--data-source"].includes(a)
);
if (unknown.length > 0 || (sourceIndex !== -1 && !args[sourceIndex + 1])) {
  console.error(
    `Unknown or incomplete option: ${unknown.join(" ") || "--data-source needs a name"}\n` +
      "Usage: npm run backfill:assumed-inputs -- [--apply] [--data-source <name>]"
  );
  process.exit(1);
}
const apply = args.includes("--apply");
const dataSource = sourceIndex !== -1 ? args[sourceIndex + 1] : "MIMIC_IV_ED_DEMO_v2.2";

const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

(async () => {
  try {
    await client.connect();

    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'observations'
         AND column_name = ANY($1)`,
      [["consciousness_assumed", "oxygen_support_assumed", "spo2_scale_assumed"]]
    );
    const have = new Set(cols.rows.map((r) => r.column_name));
    const hasScaleFlag = have.has("spo2_scale_assumed");
    if (!have.has("consciousness_assumed") || !have.has("oxygen_support_assumed")) {
      console.error("observations has no consciousness_assumed / oxygen_support_assumed columns. Nothing to do.");
      process.exitCode = 1;
      return;
    }

    // "flags still unset" = never classified before
    const unset = `consciousness_assumed IS NULL AND oxygen_support_assumed IS NULL` +
      (hasScaleFlag ? ` AND spo2_scale_assumed IS NULL` : ``);
    const legacyDefaults = `consciousness = 'Alert' AND oxygen_support IS FALSE AND spo2_scale = 1`;

    const summary = await client.query(
      `SELECT
         count(*) FILTER (WHERE ${unset} AND data_source = $1 AND ${legacyDefaults})::int AS to_mark,
         count(*) FILTER (WHERE ${unset} AND NOT (data_source = $1 AND ${legacyDefaults}))::int AS unclassified,
         count(*) FILTER (WHERE NOT (${unset}))::int AS already_flagged,
         count(*)::int AS total
       FROM observations`,
      [dataSource]
    );
    const s = summary.rows[0];
    console.log(`Observations in total: ${s.total}`);
    console.log(`Flags already set (left alone): ${s.already_flagged}`);
    console.log(`Old invented defaults from data_source "${dataSource}" (will be marked assumed): ${s.to_mark}`);
    console.log(`Flags unset but values do not match the old defaults (left alone, provenance unknown): ${s.unclassified}`);

    if (!apply) {
      console.log("Dry run: nothing was changed. Re-run with --apply to mark them.");
      return;
    }
    if (!hasScaleFlag) {
      console.error("The spo2_scale_assumed column does not exist. Apply migrations/20261116_002_observation_spo2_scale_assumed.sql first. Nothing was changed.");
      process.exitCode = 1;
      return;
    }
    if (s.to_mark === 0) {
      console.log("Nothing to update.");
      return;
    }
1``
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE observations
       SET consciousness_assumed = TRUE,
           oxygen_support_assumed = TRUE,
           spo2_scale_assumed = TRUE
       WHERE ${unset} AND data_source = $1 AND ${legacyDefaults}`,
      [dataSource]
    );
    await client.query("COMMIT");
    console.log(`Marked ${result.rowCount} observations as assumed.`);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Backfill failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
