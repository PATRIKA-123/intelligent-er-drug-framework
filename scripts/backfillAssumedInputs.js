// B10: mark EXISTING observations whose consciousness / oxygen support /
// SpO2 scale are the importer's old invented defaults.
//
// Before B10 the importer wrote consciousness = 'Alert', oxygen_support = false
// and spo2_scale = 1 for every row because the CSV has none of these fields.
// Those rows look like measured results. This script sets the *_assumed flags
// to TRUE on exactly those rows so the API can say so.
//
// Rules:
//   * Only rows from the chosen data source whose values are the old defaults.
//   * Only flags that are still NULL are filled. An existing TRUE or FALSE is
//     NEVER changed, so partly classified rows (for example two flags already
//     TRUE, the third column added later) are completed, not skipped.
//   * Works with the older two-flag layout (no spo2_scale_assumed column) and
//     with the three-flag layout. The values themselves are never changed.
//
// Safe by default: dry run unless you pass --apply. Can be re-run.
//
//   cd backend
//   npm run backfill:assumed-inputs                    (dry run)
//   npm run backfill:assumed-inputs -- --apply
//   npm run backfill:assumed-inputs -- --data-source MY_SOURCE
//
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

    // The flags that exist in THIS database (two-flag or three-flag layout).
    const flagColumns = ["consciousness_assumed", "oxygen_support_assumed"];
    if (hasScaleFlag) flagColumns.push("spo2_scale_assumed");

    const needsUpdate = flagColumns.map((f) => `${f} IS NULL`).join(" OR ");
    const anyFalse = flagColumns.map((f) => `${f} IS FALSE`).join(" OR ");
    const legacyDefaults =
      `data_source = $1 AND consciousness = 'Alert' AND oxygen_support IS FALSE AND spo2_scale = 1`;

    const fillCounts = flagColumns
      .map((f, i) => `count(*) FILTER (WHERE (${legacyDefaults}) AND ${f} IS NULL)::int AS fill_${i}`)
      .join(",\n         ");

    const summary = await client.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE (${legacyDefaults}) AND (${needsUpdate}))::int AS to_update,
         count(*) FILTER (WHERE (${legacyDefaults}) AND NOT (${needsUpdate}))::int AS already_complete,
         count(*) FILTER (WHERE (${legacyDefaults}) AND (${anyFalse}))::int AS kept_false,
         count(*) FILTER (WHERE NOT (${legacyDefaults}) AND (${needsUpdate}))::int AS unclassified,
         ${fillCounts}
       FROM observations`,
      [dataSource]
    );
    const s = summary.rows[0];
    console.log(`Observations in total: ${s.total}`);
    console.log(`Old invented defaults from data_source "${dataSource}" needing at least one flag filled: ${s.to_update}`);
    flagColumns.forEach((f, i) => console.log(`  ${f} to fill: ${s["fill_" + i]}`));
    console.log(`Old invented defaults with every flag already set (left alone): ${s.already_complete}`);
    console.log(`Old invented defaults with an explicit FALSE flag (FALSE is kept; only NULL flags are filled): ${s.kept_false}`);
    console.log(`Flags unset but values do not match the old defaults (left alone, provenance unknown): ${s.unclassified}`);
    if (!hasScaleFlag) {
      console.log(
        "NOTE: the spo2_scale_assumed column does not exist yet, so the SpO2 scale is not flagged. " +
          "Apply migrations/20261116_002_observation_spo2_scale_assumed.sql, then run this script again."
      );
    }

    if (!apply) {
      console.log("Dry run: nothing was changed. Re-run with --apply to fill the missing flags.");
      return;
    }
    if (s.to_update === 0) {
      console.log("Nothing to update.");
      return;
    }

    // COALESCE keeps any existing TRUE or FALSE and only fills NULL.
    const setClause = flagColumns.map((f) => `${f} = COALESCE(${f}, TRUE)`).join(",\n           ");
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE observations
       SET ${setClause}
       WHERE (${legacyDefaults}) AND (${needsUpdate})`,
      [dataSource]
    );
    await client.query("COMMIT");
    console.log(`Updated ${result.rowCount} observations.`);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Backfill failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
