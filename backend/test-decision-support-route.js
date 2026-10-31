require("dotenv").config();
const pool = require("./db");

// HTTP test for POST /api/decision-support/:stay_id.
// Requires the server to already be running (npm start / npm run dev
// in a separate terminal), same as test-clinical-summary.js.
//
// This endpoint DOES write (that's its whole purpose) -- scoped only
// to the stay_ids tested here: 32034003, 37330786, 30094124.

const BASE_URL = "http://localhost:5000";

async function registerAndLogin() {
  const username = `phase9_test_${Date.now()}`;
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

async function post(stayId, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/api/decision-support/${stayId}`, {
    method: "POST",
    headers,
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function run() {
  try {
    const token = await registerAndLogin();
    console.log("Registered test user and got token.\n");

    console.log("=== Case A: 32034003 (known current-engine stay) ===");
    const a = await post("32034003", token);
    console.log("status:", a.status);
    console.log(JSON.stringify(a.body, null, 2));

    console.log("\n=== Case B: 37330786 (legacy-only stay, no fresh data before this) ===");
    const b = await post("37330786", token);
    console.log("status:", b.status);
    console.log(JSON.stringify(b.body, null, 2));

    console.log("\n=== Case C: 30094124 (known Major-interaction stay) ===");
    const c = await post("30094124", token);
    console.log("status:", c.status);
    console.log("overall_risk:", c.body.decision_support.overall_risk, "priority:", c.body.decision_support.decision_priority);
    console.log("alerts.count:", c.body.alerts.count);

    console.log("\n=== Case D: nonexistent stay -> expect 404 ===");
    const d = await post("999999999", token);
    console.log("status:", d.status, d.body);

    console.log("\n=== Case E: invalid stay_id -> expect 400 ===");
    const e = await post("abc", token);
    console.log("status:", e.status, e.body);

    
    console.log("\n=== Case E2: oversized stay_id -> expect 400 ===");
    const oversizedIds = [
      "9999999999999999999",
      "9223372036854775808",
      "99999999999999999999"
    ];

    for (const id of oversizedIds) {
      const res = await post(id, token);

      console.log(`stay_id ${id} -> status: ${res.status}`, res.body);

      if (res.status !== 400) {
        throw new Error(`FAIL: oversized stay_id ${id} should return 400`);
      }
    }
    console.log("PASS: all oversized IDs returned 400");


    console.log("\n=== Case F: no authentication -> expect 401 ===");
    const f = await post("32034003", null);
    console.log("status:", f.status, f.body);

    console.log("\n=== Case G: POST twice for 37330786, verify no duplicate current rows ===");
    const countsBefore = await pool.query(
      "SELECT (SELECT count(*) FROM decision_support_results WHERE stay_id=$1) AS decisions, (SELECT count(*) FROM clinical_alerts WHERE stay_id=$1) AS alerts",
      ["37330786"]
    );
    console.log("Row counts after first POST:", countsBefore.rows[0]);

    const secondPost = await post("37330786", token);
    console.log("Second POST status:", secondPost.status);

    const countsAfter = await pool.query(
      "SELECT (SELECT count(*) FROM decision_support_results WHERE stay_id=$1) AS decisions, (SELECT count(*) FROM clinical_alerts WHERE stay_id=$1) AS alerts",
      ["37330786"]
    );
    console.log("Row counts after second POST:", countsAfter.rows[0]);
    console.log(
      countsBefore.rows[0].decisions === countsAfter.rows[0].decisions &&
        countsBefore.rows[0].alerts === countsAfter.rows[0].alerts
        ? "PASS: no duplicate rows created"
        : "FAIL: row counts changed between POSTs"
    );
  } catch (err) {
    console.error("Test script error:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

run();