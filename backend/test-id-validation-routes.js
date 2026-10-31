require("dotenv").config();
const pool = require("./db");

// Focused HTTP test for numeric-ID validation on the four routes that
// previously used a digits-only check:
//   GET   /api/clinical-context/:stay_id     (stay_id is a bigint)
//   GET   /api/clinical-summary/:stay_id     (stay_id is a bigint)
//   POST  /api/decision-support/:stay_id     (stay_id is a bigint)
//   GET   /api/emergency-cases/:id           (case_id is an INTEGER)
//   PATCH /api/emergency-cases/:id/status    (case_id is an INTEGER)
//
// The server must already be running (npm start / npm run dev in a
// separate terminal). Registers one throwaway test user for a token.
//
// What this script writes:
//   - POST /api/decision-support/37330786 with a normal existing stay runs
//     the usual idempotent refresh of that ONE stay's persisted results
//     (the same thing test-decision-support-route.js already does).
//   - Every other request is a GET, or is rejected / 404s before any write.
//   - PATCH is only sent with IDs that are rejected or do not exist, so no
//     real emergency case is ever changed.

const BASE_URL = "http://localhost:5000";

const MAX_BIGINT = "9223372036854775807";
const MAX_INTEGER = "2147483647";

// The oversized values requested, all above the bigint maximum:
const BIGINT_OVERSIZED = [
  ["20 digits", "99999999999999999999"],
  ["19 digits, above max bigint", "9999999999999999999"],
  ["max bigint + 1", "9223372036854775808"],
  ["100 digits", "1" + "0".repeat(99)],
];
// case_id is an integer, so its limit is much lower: add the integer
// boundary and the bigint maximum (valid for a stay_id, too big for a case_id).
const INTEGER_OVERSIZED = [
  ["max integer + 1", "2147483648"],
  ["max bigint (too big for an integer column)", MAX_BIGINT],
  ...BIGINT_OVERSIZED,
];

async function registerAndLogin() {
  const username = `idval_test_${Date.now()}`;
  const password = "TestPass123!";
  const reg = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role: "ADMIN" }),
  });
  if (!reg.ok) throw new Error(`Register failed: ${reg.status} ${await reg.text()}`);
  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return (await login.json()).token;
}

async function call(route, id, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method: route.method, headers };
  if (route.body) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(route.body);
  }
  const res = await fetch(`${BASE_URL}${route.url(id)}`, options);
  let body;
  try { body = await res.json(); } catch (e) { body = "(non-JSON response)"; }
  return { status: res.status, body };
}

const short = (v) => (v.length > 30 ? v.slice(0, 12) + `...(${v.length} digits)` : v);

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

async function runRoute(route, token) {
  const isStay = route.kind === "stay";
  const idName = isStay ? "stay_id" : "case_id";
  const invalidMsg = `${idName} must be a valid integer`;
  const oversized = isStay ? BIGINT_OVERSIZED : INTEGER_OVERSIZED;
  const maxValid = isStay ? MAX_BIGINT : MAX_INTEGER;
  const tag = `${route.method} ${route.url("<id>")}`;

  console.log(`\n################ ${tag}  (${idName} = ${isStay ? "bigint" : "integer"}) ################`);

  console.log("--- oversized IDs -> expect 400");
  for (const [label, value] of oversized) {
    const r = await call(route, value, token);
    check(`${label}: ${short(value)} -> ${r.status}`, r.status === 400 && r.body.error === invalidMsg, JSON.stringify(r.body));
  }

  console.log(`--- largest VALID ${isStay ? "bigint" : "integer"} (${maxValid}) -> expect 404, not 400/500`);
  const mv = await call(route, maxValid, token);
  check(`${maxValid} -> ${mv.status}`, mv.status === 404 && r404(mv, route), JSON.stringify(mv.body));

  console.log("--- normal existing ID -> expect 200");
  if (route.existing) {
    const ex = await call(route, route.existing, token);
    check(`${route.existing} -> ${ex.status}`, ex.status === 200);
  } else {
    console.log(`INFO  skipped: ${route.skipReason}`);
  }

  console.log("--- valid but nonexistent ID -> expect 404");
  const ne = await call(route, "999999999", token);
  check(`999999999 -> ${ne.status}`, ne.status === 404 && r404(ne, route), JSON.stringify(ne.body));

  console.log("--- existing rules preserved: malformed -> 400, zero is well-formed -> 404");
  for (const bad of ["abc", "-5", "1.5", "12abc"]) {
    const r = await call(route, bad, token);
    check(`${bad} -> ${r.status}`, r.status === 400 && r.body.error === invalidMsg);
  }
  const zero = await call(route, "0", token);
  check(`0 -> ${zero.status}`, zero.status === 404 && r404(zero, route));

  console.log("--- no token -> expect 401 (authentication runs before validation)");
  const probes = [oversized[0][1], oversized[1][1], maxValid, "abc", route.existing || "999999999"];
  for (const value of probes) {
    const r = await call(route, value, null);
    check(`${short(value)} (no token) -> ${r.status}`, r.status === 401);
  }
}

function r404(res, route) {
  return res.body && res.body.error === route.notFoundMsg;
}

async function run() {
  try {
    const token = await registerAndLogin();
    console.log("Registered test user and got token.");

    // An existing emergency case id, read straight from the database
    // (read-only), so the GET check uses a real case.
    const caseRow = await pool.query("SELECT case_id FROM emergency_cases ORDER BY case_id LIMIT 1");
    const existingCase = caseRow.rows.length ? String(caseRow.rows[0].case_id) : null;

    const stayNotFound = "ED stay not found";
    const caseNotFound = "Emergency case not found";

    const routes = [
      { kind: "stay", method: "GET", url: (id) => `/api/clinical-context/${id}`, existing: "37330786", notFoundMsg: stayNotFound },
      { kind: "stay", method: "GET", url: (id) => `/api/clinical-summary/${id}`, existing: "37330786", notFoundMsg: stayNotFound },
      { kind: "stay", method: "POST", url: (id) => `/api/decision-support/${id}`, existing: "37330786", notFoundMsg: stayNotFound },
      {
        kind: "case", method: "GET", url: (id) => `/api/emergency-cases/${id}`,
        existing: existingCase, skipReason: "no emergency case exists in this database", notFoundMsg: caseNotFound,
      },
      {
        kind: "case", method: "PATCH", url: (id) => `/api/emergency-cases/${id}/status`,
        body: { case_status: "ARRIVED_ER" }, existing: null,
        skipReason: "a PATCH to a real case would change its status; this test never does that", notFoundMsg: caseNotFound,
      },
    ];

    for (const route of routes) {
      await runRoute(route, token);
    }

    console.log(`\n${failures === 0 ? "ALL REQUIRED CHECKS PASSED" : failures + " REQUIRED CHECK(S) FAILED"}`);
  } catch (err) {
    console.error("Test script error:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

run();