'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {patch}=require('../scripts/b14-patch-normalizer');
const source=fs.readFileSync(path.join(__dirname,'services/medicationNormalizationService.js'),'utf8');
test('B14 patcher is safe and idempotent',()=>{const out=patch(source);assert.match(out.code,/B14_VERSIONED_PROVENANCE/);assert.deepEqual(patch(out.code),{code:out.code,changed:false})});
test('B14 keeps historical mappings unversioned and includes source timestamps',()=>{const s=fs.readFileSync(path.join(root,'migrations/20261120_006_b14_mapping_provenance.sql'),'utf8');assert.match(s,/ADD COLUMN IF NOT EXISTS mapping_version text/);assert.doesNotMatch(s,/UPDATE .*mapping_version|DEFAULT 'v/);assert.match(s,/NOT VALID/)});
test('B14 existing fail-closed checks remain',()=>{const code=patch(source).code;assert.match(code,/AMBIGUOUS_MEDICATION_MAPPING/);assert.match(code,/INCOMPLETE_MEDICATION_MAPPING/);assert.match(code,/r\.mapping_version/)});
