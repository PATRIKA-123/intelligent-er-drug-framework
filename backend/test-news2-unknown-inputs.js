// B10: NEWS2 must NOT produce a score when consciousness, oxygen support or
// the SpO2 scale are unknown. (Importer rows with unknown inputs store NULL.)
// No database needed.   node test-news2-unknown-inputs.js
const { calculateNEWS2 } = require("./services/news2Calculator");

let failed = 0, total = 0;
function check(name, got, expected) {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : `   (got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)})`));
}

const complete = { respiratoryRate: 16, spo2: 98, systolicBP: 120, heartRate: 70, temperatureCelsius: 37,
  consciousness: "ALERT", oxygenSupport: false, spo2Scale: 1 };
const outcome = (input) => {
  try { const r = calculateNEWS2(input); return `SCORE ${r.total_news2_score}`; }
  catch (e) { return `NO SCORE: ${e.message}`; }
};

check("fully measured input scores", outcome(complete), "SCORE 0");
for (const [label, patch, message] of [
  ["unknown consciousness (null)", { consciousness: null }, "Missing required NEWS2 field: consciousness"],
  ["unknown oxygen support (null)", { oxygenSupport: null }, "Missing required NEWS2 field: oxygenSupport"],
  ["unknown SpO2 scale (null)", { spo2Scale: null }, "Missing required NEWS2 field: spo2Scale"],
  ["all three unknown", { consciousness: null, oxygenSupport: null, spo2Scale: null }, "Missing required NEWS2 field: consciousness"],
  ["empty consciousness text", { consciousness: "" }, "Missing required NEWS2 field: consciousness"],
]) {
  check(`${label} -> no score`, outcome({ ...complete, ...patch }), `NO SCORE: ${message}`);
}
check("oxygen support must be a real true/false, not a text guess", outcome({ ...complete, oxygenSupport: "false" }), "NO SCORE: oxygenSupport must be true or false");

console.log(`\n${failed} FAILED / ${total} CHECKS`);
process.exit(failed ? 1 : 0);
