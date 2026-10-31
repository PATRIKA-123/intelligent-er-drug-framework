require("dotenv").config();
const pool = require("./db");
const { computeAndPersistDecisionSupport } = require("./services/decisionSupportService");

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} | Expected: ${expected}, Received: ${actual}`
    );
  }

  console.log(`PASS: ${label}`);
}


// Verification script for Phase 6 (Integrated Decision Support).
// This DOES write to decision_support_results and drug_safety_results
// (via the Phase 5 call inside the service), scoped only to the
// stay_ids tested here.

async function run() {
  try {
    const cases = [
      { label: "High NEWS2 (0 drug alerts)", stayId: "32007337" },
      { label: "Plain DETERIORATING (not rapid)", stayId: "33065303" },
      { label: "RAPIDLY_DETERIORATING", stayId: "30915333" },
      { label: "Mixed severity (known from Phase 5)", stayId: "32034003" },
      { label: "Real MAJOR interaction stay", stayId: "30094124" },
    ];

    for (const c of cases) {
      console.log(`\n=== ${c.label} -- stay ${c.stayId} ===`);
      const result = await computeAndPersistDecisionSupport(c.stayId);
      console.log(JSON.stringify(result, null, 2));
      if (c.label === "High NEWS2 (0 drug alerts)") {
  assertEqual(
    result.decision.overall_risk,
    "HIGH",
    "High NEWS2 should produce HIGH overall risk"
  );
}

if (c.label === "Plain DETERIORATING (not rapid)") {
  assertEqual(
    result.decision.decision_priority,
    "REVIEW",
    "DETERIORATING trend should require REVIEW"
  );
}

if (c.label === "RAPIDLY_DETERIORATING") {
  assertEqual(
    result.decision.overall_risk,
    "HIGH",
    "Rapid deterioration should produce HIGH overall risk"
  );
}

if (c.label === "Real MAJOR interaction stay") {
  assertEqual(
    result.decision.overall_risk,
    "HIGH",
    "Major drug interactions should produce HIGH overall risk"
  );
}
    }

    console.log("\n=== Nonexistent stay (expected: null, no writes) ===");
    const noStay = await computeAndPersistDecisionSupport("999999999");
    console.log("Result:", noStay);

    console.log("\n=== Idempotency check: re-run stay 32034003 ===");
    const secondRun = await computeAndPersistDecisionSupport("32034003");
    console.log("deleted_count (should equal 1):", secondRun.deleted_count);
    console.log("inserted_count (should equal 1):", secondRun.inserted_count);

    const countCheck = await pool.query(
      "SELECT count(*) FROM decision_support_results WHERE stay_id = $1",
      ["32034003"]
    );
    console.log("Row count for this stay (should be 1, not 2):", countCheck.rows[0].count);
  } catch (err) {
    console.error("Test script error:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

run();