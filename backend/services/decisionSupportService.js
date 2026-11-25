"use strict";
const { randomUUID } = require("crypto");
const pool = require("../db");
const { getClinicalContext } = require("./clinicalContextService");
const { getNormalizedMedications } = require("./medicationNormalizationService");
const { findDrugInteractions } = require("./ddinterService");
const { persistDrugSafetyResults } = require("./drugSafetyService");

const DRUG_CLASS_SIGNALS = [
  {
    pattern: /\b(metoprolol|atenolol|propranolol|bisoprolol|carvedilol|labetalol|nebivolol)\b/i,
    label: "Beta-blocker",
    check: (obs) =>
      Number(obs?.heart_rate) > 0 && Number(obs.heart_rate) < 55
        ? `Heart rate is ${obs.heart_rate} bpm (bradycardia risk with beta-blocker therapy)`
        : Number(obs?.systolic_bp) > 0 && Number(obs.systolic_bp) < 95
        ? `Systolic BP is ${obs.systolic_bp} mmHg (hypotension risk with beta-blocker therapy)`
        : null,
  },
  {
    pattern: /\b(amlodipine|lisinopril|enalapril|ramipril|losartan|telmisartan|valsartan|nitroglycerin|furosemide|torsemide)\b/i,
    label: "Antihypertensive / Vasodilator / Diuretic",
    check: (obs) =>
      Number(obs?.systolic_bp) > 0 && Number(obs.systolic_bp) < 95
        ? `Systolic BP is ${obs.systolic_bp} mmHg (hypotension risk if continued)`
        : null,
  },
  {
    pattern: /\b(morphine|fentanyl|tramadol|codeine|oxycodone|lorazepam|diazepam|midazolam|alprazolam)\b/i,
    label: "CNS / Respiratory Depressant",
    check: (obs) =>
      (Number(obs?.spo2) > 0 && Number(obs.spo2) < 92) ||
      (Number(obs?.respiratory_rate) > 0 && Number(obs.respiratory_rate) < 10)
        ? `Low SpO2 (${obs.spo2 ?? "?"}%) or reduced respiratory rate (${obs.respiratory_rate ?? "?"}/min) increases respiratory depression risk`
        : null,
  },
  {
    pattern: /\b(warfarin|heparin|enoxaparin|apixaban|rivaroxaban|clopidogrel|aspirin)\b/i,
    label: "Anticoagulant / Antiplatelet",
    check: (obs) =>
      Number(obs?.systolic_bp) > 0 && Number(obs.systolic_bp) < 90
        ? `Hypotension (SBP ${obs.systolic_bp} mmHg) requires ruling out occult bleeding before anticoagulation`
        : null,
  },
];

