'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateServerVersion}=require('./b04-bootstrap-test-db');

const schema='-- Dumped from database version 18.7 (a21afb5)\n';

test('requires a target server at least as new as the schema export',()=>{
  assert.throws(
    ()=>validateServerVersion(schema,180006,'18.6'),
    /Schema export is from PostgreSQL 18\.7; require PostgreSQL 18\.7 or newer \(connected server is 18\.6\)/
  );
  assert.doesNotThrow(()=>validateServerVersion(schema,180007,'18.7'));
  assert.doesNotThrow(()=>validateServerVersion(schema,190000,'19.0'));
});

test('rejects schema exports with missing or unsupported source version',()=>{
  assert.throws(()=>validateServerVersion('-- schema export\n',180007,'18.7'),/Could not determine PostgreSQL source version/);
  assert.throws(
    ()=>validateServerVersion('-- Dumped from database version 17.6\n',180007,'18.7'),
    /require PostgreSQL 18 or newer/
  );
});
