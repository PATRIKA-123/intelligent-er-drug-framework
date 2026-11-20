'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {patch}=require('./test-b13-atomic-helpers');
const source=`function run() {
    // One commit for all writes.
    await client.query("COMMIT");
        transactionStarted = false;
    // Completion happens AFTER clinical transaction commits. A failed screening
    // cannot erase its own FAILED record via ROLLBACK.
    const drugCount = Number(decisionResult.drug_safety?.inserted_count || 0);
    await screeningLedger.finishRun(engineRunId,
      drugCount + insertedRows.length > 0 ? "COMPLETE_FINDINGS" : "COMPLETE_ZERO_FINDINGS",
      drugCount, insertedRows.length);
    runRecorded = false;
}
`;
const ledger=`async function finishRun(id, status, drugCount, alertCount) {
  const r = await pool.query('UPDATE screening_runs', [id]);
  if(r.rowCount !== 1) throw Error('failed');
}
async function failRun(id, err) {
  return await pool.query('UPDATE screening_runs', [id]);
}
`;
test('B13 matches source with actual checkout whitespace',()=>{
  const result=patch(source,ledger);
  assert.match(result.alert,/await screeningLedger\.finishRun\([\s\S]*?insertedRows\.length, client\);[\s\S]*?await client\.query\("COMMIT"\)/);
  assert.match(result.ledger,/async function finishRun\(id, status, drugCount, alertCount, client = pool\)/);
  assert.equal(patch(result.alert,result.ledger).already,true);
});
test('B13 accepts CRLF',()=>{
  assert.match(patch(source.replace(/\n/g,'\r\n'),ledger.replace(/\n/g,'\r\n')).alert,/B13_ATOMIC_COMPLETION/);
});
test('B13 rejects altered transaction semantics',()=>{
  assert.throws(()=>patch(source.replace('await client.query("COMMIT")','await client.query("ROLLBACK")'),ledger),/changed; manual review required/);
});
test('B13 rejects incomplete ledger helper',()=>{
  assert.throws(()=>patch(source,'bad'),/expected once/);
});