function evaluateVitalDrugConflicts(latestObs, medications = []) {
  if (!latestObs || !Array.isArray(medications) || medications.length === 0) return [];
  const warnings = [];
  const seen = new Set();
  for (const med of medications) {
    const raw = String(med.medication_name || med.canonical_name || "").trim();
    if (!raw) continue;
    for (const rule of DRUG_CLASS_SIGNALS) {
      if (!rule.pattern.test(raw)) continue;
      const issue = rule.check(latestObs);
      if (issue) {
        const key = `${raw.toLowerCase()}:${rule.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        warnings.push(`${raw} (${rule.label}): ${issue}`);
      }
    }
  }
  return warnings;
}

function describePhysiologicalTriggers(obs, news2) {
  if (!obs) return [];
  const triggers = [];
  if (Number(obs.spo2) > 0 && Number(obs.spo2) <= 91) triggers.push(`hypoxia (SpO2 ${obs.spo2}%)`);
  if (Number(obs.heart_rate) >= 111) triggers.push(`tachycardia (HR ${obs.heart_rate} bpm)`);
  else if (Number(obs.heart_rate) > 0 && Number(obs.heart_rate) <= 50) triggers.push(`bradycardia (HR ${obs.heart_rate} bpm)`);
  if (Number(obs.systolic_bp) > 0 && Number(obs.systolic_bp) <= 100) triggers.push(`hypotension (SBP ${obs.systolic_bp} mmHg)`);
  else if (Number(obs.systolic_bp) >= 220) triggers.push(`severe hypertension (SBP ${obs.systolic_bp} mmHg)`);
  if (Number(obs.respiratory_rate) >= 21) triggers.push(`tachypnea (RR ${obs.respiratory_rate}/min)`);
  else if (Number(obs.respiratory_rate) > 0 && Number(obs.respiratory_rate) <= 8) triggers.push(`bradypnea (RR ${obs.respiratory_rate}/min)`);
  if (Number(obs.temperature_celsius) >= 38.1) triggers.push(`hyperthermia (${obs.temperature_celsius} °C)`);
  else if (Number(obs.temperature_celsius) > 0 && Number(obs.temperature_celsius) <= 35.0) triggers.push(`hypothermia (${obs.temperature_celsius} °C)`);
  if (obs.consciousness && String(obs.consciousness).toUpperCase() !== "ALERT") {
    triggers.push(`altered consciousness (${obs.consciousness})`);
  }
  if (triggers.length === 0 && news2 && Number(news2.total_news2_score) > 0) {
    triggers.push(`cumulative NEWS2 score of ${news2.total_news2_score}`);
  }
  return triggers;
}

function describeTrendSlope(trend) {
  if (!trend || !["STABLE", "IMPROVING", "DETERIORATING", "RAPIDLY_DETERIORATING"].includes(trend.trend_classification)) {
    return null;
  }
  const rates = [];
  if (Number.isFinite(Number(trend.spo2_rate_per_hour)) && Math.abs(Number(trend.spo2_rate_per_hour)) >= 0.5) {
    rates.push(`SpO2 ${Number(trend.spo2_rate_per_hour) > 0 ? "+" : ""}${Number(trend.spo2_rate_per_hour).toFixed(1)}%/hr`);
  }
  if (Number.isFinite(Number(trend.hr_rate_per_hour)) && Math.abs(Number(trend.hr_rate_per_hour)) >= 5) {
    rates.push(`HR ${Number(trend.hr_rate_per_hour) > 0 ? "+" : ""}${Number(trend.hr_rate_per_hour).toFixed(1)} bpm/hr`);
  }
  if (Number.isFinite(Number(trend.sbp_rate_per_hour)) && Math.abs(Number(trend.sbp_rate_per_hour)) >= 5) {
    rates.push(`SBP ${Number(trend.sbp_rate_per_hour) > 0 ? "+" : ""}${Number(trend.sbp_rate_per_hour).toFixed(1)} mmHg/hr`);
  }
  if (Number.isFinite(Number(trend.rr_rate_per_hour)) && Math.abs(Number(trend.rr_rate_per_hour)) >= 2) {
    rates.push(`RR ${Number(trend.rr_rate_per_hour) > 0 ? "+" : ""}${Number(trend.rr_rate_per_hour).toFixed(1)}/min/hr`);
  }
  const rateSuffix = rates.length > 0 ? ` (${rates.join(", ")})` : "";
  return `${trend.trend_classification.replace(/_/g, " ")}${rateSuffix}`;
}

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
function decisionPriority(news2, trend, counts, vitalDrugConflicts = []) {
  if (counts.major >= 1 || trend === "RAPIDLY_DETERIORATING" || news2 === "High Risk" || vitalDrugConflicts.length > 0) return "HIGH";
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
function buildDecisionSummary(news2, score, trend, counts, priority, details = {}) {
  const total = counts.major + counts.moderate + counts.minor + counts.unknown;
  const sections = [];
  const triggers = describePhysiologicalTriggers(details.latestObservation, details.latestNews2);
  const triggerText = triggers.length > 0 ? ` driven by ${triggers.join(", ")}` : "";
  sections.push(`Physiological risk: ${news2 || "Unavailable"} (NEWS2 ${score ?? "N/A"})${triggerText}.`);

  const slopeDesc = describeTrendSlope(details.latestTrend);
  sections.push(`Vital trend: ${slopeDesc || trend || "Unavailable"}.`);

  if (total > 0 && Array.isArray(details.interactionsFound) && details.interactionsFound.length > 0) {
    const pairs = details.interactionsFound
      .slice(0, 4)
      .map((i) => `${i.drug_a} + ${i.drug_b} (${i.interaction_level})`)
      .join("; ");
    sections.push(
      `Drug interaction alerts: ${total} (Major: ${counts.major}, Moderate: ${counts.moderate}, Minor: ${counts.minor}, Unknown: ${counts.unknown}) — ${pairs}.`
    );
  } else {
    sections.push(
      `Drug interaction alerts: ${total} (Major: ${counts.major}, Moderate: ${counts.moderate}, Minor: ${counts.minor}, Unknown: ${counts.unknown}).`
    );
  }

  if (Array.isArray(details.vitalDrugConflicts) && details.vitalDrugConflicts.length > 0) {
    sections.push(`Vital-medication caution: ${details.vitalDrugConflicts.join("; ")}.`);
  }

  sections.push(`Decision priority: ${priority}.`);
  return sections.join(" ");
}

async function computeAndPersistDecisionSupport(stayId, options = {}) {
  const engineRunId = options.engineRunId ?? randomUUID();
  const engineVersion = options.engineVersion ?? "phase6-v1";
  const context = await getClinicalContext(stayId);
  if (!context) return null;
  const news2Category = context.latest_news2 ? context.latest_news2.risk_level : null;
  const news2Score = context.latest_news2 ? context.latest_news2.total_news2_score : null;
  const trendClassification = context.latest_trend ? context.latest_trend.trend_classification : null;

  const normalized = await getNormalizedMedications(stayId, { requireComplete: true });
  const interactions = await findDrugInteractions(normalized.canonical_identities);
  const counts = countSeverities(interactions.interactions_found);
  const vitalDrugConflicts = evaluateVitalDrugConflicts(context.latest_observation, context.medications);
  const overallRisk = maxTier(
    physiologicalTier(news2Category),
    trendTier(trendClassification),
    drugSafetyTier(counts),
    vitalDrugConflicts.length > 0 ? "HIGH" : "LOW"
  );
  const priority = decisionPriority(news2Category, trendClassification, counts, vitalDrugConflicts);
  const summary = buildDecisionSummary(news2Category, news2Score, trendClassification, counts, priority, {
    latestObservation: context.latest_observation,
    latestNews2: context.latest_news2,
    latestTrend: context.latest_trend,
    interactionsFound: interactions.interactions_found,
    vitalDrugConflicts,
  });
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
