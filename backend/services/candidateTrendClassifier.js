"use strict";

/**
 * Experimental Vital Trend Classifier
 *
 * This module is isolated from the production clinical workflow.
 * It does not assign clinical deterioration categories or trigger alerts.
 */

const REQUIRED_VITALS = [
  "spo2",
  "heart_rate",
  "systolic_bp",
  "respiratory_rate"
];

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }

  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function classifyCandidate(trendResult) {
  if (!trendResult || typeof trendResult !== "object") {
    throw new TypeError("A trend result object is required.");
  }

  const changes = trendResult.changes;

  if (!changes || typeof changes !== "object") {
    throw new TypeError("The trend result must contain a changes object.");
  }

  const vitalResults = {};
  let availableCount = 0;

  for (const vital of REQUIRED_VITALS) {
    const change = changes[vital];

    const delta = normalizeNumber(change?.delta);
    const rate = normalizeNumber(change?.rate_per_hour);

    const valid = delta !== null && rate !== null;

    vitalResults[vital] = {
      available: valid,
      delta: valid ? delta : null,
      rate_per_hour: valid ? rate : null
    };

    if (valid) {
      availableCount++;
    }
  }

  let dataQuality;

  if (availableCount === REQUIRED_VITALS.length) {
    dataQuality = "COMPLETE";
  } else if (availableCount > 0) {
    dataQuality = "PARTIAL";
  } else {
    dataQuality = "INSUFFICIENT_DATA";
  }

  return {
    engine: "candidate-v1",
    data_quality: dataQuality,
    available_vitals: availableCount,
    total_vitals: REQUIRED_VITALS.length,
    vital_changes: vitalResults,

    clinical_classification: null,

    status: "REQUIRES_VALIDATED_RULES",

    note:
      "Vital changes are summarized only. No clinical deterioration " +
      "category or alert is assigned."
  };
}

module.exports = {
  classifyCandidate,
  REQUIRED_VITALS
};
