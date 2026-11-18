// B08: unit tests for scripts/importValidation.js (no database needed).
//   node test-import-validation.js
const { validateRow, validateAll } = require("../scripts/importValidation");

let failed = 0, total = 0;
function check(name, got, expected) {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : `   (got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)})`));
}

const good = {
  subject_id: "10014354", stay_id: "30094124", timestamp: "2147-11-14 18:23:00",
  temperature: "97.3", heart_rate: "80.0", respiratory_rate: "18.0", spo2: "99.0",
  systolic_bp: "138.0", data_source: "MIMIC_IV_ED_DEMO_v2.2",
};
const withField = (field, value) => ({ ...good, [field]: value });
const reasonFor = (field, value) => {
  const r = validateRow(withField(field, value), 2);
  return r.ok ? "ACCEPTED" : r.problems.map((p) => p.field).join(",");
};

console.log("--- valid values ---");
check("typical row is accepted", validateRow(good, 2).ok, true);
check("'80.0' style decimals are accepted as numbers", validateRow(good, 2).values.heart_rate, 80);
check("97.3 stays exactly 97.3 (no rounding)", validateRow(good, 2).values.temperature, 97.3);
check("2 decimal places accepted", reasonFor("systolic_bp", "138.25"), "ACCEPTED");
check("trailing zeros are fine (138.250)", reasonFor("systolic_bp", "138.250"), "ACCEPTED");
check("low-but-possible BP 11 is NOT rejected here (B17 flags outliers)", reasonFor("systolic_bp", "11"), "ACCEPTED");
check("SpO2 exactly 100 accepted", reasonFor("spo2", "100"), "ACCEPTED");
check("999.99 accepted (largest storable)", reasonFor("heart_rate", "999.99"), "ACCEPTED");

console.log("--- rejected values ---");
for (const [label, field, value] of [
  ["NaN", "temperature", "NaN"],
  ["Infinity", "heart_rate", "Infinity"],
  ["empty", "respiratory_rate", ""],
  ["spaces only", "spo2", "   "],
  ["letters", "heart_rate", "abc"],
  ["scientific notation", "heart_rate", "1e3"],
  ["comma decimal", "temperature", "98,6"],
  ["hex", "heart_rate", "0x10"],
  ["negative", "heart_rate", "-5"],
  ["zero", "systolic_bp", "0"],
  ["SpO2 above 100", "spo2", "150"],
  ["too large for column", "systolic_bp", "1000"],
  ["3 decimal places", "systolic_bp", "138.123"],
]) {
  check(`${label} is rejected on ${field}`, reasonFor(field, value), field);
}
check("missing column (undefined) is rejected", reasonFor("temperature", undefined), "temperature");

console.log("--- identifiers, timestamp, source ---");
check("non-numeric stay_id rejected", reasonFor("stay_id", "30094124; DROP"), "stay_id");
check("zero subject_id rejected", reasonFor("subject_id", "0"), "subject_id");
check("empty stay_id rejected", reasonFor("stay_id", ""), "stay_id");
check("impossible date rejected (Feb 30)", reasonFor("timestamp", "2147-02-30 10:00:00"), "timestamp");
check("garbage timestamp rejected", reasonFor("timestamp", "yesterday"), "timestamp");
check("year 2147 (de-identified) accepted", reasonFor("timestamp", "2147-11-14 18:23:00"), "ACCEPTED");
check("empty data_source rejected", reasonFor("data_source", ""), "data_source");
check("data_source over 50 chars rejected", reasonFor("data_source", "x".repeat(51)), "data_source");

console.log("--- reporting ---");
const bad = { ...good, heart_rate: "abc", spo2: "150" };
const r = validateRow(bad, 7);
check("problem carries CSV line, field, value and reason",
  r.problems.map((p) => [p.row, p.field, p.value]), [[7, "heart_rate", "abc"], [7, "spo2", "150"]]);
const all = validateAll([good, bad, good]);
check("validateAll counts valid and rejected rows",
  [all.validRows.length, all.rejectedRowCount, all.problems.length], [2, 1, 2]);
check("first data row is reported as CSV line 2 (header is line 1)", validateAll([bad]).problems[0].row, 2);

console.log(`\n${failed} FAILED / ${total} CHECKS`);
process.exit(failed ? 1 : 0);
