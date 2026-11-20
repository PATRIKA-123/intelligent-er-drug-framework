'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {guards,readMigrations}=require('../scripts/round2-migrations-staging.cjs');
const path=require('node:path');
const e={ROUND2_STAGING_READONLY:'YES',ROUND2_STAGING_DB_NAME:'intelligent_er_drug_test',DB_HOST:'localhost',DB_NAME:'intelligent_er_drug_test',DB_PASSWORD:'test'};
test('local test DB requires exact explicit guard',()=>{assert.doesNotThrow(()=>guards(e));for(const [k,v] of [['DB_HOST','remote'],['DB_NAME','production'],['DATABASE_URL','postgres://x'],['NODE_ENV','production'],['DB_SSL','true']])assert.throws(()=>guards({...e,[k]:v}))});
test('reads exactly migrations 009-012',()=>{let x=readMigrations(path.resolve(process.cwd(),'migrations'));assert.equal(x.length,4)});
