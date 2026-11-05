require("dotenv").config();
const pool = require("./db");
const { generateAndPersistAlerts } = require("./services/alertService");


async function run() {

  try {
        const dbCheck = await pool.query(
      "SELECT current_database() AS db"
    );

    const currentDb = dbCheck.rows[0].db;

    if (currentDb !== "intelligent_er_drug_test") {
      throw new Error(
        `SAFETY STOP: Expected intelligent_er_drug_test, connected to ${currentDb}`
      );
    }

    console.log("Safety check passed. Connected DB:", currentDb);
    const cases = [
      { label: "High NEWS2 (expect PHYSIOLOGICAL_RISK + drug alerts)", stayId: "32007337" },
      { label: "Plain DETERIORATING (expect VITAL_TREND, REVIEW)", stayId: "33065303" },
      { label: "RAPIDLY_DETERIORATING (expect VITAL_TREND, HIGH)", stayId: "30915333" },
      { label: "Mixed severity, no physio trigger (expect drug alerts only)", stayId: "32034003" },
      { label: "Real MAJOR interaction stay (expect drug alerts only, no physio)", stayId: "30094124" },
    ];

    for (const c of cases) {
      console.log(`\n=== ${c.label} -- stay ${c.stayId} ===`);
      const result = await generateAndPersistAlerts(c.stayId);
      console.log("deleted_count:", result.deleted_count, "inserted_count:", result.inserted_count);
      // Show physiological/trend alerts in full; just count drug alerts to keep output readable.
      const physio = result.alerts.filter((a) => a.alert_type !== "DRUG_INTERACTION");
      const drug = result.alerts.filter((a) => a.alert_type === "DRUG_INTERACTION");
      console.log(`drug alerts: ${drug.length}, physiological/trend alerts: ${physio.length}`);
      console.log(JSON.stringify(physio, null, 2));
    }

    console.log("\n=== Nonexistent stay (expected: null, no writes) ===");
    console.log("Result:", await generateAndPersistAlerts("999999999"));

    console.log("\n=== Idempotency check: re-run stay 32034003 ===");
    const second = await generateAndPersistAlerts("32034003");
    console.log("deleted_count:", second.deleted_count, "inserted_count:", second.inserted_count);

    const countCheck = await pool.query(
      "SELECT count(*) FROM clinical_alerts WHERE stay_id = $1",
      ["32034003"]
    );
    console.log("Row count for this stay (should not double):", countCheck.rows[0].count);
  } catch (err) {
    console.error("Test script error:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

run();