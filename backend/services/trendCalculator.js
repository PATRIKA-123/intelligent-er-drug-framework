"use strict";

const VITAL_FIELDS = [
  "spo2",
  "heart_rate",
  "systolic_bp",
  "respiratory_rate",
  "temperature", // Added temperature to align with clinical observations & NEWS2
];

// Helper to handle both snake_case, camelCase, and capitalized DB column variations (e.g. SpO2, heartRate)
function extractVitalValue(obj, field) {
  if (!obj || typeof obj !== "object") return null;
  
  const lookupKeys = [field];
  if (field === "spo2") lookupKeys.push("SpO2", "spo2");
  if (field === "heart_rate") lookupKeys.push("heartRate", "heart_rate");
  if (field === "systolic_bp") lookupKeys.push("systolicBP", "systolic_bp");
  if (field === "respiratory_rate") lookupKeys.push("respiratoryRate", "respiratory_rate");
  if (field === "temperature") {
  lookupKeys.push(
    "temperature_celsius",
    "temperatureCelsius",
    "temperature"
  );
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

function calculateVitalTrend(previous, current, options = {}) {
  if (!previous || !current) {
    throw new TypeError("Both previous and current observations are required");
  }

  const previousTime = parseTimestamp(
    previous.observation_time,
    "previous.observation_time"
  );

  const currentTime = parseTimestamp(
    current.observation_time,
    "current.observation_time"
  );

  const elapsedMs = currentTime - previousTime;

  if (elapsedMs <= 0) {
    throw new RangeError(
      "Current observation must be later than previous observation"
    );
  }

  const elapsedMinutes = elapsedMs / 60000;
  const elapsedHours = elapsedMs / 3600000;
  const minimumIntervalMinutes = options.minimumIntervalMinutes ?? 1;

  if (
    typeof minimumIntervalMinutes !== "number" ||
    !Number.isFinite(minimumIntervalMinutes) ||
    minimumIntervalMinutes <= 0
  ) {
    throw new TypeError(
      "minimumIntervalMinutes must be a positive finite number"
    );
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

  const validCount = Object.values(changes).filter(
    (item) => item.status === "CALCULATED"
  ).length;

  return {
    previous_observation_time: new Date(previousTime).toISOString(),
    current_observation_time: new Date(currentTime).toISOString(),
    elapsed_minutes: Number(elapsedMinutes.toFixed(4)),
    elapsed_hours: Number(elapsedHours.toFixed(6)),
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
    trend_classification: "NOT_CLASSIFIED",
    classification_note:
      "Rates are calculated only. Validated classification thresholds have not been configured.",
  };
}

module.exports = {
  calculateVitalTrend,
  VITAL_FIELDS,
};