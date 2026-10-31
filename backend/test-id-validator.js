
const {
  isValidStayId,
  isValidCaseId,
  isValidPatientId,
} = require("./validators/idValidator");

const tests = [
  // stay_id tests (PostgreSQL BIGINT)
  ["Stay ID: normal numeric string", () => isValidStayId("37330786") === true],
  ["Stay ID: maximum BIGINT", () => isValidStayId("9223372036854775807") === true],
  ["Stay ID: BIGINT overflow rejected", () => isValidStayId("9223372036854775808") === false],
  ["Stay ID: letters rejected", () => isValidStayId("abc") === false],
  ["Stay ID: negative rejected", () => isValidStayId("-5") === false],
  ["Stay ID: leading zeros accepted", () => isValidStayId("000123") === true],

  // case_id tests (PostgreSQL INTEGER)
  ["Case ID: normal numeric string", () => isValidCaseId("12") === true],
  ["Case ID: maximum INTEGER", () => isValidCaseId("2147483647") === true],
  ["Case ID: INTEGER overflow rejected", () => isValidCaseId("2147483648") === false],
  ["Case ID: decimal rejected", () => isValidCaseId("1.5") === false],
  ["Case ID: empty string rejected", () => isValidCaseId("") === false],

  // patient_id tests (JSON request body)
  ["Patient ID: numeric value accepted", () => isValidPatientId(123) === true],
  ["Patient ID: numeric string accepted", () => isValidPatientId("123") === true],
  ["Patient ID: maximum INTEGER accepted", () => isValidPatientId(2147483647) === true],
  ["Patient ID: overflow rejected", () => isValidPatientId("2147483648") === false],
  ["Patient ID: decimal rejected", () => isValidPatientId(1.5) === false],
  ["Patient ID: array rejected", () => isValidPatientId([5]) === false],
  ["Patient ID: null rejected", () => isValidPatientId(null) === false],
  ["Patient ID: negative integer accepted by current rule", () => isValidPatientId(-5) === true],
];

let passed = 0;
let failed = 0;

for (const [name, test] of tests) {
  try {
    if (test()) {
      console.log(`PASS: ${name}`);
      passed++;
    } else {
      console.log(`FAIL: ${name}`);
      failed++;
    }
  } catch (error) {
    console.log(`ERROR: ${name} — ${error.message}`);
    failed++;
  }
}

console.log(`\nResults: ${passed}/${tests.length} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
