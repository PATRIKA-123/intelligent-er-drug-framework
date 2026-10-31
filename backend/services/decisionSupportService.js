const { randomUUID } = require("crypto");
const pool = require("../db");
const { getClinicalContext } = require("./clinicalContextService");
const { getNormalizedMedications } = require("./medicationNormalizationService");
const { findDrugInteractions } = require("./ddinterService");
const { persistDrugSafetyResults } = require("./drugSafetyService");

function physiologicalTier(news2Category) {
  if (news2Category === "High Risk") return "HIGH";

  if (
    news2Category === "Medium Risk" ||
    news2Category === "Low-Medium Risk"
  ) {
    return "MEDIUM";
  }

  // Preserve existing risk calculation for missing/unrecognized values.
  return "LOW";
}

function trendTier(trendClassification) {
  // Option B: DETERIORATING and INSUFFICIENT_DATA
  // do not automatically increase the overall risk tier.
  if (trendClassification === "RAPIDLY_DETERIORATING") {
    return "HIGH";
  }

  return "LOW";
}

function drugSafetyTier(counts) {
  if (counts.major >= 1) return "HIGH";
  if (counts.moderate >= 1) return "MEDIUM";
  return "LOW";
}

const TIER_RANK = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

function maxTier(...tiers) {
  return tiers.reduce((worst, tier) => {
    return TIER_RANK[tier] > TIER_RANK[worst] ? tier : worst;
  }, "LOW");
}

function isTrendClassificationReviewRequired(classification) {
  return ![
    "STABLE",
    "IMPROVING",
    "DETERIORATING",
    "RAPIDLY_DETERIORATING",
  ].includes(classification);
}

function isNews2ReviewRequired(category) {
  return ![
    "High Risk",
    "Medium Risk",
    "Low-Medium Risk",
    "Low Risk",
  ].includes(category);
}

function decisionPriority(news2Category, trendClassification, counts) {
  // Known high-priority evidence takes precedence.
  if (counts.major >= 1) return "HIGH";
  if (trendClassification === "RAPIDLY_DETERIORATING") return "HIGH";
  if (news2Category === "High Risk") return "HIGH";

  if (counts.moderate >= 1) return "MEDIUM";

  if (
    news2Category === "Medium Risk" ||
    news2Category === "Low-Medium Risk"
  ) {
    return "MEDIUM";
  }

  // Missing or unrecognized NEWS2 requires review.
  if (isNews2ReviewRequired(news2Category)) {
    return "REVIEW";
  }

  // Missing, insufficient or unclassified trend requires review.
  if (isTrendClassificationReviewRequired(trendClassification)) {
    return "REVIEW";
  }

  // Option B: deterioration requires review,
  // but does not independently increase overall_risk.
  if (trendClassification === "DETERIORATING") {
    return "REVIEW";
  }

  // Unknown interaction is not treated as a confirmed harmful interaction.
  if (counts.unknown >= 1) return "REVIEW";

  if (counts.minor >= 1) return "LOW";

  return "ROUTINE";
}

function countSeverities(interactionsFound) {
  const counts = {
    major: 0,
    moderate: 0,
    minor: 0,
    unknown: 0,
  };

  for (const finding of interactionsFound) {
    const level = String(finding?.interaction_level ?? "")
      .trim()
      .toLowerCase();

    if (level === "major") {
      counts.major++;
    } else if (level === "moderate") {
      counts.moderate++;
    } else if (level === "minor") {
      counts.minor++;
    } else {
      // Includes explicit "unknown", blank and unexpected levels.
      counts.unknown++;
    }
  }

  return counts;
}

function buildDecisionSummary(news2Category, news2Score, trendClassification, counts, priority) {
  const total = counts.major + counts.moderate + counts.minor + counts.unknown;

  return (
    `Physiological risk: ${news2Category || "Unavailable"} (NEWS2 ${news2Score ?? "N/A"}). ` +
    `Vital trend: ${trendClassification || "Unavailable"}. ` +
    `Drug interaction alerts: ${total} ` +
    `(Major: ${counts.major}, Moderate: ${counts.moderate}, Minor: ${counts.minor}, Unknown: ${counts.unknown}). ` +
    `Decision priority: ${priority}.`
  );
}

