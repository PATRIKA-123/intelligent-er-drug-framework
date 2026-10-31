"use strict";

const assert = require("node:assert/strict");
const {
  calculateVitalTrend,
} = require("./services/trendCalculator");

const previous = {
  observation_time: "2026-01-01T10:00:00Z",
  spo2: 96,
  heart_rate: 80,
  systolic_bp: 120,
  respiratory_rate: 16,
  temperature: 36.5,
};

const current = {
  observation_time: "2026-01-01T11:00:00Z",
  spo2: 94,
  heart_rate: 90,
  systolic_bp: 110,
  respiratory_rate: 20,
  temperature: 37.0,
};

// 1. Correct elapsed time and rates.
const result = calculateVitalTrend(previous, current);

assert.equal(result.elapsed_minutes, 60);
assert.equal(result.data_quality.status, "COMPLETE");
assert.equal(result.changes.spo2.delta, -2);
assert.equal(result.changes.spo2.rate_per_hour, -2);
assert.equal(result.changes.heart_rate.rate_per_hour, 10);
assert.equal(result.changes.systolic_bp.rate_per_hour, -10);
assert.equal(result.changes.respiratory_rate.rate_per_hour, 4);

// 2. Missing data must not be interpreted as zero.
const missing = calculateVitalTrend(previous, {
  ...current,
  spo2: null,
});

assert.equal(missing.changes.spo2.status, "MISSING_DATA");
assert.equal(missing.changes.spo2.delta, null);
assert.equal(missing.data_quality.status, "PARTIAL");

// 3. Reject equal timestamps.
assert.throws(
  () => calculateVitalTrend(previous, {
    ...current,
    observation_time: previous.observation_time,
  }),
  RangeError
);

// 4. Reject observations in reverse chronological order.
assert.throws(
  () => calculateVitalTrend(current, previous),
  RangeError
);

// 5. Reject invalid timestamps.
assert.throws(
  () => calculateVitalTrend(previous, {
    ...current,
    observation_time: "not-a-date",
  }),
  TypeError
);

// 6. A short interval should not produce an extreme hourly rate.
const shortInterval = calculateVitalTrend(
  previous,
  {
    ...current,
    observation_time: "2026-01-01T10:00:30Z",
  }
);

assert.equal(
  shortInterval.changes.heart_rate.status,
  "INTERVAL_TOO_SHORT"
);
assert.equal(shortInterval.changes.heart_rate.rate_per_hour, null);

// 7. Classification is deliberately not inferred from rates.
assert.equal(result.trend_classification, "NOT_CLASSIFIED");

console.log("All Vital Trend Engine tests passed.");
