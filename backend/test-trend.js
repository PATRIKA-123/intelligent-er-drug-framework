"use strict";

const { calculateVitalTrend, VITAL_FIELDS } = require("./services/trendCalculator");

function runTests() {
  console.log("=== Running Trend Calculator Test Suite ===\n");

  let passed = 0;
  let failed = 0;

  function assert(label, condition, details = "") {
    if (condition) {
      console.log(`[PASS] ${label}`);
      passed++;
    } else {
      console.error(`[FAIL] ${label} ${details}`);
      failed++;
    }
  }

  // Test 1: Normal trend calculation over 1 hour (including temperature)
  try {
    const prev = {
      observation_time: "2026-06-01T10:00:00.000Z",
      spo2: 98,
      heart_rate: 80,
      systolic_bp: 120,
      respiratory_rate: 16,
      temperature: 36.5,
    };
    const curr = {
      observation_time: "2026-06-01T11:00:00.000Z",
      spo2: 94,          // delta: -4
      heart_rate: 95,    // delta: +15
      systolic_bp: 110,  // delta: -10
      respiratory_rate: 20, // delta: +4
      temperature: 38.0, // delta: +1.5
    };

    const res1 = calculateVitalTrend(prev, curr);
    assert(
      "Test 1: Correct elapsed hours and delta calculations",
      res1.elapsed_hours === 1 &&
      res1.changes.spo2.delta === -4 &&
      res1.changes.heart_rate.rate_per_hour === 15 &&
      res1.changes.temperature.delta === 1.5 &&
      res1.data_quality.status === "COMPLETE"
    );
  } catch (err) {
    assert("Test 1: Normal trend execution", false, err.message);
  }

  // Test 2: Interval too short (less than 1 minute)
  try {
    const prev = {
      observation_time: "2026-06-01T10:00:00.000Z",
      spo2: 98,
      heart_rate: 80,
      systolic_bp: 120,
      respiratory_rate: 16,
      temperature: 36.5,
    };
    const curr = {
      observation_time: "2026-06-01T10:00:30.000Z", // 30 seconds later
      spo2: 96,
      heart_rate: 85,
      systolic_bp: 118,
      respiratory_rate: 18,
      temperature: 36.6,
    };

    const res2 = calculateVitalTrend(prev, curr);
    assert(
      "Test 2: Short interval marks status as INTERVAL_TOO_SHORT",
      res2.changes.spo2.status === "INTERVAL_TOO_SHORT" &&
      res2.changes.spo2.rate_per_hour === null
    );
  } catch (err) {
    assert("Test 2: Short interval execution", false, err.message);
  }

  // Test 3: Missing vital data handling
  try {
    const prev = {
      observation_time: "2026-06-01T10:00:00.000Z",
      spo2: null,
      heart_rate: 80,
      systolic_bp: 120,
      respiratory_rate: 16,
      temperature: 36.5,
    };
    const curr = {
      observation_time: "2026-06-01T11:00:00.000Z",
      spo2: 95,
      heart_rate: 82,
      systolic_bp: 118,
      respiratory_rate: 16,
      temperature: 36.8,
    };

    const res3 = calculateVitalTrend(prev, curr);
    assert(
      "Test 3: Null vital value handled as MISSING_DATA with status PARTIAL",
      res3.changes.spo2.status === "MISSING_DATA" &&
      res3.data_quality.status === "PARTIAL"
    );
  } catch (err) {
    assert("Test 3: Missing vital execution", false, err.message);
  }

  // Test 4: Invalid timestamp error handling
  try {
    const prev = { observation_time: "invalid-date", spo2: 98 };
    const curr = { observation_time: "2026-06-01T11:00:00.000Z", spo2: 95 };
    calculateVitalTrend(prev, curr);
    assert("Test 4: Invalid timestamp throws TypeError", false);
  } catch (err) {
    assert("Test 4: Invalid timestamp throws TypeError", err.name === "TypeError");
  }

  console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);
}

runTests();