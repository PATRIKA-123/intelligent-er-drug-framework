"use strict";
function onlyOnce(s, a, label){const n=s.split(a).length-1;if(n!==1)throw Error(`${label}: expected once, found ${n}`);}
function patch(alert,ledger){
  const marker='// B13_ATOMIC_COMPLETION';
  if(alert.includes(marker)) {
    if (!ledger.includes('async function finishRun(id, status, drugCount, alertCount, client = pool)')) throw Error('Atomic marker exists but ledger helper is not patched');
    return {alert,ledger,already:true};
  }
  const before=`    // One commit for all writes.\n    await client.query("COMMIT");\n    transactionStarted = false;\n    // Completion happens AFTER clinical transaction commits. A failed screening\n    // cannot erase its own FAILED record via ROLLBACK.\n    const drugCount = Number(decisionResult.drug_safety?.inserted_count || 0);\n    await screeningLedger.finishRun(engineRunId,\n      drugCount + insertedRows.length > 0 ? "COMPLETE_FINDINGS" : "COMPLETE_ZERO_FINDINGS",\n      drugCount, insertedRows.length);\n    runRecorded = false;`;
  const after=`    // B13_ATOMIC_COMPLETION: commit the success ledger update WITH clinical results.\n    // The separate RUNNING row remains available if the clinical transaction rolls back.\n    const drugCount = Number(decisionResult.drug_safety?.inserted_count || 0);\n    await screeningLedger.finishRun(engineRunId,\n      drugCount + insertedRows.length > 0 ? "COMPLETE_FINDINGS" : "COMPLETE_ZERO_FINDINGS",\n      drugCount, insertedRows.length, client);\n    await client.query("COMMIT");\n    transactionStarted = false;\n    runRecorded = false;`;
  // Compare the complete, known transaction sequence without treating
  // indentation or CRLF as a code change. All expected statements must appear
  // exactly once and in the original order, or the patch refuses to write.
  const firstAnchor='// One commit for all writes.';
  const finalAnchor='runRecorded = false;';
  onlyOnce(alert,firstAnchor,'B13 success transaction start');
  onlyOnce(alert,finalAnchor,'B13 success transaction end');
  const begin=alert.indexOf(firstAnchor);
  const finish=alert.indexOf(finalAnchor,begin)+finalAnchor.length;
  if(finish<begin) throw Error('B13 success transaction markers out of order');
  const actual=alert.slice(begin,finish);
  const equivalent=x=>x.replace(/\s+/g,' ').trim();
  if(equivalent(actual)!==equivalent(before)) {
    throw Error('B13 success transaction sequence changed; manual review required');
  }
  const from='async function finishRun(id, status, drugCount, alertCount) {';
  const to='async function finishRun(id, status, drugCount, alertCount, client = pool) {';
  onlyOnce(ledger,from,'B13 finishRun declaration');
  const start=ledger.indexOf(from);const end=ledger.indexOf('async function failRun',start);
  if(end<0)throw Error('B13 failRun missing');
  const section=ledger.slice(start,end);
  onlyOnce(section,'const r = await pool.query(', 'B13 finishRun query');
  ledger=ledger.slice(0,start)+section.replace(from,to).replace('const r = await pool.query(','const r = await client.query(')+ledger.slice(end);
  alert=alert.slice(0,begin)+after+alert.slice(finish);
  return {alert,ledger,already:false};
}
module.exports={patch};
