'use strict';const test=require('node:test');const assert=require('node:assert/strict');
// Standalone text-level assertion of defensive guards; avoids needing DB dependencies in offline CI.
const fs=require('node:fs');const s=fs.readFileSync(require('node:path').join(__dirname,'audit1-b10-readonly-verification.js'),'utf8');
test('read-only transaction is explicit',()=>assert.match(s,/BEGIN TRANSACTION READ ONLY/));
test('local-only DB safeguards present',()=>{assert.match(s,/PRE_ER_TEST_DATABASE_NAME/);assert.match(s,/inet_server_addr/);});
test('no UPDATE, DELETE, INSERT commands in verification script',()=>{
 const sqlCalls=[...s.matchAll(/db\.query\((`[^`]*`|'[^']*'|"[^"]*")/g)].map(x=>x[1]);
 for(const sql of sqlCalls)assert.doesNotMatch(sql,/\b(UPDATE|DELETE|INSERT|TRUNCATE|DROP|ALTER)\b/i);
});
