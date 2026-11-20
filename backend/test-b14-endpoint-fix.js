"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../scripts/b14-local-migrate.js'),'utf8');
const fn=src.match(/function isVerifiedLocalEndpoint\(row\)\{[\s\S]*?\n\}/);
assert.ok(fn,'B14 endpoint helper missing');
const isVerifiedLocalEndpoint=vm.runInNewContext('('+fn[0]+')');
test('B14 accepts only PostgreSQL-verified loopback on exact test database',()=>{
 assert.equal(isVerifiedLocalEndpoint({db:'intelligent_er_drug_test',server:'::ffff:127.0.0.1',loopback:true}),true);
 assert.equal(isVerifiedLocalEndpoint({db:'intelligent_er_drug_test',server:'127.0.0.1',loopback:true}),true);
 for(const obj of [
  {db:'intelligent_er_drug_test',server:'10.0.0.5',loopback:false},
  {db:'intelligent_er_drug_test',server:null,loopback:false},
  {db:'production',server:'127.0.0.1',loopback:true},
  {db:'intelligent_er_drug_test',server:'::ffff:127.0.0.1',loopback:'true'},
 ])assert.equal(isVerifiedLocalEndpoint(obj),false);
});
test('B14 query explicitly checks IPv4, IPv6 and mapped loopback CIDRs',()=>{
 for(const cidr of ['127.0.0.0/8','::1/128','::ffff:127.0.0.0/104'])assert.ok(src.includes(cidr));
 assert.match(src,/COALESCE\(/);
 assert.match(src,/if\(!isVerifiedLocalEndpoint\(actual\)\)/);
});
