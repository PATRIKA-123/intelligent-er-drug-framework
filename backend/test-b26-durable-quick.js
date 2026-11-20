'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const {patch}=require('../scripts/b26-patch-audit');
const {preflight}=require('../scripts/b26-local-migrate');
test('B26 patch is idempotent and preserves redacted original event',()=>{const src=read('backend/middleware/clinicalAudit.js');const once=patch(src).content;assert.equal(patch(once).content,once);assert.match(once,/persistAuditEvent\(e\)/);assert.doesNotMatch(read('backend/services/durableClinicalAudit.js'),/req\.|e\.headers|e\.body/)});
test('B26 audit schema is append-only with idempotent event IDs',()=>{let sql=read('migrations/20261120_007_clinical_audit_events.sql');assert.match(sql,/BEFORE UPDATE OR DELETE/);assert.match(read('backend/services/durableClinicalAudit.js'),/ON CONFLICT \(audit_id\) DO NOTHING/)});
test('B26 refuses remote or production test targets',()=>{let base={DB_HOST:'localhost',DB_NAME:'intelligent_er_drug_test',PRE_ER_TEST_DATABASE_NAME:'intelligent_er_drug_test',B26_CONFIRM_LOCAL_TEST:'intelligent_er_drug_test',DB_SSL:'false'};assert.deepEqual(preflight(base),[]);assert.ok(preflight({...base,DB_HOST:'neon.example.com'}).length);assert.ok(preflight({...base,NODE_ENV:'production'}).length);assert.ok(preflight({...base,DB_NAME:'production'}).length)});
