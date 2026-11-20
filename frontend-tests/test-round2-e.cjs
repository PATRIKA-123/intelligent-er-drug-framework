'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const p=fs.readFileSync(require('path').join(__dirname,'../scripts/round2-e-patch.cjs'),'utf8');
test('E: real API replaces all planned capability stubs',()=>{for(const key of ['registerPatient:', 'listMyVisits:', 'claimVisit:', 'registerVisit:', 'newAccessCode:', 'getPatientHistory:', 'listFollowUps:', 'listPendingReviews:', 'listCases:'])assert.ok(p.includes(key));assert.ok(p.includes('span(s'));});
test('E: ER registration sends nested patient, case_id and idempotency key',()=>{for(const x of ['Idempotency-Key','patient = { full_name','case_id: Number(caseId)','chiefcomplaint: body.chief_complaint','requestKey.current ||= crypto.randomUUID()'])assert.ok(p.includes(x),x);});
test('E: patient claim is not presented as immediate access',()=>{assert.ok(p.includes('setPending(true)'));assert.ok(p.includes('after identity verification'));assert.ok(p.includes('setF({ stay_id:'));});
test('E: unknown medication activity is never marked active',()=>{assert.ok(p.includes('p.active === true'));assert.ok(p.includes('p.active == null'));});
test('E: least privilege for extra request headers and patient health lists',()=>{assert.ok(p.includes('key !== "Idempotency-Key"'));assert.ok(p.includes("['allergies', 'medications', 'conditions'].includes(kind)"));});
test('E: guarded patcher validates anchors, supports preflight, refuses unsafe silent rewrites',()=>{assert.ok(p.includes('total!==1'));assert.ok(p.includes('anchors changed, refusing modification'));assert.ok(p.includes("mode==='--apply'"));});

// Regression: Windows CRLF worktrees must match multi-line anchors as safely as LF.
test('E: guarded replacement works on LF and CRLF and rejects ambiguity',()=>{
 const vm=require('node:vm');
 const raw=p.slice(p.indexOf('function replace('),p.indexOf('function span('));
 const replace=vm.runInNewContext(raw+'; replace');
 for(const nl of ['\n','\r\n']) {
   const source=['before','staff: original','after'].join(nl);
   const result=replace(source,'before\nstaff: original','before\nstaff: updated','staff');
   assert.equal(result,['before','staff: updated','after'].join(nl));
 }
 assert.throws(()=>replace('before\nbefore','before','after','staff'),/expected exactly one anchor/);
});

// Regression: both span boundaries must work on Windows CRLF and Linux LF.
test('E: guarded span works on LF and CRLF, preserves line endings, rejects duplicates',()=>{
 const vm=require('node:vm');
 const raw=p.slice(p.indexOf('function span('),p.indexOf("edit('frontend/src/api/client.js'"));
 const span=vm.runInNewContext(raw+'; span');
 for(const nl of ['\n','\r\n']){
  const source=['before','  // The backend has no "list my cases" endpoint yet,','old case list','};','','function normalizeCase','after'].join(nl);
  const after=span(source,'  // The backend has no "list my cases" endpoint yet,','\n};\n\nfunction normalizeCase','new case list','case list');
  assert.equal(after,['before','new case list','};','','function normalizeCase','after'].join(nl));
  assert.throws(()=>span(source+nl+source,'  // The backend has no "list my cases" endpoint yet,','\n};\n\nfunction normalizeCase','new case list','case list'),/anchors changed/);
 }
});
