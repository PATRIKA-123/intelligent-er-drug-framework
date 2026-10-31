const pool = require("../db");
const { getClinicalContext } = require("./clinicalContextService");

/**
 *
 *
 * @param {string|number} stayId
 * @returns {Promise<object|null>} null if the stay does not exist.
 */
async function getClinicalSummary(stayId) {
  // Clinical context already covers: stay, patient, diagnoses,
  // medications, latest_observation, latest_news2, latest_trend,
  // allergies, history. It is itself read-only (Phase 2).
  const context = await getClinicalContext(stayId);
  if (!context) {
    return null;
  }

  const decisionResult = await pool.query(
    `SELECT decision_id, news2_score, news2_category, trend_classification,
            drug_alert_count, major_interaction_count, moderate_interaction_count,
            overall_risk, decision_priority, decision_summary, evidence_source, created_at, engine_run_id, engine_version
     FROM decision_support_results
     WHERE stay_id = $1
     ORDER BY created_at DESC, decision_id DESC
     LIMIT 1`,
     
    [stayId]
  );

  const decisionRow = decisionResult.rows[0] || null;

  const CURRENT_ENGINE_VERSION = "phase6-v1";

const decisionSupportComputedByCurrentEngine =
  Boolean(
    decisionRow?.engine_run_id &&
    decisionRow?.engine_version === CURRENT_ENGINE_VERSION
  );

  const drugSafetyResult = await pool.query(
    `SELECT safety_result_id, medication_id_a, medication_id_b, component_a, component_b,
            interaction_id, interaction_level, result_status, source, created_at,engine_run_id, engine_version
     FROM drug_safety_results
     WHERE stay_id = $1
     ORDER BY safety_result_id`,
    [stayId]
  );

  const alertsResult = await pool.query(
  `SELECT
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
      status,
      created_at,
      engine_run_id,
      engine_version
   FROM clinical_alerts
   WHERE stay_id = $1
   ORDER BY alert_id`,
  [stayId]
);

  const drugSafetyComputedByCurrentEngine =
  drugSafetyResult.rows.length > 0 &&
  Boolean(decisionRow?.engine_run_id) &&
  drugSafetyResult.rows.every(
    (row) =>
      row.engine_run_id === decisionRow.engine_run_id &&
      row.engine_version === CURRENT_ENGINE_VERSION
  );

const clinicalAlertsComputedByCurrentEngine =
  alertsResult.rows.length > 0 &&
  Boolean(decisionRow?.engine_run_id) &&
  alertsResult.rows.every(
    (row) =>
      row.engine_run_id === decisionRow.engine_run_id &&
      row.engine_version === CURRENT_ENGINE_VERSION
  );

  // Legacy rows are real, persisted data -- not fabricated and not
  // hidden. They are shown as-is, but clearly labeled, so the caller
  // can tell "this came from the pre-rebuild batch script" apart from
  // "this came from the current Phase 6/7 engine," rather than either
  // silently trusting stale data or pretending it doesn't exist.
 
return {
  stay: context.stay,
  patient: context.patient,
  diagnoses: context.diagnoses,
  medications: context.medications,
  latest_observation: context.latest_observation,
  latest_news2: context.latest_news2,
  latest_trend: context.latest_trend,
  allergies: context.allergies,
  history: context.history,

  decision_support: {
    computed_by_current_engine: decisionSupportComputedByCurrentEngine,
    result: decisionRow,
  },

  drug_safety: {
  computed_by_current_engine: drugSafetyComputedByCurrentEngine,
  provenance_status: drugSafetyComputedByCurrentEngine
    ? "VERIFIED_CURRENT_RUN"
    : "NOT_VERIFIED",
  findings: drugSafetyResult.rows,
},
clinical_alerts: {
  computed_by_current_engine: clinicalAlertsComputedByCurrentEngine,
  provenance_status: clinicalAlertsComputedByCurrentEngine
    ? "VERIFIED_CURRENT_RUN"
    : "NOT_VERIFIED",
  alerts: alertsResult.rows,
},
};

}

module.exports = { getClinicalSummary };