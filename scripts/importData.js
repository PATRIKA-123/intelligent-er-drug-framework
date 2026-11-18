const fs = require("fs");
const path = require("path");

// This script lives outside backend/, so Node would not find the packages that
// "npm install" put in backend/node_modules. Load them from the backend
// package so there is only ONE package.json and ONE install to maintain.
// Supported command:  cd backend && npm install && npm run import:data
const backendRequire = require("module").createRequire(
  path.join(__dirname, "../backend/package.json")
);

backendRequire("dotenv").config();

const csv = backendRequire("csv-parser");
const { Client } = backendRequire("pg");

// PostgreSQL connection

// PostgreSQL connection
const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:
    process.env.DB_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
});


const { validateAll } = require("./importValidation");
const { classifyTemperature, celsiusForDatabase } = require("./temperatureUnits");

// Options:
//   --file <path>    CSV to import (default: data/cleaned_vitals.csv)
//   --dry-run        check the file only; never connects to the database
//   --skip-invalid   import the valid rows and report the rejected ones
//                    (default: if ANY row is invalid, nothing is imported)
//   --accept-inferred-celsius
//                    treat values that can only be Celsius (25-45) as Celsius
//                    and store them, labelled INFERRED_CELSIUS. Default: they
//                    are kept as UNVERIFIED_CELSIUS with no canonical Celsius.
const args = process.argv.slice(2);
const KNOWN_FLAGS = ["--file", "--dry-run", "--skip-invalid", "--accept-inferred-celsius"];
const fileFlagIndex = args.indexOf("--file");
const unknownFlags = args.filter(
  (a, i) => a.startsWith("--") && !KNOWN_FLAGS.includes(a)
);
if (unknownFlags.length > 0 || (fileFlagIndex !== -1 && !args[fileFlagIndex + 1])) {
  console.error(
    `Unknown or incomplete option: ${unknownFlags.join(" ") || "--file needs a path"}\n` +
      "Usage: npm run import:data -- [--file <path>] [--dry-run] [--skip-invalid]"
  );
  process.exit(1);
}
const dryRun = args.includes("--dry-run");
const skipInvalid = args.includes("--skip-invalid");
const acceptInferredCelsius = args.includes("--accept-inferred-celsius");

// CSV file path
const csvFilePath =
  fileFlagIndex !== -1
    ? path.resolve(args[fileFlagIndex + 1])
    : path.join(__dirname, "../data/cleaned_vitals.csv");

if (!fs.existsSync(csvFilePath)) {
  console.error(`CSV file not found: ${csvFilePath}`);
  process.exit(1);
}

const records = [];

