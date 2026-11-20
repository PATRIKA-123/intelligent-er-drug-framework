#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
function replaceOnce(s, pattern, replacement, label) {
  const matches=[...s.matchAll(new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'))];
  if(matches.length!==1) throw Error(`B22 SAFETY STOP: expected exactly one ${label}, found ${matches.length}`);
  return s.replace(pattern,replacement);
}
function patchAlert(s) {
  if(s.includes('B22_APPEND_ONLY_ALERT')) return s;
  s=replaceOnce(s,/\/\/ Delete old alerts first because they reference safety-result rows\.\s*const preDeleteResult = await client\.query\(\s*`DELETE FROM clinical_alerts WHERE stay_id = \$1`,\s*\[stayId\]\s*\);/,`// B22_APPEND_ONLY_ALERT: preserve alerts from previous runs.\n    const preDeleteResult = { rowCount: 0 };`,'alert DELETE block');
  s=replaceOnce(s,/FROM drug_safety_results\s+WHERE stay_id = \$1`,\s*\[stayId\]/, "FROM drug_safety_results\n       WHERE stay_id = $1 AND engine_run_id = $2`, [stayId, engineRunId]", "drug safety current-run query");
  return s;
}
function patchDecision(s) {
  if(s.includes('B22_APPEND_ONLY_DECISION')) return s;
  return replaceOnce(s,/const deleteResult = await client\.query\(\s*"DELETE FROM decision_support_results WHERE stay_id = \$1",\s*\[stayId\]\s*\);/,`// B22_APPEND_ONLY_DECISION: previous decision runs remain immutable history.\n    const deleteResult = { rowCount: 0 };`,'decision DELETE block');
}
function patchDrug(s) {
  if(s.includes('B22_APPEND_ONLY_DRUG')) return s;
  return replaceOnce(s,/\/\/ Replace this stay's current snapshot inside the active transaction\.\s*const deleteResult = await client\.query\(\s*`DELETE FROM drug_safety_results\s+WHERE stay_id = \$1`,\s*\[stayId\]\s*\);/,`// B22_APPEND_ONLY_DRUG: retain drug-safety results from previous engine runs.\n    const deleteResult = { rowCount: 0 };`,'drug safety DELETE block');
}
function patchSummary(s) {
  if(s.includes('B22_CURRENT_RUN_SUMMARY')) return s;
  // Do not change decision selection: last committed decision remains the most recent completed clinical snapshot.
  s=replaceOnce(s,/FROM drug_safety_results\s+WHERE stay_id = \$1\s+ORDER BY safety_result_id`,\s*\[stayId\]/, "FROM drug_safety_results\n     WHERE stay_id = $1 AND engine_run_id = $2\n     ORDER BY safety_result_id`, [stayId, decision?.engine_run_id ?? null]", "clinical summary safety selection");
  s=replaceOnce(s,/FROM clinical_alerts\s+WHERE stay_id = \$1\s+ORDER BY alert_id`,\s*\[stayId\]/, "FROM clinical_alerts\n     WHERE stay_id = $1 AND engine_run_id = $2\n     ORDER BY alert_id`, [stayId, decision?.engine_run_id ?? null]", "clinical summary alert selection");
  s=replaceOnce(s,/const safetyResult = await pool\.query\(/, '// B22_CURRENT_RUN_SUMMARY: never mix findings from different engine runs.\n  const safetyResult = await pool.query(', 'clinical summary marker');
  return s;
}
const patches={
 'backend/services/alertService.js':patchAlert,
 'backend/services/decisionSupportService.js':patchDecision,
 'backend/services/drugSafetyService.js':patchDrug,
 'backend/services/clinicalSummaryService.js':patchSummary,
};
function run(){
  const args=process.argv.slice(2);
  if(args.length!==1 || !['--check','--apply'].includes(args[0])) throw Error('Usage: node scripts/b22-append-only-patch.js --check|--apply');
  const results=Object.entries(patches).map(([p,fn])=>{
    const dest=path.join(root,p), before=fs.readFileSync(dest,'utf8'), after=fn(before);
    return {p,dest,before,after};
  });
  if(args[0]==='--check') {console.log('B22_PATCH_PREFLIGHT_OK',results.filter(x=>x.before!==x.after).map(x=>x.p));return;}
  // preflight all four before making any edits; write only files whose contents change.
  const changed=[];
  try{for(const r of results){if(r.before!==r.after){fs.writeFileSync(r.dest,r.after);changed.push(r);}}}
  catch(e){for(const r of changed.reverse())fs.writeFileSync(r.dest,r.before);throw e;}
  console.log('B22_APPEND_ONLY_PATCH_APPLIED',changed.length,'files changed');
}
if(require.main===module){try{run()}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={patchAlert,patchDecision,patchDrug,patchSummary};
