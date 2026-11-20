'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const fs=require('node:fs');
const {checkArgs,guard,loadSQL,CONFIRM,FILES}=require('../scripts/round2-migrations-apply-local.cjs');
test('requires exact invocation',()=>{assert.throws(()=>checkArgs(['--apply']));assert.throws(()=>checkArgs(['--dry-run',CONFIRM]));assert.doesNotThrow(()=>checkArgs(['--apply',CONFIRM]));});
test('rejects production, remote, ambiguous and unconfirmed targets',()=>{
 const base={ROUND2_STAGING_APPLY:'YES',ROUND2_STAGING_DB_NAME:'intelligent_er_drug_test',ROUND2_DISPOSABLE_DB_CONFIRMED:'YES',DB_HOST:'localhost',DB_NAME:'intelligent_er_drug_test',DB_PASSWORD:'test-password'};
 assert.doesNotThrow(()=>guard(base));
 for(const bad of [{DB_HOST:'example.org'},{DATABASE_URL:'postgres://x'},{PGHOST:'remote'},{NODE_ENV:'production'},{DB_SSL:'true'},{DB_NAME:'postgres'},{ROUND2_DISPOSABLE_DB_CONFIRMED:'NO'},{ROUND2_STAGING_APPLY:'NO'}])assert.throws(()=>guard({...base,...bad}));
});
test('migration bodies pinned, ordered and contain no transaction termination',()=>{
 const dir=path.resolve(__dirname,'../migrations');
 assert.ok(fs.existsSync(dir),'Repository migrations directory must exist');
 const migrations=loadSQL(dir);assert.equal(migrations.length,4);
 for (const item of migrations) assert.doesNotMatch(item.sql.replace(/--[^\n]*/g,''),/\bCOMMIT\b/i);
});
test('runner has one explicit SQL COMMIT, rollback on errors, and postflight',()=>{
 const src=fs.readFileSync(path.resolve(__dirname,'../scripts/round2-migrations-apply-local.cjs'),'utf8');
 assert.match(src,/await client\.query\('COMMIT'\)/);assert.match(src,/await client\.query\('ROLLBACK'\)/);assert.match(src,/postflight\(client/);assert.match(src,/migration_history/);
});
