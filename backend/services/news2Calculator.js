"use strict";

const PARAMETERS = [
  "respiratoryRate",
  "spo2",
  "systolicBP",
  "heartRate",
  "temperatureCelsius",
  "consciousness",
  "oxygenSupport",
  "spo2Scale",
];

function requireNumber(value, name) {
  if (value === null || value === undefined || value === "" ||
      typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

function scoreRespiratoryRate(value) {
  requireNumber(value, "respiratoryRate");
  if (value < 0) throw new Error("respiratoryRate cannot be negative");
  if (value <= 8) return 3;
  if (value <= 11) return 1;
  if (value <= 20) return 0;
  if (value <= 24) return 2;
  return 3;
}

function scoreSpO2(value, scale, oxygenSupport) {
  requireNumber(value, "spo2");

  if (value < 0 || value > 100) {
    throw new Error("spo2 must be 0–100");
  }

  if (![1, 2].includes(scale)) {
    throw new Error("spo2Scale must be 1 or 2");
  }

  if (scale === 1) {
    if (value <= 91) return 3;
    if (value <= 93) return 2;
    if (value <= 95) return 1;
    return 0;
  }

  // NEWS2 Scale 2: oxygen-dependent upper thresholds.
  if (oxygenSupport && value >= 93) {
    if (value >= 97) return 3;
    if (value >= 95) return 2;
    return 1;
  }

  // Scale 2: air readings and lower saturation thresholds.
  if (value >= 86 && value <= 87) return 1;
  if (value >= 84 && value <= 85) return 2;
  if (value <= 83) return 3;

  return 0;
}

function scoreSystolicBP(value) {
  requireNumber(value, "systolicBP");
  if (value <= 0) throw new Error("systolicBP must be positive");
  if (value <= 90) return 3;
  if (value <= 100) return 2;
  if (value <= 110) return 1;
  if (value <= 219) return 0;
  return 3; // >= 220
}

function scoreHeartRate(value) {
  requireNumber(value, "heartRate");
  if (value < 0) throw new Error("heartRate cannot be negative");
  if (value <= 40) return 3;
  if (value <= 50) return 1;
  if (value <= 90) return 0;
  if (value <= 110) return 1;
  if (value <= 130) return 2;
  return 3;
}

function scoreTemperatureCelsius(value) {
  requireNumber(value, "temperatureCelsius");
  if (value < 25 || value > 45) {
    throw new Error("temperatureCelsius is outside the supported validation range");
  }
  if (value <= 35.0) return 3;
  if (value <= 36.0) return 1;
  if (value <= 38.0) return 0;
  if (value <= 39.0) return 1;
  return 2;
}

function scoreConsciousness(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "ALERT") return 0;
  if (["NEW_CONFUSION", "V", "P", "U"].includes(normalized)) return 3;

  throw new Error(
    "consciousness must be ALERT, NEW_CONFUSION, V, P, or U"
  );
}

function calculateNEWS2(input) {
  if (!input || typeof input !== "object") {
    throw new Error("A NEWS2 observation object is required");
  }

  for (const key of PARAMETERS) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      throw new Error(`Missing required NEWS2 field: ${key}`);
    }
  }

  if (typeof input.oxygenSupport !== "boolean") {
    throw new Error("oxygenSupport must be true or false");
  }

  if (input.spo2Scale === 2 && input.scale2ClinicianAuthorized !== true) {
    throw new Error(
      "SpO2 Scale 2 requires explicit clinician authorization"
    );
  }

  const scores = {
    respiratory_score: scoreRespiratoryRate(input.respiratoryRate),
    spo2_score: scoreSpO2(
      input.spo2,
      input.spo2Scale,
      input.oxygenSupport
    ),
    oxygen_score: input.oxygenSupport ? 2 : 0,
    systolic_bp_score: scoreSystolicBP(input.systolicBP),
    heart_rate_score: scoreHeartRate(input.heartRate),
    temperature_score: scoreTemperatureCelsius(input.temperatureCelsius),
    consciousness_score: scoreConsciousness(input.consciousness),
  };

  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const highestParameterScore = Math.max(
    scores.respiratory_score,
    scores.spo2_score,
    scores.systolic_bp_score,
    scores.heart_rate_score,
    scores.temperature_score,
    scores.consciousness_score
  );

  let riskLevel;
  if (total >= 7) {
    riskLevel = "High Risk";
  } else if (total >= 5) {
    riskLevel = "Medium Risk";
  } else if (highestParameterScore === 3) {
    riskLevel = "Low-Medium Risk";
  } else {
    riskLevel = "Low Risk";
  }

  return {
    ...scores,
    total_news2_score: total,
    risk_level: riskLevel,
    scoring_standard: "RCP NEWS2 2017",
    is_clinical_decision: false,
  };
}

module.exports = {
  calculateNEWS2,
  scoreRespiratoryRate,
  scoreSpO2,
  scoreSystolicBP,
  scoreHeartRate,
  scoreTemperatureCelsius,
  scoreConsciousness,
};