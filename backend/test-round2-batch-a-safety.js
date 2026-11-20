"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const source=fs.readFileSync(path.join(__dirname,'create-test-staff.js'),'utf8');
test('T1 seeder cannot override production safety with --force',()=>{
  assert.match(source,/args\.includes\("--force"\)/);
  assert.match(source,/process\.exit\(1\)/);
  assert.doesNotMatch(source,/unless --force/i);
});
test('T1 seeder requires exact local disposable database confirmation',()=>{
  assert.match(source,/ROUND2_CONFIRM_DISPOSABLE_SEED/);
  assert.match(source,/PRE_ER_TEST_DATABASE_NAME/);
  assert.match(source,/DB_SSL/);
  assert.match(source,/inet_server_addr/);
  assert.match(source,/DATABASE_URL/);
});
test('T1 seeder is all-or-nothing transaction and never prints password',()=>{
  assert.match(source,/await client\.query\("BEGIN"\)/);
  assert.match(source,/await client\.query\("COMMIT"\)/);
  assert.match(source,/await client\.query\("ROLLBACK"\)/);
  assert.doesNotMatch(source,/console\.log\(password\)|console\.table\(password\)/);
});
test('T1 --force rejection occurs before loading dotenv or connecting to database',()=>{
  const res=spawnSync(process.execPath,[path.join(__dirname,'create-test-staff.js'),'--force'],{encoding:'utf8',cwd:__dirname});
  assert.notEqual(res.status,0);
  assert.match(res.stderr,/SAFETY STOP/);
});
