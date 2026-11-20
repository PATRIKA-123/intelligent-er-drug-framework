'use strict';const test=require('node:test'),assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');const {patchServer,patchPre,patchSecurity}=require('../scripts/round2-b2-patch');
// For package self-test, use a representative fixture if full checkout is absent.
const server=fs.existsSync(path.join(root,'backend/server.js'))
 ?fs.readFileSync(path.join(root,'backend/server.js'),'utf8')
 :`const app={use(){}}; app.use("/api/stays", staysRoutes);`;
const pre=fs.existsSync(path.join(root,'backend/routes/preEr.js'))
 ?fs.readFileSync(path.join(root,'backend/routes/preEr.js'),'utf8')
 :`// POST /api/emergency-cases/:id/er-arrival
 router.post("/:id/er-arrival", auth, async (req,res)=>{
  try {
      const caseResult = await client.query(\`SELECT * FROM emergency_cases\`);
      const stayResult = await client.query(\`SELECT * FROM ed_stays\`);
      const updated = await client.query(\`UPDATE emergency_cases SET stay_id=$1\`);
      const transportResult = await client.query(\`UPDATE ambulance_transports SET transport_status=$1\`);
      await client.query("COMMIT");
   } catch(err) {
      // Two requests tried to link different cases to the same stay at the same
      return res.status(500).json({error:'failed'});
   }
   try { return res.status(500).json({error:'processing failed'}); }catch(e){return res.status(500).json({error:'processing failed'});}
 }
);`;
const reg=fs.readFileSync(path.join(root,'backend/services/round2Registration.js'),'utf8');
const visit=fs.readFileSync(path.join(root,'backend/routes/visitRegistration.js'),'utf8');
const patients=fs.readFileSync(path.join(root,'backend/routes/patients.js'),'utf8');
const sql=fs.readFileSync(path.join(root,'migrations/20261120_010_patients_visits.sql'),'utf8');
test('T5 patient routes enforce roles, search bounds, and transaction',()=>{
 assert.match(patients,/requireRole\('ADMIN','ER_STAFF','DOCTOR'\)/);assert.match(patients,/limit>50/);assert.match(patients,/a.doctor_user_id=\$4/);
 assert.match(patients,/requireRole\('ADMIN','ER_STAFF'\)/);assert.match(patients,/ROLLBACK/);
});
test('T6 transactional registration and one-time code',()=>{
 for(const s of ['BEGIN','COMMIT','ROLLBACK','parvah_stay_id_seq','parvah_patient_subject_seq','linkCaseToStay(client','visit_access_codes','visit_registration_requests','ON CONFLICT','payload_hash'])assert.ok(reg.includes(s),s);
 assert.match(visit,/Idempotency-Key/);assert.match(visit,/PENDING_INPUTS/);
 assert.match(reg,/linked_profile:null,identity_link_status:'PENDING_VERIFICATION'/);
 assert.doesNotMatch(reg,/AUTO_LINKED|UPDATE patient_profiles/);
});
test('T7 shared linking is retry-safe and preserves transport completion',()=>{
 assert.match(reg,/if \(old\.stay_id\) return old/);
 assert.match(reg,/transport_status IN \('DISPATCHED','EN_ROUTE','IN_TRANSIT'\)/);
 const x=patchPre(pre);assert.equal(patchPre(x),x);assert.match(x,/ROUND2_B2_SHARED_LINK/);
 assert.match(x,/status\(202\)/);
});
test('B2 patcher is idempotent and rejects wrong route anchors',()=>{
 const x=patchServer(server);assert.equal(patchServer(x),x);
 assert.throws(()=>patchServer('unrelated server'),/anchor/);
});
test('B2 migration is additive and has numeric sequences',()=>{
 assert.match(sql,/CREATE SEQUENCE IF NOT EXISTS public\.parvah_patient_subject_seq AS bigint/);
 assert.match(sql,/CREATE SEQUENCE IF NOT EXISTS public\.parvah_stay_id_seq AS bigint/);
 assert.doesNotMatch(sql,/DROP TABLE|DROP SCHEMA|TRUNCATE/);
});

test('T6 access code is 8 symbols, correctly formatted; invalid data fails closed',()=>{
 const Module=require('node:module'); const old=Module._load;
 Module._load=function(req,parent,isMain){if(req==='../db'&&parent?.filename?.endsWith('round2Registration.js'))return {};return old.call(this,req,parent,isMain);};
 let service;try{const file=path.join(root,'backend/services/round2Registration.js');delete require.cache[file];service=require(file);}finally{Module._load=old;}
 for(let i=0;i<80;i++)assert.match(service.accessCode(),/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
 assert.equal(service.validatePatient({}).is_temporary,true);
 assert.throws(()=>service.validatePatient({date_of_birth:'2026-02-31'}),/Invalid date_of_birth/);
 assert.throws(()=>service.validatePatient({phone:'xx'}),/Invalid phone/);
});

test('Browser registration accepts only the additional Idempotency-Key CORS header',()=>{
 const local=patchSecurity('const ALLOWED_HEADERS = ["Authorization", "Content-Type"];');
 assert.match(local,/"Idempotency-Key"/);assert.equal(patchSecurity(local),local);
 assert.throws(()=>patchSecurity('const ALLOWED_HEADERS = ["*"];'),/anchor/);
});
