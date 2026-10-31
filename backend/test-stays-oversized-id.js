require("dotenv").config();

// Focused HTTP test for oversized numeric stay_id handling on the
// stays routes. ed_stays.stay_id is a PostgreSQL bigint (max
// 9223372036854775807), so digits-only is not enough validation: a
// value above that passes a digits-only check but PostgreSQL rejects
// it, which used to surface as an HTTP 500 instead of a 400.
//
// READ-ONLY: every request is a GET. The server must already be
// running (npm start / npm run dev in a separate terminal). Registers
// one throwaway test user via the existing auth system for a token.

const BASE_URL = "http://localhost:5000";

const ROUTES = ["", "/observations", "/news2", "/trends", "/diagnoses"];

const MAX_BIGINT = "9223372036854775807"; // largest valid stay_id value
const OVERSIZED = [
  { label: "20 digits (the reported case)", value: "99999999999999999999" },
  { label: "19 digits but ABOVE max (defeats a length-only check)", value: "9999999999999999999" },
  { label: "max bigint + 1", value: "9223372036854775808" },
  { label: "100 digits", value: "1" + "0".repeat(99) },
];

async function registerAndLogin() {
  const username = `oversize_test_${Date.now()}`;
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

const short = (v) => (v.length > 30 ? v.slice(0, 12) + "..." + `(${v.length} digits)` : v);

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

async function run() {
  try {
    const token = await registerAndLogin();
    console.log("Registered test user and got token.\n");

    console.log("=== 1. OVERSIZED numeric stay_id -> expect 400 on the base route and all 4 sub-routes ===");
    for (const { label, value } of OVERSIZED) {
      console.log(`--- ${label}: ${short(value)}`);
      for (const suffix of ROUTES) {
        const r = await get(`/api/stays/${value}${suffix}`, token);
        check(
          `GET /api/stays/${short(value)}${suffix} -> ${r.status}`,
          r.status === 400 && r.body.error === "stay_id must be a valid integer",
          JSON.stringify(r.body)
        );
      }
    }

    console.log("\n=== 2. LARGEST VALID bigint (" + MAX_BIGINT + ") -> expect 404 (valid but nonexistent), never 400 or 500 ===");
    for (const suffix of ROUTES) {
      const r = await get(`/api/stays/${MAX_BIGINT}${suffix}`, token);
      check(
        `GET /api/stays/${MAX_BIGINT}${suffix} -> ${r.status}`,
        r.status === 404 && r.body.error === "ED stay not found",
        JSON.stringify(r.body)
      );
    }

    console.log("\n=== 3. UNCHANGED: existing stay 37330786 -> 200 on all 5 routes ===");
    for (const suffix of ROUTES) {
      const r = await get(`/api/stays/37330786${suffix}`, token);
      check(`GET /api/stays/37330786${suffix} -> ${r.status}`, r.status === 200);
    }

    console.log("\n=== 3b. UNCHANGED: in-range value written with leading zeros is judged by its NUMERIC value, not its length ===");
    const padded = "0".repeat(18) + "37330786"; // 26 characters, value 37330786
    for (const suffix of ROUTES) {
      const r = await get(`/api/stays/${padded}${suffix}`, token);
      check(`GET /api/stays/${padded}${suffix} -> ${r.status}`, r.status === 200);
    }

    console.log("\n=== 4. UNCHANGED: existing stay with no diagnoses -> 200 + empty array ===");
    const noDx = await get("/api/stays/32719751/diagnoses", token);
    check(
      `GET /api/stays/32719751/diagnoses -> ${noDx.status}`,
      noDx.status === 200 && noDx.body.count === 0 && Array.isArray(noDx.body.diagnoses) && noDx.body.diagnoses.length === 0,
      JSON.stringify(noDx.body)
    );

    console.log("\n=== 5. UNCHANGED: ordinary nonexistent stay 999999999 -> 404 on all 5 routes ===");
    for (const suffix of ROUTES) {
      const r = await get(`/api/stays/999999999${suffix}`, token);
      check(`GET /api/stays/999999999${suffix} -> ${r.status}`, r.status === 404 && r.body.error === "ED stay not found");
    }

    console.log("\n=== 6. UNCHANGED: non-numeric 'abc' -> 400 on all 5 routes ===");
    for (const suffix of ROUTES) {
      const r = await get(`/api/stays/abc${suffix}`, token);
      check(`GET /api/stays/abc${suffix} -> ${r.status}`, r.status === 400 && r.body.error === "stay_id must be a valid integer");
    }

    console.log("\n=== 7. UNCHANGED: authentication still runs FIRST -> no token = 401, even for oversized and max-bigint ids ===");
    for (const value of [OVERSIZED[0].value, OVERSIZED[1].value, MAX_BIGINT]) {
      for (const suffix of ROUTES) {
        const r = await get(`/api/stays/${value}${suffix}`, null);
        check(`GET /api/stays/${short(value)}${suffix} (no token) -> ${r.status}`, r.status === 401);
      }
    }

    console.log(`\n${failures === 0 ? "ALL REQUIRED CHECKS PASSED" : failures + " REQUIRED CHECK(S) FAILED"}`);
  } catch (err) {
    console.error("Test script error:", err.message);
    console.error(err.stack);
  }
}

run();