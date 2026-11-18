// B09: give every EXISTING observation a temperature unit status.
//
// Safe by default: it only reports what it would do. Nothing changes unless you
// pass --apply. It only touches rows that have no status yet, never changes the
// raw observations.temperature value, and can be re-run.
//
//   cd backend
//   npm run backfill:temperature-units                       (dry run)
//   npm run backfill:temperature-units -- --apply            (writes)
//   npm run backfill:temperature-units -- --apply --accept-inferred-celsius
//
// Requires migrations/20261116_001_observation_temperature_units.sql first.
// Run it on a TEST database before any shared one.

const path = require("path");
const backendRequire = require("module").createRequire(
  path.join(__dirname, "../backend/package.json")
);
backendRequire("dotenv").config();
const { Client } = backendRequire("pg");
const { classifyTemperature, celsiusForDatabase } = require("./temperatureUnits");

const args = process.argv.slice(2);
const KNOWN = ["--apply", "--accept-inferred-celsius"];
const unknown = args.filter((a) => !KNOWN.includes(a));
if (unknown.length > 0) {
  console.error(`Unknown option: ${unknown.join(" ")}\nUsage: npm run backfill:temperature-units -- [--apply] [--accept-inferred-celsius]`);
  process.exit(1);
}
const apply = args.includes("--apply");
const acceptInferredCelsius = args.includes("--accept-inferred-celsius");

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
      [["temperature_source_unit", "temperature_unit_status", "temperature_celsius_verified"]]
    );
    if (cols.rowCount !== 3) {
      console.error("The temperature unit columns do not exist yet. Apply migrations/20261116_001_observation_temperature_units.sql first.");
      process.exitCode = 1;
      return;
    }

    const rows = await client.query(
      `SELECT observation_id, temperature
       FROM observations
       WHERE temperature_unit_status IS NULL
       ORDER BY observation_id`
    );
    console.log(`Observations without a unit status: ${rows.rowCount}`);

    const ids = [], units = [], statuses = [], celsius = [];
    const counts = {};
    for (const r of rows.rows) {
      const info = classifyTemperature(Number(r.temperature), { acceptInferredCelsius });
      ids.push(r.observation_id);
      units.push(info.unit);
      statuses.push(info.status);
      celsius.push(celsiusForDatabase(info));
      counts[info.status] = (counts[info.status] || 0) + 1;
    }
    for (const [status, count] of Object.entries(counts)) console.log(`  ${status}: ${count}`);

    if (!apply) {
      console.log("Dry run: nothing was changed. Re-run with --apply to write these statuses.");
      return;
    }
    if (ids.length === 0) {
      console.log("Nothing to update.");
      return;
    }

    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE observations o
       SET temperature_source_unit = v.u,
           temperature_unit_status = v.s,
           temperature_celsius_verified = v.c
       FROM (
         SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS u,
                unnest($3::text[]) AS s, unnest($4::numeric[]) AS c
       ) v
       WHERE o.observation_id = v.id AND o.temperature_unit_status IS NULL`,
      [ids, units, statuses, celsius]
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
