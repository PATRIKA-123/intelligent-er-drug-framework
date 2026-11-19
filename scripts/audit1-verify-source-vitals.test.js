'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {csvParse,compare}=require('./audit1-verify-source-vitals');
test('CSV parser accepts embedded commas and CRLF',()=>{let r=csvParse('a,b\r\n"1,2",3\r\n');assert.deepEqual(r,[{a:'1,2',b:'3'}]);});
test('exact original-to-clean source comparison with mapped field names',()=>{
const clean=[{subject_id:'1',stay_id:'2',timestamp:'2151-01-25 19:18:00',temperature:'98.2',heart_rate:'82.0',respiratory_rate:'20.0',spo2:'100.0',systolic_bp:'11.0'}];
const source=[{subject_id:'1',stay_id:'2',charttime:'2151-01-25 19:18:00',temperature:'98.2',heartrate:'82',resprate:'20',o2sat:'100',sbp:'11',dbp:'184'}];
const out=compare(clean,source);assert.equal(out.rows_exactly_matched,1);assert.equal(out.rows_mismatched,0);assert.equal(out.suspicious_sbp_below_50[0].original_dbp,'184');});
test('mismatches fail closed; source units are never asserted',()=>{
const clean=[{subject_id:'1',stay_id:'2',timestamp:'t',temperature:'34.2',heart_rate:'80',respiratory_rate:'18',spo2:'98',systolic_bp:'110'}];
const source=[{subject_id:'1',stay_id:'2',charttime:'t',temperature:'34.2',heartrate:'80',resprate:'18',o2sat:'98',sbp:'120'}];
const out=compare(clean,source);assert.equal(out.rows_mismatched,1);assert.equal(out.unit_classification_by_range.celsius_compatible_unverified,0);});
