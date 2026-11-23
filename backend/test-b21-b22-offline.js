'use strict';
// Offline contract regression coverage. No database connection or writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const rx = read('services/prescriptionService.js');
const post = read('services/postErService.js');
const alerts = read('services/alertService.js');
const drug = read('services/drugSafetyService.js');
const decision = read('services/decisionSupportService.js');
const service = read('test-post-er-invariants.js');
function between(s,start,end){let i=s.indexOf(start); assert.ok(i>=0,`missing ${start}`);let j=end?s.indexOf(end,i+start.length):-1;return s.slice(i,j>=0?j:undefined)}
test('B21: prescription is initially PENDING_REVIEW, never already authorized',()=>{
  const code=between(rx,'INSERT INTO prescriptions','RETURNING *');
  assert.match(code,/'PENDING_REVIEW'/);
  assert.doesNotMatch(code,/'AUTHORIZED'/);
});
test('B21: reviewing uses transaction, stay-level and prescription-level FOR UPDATE locks',()=>{
  const code=between(rx,'async function reviewPrescription(', '/**\n * Retrieves prescriptions');
  assert.match(code,/BEGIN/);assert.match(code,/COMMIT/);assert.match(code,/ROLLBACK/);
  assert.match(code,/FROM ed_stays[\s\S]*?FOR UPDATE/);
  assert.match(code,/FROM prescriptions[\s\S]*?FOR UPDATE/);
});
test('B21: only actively assigned doctor may review and pending only',()=>{
  const code=between(rx,'async function reviewPrescription(', '/**\n * Retrieves prescriptions');
  assert.match(code,/doctor_user_id = \$2/);
  assert.match(code,/status = 'ACTIVE'/);
  assert.match(code,/ended_at IS NULL/);
  assert.match(code,/status !== "PENDING_REVIEW"/);
});
test('B21: incomplete screening requires documented assigned-doctor override; rejection remains possible',()=>{
  const code=between(rx,'async function reviewPrescription(', '/**\n * Retrieves prescriptions');
  // Status remains incomplete: authorization never silently re-labels an unmapped drug as screened.
  assert.match(code,/data\.status === "AUTHORIZED"/);
  assert.match(code,/screenStatus !== "SCREENED"/);
  assert.match(code,/data\.clinical_override !== true/);
  assert.match(code,/data\.acknowledged_incomplete !== true/);
  assert.match(code,/justification\.length < 30/);
  assert.match(code,/review_notes/);
  assert.match(code,/doctor_user_id = \$2/);
  assert.match(code,/status !== "PENDING_REVIEW"/);
  assert.match(service,/prescription can be rejected even if screening is incomplete/);
});
test('B21: detected interactions must be explicitly acknowledged before authorization',()=>{
  const code=between(rx,'async function reviewPrescription(', '/**\n * Retrieves prescriptions');
  assert.match(code,/findings\.length && data\.acknowledged_interactions !== true/);
  assert.match(code,/screening\.interactions_found/);
});
test('B21: discharge ensures single row under a stay lock',()=>{
  const code=between(post,'async function createDischarge(', 'async function ');
  assert.match(code,/FOR UPDATE OF e/);
  assert.match(code,/FROM discharges/);
  assert.match(code,/statusCode = 409/);
});
test('B22: per-stay nonblocking transaction-scoped advisory lock',()=>{
  assert.match(alerts,/BEGIN/);
  assert.match(alerts,/pg_try_advisory_xact_lock/);
  assert.match(alerts,/decision_support:\$\{stayId\}/);
  assert.match(alerts,/statusCode = 409/);
});
test('B22: alerts, decision and drug safety are one transaction',()=>{
  assert.match(alerts,/computeAndPersistDecisionSupport\(stayId,\s*\{[\s\S]*?client,/);
  assert.match(decision,/persistDrugSafetyResults\([\s\S]*?client,\s*engineRunId/);
  assert.match(drug,/const client = externalClient \?\? await pool\.connect\(\)/);
  assert.match(alerts,/ROLLBACK/);
});
test('B22: a shared run identifier and engine version are propagated',()=>{
  assert.match(alerts,/engineRunId = randomUUID\(\)/);
  assert.match(alerts,/engineVersion = "phase6-v1"/);
  assert.match(decision,/engine_run_id, engine_version/);
  assert.match(drug,/engine_run_id, engine_version/);
});
test('B22: screening reruns preserve previous results',()=>{
  assert.doesNotMatch(alerts,/DELETE FROM clinical_alerts WHERE stay_id/);
  assert.doesNotMatch(decision,/DELETE FROM decision_support_results WHERE stay_id/);
  assert.doesNotMatch(drug,/DELETE FROM drug_safety_results/);
});
