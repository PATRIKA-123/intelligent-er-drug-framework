'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {preflight,assertServer,migrationFiles}=require('../scripts/audit1-batch10-local');
const env={DB_HOST:'localhost',DB_PORT:'5432',DB_NAME:'intelligent_er_drug_test',PRE_ER_TEST_DATABASE_NAME:'intelligent_er_drug_test',DB_USER:'postgres',DB_PASSWORD:'test-only',DB_SSL:'false'};
test('B04 valid local test environment accepted',()=>assert.equal(preflight(env,{apply:false,confirmed:false}),true));
test('B04 refuses accidental apply without confirmation',()=>assert.throws(()=>preflight(env,{apply:true,confirmed:false}),/confirm-disposable/));
test('B04 refuses production and remote targets',()=>{
 for(const e of [{...env,NODE_ENV:'production'},{...env,DB_HOST:'remote.neon.tech'},{...env,DB_NAME:'neondb',PRE_ER_TEST_DATABASE_NAME:'neondb'},{...env,DB_SSL:'true'}])assert.throws(()=>preflight(e),/SAFETY STOP/);
});
test('B04 connected database and version checked',()=>{
 assert.doesNotThrow(()=>assertServer({database_name:env.DB_NAME,server_address:'127.0.0.1',version_num:'180004'}));
 assert.doesNotThrow(()=>assertServer({database_name:env.DB_NAME,server_address:'127.0.0.1/32',version_num:'180004'}));
 assert.doesNotThrow(()=>assertServer({database_name:env.DB_NAME,server_address:'::1/128',version_num:'180004'}));
 assert.doesNotThrow(()=>assertServer({database_name:env.DB_NAME,server_address:'::ffff:127.0.0.1',version_num:'180004'}));
 assert.doesNotThrow(()=>assertServer({database_name:env.DB_NAME,server_address:'0:0:0:0:0:ffff:7f00:1',version_num:'180004'}));
 for(const address of ['192.168.1.5','10.1.2.3','8.8.8.8','::1/64','127.0.0.1/8','::ffff:8.8.8.8/128'])
   assert.throws(()=>assertServer({database_name:env.DB_NAME,server_address:address,version_num:'180004'}),/server is not local/);
 assert.throws(()=>assertServer({database_name:'neondb',server_address:null,version_num:'180004'}),/unexpected database/);
});
test('B04 migration SQL files exist and are checksum-ready',()=>{
 const f=migrationFiles();assert.equal(f.length,3);f.forEach(x=>assert.equal(x.sha.length,64));
});
