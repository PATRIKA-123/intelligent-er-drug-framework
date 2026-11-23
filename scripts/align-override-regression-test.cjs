'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '..', 'backend', 'test-b21-b22-offline.js');
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
const original = fs.readFileSync(file, 'utf8');
const nl = original.includes('\r\n') ? '\r\n' : '\n';
const normalized = original.replace(/\r\n/g, '\n');
const oldBlock = `test('B21: incomplete screenings cannot authorize; rejection remains possible',()=>{
  const code=between(rx,'async function reviewPrescription(', '/**\\n * Retrieves prescriptions');
  assert.match(code,/data\\.status === "AUTHORIZED"/);
  assert.match(code,/screening_status !== "SCREENED"/);
  assert.match(service,/prescription can be rejected even if screening is incomplete/);
});`;
const newBlock = `test('B21: incomplete screening requires documented assigned-doctor override; rejection remains possible',()=>{
  const code=between(rx,'async function reviewPrescription(', '/**\\n * Retrieves prescriptions');
  // Status remains incomplete: authorization never silently re-labels an unmapped drug as screened.
  assert.match(code,/data\\.status === "AUTHORIZED"/);
  assert.match(code,/screenStatus !== "SCREENED"/);
  assert.match(code,/data\\.clinical_override !== true/);
  assert.match(code,/data\\.acknowledged_incomplete !== true/);
  assert.match(code,/justification\\.length < 30/);
  assert.match(code,/review_notes/);
  assert.match(code,/doctor_user_id = \\$2/);
  assert.match(code,/status !== "PENDING_REVIEW"/);
  assert.match(service,/prescription can be rejected even if screening is incomplete/);
});
test('B21: detected interactions must be explicitly acknowledged before authorization',()=>{
  const code=between(rx,'async function reviewPrescription(', '/**\\n * Retrieves prescriptions');
  assert.match(code,/findings\\.length && data\\.acknowledged_interactions !== true/);
  assert.match(code,/screening\\.interactions_found/);
});`;
const count = normalized.split(oldBlock).length-1;
if (count!==1) throw new Error(`Expected old B21 test exactly once, found ${count}. No files changed.`);
const updated=normalized.replace(oldBlock,newBlock);
fs.writeFileSync(file, nl==='\r\n' ? updated.replace(/\n/g,'\r\n'):updated);
console.log('Updated backend/test-b21-b22-offline.js to assert documented override safeguards.');
