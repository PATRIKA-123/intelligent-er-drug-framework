const { randomUUID } = require("crypto");
const pool = require("../db");
const {
  computeAndPersistDecisionSupport, 
} = require("./decisionSupportService");
const { getClinicalContext } = require("./clinicalContextService");

// Keep these severity definitions aligned with the existing project rules.
const DRUG_SEVERITY_INFO = {
  Major: {
    severity: "HIGH",
    priority: "HIGH",
  },
  Moderate: {
    severity: "MEDIUM",
    priority: "MEDIUM",
  },
  Minor: {
    severity: "LOW",
    priority: "LOW",
  },
  Unknown: {
    severity: "REVIEW",
    priority: "REVIEW",
  },
};

function buildDrugAlertRows(patientId, stayId, drugSafetyRows) {
  return drugSafetyRows.map((row) => {
    const level = row.interaction_level || "Unknown";
    const severityInfo =
      DRUG_SEVERITY_INFO[level] || DRUG_SEVERITY_INFO.Unknown;

    return {
      patient_id: patientId,
      stay_id: stayId,
      alert_type: "DRUG_INTERACTION",
      alert_source: "DDInter",
      medication_id_a: row.medication_id_a,
      medication_id_b: row.medication_id_b,
      safety_result_id: row.safety_result_id,
      severity: severityInfo.severity,
      priority: severityInfo.priority,
      alert_title: `${level} drug interaction`,
      alert_message:
        `Project-generated drug interaction finding: ` +
        `${row.component_a || "Unknown medication"} and ` +
        `${row.component_b || "Unknown medication"}. ` +
        `Interaction level: ${level}. Review by a qualified clinician is required.`,
    };
  });
}


function buildPhysiologicalAlertRows(patientId, stayId, decision) {
  const rows = [];

  const knownNews2Categories = [
    "High Risk",
    "Medium Risk",
    "Low-Medium Risk",
    "Low Risk",
  ];

  const knownTrendClassifications = [
    "STABLE",
    "IMPROVING",
    "DETERIORATING",
    "RAPIDLY_DETERIORATING",
  ];

  // NEWS2 high-risk alert
  if (decision.news2_category === "High Risk") {
    rows.push({
      patient_id: patientId,
      stay_id: stayId,
      alert_type: "PHYSIOLOGICAL_RISK",
      alert_source: "NEWS2",
      medication_id_a: null,
      medication_id_b: null,
      safety_result_id: null,
      severity: "HIGH",
      priority: "HIGH",
      alert_title: "High NEWS2 risk",
      alert_message:
        "The stored NEWS2 classification is High Risk. " +
        "This is a project-generated finding and requires clinical review.",
    });
  } else if (
    !knownNews2Categories.includes(decision.news2_category)
  ) {
    rows.push({
      patient_id: patientId,
      stay_id: stayId,
      alert_type: "DATA_QUALITY_REVIEW",
      alert_source: "NEWS2",
      medication_id_a: null,
      medication_id_b: null,
      safety_result_id: null,
      severity: "REVIEW",
      priority: "REVIEW",
      alert_title: "NEWS2 data requires review",
      alert_message:
        "The NEWS2 category is missing or unrecognized. " +
        "Clinical review is required before relying on the physiological risk assessment.",
    });
  }

  // Vital trend alerts
  if (decision.trend_classification === "RAPIDLY_DETERIORATING") {
    rows.push({
      patient_id: patientId,
      stay_id: stayId,
      alert_type: "VITAL_TREND",
      alert_source: "TREND_ENGINE",
      medication_id_a: null,
      medication_id_b: null,
      safety_result_id: null,
      severity: "HIGH",
      priority: "HIGH",
      alert_title: "Rapidly deteriorating vital trend",
      alert_message:
        "The stored vital-trend classification is RAPIDLY_DETERIORATING. " +
        "This is a project-generated finding and requires clinical review.",
    });
  } else if (decision.trend_classification === "DETERIORATING") {
    rows.push({
      patient_id: patientId,
      stay_id: stayId,
      alert_type: "VITAL_TREND",
      alert_source: "TREND_ENGINE",
      medication_id_a: null,
      medication_id_b: null,
      safety_result_id: null,
      severity: "REVIEW",
      priority: "REVIEW",
      alert_title: "Deteriorating vital trend - Clinical Review Required",
      alert_message:
        "The stored vital-trend classification is DETERIORATING. " +
        "Clinical review is required. This classification does not independently increase the overall risk tier.",
    });
  } else if (
    !knownTrendClassifications.includes(decision.trend_classification)
  ) {
    rows.push({
      patient_id: patientId,
      stay_id: stayId,
      alert_type: "DATA_QUALITY_REVIEW",
      alert_source: "TREND_ENGINE",
      medication_id_a: null,
      medication_id_b: null,
      safety_result_id: null,
      severity: "REVIEW",
      priority: "REVIEW",
      alert_title: "Vital trend data requires review",
      alert_message:
        "The vital-trend classification is missing, insufficient, or unrecognized. " +
        "Clinical review is required before relying on the trend assessment.",
    });
  }

  return rows;
}


