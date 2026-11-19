"use strict";
const assert = require("assert");
const { validateAll, findReviewWarnings } = require("../scripts/importValidation");

const base = { subject_id: "1", stay_id: "30001", timestamp: "2147-11-14 18:23:00", temperature: "98.6",
  heart_rate: "80", respiratory_rate: "18", spo2: "97", systolic_bp: "120", data_source: "TEST" };
const rows = [
  base,
  { ...base, stay_id: "30002", systolic_bp: "11" },
  { ...base, stay_id: "30003", heart_rate: "300" },
  { ...base, stay_id: "30004", spo2: "30" },
  { ...base, stay_id: "30005", systolic_bp: "65", heart_rate: "47", spo2: "78" },
];
const { validRows, problems } = validateAll(rows);
assert.strictEqual(problems.length, 0, "all rows are storable");
assert.strictEqual(validRows.length, 5, "outliers are NOT rejected or removed");

const w = findReviewWarnings(validRows);
const key = (x) => `${x.stay_id}:${x.field}`;
assert.deepStrictEqual(w.map(key).sort(), ["30002:systolic_bp", "30003:heart_rate", "30004:spo2"].sort());
assert.strictEqual(validRows.find((r) => r.stay_id === "30002").systolic_bp, 11, "value is unchanged");
assert.deepStrictEqual(findReviewWarnings([validRows[0]]), [], "normal row has no warning");
assert.deepStrictEqual(findReviewWarnings([validRows[4]]), [], "low but plausible values are not flagged");
console.log("Import outlier tests passed");
