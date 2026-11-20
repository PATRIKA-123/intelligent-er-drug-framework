"use strict";
// Explicit, curated database-free audit suite. Run with: cd backend && npm test
// Integration tests are intentionally excluded until a disposable DB is provided.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "test-rate-limit.js",
  "test-news2Calculator.js",
  "test-news2-unknown-inputs.js",
  "test-news2-b05-b06.js",
  "test-id-validator.js",
  "test-text-validator.js",
  "test-startup-environment.js",
  "test-http-security.js",
  "test-post-er-prescription-privacy.js",
  "test-case-status-race.js",
  "test-post-er-invariants.js",
  "test-staff-invitations.js",
  "test-import-validation.js",
  "test-temperature-units.js",
  "test-import-outliers.js",
  "test-b01-access-matrix.js",
  "test-b02-b03-b04-offline.js",
  "test-b07-b10-offline.js",
  "test-b13-b14-offline.js",
  "test-b15-b18-offline.js",
  "test-b19-b20-offline.js",
  "test-b21-b22-offline.js",
  "test-b25-trend-contract.js",
  "test-b26-audit-trail.js",
];

function main() {
  let failed = 0;
  console.log(`Running ${FILES.length} database-free suites. No production or test DB connection required.`);
  for (const name of FILES) {
    const full = path.join(ROOT, name);
    console.log(`\n== ${name} ==`);
    if (!fs.existsSync(full)) {
      console.error(`MISSING: ${name}`);
      failed++;
      continue;
    }
    const outcome = spawnSync(process.execPath, [full], {
      cwd: ROOT, stdio: "inherit", env: { ...process.env, NODE_ENV: "test" }, timeout: 120000,
    });
    if (outcome.error || outcome.status !== 0) {
      console.error(`FAILED: ${name}${outcome.error ? ` (${outcome.error.message})` : ""}`);
      failed++;
    }
  }
  console.log(`\nAudit offline suite: ${FILES.length - failed}/${FILES.length} scripts passed.`);
  if (failed) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { FILES, main };
