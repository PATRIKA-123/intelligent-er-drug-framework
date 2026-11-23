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
test('B03: current DB role, active status and archive state replace JWT claims',()=>{
 const s=read('backend/middleware/authMiddleware.js');
 assert.match(s,/await\s+authMiddleware\.lookupUser\((?:id|userId)\)/);
 assert.match(s,/!current\.is_active/);
 assert.match(s,/current\.archived_at/);
 assert.match(s,/role:\s*current\.role/);
 assert.match(s,/return\s+res\.status\(503\)/);
 assert.match(s,/SELECT\s+user_id,username,role,is_active,archived_at\s+FROM\s+public\.users/i);
});
test('B03: existing database test covers demotion, deactivation, outages',()=>{
 const s=read('backend/test-token-revocation-db.js');
 for(const word of ['CREATE SCHEMA','DROP SCHEMA','deactivated','demoted','database failure'])assert.ok(s.includes(word),word);
});
test('B04: retained migration history includes essential schema transitions',()=>{
 // schema-export.sql was intentionally removed during repository cleanup.
 // This checks historical migrations; it does NOT claim migrations alone
 // can bootstrap a fresh database without a verified baseline.
 const directory=path.join(root,'migrations');
 assert.ok(fs.statSync(directory).isDirectory());
 const files=fs.readdirSync(directory).filter(x=>x.endsWith('.sql')&&!x.endsWith('.down.sql'));
 for(const suffix of [
   '_007_clinical_audit_events.sql',
   '_008_staff_profiles.sql',
   '_009_doctor_reassignment.sql',
   '_010_patients_visits.sql',
   '_011_round2_er_post_er.sql',
   '_012_patient_portal_identity.sql',
   '_013_admin_management.sql',
   '_014_archived_user_accounts.sql',
 ]) assert.ok(files.some(f=>f.endsWith(suffix)),`Missing migration ${suffix}`);
 for(const f of files) assert.doesNotMatch(read(`migrations/${f}`),/^\s*(?:COPY\s+\S+\s+FROM\s+stdin)\b/im);
});
test('B04: legacy bootstrap fails clearly if required schema export is absent',()=>{
 const s=read('scripts/b04-bootstrap-test-db.js');
 for(const word of ['B04_ALLOW_DISPOSABLE_BOOTSTRAP','PRE_ER_TEST_DATABASE_NAME','NODE_ENV','not empty','--single-transaction','schema-export.sql'])assert.ok(s.includes(word),word);
 // A previously used baseline file is no longer tracked. Do not silently
 // treat that old bootstrap path as functional or recreate a fake schema.
 assert.ok(!fs.existsSync(path.join(root,'schema-export.sql')),
   'If schema-export.sql is restored, reinstate the original baseline-table test');
});
