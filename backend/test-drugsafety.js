
require("dotenv").config();

const { randomUUID } = require("crypto");
const pool = require("./db");

const {
  getNormalizedMedications,
} = require("./services/medicationNormalizationService");

const {
  findDrugInteractions,
} = require("./services/ddinterService");

const {
  persistDrugSafetyResults,
} = require("./services/drugSafetyService");

async function run() {
  const stayId = "32034003";
  const client = await pool.connect();

  try {
    const dbCheck = await client.query(
      "SELECT current_database() AS db"
    );

    const currentDb = dbCheck.rows[0].db;

    console.log("Connected database:", currentDb);

    if (currentDb !== "intelligent_er_drug_test") {
      throw new Error("SAFETY STOP: Wrong database");
    }

    const before = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM drug_safety_results
       WHERE stay_id = $1`,
      [stayId]
    );

    console.log("Original findings:", before.rows[0].count);

    await client.query("BEGIN");

    try {
      const normalized = await getNormalizedMedications(stayId);

      const interactions = await findDrugInteractions(
        normalized.canonical_identities
      );

      const engineRunId = randomUUID();
      const engineVersion = "phase6-v1";

      const result = await persistDrugSafetyResults(
        stayId,
        normalized.mapped_medications,
        interactions.interactions_found,
        {
          client,
          engineRunId,
          engineVersion,
        }
      );

      console.log("\nTemporary persistence result:");
      console.log("Deleted:", result.deleted_count);
      console.log("Inserted:", result.inserted_count);
      console.log("Engine run:", engineRunId);
      console.log("Engine version:", engineVersion);

      console.log(
        "All inserted rows have correct provenance:",
        result.findings.every(
          row =>
            row.engine_run_id === engineRunId &&
            row.engine_version === engineVersion
        )
      );

      console.log(
        "Interaction levels:",
        [...new Set(
          result.findings.map(row => row.interaction_level)
        )]
      );
    } finally {
      // Always undo the temporary persistence test.
      await client.query("ROLLBACK");
      console.log("\nTransaction rolled back.");
    }

    const after = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM drug_safety_results
       WHERE stay_id = $1`,
      [stayId]
    );

    console.log("Findings after rollback:", after.rows[0].count);

    if (before.rows[0].count !== after.rows[0].count) {
      throw new Error("SAFETY CHECK FAILED: Original count changed");
    }

    console.log("\nPersistence test completed safely.");
  } catch (err) {
    console.error("Test failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
