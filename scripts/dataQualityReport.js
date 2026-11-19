"use strict";
// B17: review-only report for the de-identified demo dataset. Never writes to
// the database and does not replace clinical assessment of outlier thresholds.
const { findReviewWarnings, validateAll } = require("./importValidation");

function buildDataQualityReport(records) {
  const { validRows, problems, rejectedRowCount } = validateAll(records);
  const warnings = findReviewWarnings(validRows).map(({ stay_id, timestamp, field, value, reason }) => ({
    stay_id, timestamp, field, value, reason, review_status: "NEEDS_SOURCE_REVIEW",
  }));
  const years = [...new Set(validRows.map((row) => Number(row.timestamp.slice(0, 4))))].sort((a, b) => a - b);
  return {
    source: "Provided CSV; source-unit and source-measurement verification required",
    timestamp_semantics: "DEIDENTIFIED_DATE_SHIFTED_NOT_REAL_CALENDAR_TIME",
    records: records.length,
    valid_records: validRows.length,
    rejected_records: rejectedRowCount,
    validation_problems: problems,
    flagged_measurements: warnings,
    year_values: years,
    caution: "Do not auto-correct these values or treat shifted years as live care dates. Clinical review required.",
  };
}
module.exports = { buildDataQualityReport };

if (require.main === module) {
  const path = require("node:path");
  const fs = require("node:fs");
  const { createRequire } = require("node:module");
  const backendRequire = createRequire(path.join(__dirname, "../backend/package.json"));
  const csv = backendRequire("csv-parser");
  const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "../data/cleaned_vitals.csv");
  const rows = [];
  fs.createReadStream(csvPath).on("error", (err) => { console.error(`Cannot read CSV: ${err.message}`); process.exitCode = 1; })
    .pipe(csv()).on("data", (row) => rows.push(row))
    .on("end", () => {
      const report = buildDataQualityReport(rows);
      console.log(JSON.stringify(report, null, 2));
      if (report.rejected_records) process.exitCode = 1;
    });
}
