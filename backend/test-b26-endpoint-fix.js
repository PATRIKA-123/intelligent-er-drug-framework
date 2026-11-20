'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {localHost,preflight}=require('../scripts/b26-local-migrate');
test('B26 accepts PostgreSQL IPv4/IPv6 loopback address formats',()=>{
  for(const address of ['localhost','127.0.0.1','127.0.0.1/32','127.2.3.4','::1','::1/128','0:0:0:0:0:0:0:1','::ffff:127.0.0.1','::ffff:127.0.0.1/128','::ffff:7f00:1','::ffff:7f00:1/128']) assert.equal(localHost(address),true,address);
});
test('B26 still rejects remote and malformed endpoints',()=>{
  for(const address of ['192.168.1.2','8.8.8.8','localhost.example.com','example.org','::2','2001:db8::1','::ffff:192.168.1.1','::ffff:c0a8:1','',null]) assert.equal(localHost(address),false,String(address));
});
test('B26 migration preflight remains restricted to exact disposable target',()=>{
  const e={DB_HOST:'localhost',DB_NAME:'intelligent_er_drug_test',PRE_ER_TEST_DATABASE_NAME:'intelligent_er_drug_test',B26_CONFIRM_LOCAL_TEST:'intelligent_er_drug_test',DB_SSL:'false'};
  assert.deepEqual(preflight(e),[]);
  assert.notDeepEqual(preflight({...e,DB_HOST:'192.168.1.2'}),[]);
  assert.notDeepEqual(preflight({...e,DB_SSL:'true'}),[]);
  assert.notDeepEqual(preflight({...e,NODE_ENV:'production'}),[]);
  assert.notDeepEqual(preflight({...e,DB_NAME:'other_test'}),[]);
});
