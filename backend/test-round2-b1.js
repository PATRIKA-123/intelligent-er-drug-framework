'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {patchPostEr,patchAssignment,patchCases}=require('../scripts/round2-b1-patch');
const root=__dirname;
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
test('T4 role guard, opt-in replacement and idempotence',()=>{
 const s=source('routes/postEr.js');const p=patchPostEr(s);
 assert.match(p,/"\/:stay_id\/assign-doctor",\s*requireErStaff/);
 assert.match(p,/ROUND2_T4_ASSIGN/);assert.equal(patchPostEr(p),p);
});
test('T4 transaction locks stay, replaces rather than deletes and preserves rollback',()=>{
 const s=source('services/postErService.js'),p=patchAssignment(s);
 assert.match(p,/ROUND2_T4_REPLACE/);assert.match(p,/FOR UPDATE/);
 assert.match(p,/status = 'REPLACED'/);assert.match(p,/ROLLBACK/);
 assert.equal(patchAssignment(p),p);
});
test('T8 queue scopes count and rows in SQL',()=>{
 const s=source('routes/emergencyCases.js'),p=patchCases(s);
 assert.match(p,/ROUND2_T8_CASE_QUEUE/);assert.match(p,/COUNT\(\*\)/);
 assert.match(p,/c\.created_by=\$3/);assert.match(p,/a\.doctor_user_id=\$3/);
 assert.match(p,/status='ACTIVE'/);assert.equal(patchCases(p),p);
});
test('T4 migration records replacements and forbids multiple active doctors',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../migrations/20261120_009_doctor_reassignment.sql'),'utf8');
 assert.match(sql,/REPLACED/);assert.match(sql,/UNIQUE INDEX/);assert.match(sql,/replaced_by/);
});
