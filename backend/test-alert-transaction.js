
const pool = require("./db");
const { generateAndPersistAlerts } = require("./services/alertService");

const stayId = "32034003";

async function getSnapshot() {
  const tables = [
    "decision_support_results",
    "drug_safety_results",
    "clinical_alerts",
  ];

  const snapshot = {};

  for (const table of tables) {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS rows,
         COUNT(DISTINCT engine_run_id)::int AS run_ids,
         MIN(engine_run_id::text) AS engine_run_id,
         MIN(engine_version) AS engine_version
       FROM ${table}
       WHERE stay_id = $1`,
      [stayId]
    );

    snapshot[table] = result.rows[0];
  }

  return snapshot;
}

async function run() {
  const triggerName = "test_force_alert_insert_failure_trigger";
  const functionName = "test_force_alert_insert_failure";

  let triggerInstalled = false;

  try {
    const dbCheck = await pool.query(
      "SELECT current_database() AS db"
    );

    const currentDb = dbCheck.rows[0].db;
    console.log("Connected DB:", currentDb);

    if (currentDb !== "intelligent_er_drug_test") {
      throw new Error("SAFETY STOP: Wrong database");
    }

    const before = await getSnapshot();

    console.log("\nBefore forced failure:");
    console.table(before);

    if (
      Number(before.decision_support_results.rows) !== 1 ||
      Number(before.drug_safety_results.rows) !== 36 ||
      Number(before.clinical_alerts.rows) !== 37
    ) {
      throw new Error(
        "Baseline mismatch. Expected 1 Decision, 36 Drug Safety, 37 Alerts."
      );
    }

    // Install a test-only trigger that deliberately fails alert insertion.
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.${functionName}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'TEST ONLY: Forced alert insertion failure';
      END;
      $$;
    `);

    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON clinical_alerts
      FOR EACH ROW
      EXECUTE FUNCTION public.${functionName}();
    `);

    triggerInstalled = true;

    console.log("\nTemporary failure trigger installed.");

    let expectedFailureCaught = false;

    try {
      await generateAndPersistAlerts(stayId);
    } catch (error) {
      if (
        error.message.includes(
          "TEST ONLY: Forced alert insertion failure"
        )
      ) {
        expectedFailureCaught = true;
        console.log("\nExpected failure caught:", error.message);
      } else {
        throw error;
      }
    }

    if (!expectedFailureCaught) {
      throw new Error(
        "Test failed: Alert insertion did not produce the expected failure."
      );
    }

    // Remove the temporary trigger before checking the database.
    await pool.query(`
      DROP TRIGGER IF EXISTS ${triggerName}
      ON clinical_alerts;
    `);

    await pool.query(`
      DROP FUNCTION IF EXISTS public.${functionName}();
    `);

    triggerInstalled = false;

    const after = await getSnapshot();

    console.log("\nAfter forced failure and rollback:");
    console.table(after);

    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(
        "ROLLBACK FAILED: Database snapshot changed."
      );
    }

    console.log(
      "\nPASS: Decision Support, Drug Safety and Clinical Alerts remained unchanged."
    );
  } catch (error) {
    console.error("\nTEST FAILED:", error.message);
    process.exitCode = 1;
  } finally {
    if (triggerInstalled) {
      try {
        await pool.query(`
          DROP TRIGGER IF EXISTS ${triggerName}
          ON clinical_alerts;
        `);

        await pool.query(`
          DROP FUNCTION IF EXISTS public.${functionName}();
        `);

        console.log("Temporary test trigger cleaned up.");
      } catch (cleanupError) {
        console.error(
          "CLEANUP FAILED:",
          cleanupError.message
        );
        process.exitCode = 1;
      }
    }

    await pool.end();
  }
}

run();
