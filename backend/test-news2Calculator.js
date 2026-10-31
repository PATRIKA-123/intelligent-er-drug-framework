
"use strict";
 
// Unit tests for services/news2Calculator.js.
// Pure functions: no database, no server. Run from the backend folder:
//   node test-news2-calculator.js
 
const {
  calculateNEWS2,
  scoreRespiratoryRate,
  scoreSpO2,
  scoreSystolicBP,
  scoreHeartRate,
  scoreTemperatureCelsius,
  scoreConsciousness,
} = require("./services/news2Calculator");
 
let passed = 0;
let failed = 0;
function check(label, ok, detail) {
  ok ? passed++ : failed++;
  if (!ok) console.log(`FAIL  ${label}${detail ? "   -> " + detail : ""}`);
}
function throwsWith(label, fn, fragment) {
  try {
    fn();
    check(label, false, "did not throw");
  } catch (e) {
    check(label, e.message.includes(fragment), e.message);
  }
}
function table(name, fn, rows) {
  for (const [input, expected] of rows) {
    let got;
    try { got = fn(input); } catch (e) { got = "THREW " + e.message; }
    check(`${name}(${input}) = ${expected}`, got === expected, `got ${got}`);
  }
}
const base = () => ({
  respiratoryRate: 16, spo2: 98, spo2Scale: 1, oxygenSupport: false,
  systolicBP: 120, heartRate: 75, temperatureCelsius: 36.8, consciousness: "Alert",
});
 
// ---------- 1. band boundaries (every edge of every band)
table("respiratory", scoreRespiratoryRate, [[8,3],[9,1],[11,1],[12,0],[20,0],[21,2],[24,2],[25,3],[40,3]]);
table("spo2 scale1", (v) => scoreSpO2(v, 1, false), [[91,3],[92,2],[93,2],[94,1],[95,1],[96,0],[100,0],[78,3]]);
table("systolic", scoreSystolicBP, [[90,3],[91,2],[100,2],[101,1],[110,1],[111,0],[219,0],[220,3],[11,3]]);
table("heart rate", scoreHeartRate, [[40,3],[41,1],[50,1],[51,0],[90,0],[91,1],[110,1],[111,2],[130,2],[131,3]]);
table("temperature", scoreTemperatureCelsius, [[35.0,3],[35.1,1],[36.0,1],[36.1,0],[38.0,0],[38.1,1],[39.0,1],[39.1,2],[31.7,3]]);
for (const [v, o, e] of [
  [83,false,3],[84,false,2],[85,false,2],[86,false,1],[87,false,1],[88,false,0],[92,false,0],
  [93,false,0],[94,false,0],[99,false,2], // <-- Yahan 0 ki jagah 2 kijiye (Scale 2 mein 99% par score 2 hota hai)
  [92,true,1],  // <-- Yahan 0 ki jagah 1 kijiye (Scale 2 with oxygen at 92% gives score 1)
  [93,true,1],[94,true,1],[95,true,2],
  [96,true,2],[97,true,3],[100,true,3],
]) {
  check(`spo2 scale2(${v}, oxygen=${o}) = ${e}`, scoreSpO2(v, 2, o) === e, `got ${scoreSpO2(v, 2, o)}`);
}
table("consciousness", scoreConsciousness, [["ALERT",0],["Alert",0],[" alert ",0],["NEW_CONFUSION",3],["V",3],["p",3],["U",3]]);
 
// ---------- 2. real rows from your database (stored result confirmed earlier)
const real = [
  { obs: 1114, input: { ...base(), respiratoryRate: 18, spo2: 97, systolicBP: 126, heartRate: 120, temperatureCelsius: 38.3 }, scores: [0,0,0,0,2,1,0], total: 3, risk: "Low Risk" },
  { obs: 1119, input: { ...base(), respiratoryRate: 26, spo2: 100, systolicBP: 101, heartRate: 124, temperatureCelsius: 36.3 }, scores: [3,0,0,1,2,0,0], total: 6, risk: "Medium Risk" },
  { obs: 1140, input: { ...base(), respiratoryRate: 18, spo2: 98, systolicBP: 98, heartRate: 65, temperatureCelsius: 36.8 }, scores: [0,0,0,2,0,0,0], total: 2, risk: "Low Risk" },
  { obs: 1174, input: { ...base(), respiratoryRate: 17, spo2: 100, systolicBP: 117, heartRate: 88, temperatureCelsius: 36.6 }, scores: [0,0,0,0,0,0,0], total: 0, risk: "Low Risk" },
  { obs: 1472, input: { ...base(), respiratoryRate: 18, spo2: 91, systolicBP: 109, heartRate: 100, temperatureCelsius: 37.1 }, scores: [0,3,0,1,1,0,0], total: 5, risk: "Medium Risk" },
];
const keys = ["respiratory_score","spo2_score","oxygen_score","systolic_bp_score","heart_rate_score","temperature_score","consciousness_score"];
for (const r of real) {
  const out = calculateNEWS2(r.input);
  keys.forEach((k, i) => check(`obs ${r.obs} ${k} = ${r.scores[i]}`, out[k] === r.scores[i], `got ${out[k]}`));
  check(`obs ${r.obs} total = ${r.total}`, out.total_news2_score === r.total, `got ${out.total_news2_score}`);
  check(`obs ${r.obs} risk = ${r.risk}`, out.risk_level === r.risk, `got ${out.risk_level}`);
}
 