async function generateAndPersistAlerts(stayId) {
  const engineRunId = randomUUID();
const engineVersion = "phase6-v1";
  // Read-only precheck: don't delete existing alerts for an invalid stay.
  const initialContext = await getClinicalContext(stayId);

  if (!initialContext) {
    return null;
  }

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    // Delete old alerts first because they reference safety-result rows.
    const preDeleteResult = await client.query(
      `DELETE FROM clinical_alerts WHERE stay_id = $1`,
      [stayId]
    );

    // Persist decision support and drug safety using the same transaction.
   const decisionResult = await computeAndPersistDecisionSupport(stayId, {
  client,
  engineRunId,
  engineVersion,
});

if (!decisionResult) {
  throw new Error(
    `Could not compute decision support for stay ${stayId}.`
  );
}

    const patientId = decisionResult.decision.patient_id;

    const drugSafetyResult = await client.query(
      `SELECT
         medication_id_a,
         medication_id_b,
         component_a,
         component_b,
         safety_result_id,
         interaction_level
       FROM drug_safety_results
       WHERE stay_id = $1`,
      [stayId]
    );

    const alertRows = [
      ...buildDrugAlertRows(patientId, stayId, drugSafetyResult.rows),
      ...buildPhysiologicalAlertRows(
        patientId,
        stayId,
        decisionResult.decision
      ),
    ];

    let insertedRows = [];

    if (alertRows.length > 0) {
      const insertResult = await client.query(
        `INSERT INTO clinical_alerts
          (
            patient_id,
            stay_id,
            alert_type,
            alert_source,
            medication_id_a,
            medication_id_b,
            safety_result_id,
            severity,
            priority,
            alert_title,
            alert_message,
            status,
            engine_run_id,
             engine_version
          )
         SELECT
            $1,
            $2,
            t.alert_type,
            t.alert_source,
            t.medication_id_a,
            t.medication_id_b,
            t.safety_result_id,
            t.severity,
            t.priority,
            t.alert_title,
            t.alert_message,
            'ACTIVE',
            $12,
            $13
         FROM unnest(
            $3::text[],
            $4::text[],
            $5::int[],
            $6::int[],
            $7::int[],
            $8::text[],
            $9::text[],
            $10::text[],
            $11::text[]
         ) AS t(
            alert_type,
            alert_source,
            medication_id_a,
            medication_id_b,
            safety_result_id,
            severity,
            priority,
            alert_title,
            alert_message
         )
         RETURNING
            alert_id,
            alert_type,
            alert_source,
            medication_id_a,
            medication_id_b,
            safety_result_id,
            severity,
            priority,
            alert_title,
            alert_message,
            status`,
        [
          patientId,
          stayId,
          alertRows.map((row) => row.alert_type),
          alertRows.map((row) => row.alert_source),
          alertRows.map((row) => row.medication_id_a),
          alertRows.map((row) => row.medication_id_b),
          alertRows.map((row) => row.safety_result_id),
          alertRows.map((row) => row.severity),
          alertRows.map((row) => row.priority),
          alertRows.map((row) => row.alert_title),
          alertRows.map((row) => row.alert_message),
          engineRunId,
          engineVersion,
        ]
      );

      insertedRows = insertResult.rows;
    }

    // One commit for all writes.
    await client.query("COMMIT");
    transactionStarted = false;

    
return {
  stay_id: stayId,
  decision: decisionResult.decision,
  drug_safety: decisionResult.drug_safety,
  deleted_count: preDeleteResult.rowCount,
  inserted_count: insertedRows.length,
  alerts: insertedRows,
};

  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Transaction rollback failed:",
          rollbackError.message
        );
      }
    }

    throw err;
  } finally {
    client.release();
  }
}

module.exports = { generateAndPersistAlerts };
