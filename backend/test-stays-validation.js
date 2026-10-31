require("dotenv").config();

// Focused HTTP test for the stays.js stay_id validation fix.
// READ-ONLY: every request here is a GET. Requires the server to
// already be running (npm start / npm run dev in a separate terminal).
// Registers one throwaway test user via the existing auth system to
// get a token, same as the previous HTTP tests.

const BASE_URL = "http://localhost:5000";

async function registerAndLogin() {
  const username = `stays_test_${Date.now()}`;
  const password = "TestPass123!";

  const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role: "ADMIN" }),
  });
  if (!registerRes.ok) {
    throw new Error(`Register failed: ${registerRes.status} ${await registerRes.text()}`);
  }

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return (await loginRes.json()).token;
}

async function get(path, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  let body;
  try {
    body = await res.json();
  } catch (e) {
    body = "(non-JSON response)";
  }
  return { status: res.status, body };
}

let failures = 0;
function check(label, actualStatus, expectedStatus, extra) {
  const ok = actualStatus === expectedStatus;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} -> ${actualStatus} (expected ${expectedStatus})${extra ? "  " + extra : ""}`);
}

async function run() {
  try {
    const token = await registerAndLogin();
    console.log("Registered test user and got token.\n");

    const validStay = "37330786"; // exists
    const missingStay = "999999999"; // valid integer, does not exist

    console.log("=== 1. Valid existing stay_id -> expect 200 (all 5 routes) ===");
    for (const suffix of ["", "/observations", "/news2", "/trends", "/diagnoses"]) {
      const r = await get(`/api/stays/${validStay}${suffix}`, token);
      check(`GET /api/stays/${validStay}${suffix}`, r.status, 200);
    }

    console.log("\n=== 2. Invalid stay_id 'abc' -> expect 400 (all 5 routes) ===");
    for (const suffix of ["", "/observations", "/news2", "/trends", "/diagnoses"]) {
      const r = await get(`/api/stays/abc${suffix}`, token);
      check(`GET /api/stays/abc${suffix}`, r.status, 400, JSON.stringify(r.body));
    }

    console.log("\n=== 2b. Other malformed values on the base route ===");
    for (const bad of ["12abc", "1.5", "-5"]) {
      const r = await get(`/api/stays/${bad}`, token);
      check(`GET /api/stays/${bad}`, r.status, 400, JSON.stringify(r.body));
    }

    console.log("\n=== 3. Valid nonexistent integer stay_id on the base route -> expect 404 ===");
    const nf = await get(`/api/stays/${missingStay}`, token);
    check(`GET /api/stays/${missingStay}`, nf.status, 404, JSON.stringify(nf.body));

    console.log("\n=== 3b. INFORMATIONAL: nonexistent stay on the 4 sub-routes (pre-existing behavior, not changed by this fix) ===");
    for (const suffix of ["/observations", "/news2", "/trends", "/diagnoses"]) {
      const r = await get(`/api/stays/${missingStay}${suffix}`, token);
      console.log(`INFO  GET /api/stays/${missingStay}${suffix} -> ${r.status} ${JSON.stringify(r.body)}`);
    }

    console.log("\n=== 4. No authentication -> expect 401 (all 5 routes, valid AND invalid id) ===");
    for (const suffix of ["", "/observations", "/news2", "/trends", "/diagnoses"]) {
      const r = await get(`/api/stays/${validStay}${suffix}`, null);
      check(`GET /api/stays/${validStay}${suffix} (no token)`, r.status, 401);
    }
    const noAuthBad = await get("/api/stays/abc", null);
    check("GET /api/stays/abc (no token)", noAuthBad.status, 401, "(auth must be checked before validation)");

    console.log(`\n${failures === 0 ? "ALL REQUIRED CHECKS PASSED" : failures + " REQUIRED CHECK(S) FAILED"}`);
  } catch (err) {
    console.error("Test script error:", err.message);
    console.error(err.stack);
  }
}

run();