"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {transformAlert, transformSummary} = require("../scripts/b13-patch-services");
const {safety} = require("../scripts/b13-local-migrate");
const fs = require("node:fs"), path = require("node:path");
const repo = path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(repo,p),"utf8");
test("B13 patcher accepts checked-out service whitespace and remains idempotent",()=>{
  for(const [file,transform] of [["backend/services/alertService.js",transformAlert],["backend/services/clinicalSummaryService.js",transformSummary]]){
    const original=read(file);
    const patched=transform(original);
    assert.match(patched,/screeningLedger/);
    assert.equal(transform(patched),patched);
  }
});
test("B13 patcher accepts newline variants",()=>{
  const s=read("backend/services/alertService.js");
  const changed=s.replace(/const client = await pool\.connect\(\);\s+let transactionStarted = false;/, "const client = await pool.connect();\r\n\r\n    let transactionStarted = false;");
  assert.match(transformAlert(changed),/await screeningLedger\.beginRun/);
});
test("B13 migration accepts unset SSL as plaintext but rejects SSL true",()=>{
  const env={DB_NAME:"intelligent_er_drug_test",PRE_ER_TEST_DATABASE_NAME:"intelligent_er_drug_test",DB_HOST:"localhost",DB_USER:"postgres",DB_PASSWORD:"test"};
  assert.deepEqual(safety(env,false),[]);
  assert.deepEqual(safety({...env,DB_SSL:"false"},false),[]);
  assert.ok(safety({...env,DB_SSL:"true"},false).length);
  assert.ok(safety({...env,DB_HOST:"remote.example"},false).length);
});
