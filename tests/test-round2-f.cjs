'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
test('F audit never issues SQL writes or loads env',()=>{
 const src=source('scripts/round2-f-audit.cjs');
 assert.doesNotMatch(src,/require\(['"]\.\.\/backend\/db/);
 assert.doesNotMatch(src,/execSync|spawnSync|writeFileSync|\bclient\.query\(/);
});
test('F staging guard rejects production and requires explicit database name',()=>{
 const {guard}=require('../scripts/round2-f-staging-readonly.cjs');
 assert.throws(()=>guard({NODE_ENV:'production',ROUND2_STAGING_READONLY:'YES',ROUND2_STAGING_DB_NAME:'parvah_stage'}));
 assert.throws(()=>guard({ROUND2_STAGING_READONLY:'YES'}));
 assert.throws(()=>guard({ROUND2_STAGING_READONLY:'YES',ROUND2_STAGING_DB_NAME:'prod_parvah'}));
 assert.doesNotThrow(()=>guard({ROUND2_STAGING_READONLY:'YES',ROUND2_STAGING_DB_NAME:'parvah_staging'}));
});
test('F staging SQL uses read-only transactions and catalog metadata',()=>{
 const s=source('scripts/round2-f-staging-readonly.cjs');
 assert.match(s,/BEGIN READ ONLY/);assert.match(s,/transaction_read_only/);assert.match(s,/information_schema\.columns/);
 assert.doesNotMatch(s,/client\.query\(['"`]\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)/i);
});
test('F schema inventory includes ownership and unique indexes',()=>{
 const {REQUIRED}=require('../scripts/round2-f-staging-readonly.cjs');
 for(const key of ['patient_visit_access','patient_identity_reviews','patient_identity_audit','visit_registration_requests','er_vital_entries'])assert.ok(REQUIRED[key]);
});
test('F audit keeps explicit NO-GO clinical and role gates',()=>{
 const s=source('scripts/round2-f-audit.cjs');
 for(const keyword of ['NO_GO_UNTIL_GATES_VERIFIED','role-matrix-five-roles','clinical-policy-signoff','staging-db-migrations'])assert.ok(s.includes(keyword));
});
