'use strict';
const test=require('node:test');const a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const {patchServer,patchPostService}=require('../scripts/round2-c-patch');
const vitals=read('backend/routes/round2Vitals.js'),board=read('backend/routes/round2Board.js'),post=read('backend/routes/round2PostEr.js'),departure=read('backend/routes/round2Departure.js'),alerts=read('backend/routes/round2Alerts.js'),migration=read('migrations/20261120_011_round2_er_post_er.sql');
test('C1: board uses scoped total and latest risk, stable ordering',()=>{
 a.match(board,/stayListFilter\(req.user\)/);a.match(board,/COUNT|count\(\*\)/i);a.match(board,/LEFT JOIN LATERAL/);a.match(board,/ORDER BY/);a.match(board,/visit_status/);
});
test('C1: vitals preserve partial entries and never manufacture NEWS2',()=>{
 a.match(vitals,/PENDING_INPUTS/);a.match(vitals,/calculateNEWS2/);a.match(vitals,/scale2ClinicianAuthorized/);a.match(vitals,/BEGIN/);a.match(vitals,/ROLLBACK/);
});
test('C2: queues use SQL scope rather than frontend filters',()=>{
 a.match(post,/ownClause\(req.user\)/);a.match(post,/doctor_user_id=\$1/);a.match(post,/case_status IN/);a.match(post,/FOR UPDATE OF f/);a.match(alerts,/doctor_user_id=\$1/);
});
test('C2: departure locked and requires authorized discharge',()=>{
 a.match(departure,/FOR UPDATE/);a.match(departure,/FROM discharges/);a.match(departure,/status\(409\)/);a.match(departure,/DEPARTED/);
});
test('C2: migration is additive and distinguishes departure',()=>{
 a.match(migration,/ADD COLUMN IF NOT EXISTS visit_status/);a.match(migration,/DISCHARGE_AUTHORIZED/);a.match(migration,/er_vital_entries/);a.doesNotMatch(migration,/DROP TABLE/);
});
test('C: server and discharge patchers are guarded and idempotent',()=>{
 const server='app.use("/api/stays", staysRoutes);';const patched=patchServer(server);a.equal(patchServer(patched),patched);
 const before='async function createDischarge(stayId, data) {\n    await client.query("COMMIT");\n}\nasync function foo() {}';const changed=patchPostService(before);a.equal(patchPostService(changed),changed);
});
