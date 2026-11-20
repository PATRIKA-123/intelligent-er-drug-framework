"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const src=p=>fs.readFileSync(path.join(root,p),"utf8");
const {statusForRun,failureCode}=require("./services/screeningRunLedger");
const {transformAlert,transformSummary}=require("../scripts/b13-patch-services");
const {safety,local}=require("../scripts/b13-local-migrate");
const row={engine_run_id:"run-1",engine_version:"phase6-v1",started_at:new Date(),completed_at:new Date(),status:"COMPLETE_FINDINGS",drug_finding_count:2,alert_count:3};
test("B13 represents complete with findings, zero findings, failed, running and stale",()=>{
 assert.equal(statusForRun(row,"drug").status,"COMPLETE_FINDINGS");
 assert.equal(statusForRun({...row,status:"COMPLETE_ZERO_FINDINGS",drug_finding_count:0,alert_count:0},"alert").status,"COMPLETE_ZERO_FINDINGS");
 assert.equal(statusForRun({...row,status:"FAILED",failure_code:"SCREENING_FAILED"},"drug").status,"FAILED");
 assert.equal(statusForRun({...row,status:"RUNNING",completed_at:null},"drug").status,"RUNNING");
 assert.equal(statusForRun({...row,engine_version:"old"},"drug").status,"STALE");
 assert.equal(statusForRun({...row,status:"RUNNING",started_at:new Date(0)},"drug").status,"STALE");
});
test("B13 failed runs do not store raw errors or clinical data",()=>{
 assert.equal(failureCode(new Error("patient clinical confidential text")),"SCREENING_FAILED");
 assert.equal(failureCode({code:"INCOMPLETE_MEDICATION_MAPPING"}),"INCOMPLETE_MEDICATION_MAPPING");
});
test("B13 runs require exact local test target and confirmation",()=>{
 const env={DB_NAME:"intelligent_er_drug_test",PRE_ER_TEST_DATABASE_NAME:"intelligent_er_drug_test",DB_HOST:"localhost",DB_SSL:"false",DB_USER:"postgres",DB_PASSWORD:"placeholder",B13_CONFIRM_LOCAL_TEST:"intelligent_er_drug_test"};
 assert.deepEqual(safety(env,true),[]);
 assert.ok(safety({...env,DB_HOST:"remote.neon.tech"},true).length);
 assert.ok(safety({...env,DB_NAME:"neondb"},true).length);
 assert.ok(safety({...env,NODE_ENV:"production"},true).length);
 assert.ok(safety({...env,B13_CONFIRM_LOCAL_TEST:""},true).length);
 for(const ip of ["::1/128","127.0.0.1/32","::ffff:127.0.0.1/128"])assert.equal(local(ip),true);
});
test("B13 SQL creates a durable partial unique index and preserves results",()=>{
 const s=src("migrations/20261120_005_screening_runs.sql");
 assert.match(s,/CREATE TABLE IF NOT EXISTS public\.screening_runs/);
 assert.match(s,/WHERE status = 'RUNNING'/);
 assert.doesNotMatch(s,/DELETE FROM|TRUNCATE/i);
});
test("B13 patcher refuses malformed service anchors",()=>{
 assert.throws(()=>transformAlert("no relevant service"),/Expected unique anchor/);
 assert.throws(()=>transformSummary("no relevant service"),/Expected unique anchor/);
});
test("B13 run records survive rollback and reflect failure outside transaction",()=>{
 const a=src("scripts/b13-patch-services.js");
 assert.match(a,/await screeningLedger\.finishRun/);
 assert.match(a,/await screeningLedger\.failRun/);
 assert.match(a,/transactionStarted = false/);
});
