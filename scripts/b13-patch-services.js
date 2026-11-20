#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const files=["backend/services/alertService.js","backend/services/clinicalSummaryService.js"];
function once(s,a,b){
  if(s.includes(b))return s;
  // Match the exact token sequence, tolerating differences in whitespace.
  // Preserve fail-closed behavior on absent or ambiguous anchors.
  const quote=(x)=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const pattern=new RegExp(a.trim().split(/\s+/).map(quote).join("\\s+"),"g");
  const matches=[...s.matchAll(pattern)];
  if(matches.length!==1)throw Error(`Expected unique anchor, found ${matches.length}: ${a.slice(0,80)}`);
  return s.replace(pattern,()=>b);
}
function transformAlert(s){
  s=once(s,'const pool = require("../db");',`const pool = require("../db");
const screeningLedger = require("./screeningRunLedger");`);
  s=once(s,'  const client = await pool.connect();\n  let transactionStarted = false;',`  // B13: durable RUNNING row is committed independently of clinical transaction.
  await screeningLedger.beginRun(stayId, engineRunId, engineVersion);
  let runRecorded = true;
  let client;
  try { client = await pool.connect(); }
  catch (err) {
    try { await screeningLedger.failRun(engineRunId, err); }
    catch (ledgerErr) { console.error("B13 run ledger failure:", ledgerErr.message); }
    throw err;
  }
  let transactionStarted = false;`);
  s=once(s,'    transactionStarted = false;\n\n    \nreturn {',`    transactionStarted = false;
    // Completion happens AFTER clinical transaction commits. A failed screening
    // cannot erase its own FAILED record via ROLLBACK.
    const drugCount = Number(decisionResult.drug_safety?.inserted_count || 0);
    await screeningLedger.finishRun(engineRunId,
      drugCount + insertedRows.length > 0 ? "COMPLETE_FINDINGS" : "COMPLETE_ZERO_FINDINGS",
      drugCount, insertedRows.length);
    runRecorded = false;

return {`);
  s=once(s,'    throw err;\n  } finally {\n    client.release();',`    if (runRecorded) {
      try { await screeningLedger.failRun(engineRunId, err); }
      catch (ledgerErr) { console.error("B13 run ledger failure:", ledgerErr.message); }
    }
    throw err;
  } finally {
    client.release();`);
  return s;
}
function transformSummary(s){
  s=once(s,'const { classifySnapshot } = require("./screeningStatus");',`const { classifySnapshot } = require("./screeningStatus");
const screeningLedger = require("./screeningRunLedger");`);
  s=once(s,'  const screening = classifySnapshot(decision, safetyResult.rows, CURRENT_ENGINE_VERSION);',`  const historical = classifySnapshot(decision, safetyResult.rows, CURRENT_ENGINE_VERSION);
  const latest = await screeningLedger.latestRun(stayId);
  const screening = screeningLedger.statusForRun(latest, "drug", CURRENT_ENGINE_VERSION) || historical;`);
  s=once(s,'  const alertScreening = classifySnapshot(decision, alertsResult.rows, CURRENT_ENGINE_VERSION);',`  const alertScreening = screeningLedger.statusForRun(latest, "alert", CURRENT_ENGINE_VERSION) ||
    classifySnapshot(decision, alertsResult.rows, CURRENT_ENGINE_VERSION);`);
  s=once(s,'  const computed = Boolean(decision && decision.engine_run_id && decision.engine_version === CURRENT_ENGINE_VERSION);',`  const computed = Boolean(decision && decision.engine_run_id && decision.engine_version === CURRENT_ENGINE_VERSION &&
    (!latest || (latest.engine_run_id === decision.engine_run_id && latest.status.startsWith("COMPLETE_"))));`);
  s=once(s,'    decision_support: {\n      computed_by_current_engine: computed,',`    screening_run: latest ? screeningLedger.statusForRun(latest, "drug", CURRENT_ENGINE_VERSION) : null,
    decision_support: {
      computed_by_current_engine: computed,`);
  return s;
}
function main(){
  const original=files.map(f=>fs.readFileSync(path.join(root,f),"utf8"));
  const out=[transformAlert(original[0]),transformSummary(original[1])];
  if(process.argv.includes("--check")){console.log("B13_PATCH_PREFLIGHT_OK");return;}
  if(!process.argv.includes("--apply"))throw Error("Use --check or --apply");
  // No partial writes if preflight of either file failed.
  for(let i=0;i<files.length;i++)fs.writeFileSync(path.join(root,files[i]),out[i]);
  console.log("B13_SERVICE_PATCH_APPLIED");
}
if(require.main===module){try{main()}catch(e){console.error(e.message);process.exitCode=1}}
module.exports={transformAlert,transformSummary};