// Read CSV
fs.createReadStream(csvFilePath)
  .pipe(csv())
  .on("data", (row) => {
    records.push(row);
  })
  .on("end", async () => {
    console.log("CSV loaded successfully.");
    console.log(`Total records found: ${records.length}`);

    // ---- Validate every row BEFORE touching the database ----
    const { validRows, problems, rejectedRowCount } = validateAll(records);
    console.log(`Valid rows: ${validRows.length}`);
    console.log(`Rejected rows: ${rejectedRowCount}`);

    if (problems.length > 0) {
      const SHOW = 20;
      console.error(
        `Problems found (showing ${Math.min(SHOW, problems.length)} of ${problems.length}):`
      );
      for (const p of problems.slice(0, SHOW)) {
        console.error(
          `  CSV line ${p.row}, field "${p.field}", value "${p.value}": ${p.reason}`
        );
      }
    }

    // ---- Decide how each temperature value is interpreted (B09) ----
    const statusCounts = {};
    for (const row of validRows) {
      row.tempInfo = classifyTemperature(row.temperature, { acceptInferredCelsius });
      statusCounts[row.tempInfo.status] = (statusCounts[row.tempInfo.status] || 0) + 1;
    }
    console.log("Temperature unit status (valid rows):");
    for (const [status, count] of Object.entries(statusCounts)) {
      console.log(`  ${status}: ${count}`);
    }

    if (dryRun) {
      console.log("Dry run: no database connection was made. Nothing was imported.");
      process.exitCode = problems.length > 0 ? 1 : 0;
      return;
    }

    if (problems.length > 0 && !skipInvalid) {
      console.error(
        "Import stopped. Nothing was imported. Fix the rows above, or re-run with --skip-invalid to import only the valid rows."
      );
      process.exitCode = 1;
      return;
    }

    if (validRows.length === 0) {
      console.error("No valid rows to import.");
      process.exitCode = 1;
      return;
    }

    try {
      // Connect to PostgreSQL
      await client.connect();

      console.log("Connected to PostgreSQL.");

      // Start transaction
      await client.query("BEGIN");

      // =====================================================
      // STEP 1: Insert unique patients
      // =====================================================

      const uniquePatients = new Map();

      for (const row of validRows) {
        uniquePatients.set(row.subject_id, row.data_source);
      }

      let patientsInserted = 0;

      for (const [subjectId, dataSource] of uniquePatients) {
        const result = await client.query(
          `
          INSERT INTO patients (
            subject_id,
            data_source
          )
          VALUES ($1, $2)
          ON CONFLICT (subject_id)
          DO NOTHING
          `,
          [subjectId, dataSource]
        );

        patientsInserted += result.rowCount;
      }

      console.log(
        `Patients processed: ${uniquePatients.size}`
      );

      console.log(
        `New patients inserted: ${patientsInserted}`
      );

      // =====================================================
      // STEP 2: Insert unique ED stays
      // =====================================================

      const uniqueStays = new Map();

      for (const row of validRows) {
        uniqueStays.set(row.stay_id, row.subject_id);
      }

      let staysInserted = 0;

      for (const [stayId, subjectId] of uniqueStays) {
        const result = await client.query(
          `
          INSERT INTO ed_stays (
            stay_id,
            subject_id
          )
          VALUES ($1, $2)
          ON CONFLICT (stay_id)
          DO NOTHING
          `,
          [stayId, subjectId]
        );

        staysInserted += result.rowCount;
      }

      console.log(
        `ED stays processed: ${uniqueStays.size}`
      );

      console.log(
        `New ED stays inserted: ${staysInserted}`
      );

      // =====================================================
      // STEP 3: Insert observations
      // =====================================================

      let observationsInserted = 0;
      let observationsSkipped = 0;

      // Store the unit provenance only if the migration has been applied.
      const unitColumns = [
        "temperature_source_unit",
        "temperature_unit_status",
        "temperature_celsius_verified",
      ];
      const found = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'observations'
           AND column_name = ANY($1)`,
        [unitColumns]
      );
      const hasUnitColumns = found.rowCount === unitColumns.length;
      if (!hasUnitColumns) {
        console.warn(
          "WARNING: temperature unit columns not found, so unit status is only reported, not stored. " +
            "Apply migrations/20261116_001_observation_temperature_units.sql first."
        );
      }

      const baseColumns = [
        "stay_id", "observation_time", "temperature", "heart_rate",
        "respiratory_rate", "spo2", "systolic_bp", "data_source",
        "consciousness", "oxygen_support", "spo2_scale",
      ];
      const insertColumns = hasUnitColumns
        ? [...baseColumns, ...unitColumns]
        : baseColumns;
      const placeholders = insertColumns.map((_, i) => `$${i + 1}`).join(", ");
      const insertSql = `
        INSERT INTO observations (${insertColumns.join(", ")})
        VALUES (${placeholders})
        ON CONFLICT (stay_id, observation_time)
        DO NOTHING`;

      for (const row of validRows) {
        const values = [
          row.stay_id,
          row.timestamp,
          row.temperature,
          row.heart_rate,
          row.respiratory_rate,
          row.spo2,
          row.systolic_bp,
          row.data_source,

          // NEWS2-related values
          "Alert",
          false,
          1,
        ];
        if (hasUnitColumns) {
          values.push(row.tempInfo.unit, row.tempInfo.status, celsiusForDatabase(row.tempInfo));
        }

        const result = await client.query(insertSql, values);

        if (result.rowCount === 1) {
          observationsInserted++;
        } else {
          observationsSkipped++;
        }
      }

      console.log(
        `New observations inserted: ${observationsInserted}`
      );

      console.log(
        `Duplicate observations skipped: ${observationsSkipped}`
      );

      // =====================================================
      // COMMIT
      // =====================================================

      await client.query("COMMIT");

      console.log(
        "Data import completed successfully! 🎉"
      );
    } catch (error) {
      // Rollback if anything goes wrong
      await client.query("ROLLBACK");

      console.error("Import failed:");
      console.error(error);
      process.exitCode = 1;
    } finally {
      // Close database connection
      await client.end();

      console.log("Database connection closed.");
    }
  });