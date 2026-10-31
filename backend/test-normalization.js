require("dotenv").config();
const pool = require("./db");
const { getNormalizedMedications } = require("./services/medicationNormalizationService");

async function run() {
  try {
    console.log("=== STAY 37330786 ===");
    console.log(JSON.stringify(await getNormalizedMedications("37330786"), null, 2));

    console.log("\n=== STAY 32034003 ===");
    console.log(JSON.stringify(await getNormalizedMedications("32034003"), null, 2));

    console.log("\n=== STAY 37887480 ===");
    console.log(JSON.stringify(await getNormalizedMedications("37887480"), null, 2));
  } catch (err) {
    console.error("Test script error:", err.message);
  } finally {
    await pool.end();
  }
}

run();