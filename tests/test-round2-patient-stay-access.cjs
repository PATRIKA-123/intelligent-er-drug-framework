'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const s=fs.readFileSync(path.join(process.cwd(),'backend','services','accessPolicy.js'),'utf8');
test('single-stay PATIENT access requires explicit verified visit grant',()=>{
 const branch=s.match(/if \(user\.role === "PATIENT"\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  if \(user\.role === "PARAMEDIC"\)/);
 assert.ok(branch,'PATIENT branch missing');
 assert.match(branch[1],/FROM public\.patient_visit_access a/);
 assert.match(branch[1],/a\.user_id = \$1 AND a\.stay_id = \$2/);
 assert.doesNotMatch(branch[1],/users u|u\.patient_id/);
});
test('stay list PATIENT scope uses verified visit grants, not legacy demographic joins',()=>{
 const branch=s.match(/case "PATIENT":\s*return \{([\s\S]*?)\r?\n\s*\};/);
 assert.ok(branch,'PATIENT list branch missing');
 assert.match(branch[1],/s\.stay_id IN/);
 assert.match(branch[1],/FROM public\.patient_visit_access a/);
 assert.match(branch[1],/a\.user_id = \$1/);
 assert.doesNotMatch(branch[1],/users u|p\.subject_id/);
});
