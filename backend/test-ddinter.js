
require("dotenv").config();

const pool = require("./db");
const { getNormalizedMedications } = require("./services/medicationNormalizationService");
const { findDrugInteractions } = require("./services/ddinterService");

async function run() {
  try {
    // SAFETY CHECK: Never run this test on the main database.
    const dbCheck = await pool.query(
      "SELECT current_database() AS db"
    );

    const currentDb = dbCheck.rows[0].db;

    console.log("Connected database:", currentDb);

    if (currentDb !== "intelligent_er_drug_test") {
      throw new Error(
        `SAFETY STOP: Expected intelligent_er_drug_test, connected to ${currentDb}`
      );
    }

    console.log("\n--- Medication Normalization ---");

    const normalized = await getNormalizedMedications("32034003");

    console.log("canonical_identities:", normalized.canonical_identities);

    console.log("\n--- DDInter Interaction Check ---");

    const result = await findDrugInteractions(
      normalized.canonical_identities
    );

    console.log("checked_pairs_count:", result.checked_pairs_count);
    console.log("interactions_found count:", result.interactions_found.length);
    console.log(JSON.stringify(result.interactions_found, null, 2));

    console.log("\n--- Edge Cases ---");

    console.log(
      "Empty array:",
      JSON.stringify(await findDrugInteractions([]))
    );

    console.log(
      "Single drug:",
      JSON.stringify(await findDrugInteractions(["amoxicillin"]))
    );

    console.log(
      "Null input:",
      JSON.stringify(await findDrugInteractions(null))
    );

    console.log(
      "Duplicate drug:",
      JSON.stringify(
        await findDrugInteractions([
          "ibuprofen",
          "ibuprofen",
          "prasugrel"
        ])
      )
    );

    console.log("\nDDInter tests completed.");
  } catch (err) {
    console.error("Test script error:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
