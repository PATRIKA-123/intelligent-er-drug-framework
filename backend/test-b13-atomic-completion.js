"use strict";
const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {patch}=require('./test-b13-atomic-helpers');
const base=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
// Works both before and after the patch and never touches the DB.
test('B13 success ledger update is in clinical transaction before commit',()=>{
  const out=patch(read('backend/services/alertService.js'),read('backend/services/screeningRunLedger.js'));
  const s=out.alert, a=s.indexOf('// B13_ATOMIC_COMPLETION'),b=s.indexOf('await screeningLedger.finishRun(',a),c=s.indexOf('await client.query("COMMIT")',a),d=s.indexOf('runRecorded = false;',a);
  assert.ok(a>=0 && b>a && c>b && d>c);
  assert.match(s.slice(b,c),/insertedRows\.length, client\)/);
});
test('B13 ledger accepts same transaction client and leaves failRun outside',()=>{
 const out=patch(read('backend/services/alertService.js'),read('backend/services/screeningRunLedger.js'));
 assert.match(out.ledger,/async function finishRun\(id, status, drugCount, alertCount, client = pool\)/);
 const x=out.ledger.split('async function failRun')[0];assert.match(x,/const r = await client\.query\(/);
 assert.match(out.ledger.split('async function failRun')[1],/await pool\.query\(/);
});
test('B13 atomic patch refuses malformed service source',()=>{
 assert.throws(()=>patch('garbage',read('backend/services/screeningRunLedger.js')),/expected once/);
});
test('B13 atomic patch is idempotent',()=>{
 const a=patch(read('backend/services/alertService.js'),read('backend/services/screeningRunLedger.js'));
 const b=patch(a.alert,a.ledger);assert.equal(b.already,true);assert.equal(b.alert,a.alert);
});