/**
 * Computes and persists decision support for one ED stay.
 *
 * options.client, when provided, is owned by the caller. In that case,
 * this function does not begin, commit, roll back, or release it.
 * Without a client, this function manages its own transaction.
 */
async function computeAndPersistDecisionSupport(stayId, options = {}) {
  const engineRunId = options.engineRunId ?? randomUUID();
  const engineVersion = options.engineVersion ?? "phase6-v1";

  const context = await getClinicalContext(stayId);

  if (!context) {
    return null;
  }

  const news2Category = context.latest_news2
    ? context.latest_news2.risk_level
    : null;

  const news2Score = context.latest_news2
    ? context.latest_news2.total_news2_score
    : null;

  const trendClassification = context.latest_trend
    ? context.latest_trend.trend_classification
    : null;

  const normalized = await getNormalizedMedications(stayId);

  const interactions = await findDrugInteractions(
    normalized.canonical_identities
  );

  const counts = countSeverities(interactions.interactions_found);

  const overallRisk = maxTier(
    physiologicalTier(news2Category),
    trendTier(trendClassification),
    drugSafetyTier(counts)
  );

  const priority = decisionPriority(
    news2Category,
    trendClassification,
    counts
  );

  const summary = buildDecisionSummary(
    news2Category,
    news2Score,
    trendClassification,
    counts,
    priority
  );

  // Respect caller-owned transactions.
  const externalClient = options.client ?? null;
  const client = externalClient ?? await pool.connect();
  const ownsTransaction = !externalClient;

  try {
    if (ownsTransaction) {
      await client.query("BEGIN");
    }

    // Drug Safety and Decision Support now share the same transaction.
    const drugSafety = await persistDrugSafetyResults(
      stayId,
      normalized.mapped_medications,
      interactions.interactions_found,
      {
        ...options,
        client,
        engineRunId,
        engineVersion,
      }
    );

    if (!drugSafety) {
      if (ownsTransaction) {
        await client.query("ROLLBACK");
      }

      return null;
    }

    const deleteResult = await client.query(
      `DELETE FROM decision_support_results
       WHERE stay_id = $1`,
      [stayId]
    );

    const insertResult = await client.query(
      `INSERT INTO decision_support_results
         (patient_id, stay_id, news2_score, news2_category,
          trend_classification, drug_alert_count,
          major_interaction_count, moderate_interaction_count,
          overall_risk, decision_priority, decision_summary,
          evidence_source, engine_run_id, engine_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               $9, $10, $11, $12, $13, $14)
       RETURNING decision_id, patient_id, stay_id, news2_score,
                 news2_category, trend_classification,
                 drug_alert_count, major_interaction_count,
                 moderate_interaction_count, overall_risk,
                 decision_priority, decision_summary,
                 evidence_source, engine_run_id, engine_version`,
      [
        context.patient ? context.patient.patient_id : null,
        stayId,
        news2Score,
        news2Category,
        trendClassification,
        counts.major + counts.moderate + counts.minor + counts.unknown,
        counts.major,
        counts.moderate,
        overallRisk,
        priority,
        summary,
        "NEWS2 + VITAL_TREND + DDInter_2.0 (Phase 6 engine)",
        engineRunId,
        engineVersion,
      ]
    );

    if (ownsTransaction) {
      await client.query("COMMIT");
    }

    return {
      stay_id: stayId,
      deleted_count: deleteResult.rowCount,
      inserted_count: insertResult.rows.length,
      decision: insertResult.rows[0],
      drug_safety: {
        deleted_count: drugSafety.deleted_count,
        inserted_count: drugSafety.inserted_count,
      },
      interaction_counts: counts,
    };
  } catch (err) {
    if (ownsTransaction) {
      await client.query("ROLLBACK");
    }

    throw err;
  } finally {
    if (ownsTransaction) {
      client.release();
    }
  }
}
module.exports = { computeAndPersistDecisionSupport };