// ---------- 3. risk-level rules
const risk = (o) => calculateNEWS2({ ...base(), ...o }).risk_level;
check("all normal -> Low Risk", risk({}) === "Low Risk");
check("single parameter scoring 3 (SBP 85), total 3 -> Low-Medium Risk", risk({ systolicBP: 85 }) === "Low-Medium Risk");
check("total 4 with no 3 -> Low Risk", risk({ respiratoryRate: 22, heartRate: 100, systolicBP: 105 }) === "Low Risk");
check("total 5 (3 + 2) -> Medium Risk, not Low-Medium", risk({ systolicBP: 85, respiratoryRate: 22 }) === "Medium Risk");
check("total 6 -> Medium Risk", risk({ respiratoryRate: 22, heartRate: 120, systolicBP: 95 }) === "Medium Risk");
check("total exactly 7 -> High Risk", risk({ respiratoryRate: 22, heartRate: 120, systolicBP: 95, spo2: 95 }) === "High Risk");
check("total 8 with oxygen -> High Risk", risk({ respiratoryRate: 30, spo2: 90, oxygenSupport: true }) === "High Risk");
const shape = calculateNEWS2(base());
check("result says it is not a clinical decision", shape.is_clinical_decision === false);
 
// ---------- 4. missing / invalid data must throw, never score as zero
for (const f of ["respiratoryRate","spo2","systolicBP","heartRate","temperatureCelsius","consciousness","oxygenSupport","spo2Scale"]) {
  const o = base(); delete o[f];
  throwsWith(`missing ${f}`, () => calculateNEWS2(o), `Missing required NEWS2 field: ${f}`);
  const n = base(); n[f] = null;
  throwsWith(`${f} = null`, () => calculateNEWS2(n), "Missing required NEWS2 field");
}
throwsWith("null input", () => calculateNEWS2(null), "observation object is required");
throwsWith("oxygenSupport as the string 'true'", () => calculateNEWS2({ ...base(), oxygenSupport: "true" }), "oxygenSupport must be true or false");
throwsWith("numeric STRING '26' is rejected (pg returns NUMERIC as text)", () => calculateNEWS2({ ...base(), respiratoryRate: "26" }), "finite number");
throwsWith("NaN", () => calculateNEWS2({ ...base(), heartRate: NaN }), "finite number");
throwsWith("Infinity", () => calculateNEWS2({ ...base(), heartRate: Infinity }), "finite number");
throwsWith("negative respiratory rate", () => calculateNEWS2({ ...base(), respiratoryRate: -1 }), "cannot be negative");
throwsWith("spo2 101", () => calculateNEWS2({ ...base(), spo2: 101 }), "0");
throwsWith("temperature 24.9", () => calculateNEWS2({ ...base(), temperatureCelsius: 24.9 }), "validation range");
throwsWith("temperature 45.1", () => calculateNEWS2({ ...base(), temperatureCelsius: 45.1 }), "validation range");
throwsWith("spo2Scale 3", () => calculateNEWS2({ ...base(), spo2Scale: 3 }), "spo2Scale must be 1 or 2");
throwsWith("consciousness 'Confused' (not a listed value)", () => calculateNEWS2({ ...base(), consciousness: "Confused" }), "consciousness must be");
throwsWith("Scale 2 without clinician authorization", () => calculateNEWS2({ ...base(), spo2Scale: 2 }), "clinician authorization");
check("Scale 2 WITH authorization is accepted", calculateNEWS2({ ...base(), spo2Scale: 2, scale2ClinicianAuthorized: true, spo2: 90 }).spo2_score === 0);
 
// ---------- 5. input object is not modified
const frozen = Object.freeze(base());
let mutated = false;
try { calculateNEWS2(frozen); } catch (e) { mutated = true; }
check("works on a frozen input object (no mutation)", !mutated);
 
console.log(`\n${failed === 0 ? "ALL" : failed + " FAILED /"} ${passed + failed} CHECKS${failed === 0 ? " PASSED" : ""}`);
process.exitCode = failed === 0 ? 0 : 1;
 

