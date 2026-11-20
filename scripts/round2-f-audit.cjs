#!/usr/bin/env node
'use strict';
// Read-only release audit: never loads .env, never invokes migrations, never writes to repo.
const fs=require('node:fs');const path=require('node:path');const root=process.cwd();
const read=(p)=>{try{return fs.readFileSync(path.join(root,p),'utf8')}catch{return null}};
const checks=[];
function check(id,ok,details,priority='required') {checks.push({id,status:ok?'PASS':'BLOCKED',priority,details});}
const files=[
 'backend/routes/round2Patient.js','backend/routes/round2Identity.js',
 'backend/routes/round2Board.js','backend/routes/round2Vitals.js',
 'backend/routes/round2Departure.js','backend/routes/round2PostEr.js',
 'backend/routes/round2Alerts.js','backend/services/round2Registration.js',
 'backend/services/round2Patient.js','backend/routes/visitRegistration.js',
 'frontend/src/api/real.js','frontend/src/api/client.js',
 'migrations/20261120_009_doctor_reassignment.sql',
 'migrations/20261120_010_patients_visits.sql',
 'migrations/20261120_011_round2_er_post_er.sql',
 'migrations/20261120_012_patient_portal_identity.sql',
];
for(const f of files)check('file:'+f,read(f)!==null,'Required Round 2 artifact', 'artifact');
const server=read('backend/server.js')||'';
for(const [id,needle] of [
 ['registration-route','visitRegistration'],['patient-route','round2Patient'],
 ['identity-route','round2Identity'],['board-route','round2Board'],
 ['vitals-route','round2Vitals'],['departure-route','round2Departure'],
 ['post-er-queues','round2PostEr'],['alerts-route','round2Alerts'],
 ['staff-route','staff']]) check('mount:'+id,server.includes(needle),'server.js must mount the actual route');
const real=read('frontend/src/api/real.js')||'';
const frontendClient=read('frontend/src/api/client.js')||'';
check('frontend-adapter-marker',real.includes('ROUND2_E_ADAPTER_V1'),'Batch E marker must be present');
check('idempotency-header',real.includes('Idempotency-Key')&&frontendClient.includes('Idempotency-Key'),'Registration request and client must send idempotency key');
check('no-unimplemented-stubs',!real.includes('throw new ApiError(501'),'No remaining 501 feature stubs in real adapter');
const reg=read('backend/services/round2Registration.js')||'';
check('registration-transaction',reg.includes("query('BEGIN')")&&reg.includes("query('ROLLBACK')")&&reg.includes('visit_registration_requests'),'Registration must have rollback and persistent idempotency');
check('registration-no-auto-link',reg.includes('PENDING_VERIFICATION')&&!reg.includes('tryLink('),'Never auto-link visit by demographics');
const patient=read('backend/services/round2Patient.js')||'';
check('claim-needs-human-approval',patient.includes('PENDING_VERIFICATION')&&patient.includes('patient_identity_reviews')&&patient.includes('verification_method'),'Identity claim must require human review');
check('claim-limits',patient.includes('patient_claim_attempts')&&patient.includes('pg_advisory_xact_lock'),'Claim attempt limiting and serialization present');
const board=read('backend/routes/round2Board.js')||'';
check('board-scope',board.includes('stayListFilter(req.user)'),'Board must enforce role scope in SQL');
const vitals=read('backend/routes/round2Vitals.js')||'';
check('vitals-partial',vitals.includes('PENDING_INPUTS')&&vitals.includes('calculateNEWS2'),'Incomplete measurements cannot be scored');
const dep=read('backend/routes/round2Departure.js')||'';
check('departure-auth',dep.includes('discharges')&&dep.includes('FOR UPDATE'),'Departure should lock stay and require discharge');
const allSql=['009_doctor_reassignment','010_patients_visits','011_round2_er_post_er','012_patient_portal_identity'];
for(let i=0;i<allSql.length;i++){
 const name=allSql[i];const sql=read('migrations/20261120_'+name+'.sql')||'';
 check('migration:'+name,sql.includes('public.')&&sql.trim().length>100,'Migration exists and references explicit schema');
}
// Known evidence gaps: these must NEVER be silently labelled complete.
const gates=[
 {id:'staging-db-migrations',status:'NOT_VERIFIED',reason:'Apply and verify 009-012 on isolated staging only, with snapshot and rollback plan'},
 {id:'role-matrix-five-roles',status:'NOT_VERIFIED',reason:'ADMIN, ER_STAFF, DOCTOR, PARAMEDIC, PATIENT real API acceptance tests missing'},
 {id:'identity-correction-e2e',status:'NOT_VERIFIED',reason:'Independent verification, claim approval, denial, revoke/correction and audit must be tested'},
 {id:'clinical-policy-signoff',status:'NOT_VERIFIED',reason:'Clinical reviewer must approve NEWS2 Scale 2 and prescription/discharge policy'},
 {id:'production-deployment',status:'NOT_AUTHORIZED',reason:'No production migration, merge or deployment authorized by this audit'},
];
const failures=checks.filter(c=>c.status==='BLOCKED');
const report={version:'round2-f-v1',generated_at:new Date().toISOString(),checks_passed:checks.length-failures.length,checks_failed:failures.length,checks,gates,release_decision:'NO_GO_UNTIL_GATES_VERIFIED'};
if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
else{
 console.log(`ROUND2_F_STATIC_AUDIT ${checks.length-failures.length}/${checks.length} checks passed`);
 for(const f of failures)console.log('BLOCKED',f.id,'-',f.details);
 for(const g of gates)console.log('GATE',g.id,g.status,'-',g.reason);
 console.log('RELEASE_DECISION',report.release_decision);
}
process.exitCode=failures.length?1:0;
