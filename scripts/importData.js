const fs = require("fs");
const path = require("path");

const backendRequire = require("module").createRequire(
  path.join(__dirname, "../backend/package.json")
);

backendRequire("dotenv").config();

const csv = backendRequire("csv-parser");
const { Client } = backendRequire("pg");


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


const { validateAll, findReviewWarnings } = require("./importValidation");
const { classifyTemperature, celsiusForDatabase } = require("./temperatureUnits");

const args = process.argv.slice(2);
const KNOWN_FLAGS = ["--file", "--dry-run", "--skip-invalid", "--accept-inferred-celsius", "--demo-defaults"];
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
const demoDefaults = args.includes("--demo-defaults");

const csvFilePath =
  fileFlagIndex !== -1
    ? path.resolve(args[fileFlagIndex + 1])
    : path.join(__dirname, "../data/cleaned_vitals.csv");

if (!fs.existsSync(csvFilePath)) {
  console.error(`CSV file not found: ${csvFilePath}`);
  process.exit(1);
}

const records = [];

fs.createReadStream(csvFilePath)
  .pipe(csv())
  .on("data", (row) => {
    records.push(row);
  })
  .on("end", async () => {
    console.log("CSV loaded successfully.");
    console.log(`Total records found: ${records.length}`);

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

    const reviewWarnings = findReviewWarnings(validRows);
    console.log(`Values to review (stored unchanged): ${reviewWarnings.length}`);
    for (const w of reviewWarnings.slice(0, 20)) {
      console.log(`  stay ${w.stay_id}, ${w.timestamp}, ${w.field} = ${w.value}: ${w.reason}`);
    }
    console.log(
      "Note: dates in this dataset are shifted (around year 2147) for privacy. Keep their order; do not read them as real calendar time."
    );

    const statusCounts = {};
    for (const row of validRows) {
      row.tempInfo = classifyTemperature(row.temperature, { acceptInferredCelsius });
      statusCounts[row.tempInfo.status] = (statusCounts[row.tempInfo.status] || 0) + 1;
    }
    console.log("Temperature unit status (valid rows):");
    for (const [status, count] of Object.entries(statusCounts)) {
      console.log(`  ${status}: ${count}`);
    }

    console.log(
      demoDefaults
        ? "Consciousness / oxygen support / SpO2 scale: demo defaults will be stored and marked as ASSUMED."
        : "Consciousness / oxygen support / SpO2 scale: not in the CSV, stored as UNKNOWN (NULL)."
    );

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
      await client.connect();

      console.log("Connected to PostgreSQL.");

      await client.query("BEGIN");


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


      let observationsInserted = 0;
      let observationsSkipped = 0;

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

      const assumedColumns = [
        "consciousness_assumed",
        "oxygen_support_assumed",
        "spo2_scale_assumed",
      ];
      const foundAssumed = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'observations'
           AND column_name = ANY($1)`,
        [assumedColumns]
      );
      const presentAssumed = assumedColumns.filter((c) =>
        foundAssumed.rows.some((r) => r.column_name === c)
      );
      if (demoDefaults && presentAssumed.length !== assumedColumns.length) {
        throw new Error(
          "--demo-defaults needs the columns " + assumedColumns.join(", ") +
            " on observations. Apply migrations/20261116_002_observation_spo2_scale_assumed.sql. Nothing was imported."
        );
      }

      const baseColumns = [
        "stay_id", "observation_time", "temperature", "heart_rate",
        "respiratory_rate", "spo2", "systolic_bp", "data_source",
        "consciousness", "oxygen_support", "spo2_scale",
      ];
      const insertColumns = [
        ...baseColumns,
        ...(hasUnitColumns ? unitColumns : []),
        ...presentAssumed,
      ];
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

          demoDefaults ? "Alert" : null,
          demoDefaults ? false : null,
          demoDefaults ? 1 : null,
        ];
        if (hasUnitColumns) {
          values.push(row.tempInfo.unit, row.tempInfo.status, celsiusForDatabase(row.tempInfo));
        }
        for (const _ of presentAssumed) values.push(demoDefaults);

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


      await client.query("COMMIT");

      console.log(
        "Data import completed successfully! 🎉"
      );
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Import failed:");
      console.error(error);
      process.exitCode = 1;
    } finally {
      await client.end();

      console.log("Database connection closed.");
    }
  });