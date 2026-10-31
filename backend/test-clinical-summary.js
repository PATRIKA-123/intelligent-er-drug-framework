require("dotenv").config();
const pool = require("./db");

// IMPORTANT: this test makes real HTTP requests, unlike the previous
// test-*.js scripts which called service functions directly. That's
// because Phase 8 is a route (auth middleware + validation live
// there, not in the service), so testing 401/400 behavior requires
// an actual HTTP call. The server must already be running
// (npm start or npm run dev, in a separate terminal) before running
// this script.
//
// This script is READ-ONLY with respect to clinical data -- it never
// calls any clinical-summary write path (there isn't one). It DOES
// register one throwaway test user via the existing auth system, to
// get a token to test with, exactly like you've been doing manually
// in Postman.

const BASE_URL = "http://localhost:5000";

async function registerAndLogin() {
  const username = `phase8_test_${Date.now()}`;
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
  const loginData = await loginRes.json();
  return loginData.token;
}

async function rowCounts(stayId) {
  const tables = ["decision_support_results", "drug_safety_results", "clinical_alerts", "observations"];
  const counts = {};
  for (const t of tables) {
    const r = await pool.query(`SELECT count(*) FROM ${t} WHERE stay_id = $1`, 
      [stayId]
    );
    counts[t] = r.rows[0].count;
  }
  return counts;
}

async function run() {
  try {
    const token = await registerAndLogin();
    console.log("Registered test user and got token.\n");

    const watchedStayId = "32007337"; // has fresh Phase 6/7 data
    const beforeCounts = await rowCounts(watchedStayId);

    console.log("=== Case 1: valid authenticated stay WITH processed Phase 6/7 data (32007337) ===");
    const res1 = await fetch(`${BASE_URL}/api/clinical-summary/${watchedStayId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("status:", res1.status);
    const body1 = await res1.json();
console.log(JSON.stringify(body1, null, 2));

console.log("Decision provenance:", body1.decision_support.computed_by_current_engine);
console.log("Drug Safety provenance:", body1.drug_safety.provenance_status);
console.log("Clinical Alerts provenance:", body1.clinical_alerts.provenance_status);


    console.log("\n=== Case 2: valid stay with NO Phase 6/7 data from the current engine (37330786, legacy-only) ===");
    const res2 = await fetch(`${BASE_URL}/api/clinical-summary/37330786`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("status:", res2.status);
    const body2 = await res2.json();
    console.log("decision_support.computed_by_current_engine:", body2.decision_support.computed_by_current_engine);
    console.log("decision_support.result (legacy, shown not hidden):", JSON.stringify(body2.decision_support.result));
    console.log("drug_safety.findings count:", body2.drug_safety.findings.length);
    console.log("clinical_alerts.alerts count:", body2.clinical_alerts.alerts.length);

    console.log("\n=== Case 3: nonexistent stay -> expect 404 ===");
    const res3 = await fetch(`${BASE_URL}/api/clinical-summary/999999999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("status:", res3.status, await res3.json());

    console.log("\n=== Case 4: invalid stay_id -> expect 400 ===");
    const res4 = await fetch(`${BASE_URL}/api/clinical-summary/abc`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("status:", res4.status, await res4.json());

     
    console.log("\n=== Case 5: oversized stay_id -> expect 400 ===");
    const oversizedIds = [
      "9999999999999999999",
      "9223372036854775808",
      "99999999999999999999"
    ];

    for (const id of oversizedIds) {
      const res = await fetch(`${BASE_URL}/api/clinical-summary/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();

      console.log(`stay_id ${id} -> status: ${res.status}`, body);

      if (res.status !== 400) {
        throw new Error(`FAIL: oversized stay_id ${id} should return 400`);
      }
    }
    console.log("PASS: all oversized IDs returned 400");


    console.log("\n=== Case 6: no authentication -> expect 401 ===");
    const res5 = await fetch(`${BASE_URL}/api/clinical-summary/${watchedStayId}`);
    console.log("status:", res5.status, await res5.json());

    console.log("\n=== Case 7: verify the GET requests above modified NOTHING in the database ===");
    const afterCounts = await rowCounts(watchedStayId);
    console.log("before:", beforeCounts);
    console.log("after: ", afterCounts);
    console.log(
      JSON.stringify(beforeCounts) === JSON.stringify(afterCounts)
        ? "PASS: no rows changed"
        : "FAIL: row counts changed!"
    );
  } catch (err) {
    console.error("Test script error:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

run();