'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const path=require('node:path');const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('D migration: claims require separate verification and stay has one owner',()=>{
 const s=read('migrations/20261120_012_patient_portal_identity.sql');
 for(const token of ['UNIQUE(stay_id)','PENDING_VERIFICATION','code_id bigint REFERENCES public.visit_access_codes','consent_version','patient_identity_audit','ip_digest','patient_allergies','patient_medications','patient_conditions']) assert(s.includes(token),token);
 assert(!s.includes('DROP TABLE'));
});
test('D claim: never auto-grants patient visit access',()=>{
 const s=read('backend/services/round2Patient.js');
 const claim=s.slice(s.indexOf('async function claimVisit'),s.indexOf('async function reviewIdentity'));
 assert(claim.includes('PENDING_VERIFICATION'));
 assert(!claim.includes('INSERT INTO public.patient_visit_access'));
 assert(claim.includes('account_count')&&claim.includes('ip_count')&&claim.includes('stay_count'));
 assert(claim.includes('pg_advisory_xact_lock'));
});
test('D identity: approval locks stay and consumes matching code atomically',()=>{
 const s=read('backend/services/round2Patient.js');
 assert(s.includes('WHERE stay_id=$1 AND code_id=$3 AND used_at IS NULL'));
 assert(s.includes('FOR UPDATE'));
 assert(s.includes("await client.query('BEGIN')"));
 assert(s.includes('patient_identity_audit'));
});
test('D patient: owned health items, patient-only auth, prescription activity unknown',()=>{
 const s=read('backend/routes/round2Patient.js');
 assert(s.includes("auth.requireRole('PATIENT')"));
 assert(s.includes('WHERE id=$1 AND user_id=$2'));
 assert(s.includes("activity_status:'UNKNOWN'"));
 assert(s.includes('consent_changed_at'));
});
test('D history consent: denied returns no history lists',()=>{
 const s=read('backend/routes/round2Identity.js');
 assert(s.indexOf('if(!profile.share_history)')<s.indexOf('const visit=await'));
 assert(s.includes('HISTORY_RESTRICTED_READ'));
 assert(s.includes('PATIENT_REPORTED_UNVERIFIED'));
});
test('D patcher: mounts before generic stay routes',()=>{
 const s=read('scripts/round2-d-patch.js');assert(s.includes("mounts+required[1]"));
});

test('D patient details: update is audited and never auto-links',()=>{const s=read('backend/routes/round2Identity.js');assert(s.includes('HOSPITAL_DETAILS_UPDATED'));assert(s.includes('REQUIRES_STAFF_VERIFICATION'));assert(!s.includes('AUTO_LINKED'));});
