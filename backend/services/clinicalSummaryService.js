"use strict";
const pool = require("../db");
const { getClinicalContext } = require("./clinicalContextService");
const { classifySnapshot } = require("./screeningStatus");
const screeningLedger = require("./screeningRunLedger");
const CURRENT_ENGINE_VERSION = "phase6-v1";

/** Read-only clinical summary for an ED stay; never triggers screening. */
async function getClinicalSummary(stayId) {
  const context = await getClinicalContext(stayId);
  if (!context) return null;

  const decisionResult = await pool.query(
    `SELECT decision_id, news2_score, news2_category, trend_classification,
            drug_alert_count, major_interaction_count, moderate_interaction_count,
            overall_risk, decision_priority, decision_summary, evidence_source,
            created_at, engine_run_id, engine_version
     FROM decision_support_results WHERE stay_id = $1
     ORDER BY created_at DESC, decision_id DESC LIMIT 1`, [stayId]);
  const decision = decisionResult.rows[0] || null;

  // B22_CURRENT_RUN_SUMMARY: never mix findings from different engine runs.
  const safetyResult = await pool.query(
    `SELECT safety_result_id, medication_id_a, medication_id_b, component_a, component_b,
            interaction_id, interaction_level, result_status, source, created_at,
            engine_run_id, engine_version
     FROM drug_safety_results
     WHERE stay_id = $1 AND engine_run_id = $2
     ORDER BY safety_result_id`, [stayId, decision?.engine_run_id ?? null]);
  const alertsResult = await pool.query(
    `SELECT alert_id, alert_type, alert_source, medication_id_a, medication_id_b,
            safety_result_id, severity, priority, alert_title, alert_message,
            status, created_at, engine_run_id, engine_version
     FROM clinical_alerts
     WHERE stay_id = $1 AND engine_run_id = $2
     ORDER BY alert_id`, [stayId, decision?.engine_run_id ?? null]);

  // No findings does not mean no screening. A persisted current-engine decision
  // proves the clinical pipeline completed even when its safety/alerts tables
  // were legitimately left empty. This is a snapshot, not a run history.
    const historical = classifySnapshot(decision, safetyResult.rows, CURRENT_ENGINE_VERSION);
  const latest = await screeningLedger.latestRun(stayId);
  const screening = screeningLedger.statusForRun(latest, "drug", CURRENT_ENGINE_VERSION) || historical;
    const alertScreening = screeningLedger.statusForRun(latest, "alert", CURRENT_ENGINE_VERSION) ||
    classifySnapshot(decision, alertsResult.rows, CURRENT_ENGINE_VERSION);
    const computed = Boolean(decision && decision.engine_run_id && decision.engine_version === CURRENT_ENGINE_VERSION &&
    (!latest || (latest.engine_run_id === decision.engine_run_id && latest.status.startsWith("COMPLETE_"))));
  const safetyCurrent = screening.status.startsWith("COMPLETE_");
  const alertsCurrent = alertScreening.status.startsWith("COMPLETE_");

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
        screening_run: latest ? screeningLedger.statusForRun(latest, "drug", CURRENT_ENGINE_VERSION) : null,
    decision_support: {
      computed_by_current_engine: computed,
      result: decision,
    },
    drug_safety: {
      computed_by_current_engine: safetyCurrent,
      provenance_status: safetyCurrent ? "VERIFIED_CURRENT_RUN" : "NOT_VERIFIED",
      screening_status: screening.status,
      completed_at: screening.completed_at,
      engine_run_id: screening.engine_run_id,
      findings: safetyResult.rows,
    },
    clinical_alerts: {
      computed_by_current_engine: alertsCurrent,
      provenance_status: alertsCurrent ? "VERIFIED_CURRENT_RUN" : "NOT_VERIFIED",
      screening_status: alertScreening.status,
      completed_at: alertScreening.completed_at,
      engine_run_id: alertScreening.engine_run_id,
      alerts: alertsResult.rows,
    },
  };
}
module.exports = { getClinicalSummary };
