const { randomUUID } = require("crypto");
const pool = require("./db");

const {
  computeAndPersistDecisionSupport,
} = require("./services/decisionSupportService");

async function run() {
  const stayId = "32034003";
  const client = await pool.connect();

  let transactionStarted = false;

  try {
    const dbCheck = await client.query(
      "SELECT current_database() AS db"
    );

    const currentDb = dbCheck.rows[0].db;

    console.log("Connected database:", currentDb);

    if (currentDb !== "intelligent_er_drug_test") {
      throw new Error("SAFETY STOP: Wrong database");
    }

    // Capture original row counts.
    const before = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM decision_support_results
          WHERE stay_id = $1) AS decisions,
         (SELECT COUNT(*) FROM drug_safety_results
          WHERE stay_id = $1) AS drug_findings`,
      [stayId]
    );

    console.log("Original records:", before.rows[0]);

    const engineRunId = randomUUID();
    const engineVersion = "phase6-v1";

    await client.query("BEGIN");
    transactionStarted = true;

    const result = await computeAndPersistDecisionSupport(
      stayId,
      {
        client,
        engineRunId,
        engineVersion,
      }
    );

    if (!result) {
      throw new Error("Decision Support returned null");
    }

    console.log("\nTemporary Decision Support result:");
    console.log("Decision:", result.decision);
    console.log("Drug Safety:", result.drug_safety);
    console.log("Interaction counts:", result.interaction_counts);

    if (result.decision.engine_run_id !== engineRunId) {
      throw new Error("Decision Support provenance mismatch");
    }

    // Confirm both writes are visible inside this transaction.
    const temporary = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM decision_support_results
          WHERE stay_id = $1 AND engine_run_id = $2) AS decisions,
         (SELECT COUNT(*) FROM drug_safety_results
          WHERE stay_id = $1 AND engine_run_id = $2) AS drug_findings`,
      [stayId, engineRunId]
    );

    console.log("\nTemporary rows inside transaction:", temporary.rows[0]);

    if (Number(temporary.rows[0].decisions) !== 1) {
      throw new Error("Temporary Decision Support row missing");
    }

    if (
      Number(temporary.rows[0].drug_findings) !==
      result.drug_safety.inserted_count
    ) {
      throw new Error("Temporary Drug Safety row count mismatch");
    }
    const breakdown = await client.query(
  `SELECT
     COALESCE(NULLIF(TRIM(interaction_level), ''), '[NULL / BLANK]') AS interaction_level,
     COUNT(*) AS total_rows
   FROM drug_safety_results
   WHERE stay_id = $1
     AND engine_run_id = $2
   GROUP BY 1
   ORDER BY total_rows DESC`,
  [stayId, engineRunId]
 );

  console.log("\nTemporary interaction-level breakdown:");
  console.table(breakdown.rows);

 console.log("\nCanonical interaction counts:");
console.log(result.interaction_counts);

const canonicalTotal = Object.values(
  result.interaction_counts
).reduce((a, b) => a + b, 0);

console.log("Canonical total:", canonicalTotal);
console.log(
  "Persisted medication-level total:",
  result.drug_safety.inserted_count
);

    await client.query("ROLLBACK");
    transactionStarted = false;

    console.log("\nTransaction rolled back.");

    // Verify original counts are unchanged.
    const after = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM decision_support_results
          WHERE stay_id = $1) AS decisions,
         (SELECT COUNT(*) FROM drug_safety_results
          WHERE stay_id = $1) AS drug_findings`,
      [stayId]
    );

    console.log("Records after rollback:", after.rows[0]);

    if (
      Number(before.rows[0].decisions) !==
        Number(after.rows[0].decisions) ||
      Number(before.rows[0].drug_findings) !==
        Number(after.rows[0].drug_findings)
    ) {
      throw new Error("SAFETY CHECK FAILED: Original counts changed");
    }

    console.log("\nPASS: Both persistence operations rolled back safely.");
  } catch (err) {
    console.error("Test failed:", err);

    if (transactionStarted) {
      await client.query("ROLLBACK");
      console.log("Transaction rolled back after failure.");
    }

    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();