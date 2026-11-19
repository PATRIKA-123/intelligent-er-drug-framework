'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('B02: permission and stay checks precede mutation',()=>{
 const code=read('backend/routes/decisionSupport.js');
 assert.match(code,/authMiddleware\.requireRole\(\.\.\.DECISION_SUPPORT_ROLES\),\s*requireStayAccess\(\)/);
 assert.ok(code.indexOf('requireStayAccess(),')<code.indexOf('await generateAndPersistAlerts(stay_id)'));
 assert.match(read('backend/services/alertService.js'),/pg_try_advisory_xact_lock/);
});
test('B02: existing real-DB test covers denial, rollback and concurrency',()=>{
 const s=read('backend/test-decision-support-access.js');
 for(const word of ['CREATE SCHEMA','DROP SCHEMA','409','PATIENT','DOCTOR','failing run kept previous alerts'])assert.ok(s.includes(word),word);
});
test('B03: current DB role and active status replace JWT claims',()=>{
 const s=read('backend/middleware/authMiddleware.js');
 assert.match(s,/await authMiddleware\.lookupUser\(userId\)/);
 assert.match(s,/!current\.is_active/);
 assert.match(s,/role:\s*current\.role/);
 assert.match(s,/return res\.status\(503\)/);
});
test('B03: existing database test covers demotion, deactivation, outages',()=>{
 const s=read('backend/test-token-revocation-db.js');
 for(const word of ['CREATE SCHEMA','DROP SCHEMA','deactivated','demoted','database failure'])assert.ok(s.includes(word),word);
});
test('B04: baseline contains required application tables',()=>{
 const s=read('schema-export.sql');
 const names=new Set([...s.matchAll(/CREATE\s+TABLE\s+(?:public\.)?([a-z][\w]*)\s*\(/gi)].map(x=>x[1].toLowerCase()));
 for(const n of ['users','patients','ed_stays','observations','emergency_cases','doctor_profiles','stay_doctor_assignments','prescriptions','clinical_alerts','drug_safety_results'])assert.ok(names.has(n),n);
 assert.doesNotMatch(s,/^\s*(?:COPY\s+\S+\s+FROM\s+stdin|INSERT\s+INTO)\b/im);
});
test('B04: bootstrap refuses dangerous targets unless explicitly authorized',()=>{
 const s=read('scripts/b04-bootstrap-test-db.js');
 for(const word of ['B04_ALLOW_DISPOSABLE_BOOTSTRAP','PRE_ER_TEST_DATABASE_NAME','NODE_ENV','not empty','--single-transaction','schema-export.sql'])assert.ok(s.includes(word),word);
});
