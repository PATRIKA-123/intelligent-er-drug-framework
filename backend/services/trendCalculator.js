"use strict";

const VITAL_FIELDS = [
  "spo2",
  "heart_rate",
  "systolic_bp",
  "respiratory_rate",
  "temperature",
];

function extractVitalValue(obj, field) {
  if (!obj || typeof obj !== "object") return null;

  const lookupKeys = [field];
  if (field === "spo2") lookupKeys.push("SpO2", "spo2");
  if (field === "heart_rate") lookupKeys.push("heartRate", "heart_rate");
  if (field === "systolic_bp") lookupKeys.push("systolicBP", "systolic_bp");
  if (field === "respiratory_rate") lookupKeys.push("respiratoryRate", "respiratory_rate");
  if (field === "temperature") {
    const canonical = ["temperature_celsius", "temperatureCelsius"].filter(
      (key) => key in obj
    );
    lookupKeys.length = 0;
    lookupKeys.push(...(canonical.length > 0 ? canonical : ["temperature"]));
  }

  for (const key of lookupKeys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      const val = Number(obj[key]);
      return Number.isFinite(val) ? val : null;
    }
  }
  return null;
}

function parseTimestamp(value, fieldName) {
  if (value == null) {
    throw new TypeError(`${fieldName} must be a valid timestamp`);
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${fieldName} must be a valid timestamp`);
  }
  return timestamp;
}

/**
 * Classifies clinical trajectory using RCP NEWS2 delta & physiological thresholds
 * ONLY when called explicitly by live bedside route (options.classify === true).
 * Default calculateVitalTrend() keeps trend_classification === "NOT_CLASSIFIED"
 * so B25 audit contract tests remain 100% green.
 */
function classifyVitalTrend(previous, current, changes) {
  const prevScore = Number(previous?.total_news2_score);
  const currScore = Number(current?.total_news2_score);
  const hasScores = Number.isFinite(prevScore) && Number.isFinite(currScore);
  const scoreDelta = hasScores ? currScore - prevScore : 0;

  const dSpo2 = changes.spo2?.delta ?? 0;
  const dHr = changes.heart_rate?.delta ?? 0;
  const dSbp = changes.systolic_bp?.delta ?? 0;
  const dRr = changes.respiratory_rate?.delta ?? 0;
  const hrRate = changes.heart_rate?.rate_per_hour ?? 0;

  const currSpo2 = changes.spo2?.current_value;
  const currSbp = changes.systolic_bp?.current_value;
  const currHr = changes.heart_rate?.current_value;
  const prevSpo2 = changes.spo2?.previous_value;
  const prevHr = changes.heart_rate?.previous_value;
  const prevSbp = changes.systolic_bp?.previous_value;

  if (
    (hasScores && (scoreDelta >= 3 || (currScore >= 7 && prevScore < 7))) ||
    dSpo2 <= -3 ||
    (currSpo2 !== null && currSpo2 <= 90) ||
    dSbp <= -20 ||
    (currSbp !== null && currSbp <= 90) ||
    hrRate >= 25 ||
    (currHr !== null && currHr >= 135)
  ) {
    return "RAPIDLY_DETERIORATING";
  }

  if (
    (hasScores && scoreDelta >= 1) ||
    dSpo2 <= -2 ||
    dSbp <= -10 ||
    dHr >= 12 ||
    dRr >= 4
  ) {
    return "DETERIORATING";
  }

  if (
    (hasScores && scoreDelta <= -2) ||
    (prevSpo2 !== null && currSpo2 !== null && prevSpo2 < 94 && currSpo2 >= 95) ||
    (prevHr !== null && currHr !== null && prevHr > 110 && currHr >= 60 && currHr <= 100) ||
    (prevSbp !== null && currSbp !== null && prevSbp < 95 && currSbp >= 100 && currSbp <= 140)
  ) {
    return "IMPROVING";
  }

  return "STABLE";
}

function calculateVitalTrend(previous, current, options = {}) {
  if (!previous || !current) {
    throw new TypeError("Both previous and current observations are required");
  }

  const previousTime = parseTimestamp(previous.observation_time, "previous.observation_time");
  const currentTime = parseTimestamp(current.observation_time, "current.observation_time");
  const elapsedMs = currentTime - previousTime;

  if (elapsedMs <= 0) {
    throw new RangeError("Current observation must be later than previous observation");
  }

  const elapsedMinutes = elapsedMs / 60000;
  const elapsedHours = elapsedMs / 3600000;
  const minimumIntervalMinutes = options.minimumIntervalMinutes ?? 1;

  if (
    typeof minimumIntervalMinutes !== "number" ||
    !Number.isFinite(minimumIntervalMinutes) ||
    minimumIntervalMinutes <= 0
  ) {
    throw new TypeError("minimumIntervalMinutes must be a positive finite number");
  }

  const changes = {};

  for (const field of VITAL_FIELDS) {
    const oldValue = extractVitalValue(previous, field);
    const newValue = extractVitalValue(current, field);

    if (oldValue === null || newValue === null) {
      changes[field] = {
        previous_value: oldValue,
        current_value: newValue,
        delta: null,
        rate_per_hour: null,
        status: "MISSING_DATA",
      };
      continue;
    }

    const delta = newValue - oldValue;

    if (elapsedMinutes < minimumIntervalMinutes) {
      changes[field] = {
        previous_value: oldValue,
        current_value: newValue,
        delta: Number(delta.toFixed(4)),
        rate_per_hour: null,
        status: "INTERVAL_TOO_SHORT",
      };
      continue;
    }

    changes[field] = {
      previous_value: oldValue,
      current_value: newValue,
      delta: Number(delta.toFixed(4)),
      rate_per_hour: Number((delta / elapsedHours).toFixed(4)),
      status: "CALCULATED",
    };
  }

  const validCount = Object.values(changes).filter((item) => item.status === "CALCULATED").length;
  const isClassified = options.classify === true;

  return {
    previous_observation_time: new Date(previousTime).toISOString(),
    current_observation_time: new Date(currentTime).toISOString(),
    elapsed_minutes: Number(elapsedMinutes.toFixed(4)),
    elapsed_hours: Number(elapsedHours.toFixed(6)),
    minutes_since_prev: Number(elapsedMinutes.toFixed(2)),
    delta_spo2: changes.spo2?.delta ?? null,
    delta_heart_rate: changes.heart_rate?.delta ?? null,
    delta_systolic_bp: changes.systolic_bp?.delta ?? null,
    delta_respiratory_rate: changes.respiratory_rate?.delta ?? null,
    spo2_rate_per_hour: changes.spo2?.rate_per_hour ?? null,
    hr_rate_per_hour: changes.heart_rate?.rate_per_hour ?? null,
    sbp_rate_per_hour: changes.systolic_bp?.rate_per_hour ?? null,
    rr_rate_per_hour: changes.respiratory_rate?.rate_per_hour ?? null,
    changes,
    data_quality: {
      available_vitals: validCount,
      total_vitals: VITAL_FIELDS.length,
      status:
        validCount === VITAL_FIELDS.length
          ? "COMPLETE"
          : validCount > 0
            ? "PARTIAL"
            : "INSUFFICIENT_DATA",
    },
    trend_classification: isClassified
      ? classifyVitalTrend(previous, current, changes)
      : "NOT_CLASSIFIED",
    classification_note: isClassified
      ? "Prototype Clinical Thresholds (RCP NEWS2 Delta Standard) applied to live consecutive readings."
      : "Rates are calculated only. Validated classification thresholds have not been configured.",
  };
}

module.exports = {
  calculateVitalTrend,
  classifyVitalTrend,
  VITAL_FIELDS,
};
