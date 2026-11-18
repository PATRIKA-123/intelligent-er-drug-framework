// B09: temperature unit classification and the trend calculator's use of Celsius.
// No database needed.   node test-temperature-units.js
const fs = require("fs");
const path = require("path");
const { classifyTemperature, STATUS } = require("../scripts/temperatureUnits");
const { calculateVitalTrend } = require("./services/trendCalculator");
const { calculateNEWS2 } = require("./services/news2Calculator");

let failed = 0, total = 0;
function check(name, got, expected) {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : `   (got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)})`));
}
const c = (v, o) => classifyTemperature(v, o);

console.log("--- Fahrenheit values are converted ---");
check("98.6 F -> 37.0 C", [c(98.6).status, c(98.6).celsius, c(98.6).unit], ["CONVERTED_FROM_F", 37, "F"]);
check("97.3 F -> 36.3 C", c(97.3).celsius, 36.3);
check("102.4 F -> 39.1 C", c(102.4).celsius, 39.1);
check("lowest plausible 77.00 F -> 25.0 C", [c(77).status, c(77).celsius], ["CONVERTED_FROM_F", 25]);
check("highest plausible 113.00 F -> 45.0 C", [c(113).status, c(113).celsius], ["CONVERTED_FROM_F", 45]);
check("exact half-tenth rounds up like the database (45.09 F is outside, 77.09 F -> 25.05 -> 25.1)", c(77.09).celsius, 25.1);

console.log("--- Celsius-looking values are NOT silently trusted ---");
check("36.8 -> UNVERIFIED_CELSIUS, no canonical Celsius", [c(36.8).status, c(36.8).celsius, c(36.8).unit], ["UNVERIFIED_CELSIUS", null, "C"]);
check("25.00 and 45.00 are Celsius-looking", [c(25).status, c(45).status], ["UNVERIFIED_CELSIUS", "UNVERIFIED_CELSIUS"]);
check("operator choice accepts them, labelled INFERRED_CELSIUS",
  [c(36.8, { acceptInferredCelsius: true }).status, c(36.8, { acceptInferredCelsius: true }).celsius], ["INFERRED_CELSIUS", 36.8]);
check("accepting inference does not change Fahrenheit handling", c(98.6, { acceptInferredCelsius: true }).status, "CONVERTED_FROM_F");

console.log("--- implausible values are never converted ---");
for (const v of [24.99, 45.01, 48, 60, 76.99, 113.01, 200, 999.99]) {
  check(`${v} -> IMPLAUSIBLE, no Celsius`, [c(v).status, c(v).celsius], ["IMPLAUSIBLE", null]);
}
check("ranges never overlap (no value is both F and C)",
  Array.from({ length: 20000 }, (_, i) => i / 100).filter((v) => {
    const f = v * 100 >= 7700 && v * 100 <= 11300, cc = v * 100 >= 2500 && v * 100 <= 4500; return f && cc;
  }).length, 0);

console.log("--- the real CSV: every row gets a status ---");
const lines = fs.readFileSync(path.join(__dirname, "../data/cleaned_vitals.csv"), "utf8").trim().split(/\r?\n/);
const header = lines[0].split(",");
const tempIdx = header.indexOf("temperature");
const counts = {};
for (const line of lines.slice(1)) {
  const s = c(Number(line.split(",")[tempIdx])).status;
  counts[s] = (counts[s] || 0) + 1;
}
check("554 rows classified", Object.values(counts).reduce((a, b) => a + b, 0), 554);
check("520 Fahrenheit, 34 unverified Celsius, 0 implausible",
  [counts.CONVERTED_FROM_F, counts.UNVERIFIED_CELSIUS, counts.IMPLAUSIBLE || 0], [520, 34, 0]);

console.log("--- scoring never consumes raw Fahrenheit ---");
const base = { respiratoryRate: 16, spo2: 98, systolicBP: 120, heartRate: 70, consciousness: "ALERT", oxygenSupport: false, spo2Scale: 1 };
let threw = false;
try { calculateNEWS2({ ...base, temperatureCelsius: 98.6 }); } catch (_) { threw = true; }
check("NEWS2 refuses a Fahrenheit value passed as Celsius", threw, true);

console.log("--- trend calculator uses Celsius only ---");
const t = (prev, cur) => calculateVitalTrend(prev, cur).changes?.temperature || calculateVitalTrend(prev, cur).vital_changes?.temperature;
const prev = { observation_time: "2147-01-01 01:00", temperature: 98.6, temperature_celsius: 37.0 };
const cur  = { observation_time: "2147-01-01 02:00", temperature: 100.4, temperature_celsius: 38.0 };
const full = calculateVitalTrend(prev, cur);
const temp = JSON.stringify(full).match(/"temperature":\{[^}]*\}/)[0];
check("row with raw F and Celsius -> delta is 1.0 C (not 1.8 F)", JSON.parse("{" + temp + "}").temperature.delta, 1);
const nullC = calculateVitalTrend({ ...prev, temperature_celsius: null }, cur);
const nullTemp = JSON.parse("{" + JSON.stringify(nullC).match(/"temperature":\{[^}]*\}/)[0] + "}").temperature;
check("NULL temperature_celsius (unverified) -> MISSING_DATA, raw value NOT used", [nullTemp.status, nullTemp.previous_value], ["MISSING_DATA", null]);
const preEr = calculateVitalTrend({ observation_time: "2147-01-01 01:00", temperature: 36.5 }, { observation_time: "2147-01-01 02:00", temperature: 37.5 });
const preErTemp = JSON.parse("{" + JSON.stringify(preEr).match(/"temperature":\{[^}]*\}/)[0] + "}").temperature;
check("objects with only 'temperature' (Pre-ER, Celsius) still work", [preErTemp.status, preErTemp.delta], ["CALCULATED", 1]);

console.log(`\n${failed} FAILED / ${total} CHECKS`);
process.exit(failed ? 1 : 0);
