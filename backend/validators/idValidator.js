// Shared validation for numeric IDs taken from the URL, so every route
// applies the SAME rule instead of each keeping its own copy.
//
// An ID arrives as a string. It must be checked BEFORE it reaches a
// PostgreSQL query: a digits-only value too large for the column's type
// makes PostgreSQL throw an "out of range" error, which the routes
// would otherwise report as HTTP 500 instead of 400.
//
// BigInt is used for the comparison so large values are compared exactly
// (Number() silently loses precision above 2^53).
//
// Rules kept from the earlier /^\d+$/ check: digits only, so letters,
// decimals, signs ("-5", "+5") and empty strings are rejected. Zero is
// well-formed; it simply matches no row, so routes answer 404, as before.
// Leading zeros are accepted because PostgreSQL accepts them too.

// Largest values PostgreSQL can hold:
const MAX_BIGINT = 9223372036854775807n; // bigint  -> ed_stays.stay_id
const MAX_INTEGER = 2147483647n; // integer -> emergency_cases.case_id
const MIN_INTEGER = -2147483648n; // integer -> patient_id (may be negative)

function isDigitsWithin(value, max) {
  return /^\d+$/.test(value) && BigInt(value) <= max;
}

// stay_id columns are bigint.
function isValidStayId(value) {
  return isDigitsWithin(value, MAX_BIGINT);
}

// emergency_cases.case_id is a 4-byte integer, NOT a bigint, so it has
// a much lower limit. Using the bigint limit here would still let values
// above 2147483647 through to PostgreSQL and fail with a 500.
function isValidCaseId(value) {
  return isDigitsWithin(value, MAX_INTEGER);
}


// patient_id comes from a JSON request BODY (not the URL), so it can be any
// JSON type, not only a string. Only a number or a string can be an ID: a
// value like [5] would be turned into "5" by JavaScript and then rejected by
// PostgreSQL, so every other type is refused up front.
// patients.patient_id is a 4-byte integer. A leading minus sign is allowed
// on purpose: a negative integer is well-formed and simply matches no
// patient, so it keeps getting the route's existing "Invalid patient_id"
// answer from the database check instead of a new response.
function isValidPatientId(value) {
  if (typeof value !== "number" && typeof value !== "string") return false;
  const text = String(value);
  if (!/^-?\d+$/.test(text)) return false;
  const n = BigInt(text);
  return n >= MIN_INTEGER && n <= MAX_INTEGER;
}

module.exports = { isValidStayId, isValidCaseId, isValidPatientId };