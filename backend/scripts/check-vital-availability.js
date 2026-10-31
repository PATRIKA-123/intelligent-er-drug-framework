"use strict";

require("dotenv").config({
  path: require("path").join(__dirname, "../.env"),
});

const pool = require("../db");

async function main() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total_rows,
        COUNT(spo2) AS spo2_available,
        COUNT(heart_rate) AS heart_rate_available,
        COUNT(systolic_bp) AS systolic_bp_available,
        COUNT(respiratory_rate) AS respiratory_rate_available,
        COUNT(
          CASE WHEN spo2 IS NOT NULL
             AND heart_rate IS NOT NULL
             AND systolic_bp IS NOT NULL
             AND respiratory_rate IS NOT NULL
          THEN 1 END
        ) AS rows_with_all_four_vitals
      FROM observations_clean
    `);

    console.log("===== VITAL DATA AVAILABILITY =====");
    console.table(result.rows);

    const sample = await pool.query(`
      SELECT
        observation_id,
        stay_id,
        observation_time,
        spo2,
        heart_rate,
        systolic_bp,
        respiratory_rate
      FROM observations_clean
      WHERE spo2 IS NOT NULL
         OR heart_rate IS NOT NULL
         OR systolic_bp IS NOT NULL
         OR respiratory_rate IS NOT NULL
      ORDER BY stay_id, observation_time, observation_id
      LIMIT 10
    `);

    console.log("===== FIRST ROWS WITH ANY VITAL =====");
    console.table(sample.rows);
    console.log("Database writes: NONE");
  } catch (error) {
    console.error("Diagnostic failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
