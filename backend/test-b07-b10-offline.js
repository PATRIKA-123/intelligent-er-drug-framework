"use strict";
// Offline B07-B10 regression checks. Does not connect to PostgreSQL.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const backend = __dirname;
const project = path.resolve(backend, "..");
const { validateRow, validateAll } = require("../scripts/importValidation");
const { classifyTemperature, celsiusForDatabase } = require("../scripts/temperatureUnits");
const { calculateNEWS2 } = require("./services/news2Calculator");
const row = { subject_id:"1001", stay_id:"5001", timestamp:"2147-01-01 10:00:00",
  temperature:"98.6", heart_rate:"80.0", respiratory_rate:"18.0", spo2:"97.0",
  systolic_bp:"120.0", data_source:"TEST" };

test("B07: importer runtime dependencies can be resolved from backend", () => {
  const pkg = require("./package.json");
  for (const name of ["csv-parser", "dotenv", "pg"]) {
    assert.equal(typeof pkg.dependencies[name], "string", `${name} must be a production dependency`);
    assert.ok(createRequire(path.join(backend, "package.json")).resolve(name));
  }
  assert.match(pkg.scripts["import:data"], /importData\.js/);
});

test("B08: decimal-looking integer values are parsed without silent truncation", () => {
  const actual = validateRow(row, 2);
  assert.equal(actual.ok, true);
  assert.equal(actual.values.heart_rate, 80);
  assert.equal(actual.values.spo2, 97);
  assert.equal(actual.values.temperature, 98.6);
});

test("B08/B05: fractional SpO2 is refused before import, matching NEWS2", () => {
  for (const saturation of ["83.5", "87.5", "95.01", "99.9"]) {
    const result = validateRow({ ...row, spo2: saturation }, 17);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.field === "spo2" && /whole-number/.test(p.reason)));
    assert.equal(result.problems.find(p => p.field === "spo2").row, 17);
  }
  assert.equal(validateRow({ ...row, spo2: "97.000" }, 2).ok, true);
  assert.throws(() => calculateNEWS2({respiratoryRate:16, spo2:97.5, systolicBP:120,
    heartRate:80, temperatureCelsius:37, consciousness:"ALERT", oxygenSupport:false, spo2Scale:1}), /whole-number|integer|fractional/i);
});

test("B08: invalid rows produce line-and-field errors, no valid-row contamination", () => {
  const result = validateAll([row, { ...row, spo2:"101", heart_rate:"NaN" }, row]);
  assert.equal(result.validRows.length, 2);
  assert.equal(result.rejectedRowCount, 1);
  assert.deepEqual(result.problems.map(p => [p.row,p.field]), [[3,"heart_rate"],[3,"spo2"]]);
});

test("B09: raw Fahrenheit is retained, Celsius canonicalized; ambiguous Celsius withheld", () => {
  const f = classifyTemperature(98.6);
  assert.equal(f.status,"CONVERTED_FROM_F");
  assert.equal(celsiusForDatabase(f),"37.0");
  const ambiguous = classifyTemperature(36.8);
  assert.equal(ambiguous.status,"UNVERIFIED_CELSIUS");
  assert.equal(celsiusForDatabase(ambiguous),null);
  assert.equal(classifyTemperature(36.8, {acceptInferredCelsius:true}).status,"INFERRED_CELSIUS");
  assert.equal(classifyTemperature(60).status,"IMPLAUSIBLE");
});

test("B09: all project data rows classify, but inference is not proof of source unit", () => {
  const lines = fs.readFileSync(path.join(project,"data","cleaned_vitals.csv"),"utf8").trim().split(/\r?\n/);
  const names=lines[0].split(","); const idx=names.indexOf("temperature");
  assert.ok(idx>=0);
  const counts={};
  for (const l of lines.slice(1)) {const v=Number(l.split(",")[idx]);const s=classifyTemperature(v).status;counts[s]=(counts[s]||0)+1;}
  assert.equal(lines.length-1,554);
  assert.equal(counts.CONVERTED_FROM_F,520);
  assert.equal(counts.UNVERIFIED_CELSIUS,34);
});

test("B10: importer defaults to unknown rather than invented normal clinical inputs", () => {
  const src=fs.readFileSync(path.join(project,"scripts","importData.js"),"utf8");
  for (const expression of [/demoDefaults\s*\?\s*"Alert"\s*:\s*null/,
    /demoDefaults\s*\?\s*false\s*:\s*null/,
    /demoDefaults\s*\?\s*1\s*:\s*null/]) {
    assert.match(src,expression);
  }
  assert.match(src,/consciousness_assumed/);
  assert.match(src,/oxygen_support_assumed/);
  assert.match(src,/spo2_scale_assumed/);
});

test("B10: missing NEWS2 input cannot publish a complete score", () => {
  const complete={respiratoryRate:16,spo2:97,systolicBP:120,heartRate:80,
    temperatureCelsius:37,consciousness:"ALERT",oxygenSupport:false,spo2Scale:1};
  for (const missing of ["consciousness","oxygenSupport","spo2Scale"]) {
    assert.throws(()=>calculateNEWS2({...complete,[missing]:null}), /Missing required NEWS2 field/);
  }
});
