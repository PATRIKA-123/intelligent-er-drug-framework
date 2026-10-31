"use strict";

require("dotenv").config();
const { calculateNEWS2 } = require("./services/news2Calculator");

function runTests() {
  console.log("=== Running NEWS2 Calculator Test Suite ===\n");

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

  // Test 1: Normal Patient Vitals (Scale 1, Room Air)
  try {
    const res1 = calculateNEWS2({
      respiratoryRate: 16,
      spo2: 97,
      systolicBP: 120,
      heartRate: 75,
      temperatureCelsius: 37.0,
      consciousness: "Alert",
      oxygenSupport: false,
      spo2Scale: 1,
    });
    assert("Test 1: Normal vitals return total score 0 and Low Risk", res1.total_news2_score === 0 && res1.risk_level === "Low Risk");
  } catch (err) {
    assert("Test 1: Normal vitals execution", false, err.message);
  }

  // Test 2: High Risk Patient (Multiple deranged vitals + Oxygen support)
  try {
    const res2 = calculateNEWS2({
      respiratoryRate: 26, // score 3
      spo2: 91,           // score 2 (Scale 1)
      systolicBP: 85,     // score 3
      heartRate: 115,     // score 2
      temperatureCelsius: 39.5, // score 2
      consciousness: "V", // score 3
      oxygenSupport: true,  // score 2
      spo2Scale: 1,
    });
    // Expected scores: RR(3) + SpO2(2) + SBP(3) + HR(2) + Temp(2) + AVPU(3) + O2(2) = 17
    assert("Test 2: High risk calculations and high total score", res2.total_news2_score >= 7 && res2.risk_level === "High Risk");
  } catch (err) {
    assert("Test 2: High risk execution", false, err.message);
  }

  // Test 3: SpO2 Scale 2 with Explicit Clinician Authorization
  try {
    const res3 = calculateNEWS2({
      respiratoryRate: 18,
      spo2: 90,           // scale 2 target 88-92% -> score 0
      systolicBP: 130,
      heartRate: 80,
      temperatureCelsius: 36.6,
      consciousness: "Alert",
      oxygenSupport: false,
      spo2Scale: 2,
      scale2ClinicianAuthorized: true,
    });
    assert("Test 3: Scale 2 valid run with authorization scores correctly", res3.total_news2_score === 0);
  } catch (err) {
    assert("Test 3: Scale 2 execution", false, err.message);
  }

  // Test 4: SpO2 Scale 2 without Authorization (Should throw error)
  try {
    calculateNEWS2({
      respiratoryRate: 18,
      spo2: 90,
      systolicBP: 130,
      heartRate: 80,
      temperatureCelsius: 36.6,
      consciousness: "Alert",
      oxygenSupport: false,
      spo2Scale: 2,
      scale2ClinicianAuthorized: false, // missing authorization
    });
    assert("Test 4: Scale 2 without authorization throws error", false);
  } catch (err) {
    assert("Test 4: Scale 2 without authorization throws error", err.message.includes("requires explicit clinician authorization"));
  }

  // Test 5: Missing Required Field Handling
  try {
    calculateNEWS2({
      respiratoryRate: 16,
      // spo2 missing
      systolicBP: 120,
      heartRate: 75,
      temperatureCelsius: 37.0,
      consciousness: "Alert",
      oxygenSupport: false,
      spo2Scale: 1,
    });
    assert("Test 5: Missing field throws descriptive error", false);
  } catch (err) {
    assert("Test 5: Missing field throws descriptive error", err.message.includes("Missing required NEWS2 field"));
  }

  console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);
}

runTests();