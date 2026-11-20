'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { guards } = require('../scripts/round2-migrations-staging.cjs');
const e={ROUND2_STAGING_READONLY:'YES',ROUND2_STAGING_DB_NAME:'intelligent_er_drug_test',DB_HOST:'localhost',DB_NAME:'intelligent_er_drug_test',DB_PASSWORD:'test'};
test('local staging guard rejects remote targets and ambiguous config', () => {
  assert.doesNotThrow(()=>guards(e));
  for(const [k,v] of [['DB_HOST','192.168.1.10'],['DB_NAME','real_patients'],['ROUND2_STAGING_DB_NAME','real_patients'],['DATABASE_URL','postgres://localhost/real_patients'],['PGHOST','remote'],['PGSSLMODE','require'],['NODE_ENV','production'],['DB_SSL','true']]) {
    assert.throws(()=>guards({...e,[k]:v}), `${k} must be refused`);
  }
});
test('server-side address is informational, not treated as connection target',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../scripts/round2-migrations-staging.cjs'),'utf8');
  assert.match(source,/inet_server_addr\(\)/);
  assert.doesNotMatch(source,/throw new Error\('Server is not local loopback'\)/);
  assert.match(source,/info\.db !== EXPECTED_DB \|\| info\.read_only !== 'on'/);
});
test('migration runner provides no permanent apply mode',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../scripts/round2-migrations-staging.cjs'),'utf8');
  assert.match(source, /\['--preflight','--dry-run'\]/);
  assert.match(source, /await client\.query\('ROLLBACK'\)/);
});
