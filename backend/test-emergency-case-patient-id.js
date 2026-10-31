require("dotenv").config();
const pool = require("./db");

// Focused HTTP test for input validation in POST /api/emergency-cases.
// patient_id is a PostgreSQL integer column (range -2147483648 .. 2147483647),
// while temporary_case_code and source are limited to 30 characters. Invalid
// values must be rejected before PostgreSQL rather than producing HTTP 500.
//
// The server must already be running (npm start / npm run dev in a separate
// terminal). Registers two throwaway users (an ADMIN and a PATIENT).
//
// THIS TEST CREATES NOTHING. Every request is rejected (400/401/403) or fails
// the patients foreign key (400). The last check confirms that the number of
// emergency_cases rows is the same before and after.

const BASE_URL = "http://localhost:5000";

const MALFORMED = "patient_id must be a valid integer";
const NO_SUCH_PATIENT = "Invalid patient_id"; // existing response for a missing patient

async function registerAndLogin(role) {
  const username = `ecpid_${role.toLowerCase()}_${Date.now()}`;
  const password = "TestPass123!";
  const reg = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role }),
  });
  if (!reg.ok) throw new Error(`Register failed: ${reg.status} ${await reg.text()}`);
  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return (await login.json()).token;
}

let counter = 0;
function uniqueCode() {
  counter += 1;
  return `IDVAL-${Date.now()}-${counter}`; // well under the 30-character limit
}

async function post(token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/api/emergency-cases`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let json;
  try { json = await res.json(); } catch (e) { json = "(non-JSON response)"; }
  return { status: res.status, body: json };
}

const show = (v) => {
  const t = JSON.stringify(v);
  return t.length > 40 ? t.slice(0, 22) + `...(${t.length - 2} chars)` : t;
};

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

async function rowCount() {
  const r = await pool.query("SELECT count(*) FROM emergency_cases");
  return r.rows[0].count;
}

async function run() {
  try {
    const adminToken = await registerAndLogin("ADMIN");
    const patientToken = await registerAndLogin("PATIENT");
    console.log("Registered test users and got tokens.\n");

    const before = await rowCount();

    console.log("=== 1. Malformed or out-of-range patient_id -> expect 400 '" + MALFORMED + "' (was 500) ===");
    const bad = [
      ["max integer + 1 (number)", 2147483648],
      ["max integer + 1 (string)", "2147483648"],
      ["11 digits (number)", 99999999999],
      ["max bigint (string)", "9223372036854775807"],
      ["max bigint + 1 (string)", "9223372036854775808"],
      ["20 digits (string)", "99999999999999999999"],
      ["100 digits (string)", "1" + "0".repeat(99)],
      ["below min integer (number)", -2147483649],
      ["below min integer (string)", "-2147483649"],
      ["letters", "abc"],
      ["decimal (number)", 1.5],
      ["decimal (string)", "1.5"],
      ["empty string", ""],
      ["array", [5]],
      ["object", { a: 1 }],
      ["boolean", true],
    ];
    for (const [label, value] of bad) {
      const r = await post(adminToken, { temporary_case_code: uniqueCode(), patient_id: value });
      check(`${label}: ${show(value)} -> ${r.status}`, r.status === 400 && r.body.error === MALFORMED, JSON.stringify(r.body));
    }

    console.log("\n=== 2. Well-formed but matches no patient -> existing 400 '" + NO_SUCH_PATIENT + "' (reaches the database, nothing inserted) ===");
    const wellFormed = [
      ["largest valid integer (number)", 2147483647],
      ["largest valid integer (string)", "2147483647"],
      ["smallest valid integer", -2147483648],
      ["negative", -5],
      ["zero (number)", 0],
      ["zero (string)", "0"],
    ];
    for (const [label, value] of wellFormed) {
      const r = await post(adminToken, { temporary_case_code: uniqueCode(), patient_id: value });
      check(`${label}: ${show(value)} -> ${r.status}`, r.status === 400 && r.body.error === NO_SUCH_PATIENT, JSON.stringify(r.body));
    }

    console.log("\n=== 3. Existing check order preserved: missing temporary_case_code is reported first ===");
    const noCode = await post(adminToken, { patient_id: 2147483648 });
    check(`no temporary_case_code + oversized patient_id -> ${noCode.status}`, noCode.status === 400 && noCode.body.error === "temporary_case_code is required", JSON.stringify(noCode.body));

    console.log("\n=== 4. Over-length text fields -> expect 400 and no insert ===");
    const longCode = await post(adminToken, { temporary_case_code: "C".repeat(31) });
    check(`31-character temporary_case_code -> ${longCode.status}`, longCode.status === 400 && longCode.body.error === "temporary_case_code must be at most 30 characters", JSON.stringify(longCode.body));
    const longSource = await post(adminToken, { temporary_case_code: uniqueCode(), source: "S".repeat(31) });
    check(`31-character source -> ${longSource.status}`, longSource.status === 400 && longSource.body.error === "source must be at most 30 characters", JSON.stringify(longSource.body));

    console.log("\n=== 5. Authentication / authorization still run first ===");
    const noToken = await post(null, { temporary_case_code: uniqueCode(), patient_id: 2147483648 });
    check(`no token + oversized patient_id -> ${noToken.status}`, noToken.status === 401, JSON.stringify(noToken.body));
    const wrongRole = await post(patientToken, { temporary_case_code: uniqueCode(), patient_id: 2147483648 });
    check(`PATIENT role + oversized patient_id -> ${wrongRole.status}`, wrongRole.status === 403, JSON.stringify(wrongRole.body));

    console.log("\n=== 6. Nothing was created ===");
    const after = await rowCount();
    check(`emergency_cases rows before/after: ${before} / ${after}`, before === after);

    console.log(`\n${failures === 0 ? "ALL REQUIRED CHECKS PASSED" : failures + " REQUIRED CHECK(S) FAILED"}`);
  } catch (err) {
    console.error("Test script error:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

run();
