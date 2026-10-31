require("dotenv").config();

// Focused HTTP test: do the four stays sub-routes distinguish a
// NONEXISTENT stay (404) from an EXISTING stay with no records (200
// with an empty array)?
//
// READ-ONLY: every request is a GET. The server must already be running
// (npm start / npm run dev in a separate terminal). Registers one
// throwaway test user via the existing auth system to get a token.

const BASE_URL = "http://localhost:5000";

const SUBROUTES = [
  { suffix: "/observations", key: "observations" },
  { suffix: "/news2", key: "news2_results" },
  { suffix: "/trends", key: "trends" },
  { suffix: "/diagnoses", key: "diagnoses" },
];

const EXISTING_WITH_DATA = "37330786"; // has observations, NEWS2, trends, diagnoses
const EXISTING_NO_DIAGNOSES = "32719751"; // real stay with zero diagnosis rows
const NONEXISTENT = "999999999"; // valid integer, not in ed_stays

async function registerAndLogin() {
  const username = `subroute_test_${Date.now()}`;
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

async function get(path, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  let body;
  try { body = await res.json(); } catch (e) { body = "(non-JSON response)"; }
  return { status: res.status, body };
}

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

async function run() {
  try {
    const token = await registerAndLogin();
    console.log("Registered test user and got token.\n");

    console.log("=== 1. NONEXISTENT stay -> expect 404 + {error: 'ED stay not found'} on all 4 sub-routes ===");
    for (const { suffix } of SUBROUTES) {
      const r = await get(`/api/stays/${NONEXISTENT}${suffix}`, token);
      check(
        `GET /api/stays/${NONEXISTENT}${suffix} -> ${r.status}`,
        r.status === 404 && r.body.error === "ED stay not found",
        JSON.stringify(r.body)
      );
    }

    console.log("\n=== 2. EXISTING stay WITH records -> expect 200, count > 0 on all 4 sub-routes ===");
    for (const { suffix, key } of SUBROUTES) {
      const r = await get(`/api/stays/${EXISTING_WITH_DATA}${suffix}`, token);
      check(
        `GET /api/stays/${EXISTING_WITH_DATA}${suffix} -> ${r.status}`,
        r.status === 200 && r.body.count > 0 && Array.isArray(r.body[key]),
        `count=${r.body.count}`
      );
    }

    console.log("\n=== 3. EXISTING stay with NO records for that endpoint -> expect 200 + empty array (NOT 404) ===");
    const noDx = await get(`/api/stays/${EXISTING_NO_DIAGNOSES}/diagnoses`, token);
    check(
      `GET /api/stays/${EXISTING_NO_DIAGNOSES}/diagnoses -> ${noDx.status}`,
      noDx.status === 200 && noDx.body.count === 0 && Array.isArray(noDx.body.diagnoses) && noDx.body.diagnoses.length === 0,
      JSON.stringify(noDx.body)
    );
    console.log("INFO  (that stay still has data on the other routes, confirming it truly exists:)");
    for (const { suffix } of SUBROUTES.filter((s) => s.suffix !== "/diagnoses")) {
      const r = await get(`/api/stays/${EXISTING_NO_DIAGNOSES}${suffix}`, token);
      check(`GET /api/stays/${EXISTING_NO_DIAGNOSES}${suffix} -> ${r.status}`, r.status === 200 && r.body.count > 0, `count=${r.body.count}`);
    }

    console.log("\n=== 4. Base route unchanged: nonexistent -> 404, existing -> 200 ===");
    const baseMissing = await get(`/api/stays/${NONEXISTENT}`, token);
    check(`GET /api/stays/${NONEXISTENT} -> ${baseMissing.status}`, baseMissing.status === 404 && baseMissing.body.error === "ED stay not found");
    const baseOk = await get(`/api/stays/${EXISTING_WITH_DATA}`, token);
    check(`GET /api/stays/${EXISTING_WITH_DATA} -> ${baseOk.status}`, baseOk.status === 200);

    console.log("\n=== 5. Validation still wins over the existence check: 'abc' -> 400 (not 404) ===");
    for (const { suffix } of SUBROUTES) {
      const r = await get(`/api/stays/abc${suffix}`, token);
      check(`GET /api/stays/abc${suffix} -> ${r.status}`, r.status === 400 && r.body.error === "stay_id must be a valid integer");
    }

    console.log("\n=== 6. Authentication still runs FIRST: no token -> 401, even for a nonexistent stay ===");
    console.log("      (if this returned 404, anyone could probe which stay IDs exist without logging in)");
    for (const { suffix } of SUBROUTES) {
      const real = await get(`/api/stays/${EXISTING_WITH_DATA}${suffix}`, null);
      check(`GET /api/stays/${EXISTING_WITH_DATA}${suffix} (no token) -> ${real.status}`, real.status === 401);
      const missing = await get(`/api/stays/${NONEXISTENT}${suffix}`, null);
      check(`GET /api/stays/${NONEXISTENT}${suffix} (no token) -> ${missing.status}`, missing.status === 401);
    }

    console.log("\n=== INFO (not a required check, outside this fix's scope) ===");
    const huge = await get(`/api/stays/99999999999999999999/observations`, token);
    console.log(`INFO  20-digit stay_id (passes the digits-only check, exceeds bigint range) -> ${huge.status} ${JSON.stringify(huge.body)}`);

    console.log(`\n${failures === 0 ? "ALL REQUIRED CHECKS PASSED" : failures + " REQUIRED CHECK(S) FAILED"}`);
  } catch (err) {
    console.error("Test script error:", err.message);
    console.error(err.stack);
  }
}

run();