"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calculateVitalTrend } = require("./services/trendCalculator");
const { classifyCandidate } = require("./services/candidateTrendClassifier");
const base = { observation_time: "2026-01-01T12:00:00Z", spo2: 98, heart_rate: 80, systolic_bp: 120, respiratory_rate: 16, temperature_celsius: 36.8 };
const later = { ...base, observation_time: "2026-01-01T12:30:00Z", spo2: 94, heart_rate: 93, systolic_bp: 110, respiratory_rate: 21 };
test("B25 current production calculator reports NOT_CLASSIFIED, not invented risk", () => {
  const result = calculateVitalTrend(base, later);
  assert.equal(result.trend_classification, "NOT_CLASSIFIED");
  assert.equal(result.data_quality.status, "COMPLETE");
  assert.equal(result.changes.spo2.delta, -4);
  assert.equal(result.changes.spo2.rate_per_hour, -8);
  assert.match(result.classification_note, /not been configured/i);
});
test("B25 candidate classifier does not output a clinical deterioration label", () => {
  const r = classifyCandidate(calculateVitalTrend(base, later));
  assert.equal(r.status, "REQUIRES_VALIDATED_RULES");
  assert.equal(r.clinical_classification, null);
  assert.equal(r.data_quality, "COMPLETE");
});
test("B25 missing canonical Celsius does not fall back to raw Fahrenheit", () => {
  const prev = { ...base, temperature: 98.6, temperature_celsius: null };
  const cur = { ...later, temperature: 99.1, temperature_celsius: null };
  const r = calculateVitalTrend(prev, cur);
  assert.equal(r.changes.temperature.status, "MISSING_DATA");
  assert.equal(r.data_quality.status, "PARTIAL");
});
