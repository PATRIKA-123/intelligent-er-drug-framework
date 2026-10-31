"use strict";

require("dotenv").config({
  path: require("path").join(__dirname, "../../.env"),
});

const pool = require("../db");
const { calculateVitalTrend } = require("../services/trendCalculator");

async function main() {
  try {
    const observations = await pool.query(`
      SELECT observation_id, stay_id, observation_time,
             spo2, heart_rate, systolic_bp, respiratory_rate
      FROM observations_clean
      WHERE stay_id IS NOT NULL
      ORDER BY stay_id, observation_time, observation_id
      LIMIT 25
    `);

    const byStay = new Map();

    for (const row of observations.rows) {
      if (!byStay.has(row.stay_id)) byStay.set(row.stay_id, []);
      byStay.get(row.stay_id).push(row);
    }

    let calculatedPairs = 0;
    let skippedPairs = 0;

    for (const [stayId, rows] of byStay) {
      for (let i = 1; i < rows.length; i++) {
        try {
          const trend = calculateVitalTrend(rows[i - 1], rows[i]);
          calculatedPairs++;

          console.log(JSON.stringify({
            stay_id: stayId,
            previous_observation_id: rows[i - 1].observation_id,
            current_observation_id: rows[i].observation_id,
            elapsed_minutes: trend.elapsed_minutes,
            data_quality: trend.data_quality.status,
            changes: trend.changes,
            trend_classification: trend.trend_classification,
          }));
        } catch (error) {
          skippedPairs++;
          console.error(`Skipped stay ${stayId}: ${error.message}`);
        }
      }
    }

    console.log("\n===== SUMMARY =====");
    console.log("Observation rows read:", observations.rowCount);
    console.log("Pairs calculated:", calculatedPairs);
    console.log("Pairs skipped:", skippedPairs);
    console.log("Database writes: NONE");
  } catch (error) {
    console.error("Trend preview failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
