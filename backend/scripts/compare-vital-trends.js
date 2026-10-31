"use strict";

require("dotenv").config({
  path: require("path").join(__dirname, "../../.env")
});

const pool = require("../db");
const { calculateVitalTrend } = require("../services/trendCalculator");

async function main() {
  try {
    const result = await pool.query(`
      SELECT
        observation_id,
        stay_id,
        observation_time,
        spo2,
        heart_rate,
        systolic_bp,
        respiratory_rate
      FROM observations_clean
      WHERE stay_id IS NOT NULL
      ORDER BY stay_id, observation_time, observation_id
    `);

    const stored = await pool.query(`
      SELECT
        stay_id,
        observation_time,
        delta_spo2,
        delta_heart_rate,
        delta_systolic_bp,
        delta_respiratory_rate,
        spo2_rate_per_hour,
        hr_rate_per_hour,
        sbp_rate_per_hour,
        rr_rate_per_hour,
        trend_classification
      FROM trend_results
    `);

    const byStay = new Map();

    for (const row of result.rows) {
      const key = String(row.stay_id);
      if (!byStay.has(key)) byStay.set(key, []);
      byStay.get(key).push(row);
    }

    const storedByKey = new Map();

    for (const row of stored.rows) {
      const key = `${row.stay_id}|${new Date(row.observation_time).getTime()}`;
      storedByKey.set(key, row);
    }

    let pairs = 0;
    let calculated = 0;
    let skipped = 0;
    let matchedStoredRows = 0;
    let unmatchedStoredRows = 0;
    let classificationDifferences = 0;
    let rateComparisons = 0;
    let rateDifferences = 0;

    const examples = [];

    for (const [stayId, rows] of byStay) {
      for (let i = 1; i < rows.length; i++) {
        pairs++;

        const previous = rows[i - 1];
        const current = rows[i];

        let trend;

        try {
          trend = calculateVitalTrend(previous, current);
          calculated++;
        } catch (error) {
          skipped++;
          continue;
        }

        const key = `${stayId}|${new Date(current.observation_time).getTime()}`;
        const old = storedByKey.get(key);

        if (!old) {
          unmatchedStoredRows++;
          continue;
        }

        matchedStoredRows++;

        if (
          old.trend_classification &&
          old.trend_classification !== trend.trend_classification
        ) {
          classificationDifferences++;
        }

        const comparisons = [
          ["spo2", "delta_spo2"],
          ["heart_rate", "delta_heart_rate"],
          ["systolic_bp", "delta_systolic_bp"],
          ["respiratory_rate", "delta_respiratory_rate"],
        ];

        for (const [field, storedField] of comparisons) {
          const oldValue = old[storedField];
          const newValue = trend.changes[field].delta;

          if (oldValue == null || newValue == null) continue;

          rateComparisons++;

          if (Math.abs(Number(oldValue) - Number(newValue)) > 0.01) {
            rateDifferences++;

            if (examples.length < 10) {
              examples.push({
                stay_id: stayId,
                observation_id: current.observation_id,
                field,
                stored_delta: Number(oldValue),
                calculated_delta: newValue,
              });
            }
          }
        }
      }
    }

    console.log("\n===== READ-ONLY TREND COMPARISON =====");
    console.table([{
      observations_read: result.rowCount,
      stored_trend_rows: stored.rowCount,
      stays_read: byStay.size,
      consecutive_pairs: pairs,
      pairs_calculated: calculated,
      pairs_skipped: skipped,
      matched_existing_trend_rows: matchedStoredRows,
      pairs_without_matching_stored_row: unmatchedStoredRows,
      delta_values_compared: rateComparisons,
      delta_differences_over_0_01: rateDifferences,
      classification_differences: classificationDifferences,
    }]);

    console.log("\nFirst delta mismatches (if any):");
    console.table(examples);

    console.log("\nDatabase writes: NONE");
    console.log("Existing trend classifications were not modified.");
  } catch (error) {
    console.error("Comparison failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
