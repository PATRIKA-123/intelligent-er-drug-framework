"use strict";
const { randomUUID } = require("crypto");
const pool = require("../db");
const { getClinicalContext } = require("./clinicalContextService");
const { getNormalizedMedications } = require("./medicationNormalizationService");
const { findDrugInteractions } = require("./ddinterService");
const { persistDrugSafetyResults } = require("./drugSafetyService");

function physiologicalTier(category) {
  if (category === "High Risk") return "HIGH";
  if (["Medium Risk", "Low-Medium Risk"].includes(category)) return "MEDIUM";
  return "LOW";
}
function trendTier(status) { return status === "RAPIDLY_DETERIORATING" ? "HIGH" : "LOW"; }
function drugSafetyTier(counts) {
  if (counts.major >= 1) return "HIGH";
  if (counts.moderate >= 1) return "MEDIUM";
  return "LOW";
}
const TIER_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };
function maxTier(...tiers) {
  return tiers.reduce((worst, tier) => TIER_RANK[tier] > TIER_RANK[worst] ? tier : worst, "LOW");
}
function isTrendClassificationReviewRequired(value) {
  return !["STABLE", "IMPROVING", "DETERIORATING", "RAPIDLY_DETERIORATING"].includes(value);
}
function isNews2ReviewRequired(value) {
  return !["High Risk", "Medium Risk", "Low-Medium Risk", "Low Risk"].includes(value);
}
function decisionPriority(news2, trend, counts) {
  if (counts.major >= 1 || trend === "RAPIDLY_DETERIORATING" || news2 === "High Risk") return "HIGH";
  if (counts.moderate >= 1 || ["Medium Risk", "Low-Medium Risk"].includes(news2)) return "MEDIUM";
  if (isNews2ReviewRequired(news2) || isTrendClassificationReviewRequired(trend)) return "REVIEW";
  if (trend === "DETERIORATING" || counts.unknown >= 1) return "REVIEW";
  if (counts.minor >= 1) return "LOW";
  return "ROUTINE";
}
function countSeverities(found) {
  const counts = { major: 0, moderate: 0, minor: 0, unknown: 0 };
  for (const item of found) {
    const level = String(item?.interaction_level ?? "").trim().toLowerCase();
    if (Object.hasOwn(counts, level) && level !== "unknown") counts[level]++;
    else counts.unknown++;
  }
  return counts;
}
function buildDecisionSummary(news2, score, trend, counts, priority) {
  const total = counts.major + counts.moderate + counts.minor + counts.unknown;
  return `Physiological risk: ${news2 || "Unavailable"} (NEWS2 ${score ?? "N/A"}). ` +
    `Vital trend: ${trend || "Unavailable"}. ` +
    `Drug interaction alerts: ${total} ` +
    `(Major: ${counts.major}, Moderate: ${counts.moderate}, Minor: ${counts.minor}, Unknown: ${counts.unknown}). ` +
    `Decision priority: ${priority}.`;
}

async function computeAndPersistDecisionSupport(stayId, options = {}) {
  const engineRunId = options.engineRunId ?? randomUUID();
  const engineVersion = options.engineVersion ?? "phase6-v1";
  const context = await getClinicalContext(stayId);
  if (!context) return null;
  const news2Category = context.latest_news2 ? context.latest_news2.risk_level : null;
  const news2Score = context.latest_news2 ? context.latest_news2.total_news2_score : null;
  const trendClassification = context.latest_trend ? context.latest_trend.trend_classification : null;

  // B14: every medication must have unambiguous, verified normalization before
  // clinical interaction screening can be labeled complete. No persisted rows
  // are deleted when this precondition fails.
  const normalized = await getNormalizedMedications(stayId, { requireComplete: true });
  const interactions = await findDrugInteractions(normalized.canonical_identities);
  const counts = countSeverities(interactions.interactions_found);
  const overallRisk = maxTier(physiologicalTier(news2Category), trendTier(trendClassification), drugSafetyTier(counts));
  const priority = decisionPriority(news2Category, trendClassification, counts);
  const summary = buildDecisionSummary(news2Category, news2Score, trendClassification, counts, priority);
  const externalClient = options.client ?? null;
  const client = externalClient ?? await pool.connect();
  const ownsTransaction = !externalClient;

  try {
    if (ownsTransaction) await client.query("BEGIN");
    const drugSafety = await persistDrugSafetyResults(
      stayId, normalized.mapped_medications, interactions.interactions_found,
      { ...options, client, engineRunId, engineVersion }
    );
    if (!drugSafety) {
      if (ownsTransaction) await client.query("ROLLBACK");
      return null;
    }
    // B22_APPEND_ONLY_DECISION: previous decision runs remain immutable history.
    const deleteResult = { rowCount: 0 };
    const insertResult = await client.query(
      `INSERT INTO decision_support_results
         (patient_id, stay_id, news2_score, news2_category,
          trend_classification, drug_alert_count,
          major_interaction_count, moderate_interaction_count,
          overall_risk, decision_priority, decision_summary,
          evidence_source, engine_run_id, engine_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING decision_id, patient_id, stay_id, news2_score,
                 news2_category, trend_classification,
                 drug_alert_count, major_interaction_count,
                 moderate_interaction_count, overall_risk,
                 decision_priority, decision_summary,
                 evidence_source, engine_run_id, engine_version`,
      [context.patient ? context.patient.patient_id : null, stayId,
       news2Score, news2Category, trendClassification,
       counts.major + counts.moderate + counts.minor + counts.unknown,
       counts.major, counts.moderate, overallRisk, priority, summary,
       "NEWS2 + VITAL_TREND + DDInter_2.0 (Phase 6 engine)", engineRunId, engineVersion]
    );
    if (ownsTransaction) await client.query("COMMIT");
    return { stay_id: stayId, deleted_count: deleteResult.rowCount,
      inserted_count: insertResult.rows.length, decision: insertResult.rows[0],
      drug_safety: { deleted_count: drugSafety.deleted_count, inserted_count: drugSafety.inserted_count },
      interaction_counts: counts };
  } catch (err) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (ownsTransaction) client.release();
  }
}
module.exports = { computeAndPersistDecisionSupport };
