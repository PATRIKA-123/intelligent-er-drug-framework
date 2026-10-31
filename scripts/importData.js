require("dotenv").config();

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { Client } = require("pg");

// PostgreSQL connection
const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// CSV file path
const csvFilePath = path.join(
  __dirname,
  "../data/cleaned_vitals.csv"
);

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

      for (const row of records) {
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

      for (const row of records) {
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

      for (const row of records) {
        const result = await client.query(
          `
          INSERT INTO observations (
            stay_id,
            observation_time,
            temperature,
            heart_rate,
            respiratory_rate,
            spo2,
            systolic_bp,
            data_source,
            consciousness,
            oxygen_support,
            spo2_scale
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11
          )
          ON CONFLICT (stay_id, observation_time)
          DO NOTHING
          `,
          [
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
          ]
        );

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
    } finally {
      // Close database connection
      await client.end();

      console.log("Database connection closed.");
    }
  });