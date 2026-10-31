
const { textFieldError } = require("./validators/textValidator");

const tests = [
  {
    name: "Normal text",
    value: "CASE-123",
    max: 30,
    expected: null,
  },
  {
    name: "Text exactly at limit",
    value: "A".repeat(30),
    max: 30,
    expected: null,
  },
  {
    name: "Text exceeds limit",
    value: "A".repeat(31),
    max: 30,
    expected: "temporary_case_code must be at most 30 characters",
  },
  {
    name: "Null byte rejected",
    value: "CASE\0" + "123",
    max: 30,
    expected: "temporary_case_code contains an invalid character",
  },
  {
    name: "Object rejected",
    value: { code: "CASE-123" },
    max: 30,
    expected: "temporary_case_code must be a string",
  },
  {
    name: "Missing optional value",
    value: undefined,
    max: 30,
    expected: null,
  },
  {
  name: "Number rejected",
  value: 123,
  max: 30,
  expected: "temporary_case_code must be a string"
},
{
  name: "Boolean rejected",
  value: true,
  max: 30,
  expected: "temporary_case_code must be a string"
},
{
  name: "Empty string rejected",
  value: "",
  max: 30,
  expected: "temporary_case_code must not be empty"
},
{
  name: "Whitespace-only string rejected",
  value: "   ",
  max: 30,
  expected: "temporary_case_code must not be empty"
},
];

let failures = 0;

for (const test of tests) {
  const actual = textFieldError(
    "temporary_case_code",
    test.value,
    test.max
  );

  if (actual === test.expected) {
    console.log(`PASS: ${test.name}`);
  } else {
    failures++;
    console.log(`FAIL: ${test.name}`);
    console.log("Expected:", test.expected);
    console.log("Actual:", actual);
  }
}

console.log(
  `\nResult: ${tests.length - failures}/${tests.length} tests passed.`
);

if (failures > 0) {
  process.exitCode = 1;
}
