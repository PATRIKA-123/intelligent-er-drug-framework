'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {patchAlert,patchDecision,patchDrug,patchSummary}=require('../scripts/b22-append-only-patch');
test('B22: removes all three dangerous deletes while retaining row counts',()=>{
 const a=`// Delete old alerts first because they reference safety-result rows.\n const preDeleteResult = await client.query(\n  \`DELETE FROM clinical_alerts WHERE stay_id = $1\`,\n  [stayId]\n );\n FROM drug_safety_results\n WHERE stay_id = $1\`,\n [stayId]`;
 const d=`const deleteResult = await client.query("DELETE FROM decision_support_results WHERE stay_id = $1", [stayId]);`;
 const g=`// Replace this stay's current snapshot inside the active transaction.\n const deleteResult = await client.query(\n \`DELETE FROM drug_safety_results\n WHERE stay_id = $1\`,\n [stayId]\n );`;
 assert.doesNotMatch(patchAlert(a),/DELETE FROM clinical_alerts/);
 assert.match(patchAlert(a),/engine_run_id = \$2/);
 assert.doesNotMatch(patchDecision(d),/DELETE FROM decision_support_results/);
 assert.doesNotMatch(patchDrug(g),/DELETE FROM drug_safety_results/);
 assert.equal(patchAlert(patchAlert(a)),patchAlert(a));
 assert.equal(patchDecision(patchDecision(d)),patchDecision(d));
 assert.equal(patchDrug(patchDrug(g)),patchDrug(g));
});
test('B22: summary only reads findings for the decision run',()=>{
 const s='const safetyResult = await pool.query(`SELECT 1 FROM drug_safety_results WHERE stay_id = $1 ORDER BY safety_result_id`, [stayId]);\nconst alertsResult = await pool.query(`SELECT 1 FROM clinical_alerts WHERE stay_id = $1 ORDER BY alert_id`, [stayId]);';
 const out=patchSummary(s);
 assert.equal((out.match(/engine_run_id = \$2/g)||[]).length,2);
 assert.equal((out.match(/decision\?\.engine_run_id \?\? null/g)||[]).length,2);
 assert.equal(patchSummary(out),out);
});
test('B22: refuse changed SQL instead of silently skipping',()=>{
 assert.throws(()=>patchDecision('SELECT 1'),/SAFETY STOP/);
 assert.throws(()=>patchSummary('SELECT 1'),/SAFETY STOP/);
});
