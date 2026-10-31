"use strict";

// READ-ONLY golden test for services/news2Calculator.js.
//
// Recalculates NEWS2 for every row of observations_clean and compares the
// result with the stored row in news2_results_real. Nothing is written.
// Expected on the current data: every row matches and there are no errors.
//
// Run from the backend folder:   node scripts/compare-news2.js
// (db.js loads the .env file itself, so no dotenv call is needed here.)

const pool = require("../db");
const { calculateNEWS2 } = require("../services/news2Calculator");

const SCORE_FIELDS = [
  "respiratory_score",
  "spo2_score",
  "oxygen_score",
  "systolic_bp_score",
  "heart_rate_score",
  "temperature_score",
  "consciousness_score",
];

// node-postgres returns NUMERIC columns as strings, but news2Calculator only
// accepts real numbers. null must stay null: Number(null) is 0, which would
// silently turn "missing" into "zero".
const num = (v) => (v === null || v === undefined ? null : Number(v));

function toInput(row) {
  return {
    respiratoryRate: num(row.respiratory_rate),
    spo2: num(row.spo2),
    spo2Scale: num(row.spo2_scale),
    oxygenSupport: row.oxygen_support,
    systolicBP: num(row.systolic_bp),
    heartRate: num(row.heart_rate),
    temperatureCelsius: num(row.temperature_celsius),
    consciousness: row.consciousness,
  };
}

const bump = (obj, key) => {
  obj[key] = (obj[key] || 0) + 1;
};

async function main() {
  try {
    const counts = await pool.query(`
      SELECT (SELECT COUNT(*) FROM observations_clean) AS observations_clean_rows,
             (SELECT COUNT(*) FROM news2_results_real) AS stored_news2_rows
    `);

    const { rows } = await pool.query(`
      SELECT o.observation_id, o.stay_id,
             o.respiratory_rate, o.spo2, o.spo2_scale, o.oxygen_support,
             o.systolic_bp, o.heart_rate, o.temperature_celsius, o.consciousness,
             n.respiratory_score, n.spo2_score, n.oxygen_score,
             n.systolic_bp_score, n.heart_rate_score, n.temperature_score,
             n.consciousness_score, n.total_news2_score, n.risk_level
      FROM observations_clean o
      JOIN news2_results_real n ON n.observation_id = o.observation_id
      ORDER BY o.observation_id
    `);

    let exact = 0;
    const mismatches = [];
    const errors = [];
    const calculatedRisk = {};
    const storedRisk = {};

    for (const row of rows) {
      bump(storedRisk, row.risk_level);

      let result;
      try {
        result = calculateNEWS2(toInput(row));
      } catch (err) {
        errors.push({ observation_id: row.observation_id, error: err.message });
        continue;
      }
      bump(calculatedRisk, result.risk_level);

      const diffs = [];
      for (const field of SCORE_FIELDS) {
        if (Number(row[field]) !== result[field]) {
          diffs.push(`${field}: stored ${row[field]}, calculated ${result[field]}`);
        }
      }
      if (Number(row.total_news2_score) !== result.total_news2_score) {
        diffs.push(`total: stored ${row.total_news2_score}, calculated ${result.total_news2_score}`);
      }
      if (row.risk_level !== result.risk_level) {
        diffs.push(`risk_level: stored ${row.risk_level}, calculated ${result.risk_level}`);
      }

      if (diffs.length === 0) exact++;
      else mismatches.push({ observation_id: row.observation_id, stay_id: row.stay_id, differences: diffs.join("; ") });
    }

    const coverageOk =
      Number(counts.rows[0].observations_clean_rows) === rows.length &&
      Number(counts.rows[0].stored_news2_rows) === rows.length;

    console.log("\n===== READ-ONLY NEWS2 COMPARISON =====");
    console.table([{
      observations_clean_rows: Number(counts.rows[0].observations_clean_rows),
      stored_news2_rows: Number(counts.rows[0].stored_news2_rows),
      rows_compared: rows.length,
      exact_matches: exact,
      mismatches: mismatches.length,
      calculator_errors: errors.length,
    }]);

    console.log("Risk distribution, stored:    ", JSON.stringify(storedRisk));
    console.log("Risk distribution, calculated:", JSON.stringify(calculatedRisk));

    if (!coverageOk) {
      console.log("\nWARNING: the join did not cover every row of observations_clean / news2_results_real.");
    }
    if (mismatches.length > 0) {
      console.log("\nFirst mismatches:");
      console.table(mismatches.slice(0, 10));
    }
    if (errors.length > 0) {
      console.log("\nFirst calculator errors (rows the calculator refused to score):");
      console.table(errors.slice(0, 10));
    }

    const ok = mismatches.length === 0 && errors.length === 0 && coverageOk;
    console.log(`\n${ok ? "PASS: calculator reproduces every stored NEWS2 result." : "FAIL: see the details above."}`);
    console.log("Database writes: NONE");
    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    console.error("Comparison failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();