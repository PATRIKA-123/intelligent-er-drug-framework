"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreSpO2, calculateNEWS2 } = require("./services/news2Calculator");

const base = { respiratoryRate: 16, spo2: 98, spo2Scale: 2,
  scale2ClinicianAuthorized: true, oxygenSupport: false, systolicBP: 120,
  heartRate: 75, temperatureCelsius: 36.8, consciousness: "ALERT" };

// Royal College of Physicians NEWS2 2017 Chart 1, SpO2 Scale 2.
const expectedScale2 = (v, oxygen) => {
  if (v <= 83) return 3;
  if (v <= 85) return 2;
  if (v <= 87) return 1;
  if (v <= 92 || !oxygen) return 0;
  if (v <= 94) return 1;
  if (v <= 96) return 2;
  return 3;
};

test("B05: all 202 integer Scale 2 SpO2 combinations (0–100, air and oxygen)", () => {
  for (const oxygen of [false, true]) {
    for (let spo2 = 0; spo2 <= 100; spo2++) {
      assert.equal(scoreSpO2(spo2, 2, oxygen), expectedScale2(spo2, oxygen),
        `SpO2 ${spo2}, oxygen ${oxygen}`);
    }
  }
});

test("B05: fractional Scale 2 inputs fail visibly instead of silently scoring 0", () => {
  for (const v of [83.5, 84.5, 85.5, 86.5, 87.5, 88.5, 92.5, 93.5, 94.5, 95.5, 96.5]) {
    for (const oxygen of [false, true]) {
      assert.throws(() => scoreSpO2(v, 2, oxygen), /whole-number percentage/);
      assert.throws(() => calculateNEWS2({ ...base, spo2: v, oxygenSupport: oxygen }), /whole-number percentage/);
    }
  }
});

test("B05: malformed saturation, scale and oxygen flags rejected", () => {
  for (const v of [-1, 101, NaN, Infinity, "93", null]) {
    assert.throws(() => scoreSpO2(v, 2, false));
  }
  for (const v of [1.1, 91.5, 95.5]) {
    assert.throws(() => scoreSpO2(v, 1, false), /whole-number percentage/);
  }
  assert.throws(() => scoreSpO2(93, 3, false), /spo2Scale/);
  assert.throws(() => scoreSpO2(93, 2, "false"), /oxygenSupport/);
});

test("B06: disputed chart values are 0, oxygen contributes independently", () => {
  assert.equal(scoreSpO2(99, 2, false), 0);
  assert.equal(scoreSpO2(92, 2, true), 0);
  const o = calculateNEWS2({ ...base, spo2: 92, oxygenSupport: true });
  assert.equal(o.spo2_score, 0);
  assert.equal(o.oxygen_score, 2);
  assert.equal(o.total_news2_score, 2);
  assert.equal(scoreSpO2(99, 2, true), 3);
});

test("B06: clinician authorization remains mandatory for Scale 2", () => {
  assert.throws(() => calculateNEWS2({ ...base, scale2ClinicianAuthorized: false }), /clinician authorization/);
});
