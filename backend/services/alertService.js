const { randomUUID } = require("crypto");
const pool = require("../db");
const screeningLedger = require("./screeningRunLedger");
const { computeAndPersistDecisionSupport } = require("./decisionSupportService");
const { getClinicalContext } = require("./clinicalContextService");

const HYSTERESIS_WINDOW_MINUTES = 15;
const SEVERITY_RANK = { LOW: 0, REVIEW: 1, MEDIUM: 2, HIGH: 3 };

const DRUG_SEVERITY_INFO = {
  Major: { severity: "HIGH", priority: "HIGH" },
  Moderate: { severity: "MEDIUM", priority: "MEDIUM" },
  Minor: { severity: "LOW", priority: "LOW" },
  Unknown: { severity: "REVIEW", priority: "REVIEW" },
};

function buildDrugAlertRows(patientId, stayId, drugSafetyRows) {
  return drugSafetyRows.map((row) => {
    const level = row.interaction_level || "Unknown";
    const severityInfo = DRUG_SEVERITY_INFO[level] || DRUG_SEVERITY_INFO.Unknown;
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
        `Drug interaction detected: ${row.component_a || "Unknown medication"} + ` +
        `${row.component_b || "Unknown medication"} (${level}). Clinician review required.`,
    };
  });
}

function buildPhysiologicalAlertRows(patientId, stayId, decision) {
  const rows = [];
  const knownNews2Categories = ["High Risk", "Medium Risk", "Low-Medium Risk", "Low Risk"];
  const knownTrendClassifications = ["STABLE", "IMPROVING", "DETERIORATING", "RAPIDLY_DETERIORATING"];

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
      alert_message: `NEWS2 score ${decision.news2_score ?? "7+"} indicates High physiological risk. Immediate clinical review required.`,
    });
  } else if (!knownNews2Categories.includes(decision.news2_category)) {
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
      alert_title: "NEWS2 baseline incomplete",
      alert_message: "Complete all 6 vital parameters + oxygen support to generate a verified NEWS2 score.",
    });
  }

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
      alert_title: "Rapidly deteriorating vital trajectory",
      alert_message: "Rapid physiological decline detected across consecutive vital readings. Escalate bedside evaluation.",
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
      alert_title: "Deteriorating vital trend",
      alert_message: "Worsening vital deltas observed since last reading. Reassess patient trajectory.",
    });
  } else if (!knownTrendClassifications.includes(decision.trend_classification)) {
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
      alert_title: "Awaiting second vital reading for trend",
      alert_message: "Baseline vitals recorded. Record a subsequent vital check to compute rate-of-change trajectory.",
    });
  }

  return rows;
}

async function filterWithHysteresis(client, stayId, candidateRows) {
  if (!candidateRows.length) return [];
  const recentRes = await client.query(
    `SELECT alert_type, alert_title, severity
     FROM clinical_alerts
     WHERE stay_id = $1
       AND status = 'ACTIVE'
       AND created_at >= NOW() - ($2 || ' minutes')::interval`,
    [stayId, String(HYSTERESIS_WINDOW_MINUTES)]
  );
  if (!recentRes.rows.length) return candidateRows;

  return candidateRows.filter((cand) => {
    const matchingRecent = recentRes.rows.filter(
      (r) => r.alert_type === cand.alert_type && r.alert_title === cand.alert_title
    );
    if (!matchingRecent.length) return true;
    const maxRecentRank = Math.max(...matchingRecent.map((r) => SEVERITY_RANK[r.severity] ?? 0));
    const candRank = SEVERITY_RANK[cand.severity] ?? 0;
    return candRank > maxRecentRank;
  });
}

async function generateAndPersistAlerts(stayId) {
  const engineRunId = randomUUID();
  const engineVersion = "phase6-v1";
  const initialContext = await getClinicalContext(stayId);
  if (!initialContext) return null;

  await screeningLedger.beginRun(stayId, engineRunId, engineVersion);
  let runRecorded = true;
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    try { await screeningLedger.failRun(engineRunId, err); } catch (_) {}
    throw err;
  }
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const lock = await client.query(
      `SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS locked`,
      [`decision_support:${stayId}`]
    );
    if (!lock.rows[0].locked) {
      const busy = new Error("Decision-support processing is already in progress for this stay");
      busy.statusCode = 409;
      throw busy;
    }

    const preDeleteResult = { rowCount: 0 };
    const decisionResult = await computeAndPersistDecisionSupport(stayId, {
      client,
      engineRunId,
      engineVersion,
    });
    if (!decisionResult) throw new Error(`Could not compute decision support for stay ${stayId}.`);

    const patientId = decisionResult.decision.patient_id;
    const drugSafetyResult = await client.query(
      `SELECT medication_id_a, medication_id_b, component_a, component_b,
              safety_result_id, interaction_level
       FROM drug_safety_results
       WHERE stay_id = $1 AND engine_run_id = $2`,
      [stayId, engineRunId]
    );

    const rawAlertRows = [
      ...buildDrugAlertRows(patientId, stayId, drugSafetyResult.rows),
      ...buildPhysiologicalAlertRows(patientId, stayId, decisionResult.decision),
    ];

    const alertRows = await filterWithHysteresis(client, stayId, rawAlertRows);
    let insertedRows = [];

    if (alertRows.length > 0) {
      const insertResult = await client.query(
        `INSERT INTO clinical_alerts
          (patient_id, stay_id, alert_type, alert_source,
           medication_id_a, medication_id_b, safety_result_id,
           severity, priority, alert_title, alert_message,
           status, engine_run_id, engine_version)
         SELECT $1, $2, t.alert_type, t.alert_source,
                t.medication_id_a, t.medication_id_b, t.safety_result_id,
                t.severity, t.priority, t.alert_title, t.alert_message,
                'ACTIVE', $12, $13
         FROM unnest(
            $3::text[], $4::text[], $5::int[], $6::int[], $7::int[],
            $8::text[], $9::text[], $10::text[], $11::text[]
         ) AS t(alert_type, alert_source, medication_id_a, medication_id_b,
                safety_result_id, severity, priority, alert_title, alert_message)
         RETURNING alert_id, alert_type, alert_source, medication_id_a,
                   medication_id_b, safety_result_id, severity, priority,
                   alert_title, alert_message, status`,
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

    const drugCount = Number(decisionResult.drug_safety?.inserted_count || 0);
    await screeningLedger.finishRun(
      engineRunId,
      drugCount + insertedRows.length > 0 ? "COMPLETE_FINDINGS" : "COMPLETE_ZERO_FINDINGS",
      drugCount,
      insertedRows.length,
      client
    );
    await client.query("COMMIT");
    transactionStarted = false;
    runRecorded = false;

    return {
      stay_id: stayId,
      decision: decisionResult.decision,
      drug_safety: decisionResult.drug_safety,
      deleted_count: preDeleteResult.rowCount,
      inserted_count: insertedRows.length,
      suppressed_count: rawAlertRows.length - alertRows.length,
      alerts: insertedRows,
    };
  } catch (err) {
    if (transactionStarted) {
      try { await client.query("ROLLBACK"); } catch (_) {}
    }
    if (runRecorded) {
      try { await screeningLedger.failRun(engineRunId, err); } catch (_) {}
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { generateAndPersistAlerts };
